import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { BackupRepo } from '@infinity-docs/persistence';
import type { CredentialVault } from '@infinity-docs/backup';
import type { ConnectedOrg, CrmType } from '@infinity-docs/shared';

export interface BackupOrgRouteDeps {
  repo: BackupRepo;
  vault: CredentialVault;
}

interface ConnectBody {
  tenantId?: string;
  crmType?: string;
  displayName?: string;
  instanceUrl?: string;
  externalOrgId?: string;
  isSandbox?: boolean;
  refreshToken?: string;
  accessToken?: string;
  expiresIn?: number;
  gitRemoteUrl?: string | null;
}

export function registerBackupOrgRoutes(app: FastifyInstance, deps: BackupOrgRouteDeps): void {
  // List all connected orgs for a tenant
  app.get(
    '/admin/api/backup/orgs',
    { preHandler: [app.requireAdmin] },
    async (req, reply) => {
      const q = req.query as { tenantId?: string };
      if (!q.tenantId) return reply.code(400).send({ error: 'tenantId required' });
      return { orgs: deps.repo.connectedOrgs.findByTenant(q.tenantId) };
    },
  );

  // Register a new connected org (manual credential entry — demo path)
  app.post(
    '/admin/api/backup/orgs',
    { preHandler: [app.requireAdmin] },
    async (req, reply) => {
      const body = (req.body ?? {}) as ConnectBody;
      const { tenantId, crmType, displayName, instanceUrl, externalOrgId, refreshToken, accessToken } = body;

      if (!tenantId || !crmType || !displayName || !instanceUrl || !externalOrgId || !refreshToken || !accessToken) {
        return reply.code(400).send({
          error: 'tenantId, crmType, displayName, instanceUrl, externalOrgId, refreshToken, accessToken required',
        });
      }
      if (crmType !== 'salesforce' && crmType !== 'hubspot') {
        return reply.code(400).send({ error: 'crmType must be salesforce or hubspot' });
      }

      const expiresIn = typeof body.expiresIn === 'number' ? body.expiresIn : 7200;
      const now = Date.now();
      const orgId = randomUUID();

      // Encrypt the refresh token before inserting
      const encryptedRefreshToken = deps.vault.encrypt(tenantId, refreshToken);

      const org: ConnectedOrg = {
        id: orgId,
        tenantId,
        crmType: crmType as CrmType,
        displayName,
        instanceUrl,
        externalOrgId,
        isSandbox: body.isSandbox ?? false,
        oauthRefreshTokenEncrypted: encryptedRefreshToken,
        oauthAccessTokenCache: accessToken,
        accessTokenExpiresAt: now + expiresIn * 1000,
        gitRemoteUrl: body.gitRemoteUrl ?? null,
        connectedAt: now,
        lastUsedAt: null,
      };

      deps.repo.connectedOrgs.insert(org);

      return reply.code(201).send({ orgId });
    },
  );

  // Disconnect an org (deletes from DB — cascades to scopes)
  app.delete<{ Params: { id: string } }>(
    '/admin/api/backup/orgs/:id',
    { preHandler: [app.requireAdmin] },
    async (req, reply) => {
      const org = deps.repo.connectedOrgs.findById(req.params.id);
      if (!org) return reply.code(404).send({ error: 'not found' });
      deps.repo.connectedOrgs.delete(req.params.id);
      return reply.code(204).send();
    },
  );
}
