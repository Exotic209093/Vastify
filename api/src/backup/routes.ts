import { Hono } from 'hono';
import { randomUUID } from 'node:crypto';
import { requireApiKey, tenantOf } from '../auth/api-key.js';
import { getDb } from '../db/client.js';
import { getBackends } from '../object/registry.js';
import { loadConfig } from '../config.js';
import { createBackupRepo } from './repo.js';
import { CredentialVault } from './credential-vault.js';
import { GitSync } from './git-sync.js';
import { BackupEngine } from './backup-engine.js';
import type { ConnectedOrg, BackupScope, Snapshot, CrmType } from './types.js';

const routes = new Hono();

routes.use('*', requireApiKey);

// Lazy singletons — initialized on first request to avoid startup cost
let _repo: ReturnType<typeof createBackupRepo> | undefined;
let _vault: CredentialVault | undefined;
let _gitSync: GitSync | undefined;

function getRepo() {
  if (!_repo) _repo = createBackupRepo(getDb());
  return _repo;
}

function getVault() {
  if (!_vault) {
    const config = loadConfig();
    _vault = new CredentialVault({
      repo: getRepo(),
      masterKey: Buffer.from(config.vaultMasterKeyHex, 'hex'),
      oauthClients: {
        salesforce: { clientId: config.sfClientId, clientSecret: config.sfClientSecret },
        hubspot: { clientId: config.hsClientId, clientSecret: config.hsClientSecret },
      },
    });
  }
  return _vault;
}

function getGitSync() {
  if (!_gitSync) {
    const config = loadConfig();
    _gitSync = new GitSync({ gitDataDir: config.backupGitDataDir });
  }
  return _gitSync;
}

function getEngine(): BackupEngine {
  const backends = getBackends();
  const backend = backends.values().next().value as import('../object/backend.js').ObjectBackend | undefined;
  if (!backend) throw new Error('No storage backend configured');
  return new BackupEngine({
    repo: getRepo(),
    vault: getVault(),
    gitSync: getGitSync(),
    backend,
  });
}

// ─── Connected Orgs ───────────────────────────────────────────────────────────

routes.get('/orgs', (c) => {
  const tenantId = tenantOf(c);
  const orgs = getRepo().connectedOrgs.findByTenant(tenantId);
  return c.json({ orgs });
});

routes.post('/orgs', async (c) => {
  const tenantId = tenantOf(c);
  const body = await c.req.json<{
    crmType?: string; displayName?: string; instanceUrl?: string;
    externalOrgId?: string; isSandbox?: boolean;
    refreshToken?: string; accessToken?: string; expiresIn?: number;
    gitRemoteUrl?: string | null;
  }>();

  const { crmType, displayName, instanceUrl, externalOrgId, refreshToken, accessToken } = body;
  if (!crmType || !displayName || !instanceUrl || !externalOrgId || !refreshToken || !accessToken) {
    return c.json({ error: 'crmType, displayName, instanceUrl, externalOrgId, refreshToken, accessToken required' }, 400);
  }
  if (crmType !== 'salesforce' && crmType !== 'hubspot') {
    return c.json({ error: 'crmType must be salesforce or hubspot' }, 400);
  }

  const expiresIn = typeof body.expiresIn === 'number' ? body.expiresIn : 7200;
  const now = Date.now();
  const orgId = randomUUID();
  const encryptedRefreshToken = getVault().encrypt(tenantId, refreshToken);

  const org: ConnectedOrg = {
    id: orgId, tenantId, crmType: crmType as CrmType,
    displayName, instanceUrl, externalOrgId,
    isSandbox: body.isSandbox ?? false,
    oauthRefreshTokenEncrypted: encryptedRefreshToken,
    oauthAccessTokenCache: accessToken,
    accessTokenExpiresAt: now + expiresIn * 1000,
    gitRemoteUrl: body.gitRemoteUrl ?? null,
    connectedAt: now, lastUsedAt: null,
  };

  getRepo().connectedOrgs.insert(org);
  return c.json({ orgId }, 201);
});

routes.delete('/orgs/:id', (c) => {
  const tenantId = tenantOf(c);
  const org = getRepo().connectedOrgs.findById(c.req.param('id'));
  if (!org || org.tenantId !== tenantId) return c.json({ error: 'not found' }, 404);
  getRepo().connectedOrgs.delete(c.req.param('id'));
  return new Response(null, { status: 204 });
});

