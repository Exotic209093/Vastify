import {
  createCipheriv, createDecipheriv, randomBytes, hkdfSync,
} from 'node:crypto';
import type { BackupRepo } from '@infinity-docs/persistence';
import type { ConnectedOrg } from '@infinity-docs/shared';
import { CredentialNotFoundError, TokenRefreshError } from './errors.js';

interface OAuthClientConfig {
  clientId: string;
  clientSecret: string;
}

export interface CredentialVaultOptions {
  repo: BackupRepo;
  masterKey: Buffer;
  oauthClients: {
    salesforce: OAuthClientConfig;
    hubspot: OAuthClientConfig;
  };
}

export class CredentialVault {
  constructor(private opts: CredentialVaultOptions) {}

  private getTenantKey(tenantId: string): Buffer {
    return Buffer.from(
      hkdfSync('sha256', this.opts.masterKey, Buffer.from(tenantId), 'infinity-docs-vault-v1', 32),
    );
  }

  encrypt(tenantId: string, plaintext: string): string {
    const key = this.getTenantKey(tenantId);
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`;
  }

  decrypt(tenantId: string, encoded: string): string {
    const key = this.getTenantKey(tenantId);
    const parts = encoded.split(':');
    if (parts.length !== 3) throw new Error('Invalid encrypted credential format');
    const [ivB64, tagB64, encB64] = parts as [string, string, string];
    const iv = Buffer.from(ivB64, 'base64');
    const tag = Buffer.from(tagB64, 'base64');
    const encrypted = Buffer.from(encB64, 'base64');
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
  }

  async getAccessToken(tenantId: string, connectedOrgId: string): Promise<string> {
    const org = this.opts.repo.connectedOrgs.findById(connectedOrgId);
    if (!org) throw new CredentialNotFoundError(connectedOrgId);

    // TODO(Plan 2): add per-org in-flight deduplication. HubSpot rotates refresh
    // tokens on each use — two concurrent expired-cache calls will race, the second
    // will consume the already-used token and fail.
    const now = Date.now();
    if (org.oauthAccessTokenCache && org.accessTokenExpiresAt && org.accessTokenExpiresAt > now + 60_000) {
      this.opts.repo.connectedOrgs.update(connectedOrgId, { lastUsedAt: now });
      return org.oauthAccessTokenCache;
    }

    const refreshToken = this.decrypt(tenantId, org.oauthRefreshTokenEncrypted);
    const tokens = await this.refreshToken(org, refreshToken);

    this.opts.repo.connectedOrgs.update(connectedOrgId, {
      oauthAccessTokenCache: tokens.accessToken,
      accessTokenExpiresAt: now + tokens.expiresIn * 1000,
      lastUsedAt: now,
    });

    return tokens.accessToken;
  }

  storeInitialCredentials(
    tenantId: string,
    connectedOrgId: string,
    refreshToken: string,
    accessToken: string,
    expiresIn: number,
  ): void {
    const encrypted = this.encrypt(tenantId, refreshToken);
    this.opts.repo.connectedOrgs.update(connectedOrgId, {
      oauthRefreshTokenEncrypted: encrypted,
      oauthAccessTokenCache: accessToken,
      accessTokenExpiresAt: Date.now() + expiresIn * 1000,
    });
  }

  private async refreshToken(
    org: ConnectedOrg,
    refreshToken: string,
  ): Promise<{ accessToken: string; expiresIn: number }> {
    return org.crmType === 'salesforce'
      ? this.refreshSalesforceToken(org.instanceUrl, refreshToken)
      : this.refreshHubSpotToken(refreshToken);
  }

  private async refreshSalesforceToken(
    instanceUrl: string,
    refreshToken: string,
  ): Promise<{ accessToken: string; expiresIn: number }> {
    const { clientId, clientSecret } = this.opts.oauthClients.salesforce;
    const resp = await fetch(`${instanceUrl}/services/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
      }),
    });
    if (!resp.ok) {
      const body = await resp.text();
      throw new TokenRefreshError('salesforce', resp.status, body.slice(0, 200));
    }
    const json = await resp.json() as { access_token: string };
    // Salesforce does not return expires_in; 7200s (2h) matches the default
    // session timeout. Orgs with custom timeout settings may expire sooner.
    return { accessToken: json.access_token, expiresIn: 7200 };
  }

  private async refreshHubSpotToken(
    refreshToken: string,
  ): Promise<{ accessToken: string; expiresIn: number }> {
    const { clientId, clientSecret } = this.opts.oauthClients.hubspot;
    const resp = await fetch('https://api.hubapi.com/oauth/v1/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
      }),
    });
    if (!resp.ok) {
      const body = await resp.text();
      throw new TokenRefreshError('hubspot', resp.status, body.slice(0, 200));
    }
    const json = await resp.json() as { access_token: string; expires_in: number };
    return { accessToken: json.access_token, expiresIn: json.expires_in };
  }
}
