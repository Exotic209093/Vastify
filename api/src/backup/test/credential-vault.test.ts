import { describe, it, expect, mock, beforeEach, spyOn } from 'bun:test';
import { CredentialVault } from '../credential-vault.js';
import type { BackupRepo } from '../repo.js';

type MockFn = ReturnType<typeof mock>;

const MASTER_KEY = Buffer.alloc(32, 0xab);

const OAUTH_CLIENTS = {
  salesforce: { clientId: 'sf-client', clientSecret: 'sf-secret' },
  hubspot: { clientId: 'hs-client', clientSecret: 'hs-secret' },
};

function makeRepo(orgOverride?: Record<string, unknown>): BackupRepo {
  const org = {
    id: 'org-1', tenantId: 'tenant-a', crmType: 'salesforce', displayName: 'Acme',
    instanceUrl: 'https://acme.my.salesforce.com', externalOrgId: '00D',
    isSandbox: false, oauthRefreshTokenEncrypted: '',
    oauthAccessTokenCache: null, accessTokenExpiresAt: null,
    gitRemoteUrl: null, connectedAt: 1000, lastUsedAt: null,
    ...orgOverride,
  };

  return {
    connectedOrgs: {
      insert: mock(),
      findById: mock(() => org),
      findByTenant: mock(() => [org]),
      update: mock(),
      delete: mock(),
    },
    backupScopes: { insert: mock(), findById: mock(), findByOrg: mock(() => []), delete: mock() },
    snapshots: { insert: mock(), findById: mock(), findByTenant: mock(() => []), updateStatus: mock() },
    diffPlans: { insert: mock(), findById: mock(), findBySnapshot: mock(() => []) },
    restoreJobs: { insert: mock(), findById: mock(), findByTenant: mock(() => []), updateStatus: mock() },
  } as unknown as BackupRepo;
}

describe('CredentialVault — encryption', () => {
  let vault: CredentialVault;

  beforeEach(() => {
    vault = new CredentialVault({ repo: makeRepo(), masterKey: MASTER_KEY, oauthClients: OAUTH_CLIENTS });
  });

  it('round-trips a refresh token through encrypt/decrypt', () => {
    const original = 'my-super-secret-refresh-token';
    const encrypted = vault.encrypt('tenant-a', original);
    expect(encrypted).not.toBe(original);
    expect(encrypted.split(':')).toHaveLength(3);
    expect(vault.decrypt('tenant-a', encrypted)).toBe(original);
  });

  it('produces different ciphertext for the same plaintext (random IV)', () => {
    const enc1 = vault.encrypt('tenant-a', 'token');
    const enc2 = vault.encrypt('tenant-a', 'token');
    expect(enc1).not.toBe(enc2);
  });

  it('uses different keys for different tenants', () => {
    const encrypted = vault.encrypt('tenant-a', 'token');
    expect(() => vault.decrypt('tenant-b', encrypted)).toThrow();
  });
});

describe('CredentialVault — getAccessToken', () => {
  it('returns cached token if not expired', async () => {
    const repo = makeRepo({
      oauthAccessTokenCache: 'cached-token',
      accessTokenExpiresAt: Date.now() + 3_600_000,
    });
    const vault = new CredentialVault({ repo, masterKey: MASTER_KEY, oauthClients: OAUTH_CLIENTS });
    const token = await vault.getAccessToken('tenant-a', 'org-1');
    expect(token).toBe('cached-token');
  });

  it('refreshes token when cache is expired', async () => {
    const encryptedRefresh = new CredentialVault({
      repo: makeRepo(), masterKey: MASTER_KEY, oauthClients: OAUTH_CLIENTS,
    }).encrypt('tenant-a', 'my-refresh-token');

    const repo = makeRepo({
      oauthRefreshTokenEncrypted: encryptedRefresh,
      oauthAccessTokenCache: 'old-token',
      accessTokenExpiresAt: Date.now() - 1000,
    });
    const vault = new CredentialVault({ repo, masterKey: MASTER_KEY, oauthClients: OAUTH_CLIENTS });

    const fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: 'new-token', issued_at: String(Date.now()) }),
    } as unknown as Response);

    const token = await vault.getAccessToken('tenant-a', 'org-1');
    expect(token).toBe('new-token');
    expect(repo.connectedOrgs.update).toHaveBeenCalledWith('org-1', expect.objectContaining({
      oauthAccessTokenCache: 'new-token',
    }));

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://acme.my.salesforce.com/services/oauth2/token');
    const body = new URLSearchParams(init.body as string);
    expect(body.get('grant_type')).toBe('refresh_token');
    expect(body.get('refresh_token')).toBe('my-refresh-token');
    expect(body.get('client_id')).toBe('sf-client');

    fetchSpy.mockRestore();
  });

  it('throws CredentialNotFoundError when org is not found', async () => {
    const repo = makeRepo();
    (repo.connectedOrgs.findById as MockFn).mockImplementation(() => null);
    const vault = new CredentialVault({ repo, masterKey: MASTER_KEY, oauthClients: OAUTH_CLIENTS });
    await expect(vault.getAccessToken('tenant-a', 'missing-org'))
      .rejects.toThrow('No credentials found for connected org: missing-org');
  });

  it('refreshes HubSpot token when cache is expired', async () => {
    const encryptedRefresh = new CredentialVault({
      repo: makeRepo(), masterKey: MASTER_KEY, oauthClients: OAUTH_CLIENTS,
    }).encrypt('tenant-a', 'my-hs-refresh-token');

    const repo = makeRepo({
      crmType: 'hubspot',
      instanceUrl: 'https://api.hubapi.com',
      oauthRefreshTokenEncrypted: encryptedRefresh,
      oauthAccessTokenCache: null,
      accessTokenExpiresAt: null,
    });
    const vault = new CredentialVault({ repo, masterKey: MASTER_KEY, oauthClients: OAUTH_CLIENTS });

    const fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: 'hs-new-token', expires_in: 1800 }),
    } as unknown as Response);

    const token = await vault.getAccessToken('tenant-a', 'org-1');
    expect(token).toBe('hs-new-token');
    expect(repo.connectedOrgs.update).toHaveBeenCalledWith('org-1', expect.objectContaining({
      oauthAccessTokenCache: 'hs-new-token',
    }));
    fetchSpy.mockRestore();
  });
});

describe('CredentialVault — storeInitialCredentials', () => {
  it('encrypts the refresh token and writes all fields to repo', () => {
    const repo = makeRepo();
    const vault = new CredentialVault({ repo, masterKey: MASTER_KEY, oauthClients: OAUTH_CLIENTS });
    vault.storeInitialCredentials('tenant-a', 'org-1', 'my-refresh', 'my-access', 3600);
    expect(repo.connectedOrgs.update).toHaveBeenCalledWith('org-1', expect.objectContaining({
      oauthAccessTokenCache: 'my-access',
    }));
    const callArgs = (repo.connectedOrgs.update as MockFn).mock.calls[0][1] as Record<string, unknown>;
    expect(callArgs['oauthRefreshTokenEncrypted']).not.toBe('my-refresh');
    expect(vault.decrypt('tenant-a', callArgs['oauthRefreshTokenEncrypted'] as string)).toBe('my-refresh');
    expect(callArgs['accessTokenExpiresAt'] as number).toBeGreaterThan(Date.now() + 3_500_000);
  });
});