// ─── Backup Scopes ────────────────────────────────────────────────────────────

routes.get('/scopes', (c) => {
  const tenantId = tenantOf(c);
  const connectedOrgId = c.req.query('connectedOrgId');
  if (!connectedOrgId) return c.json({ error: 'connectedOrgId required' }, 400);

  const org = getRepo().connectedOrgs.findById(connectedOrgId);
  if (!org || org.tenantId !== tenantId) return c.json({ error: 'not found' }, 404);

  return c.json({ scopes: getRepo().backupScopes.findByOrg(connectedOrgId) });
});

routes.post('/scopes', async (c) => {
  const tenantId = tenantOf(c);
  const body = await c.req.json<{
    connectedOrgId?: string; name?: string; rootObject?: string;
    maxDepth?: number; includeFiles?: boolean; includeMetadata?: boolean;
  }>();

  const { connectedOrgId, name, rootObject } = body;
  if (!connectedOrgId || !name || !rootObject) {
    return c.json({ error: 'connectedOrgId, name, rootObject required' }, 400);
  }
  const org = getRepo().connectedOrgs.findById(connectedOrgId);
  if (!org || org.tenantId !== tenantId) return c.json({ error: 'connectedOrg not found' }, 404);

  const scope: BackupScope = {
    id: randomUUID(), tenantId, connectedOrgId, name, rootObject,
    maxDepth: typeof body.maxDepth === 'number' ? body.maxDepth : 3,
    includeFiles: body.includeFiles ?? true,
    includeMetadata: body.includeMetadata ?? true,
    createdAt: Date.now(),
  };

  getRepo().backupScopes.insert(scope);
  return c.json({ scopeId: scope.id }, 201);
});

routes.delete('/scopes/:id', (c) => {
  const tenantId = tenantOf(c);
  const scope = getRepo().backupScopes.findById(c.req.param('id'));
  if (!scope || scope.tenantId !== tenantId) return c.json({ error: 'not found' }, 404);
  getRepo().backupScopes.delete(c.req.param('id'));
  return new Response(null, { status: 204 });
});

// ─── Snapshots ────────────────────────────────────────────────────────────────

routes.get('/snapshots', (c) => {
  const tenantId = tenantOf(c);
  const limitStr = c.req.query('limit');
  const limit = limitStr ? Number.parseInt(limitStr, 10) : 50;
  const snapshots = getRepo().snapshots.findByTenant(tenantId, Number.isFinite(limit) ? limit : 50);
  return c.json({ snapshots });
});

routes.get('/snapshots/:id', (c) => {
  const tenantId = tenantOf(c);
  const snap = getRepo().snapshots.findById(c.req.param('id'));
  if (!snap || snap.tenantId !== tenantId) return c.json({ error: 'not found' }, 404);
  return c.json(snap);
});

routes.post('/snapshots', async (c) => {
  const tenantId = tenantOf(c);
  const body = await c.req.json<{ connectedOrgId?: string; scopeId?: string }>();
  const { connectedOrgId, scopeId } = body;

  if (!connectedOrgId || !scopeId) {
    return c.json({ error: 'connectedOrgId, scopeId required' }, 400);
  }
  const org = getRepo().connectedOrgs.findById(connectedOrgId);
  if (!org || org.tenantId !== tenantId) return c.json({ error: 'connectedOrg not found' }, 404);

  const scope = getRepo().backupScopes.findById(scopeId);
  if (!scope || scope.tenantId !== tenantId) return c.json({ error: 'scope not found' }, 404);

  const snapshotId = randomUUID();
  const now = Date.now();

  const snap: Snapshot = {
    id: snapshotId, tenantId, connectedOrgId, backupScopeId: scopeId,
    status: 'pending', archiveStorageKey: null, archiveBackendId: null, gitCommitSha: null,
    recordCount: null, fileCount: null, metadataItemCount: null, sizeBytes: null,
    startedAt: now, completedAt: null, error: null,
  };

  getRepo().snapshots.insert(snap);

  // Fire and forget — poll GET /snapshots/:id for status
  queueMicrotask(() => {
    getEngine().run(snapshotId).catch((err: unknown) => {
      console.error({ err, snapshotId }, 'BackupEngine.run error');
    });
  });

  return c.json({ snapshotId }, 202);
});

export { routes as backupRoutes };
