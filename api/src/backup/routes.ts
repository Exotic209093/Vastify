import { Hono } from 'hono';
import { randomUUID } from 'node:crypto';
import { requireApiKey, tenantOf } from '../auth/api-key.js';
import { getDb } from '../db/client.js';
import { getBackends } from '../object/registry.js';
import { loadConfig } from '../config.js';
import { createBackupRepo } from './repo.js';
import { CredentialVault } from './credential-vault.js';
import { GitSync } from './git-sync.js';
import { BackupEngine, createCrmAdapter } from './backup-engine.js';
import { DiffEngine } from './diff-engine.js';
import { DiffPlanStore } from './diff-plan-store.js';
import { RestoreExecutor } from './restore-executor.js';
import type { ConnectedOrg, BackupScope, Snapshot, CrmType, DiffPlan, RestoreJob, RestoreJobMode } from './types.js';

const routes = new Hono();

routes.use('*', requireApiKey);

// Lazy singletons — initialized on first request to avoid startup cost
let _repo: ReturnType<typeof createBackupRepo> | undefined;
let _vault: CredentialVault | undefined;
let _gitSync: GitSync | undefined;
let _diffPlanStore: DiffPlanStore | undefined;
let _restoreExecutor: RestoreExecutor | undefined;

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

function getBackend() {
  const backends = getBackends();
  const backend = backends.values().next().value as import('../object/backend.js').ObjectBackend | undefined;
  if (!backend) throw new Error('No storage backend configured');
  return backend;
}

function getEngine(): BackupEngine {
  return new BackupEngine({
    repo: getRepo(),
    vault: getVault(),
    gitSync: getGitSync(),
    backend: getBackend(),
  });
}

function getDiffPlanStore() {
  if (!_diffPlanStore) _diffPlanStore = new DiffPlanStore(getBackend());
  return _diffPlanStore;
}

function getRestoreExecutor() {
  if (!_restoreExecutor) _restoreExecutor = new RestoreExecutor();
  return _restoreExecutor;
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

// ─── Diff ─────────────────────────────────────────────────────────────────────

routes.post('/snapshots/:id/diff', async (c) => {
  const tenantId = tenantOf(c);
  const snap = getRepo().snapshots.findById(c.req.param('id'));
  if (!snap || snap.tenantId !== tenantId) return c.json({ error: 'snapshot not found' }, 404);
  if (snap.status !== 'complete') return c.json({ error: 'snapshot must be complete before diffing' }, 400);
  if (!snap.archiveStorageKey) return c.json({ error: 'snapshot has no archive' }, 400);

  const body = await c.req.json<{ targetOrgId?: string }>();
  if (!body.targetOrgId) return c.json({ error: 'targetOrgId required' }, 400);

  const targetOrg = getRepo().connectedOrgs.findById(body.targetOrgId);
  if (!targetOrg || targetOrg.tenantId !== tenantId) return c.json({ error: 'target org not found' }, 404);

  const planId = randomUUID();
  const accessToken = await getVault().getAccessToken(tenantId, body.targetOrgId);
  const targetAdapter = createCrmAdapter(targetOrg, accessToken);
  const engine = new DiffEngine(getBackend());

  const diffDoc = await engine.buildDiff({
    planId,
    snapshotId: snap.id,
    tenantId,
    targetOrgId: body.targetOrgId,
    snapshotStorageKey: snap.archiveStorageKey,
    targetAdapter,
  });

  const storageKey = await getDiffPlanStore().save(tenantId, planId, diffDoc);

  const plan: DiffPlan = {
    id: planId, tenantId, snapshotId: snap.id, targetOrgId: body.targetOrgId,
    storageKey, backendId: snap.archiveBackendId ?? 'gcs',
    targetStateHash: diffDoc.targetStateHash,
    summaryCounts: JSON.stringify(diffDoc.counts),
    builtAt: Date.now(), expiresAt: null,
  };
  getRepo().diffPlans.insert(plan);

  return c.json({ diffPlanId: planId }, 201);
});

routes.get('/diff-plans/:id', (c) => {
  const tenantId = tenantOf(c);
  const plan = getRepo().diffPlans.findById(c.req.param('id'));
  if (!plan || plan.tenantId !== tenantId) return c.json({ error: 'not found' }, 404);
  return c.json(plan);
});

// List existing diff plans for a snapshot — used by the SnapshotDetail page
// to auto-load a pre-built plan instead of forcing the user to click Build Diff.
// Optional ?targetOrgId= filter.
routes.get('/snapshots/:snapshotId/diff-plans', (c) => {
  const tenantId = tenantOf(c);
  const snapshotId = c.req.param('snapshotId');
  const targetOrgId = c.req.query('targetOrgId');
  const repo = getRepo();
  const snap = repo.snapshots.findById(snapshotId);
  if (!snap || snap.tenantId !== tenantId) return c.json({ error: 'not found' }, 404);

  // findBySnapshot requires a targetOrgId. If none supplied, scan all of the
  // tenant's connected orgs and merge.
  let plans;
  if (targetOrgId) {
    plans = repo.diffPlans.findBySnapshot(snapshotId, targetOrgId);
  } else {
    const orgs = repo.connectedOrgs.findByTenant(tenantId);
    plans = orgs.flatMap((o) => repo.diffPlans.findBySnapshot(snapshotId, o.id));
  }
  // Newest first (findBySnapshot already orders DESC, but we re-sort after merge).
  plans.sort((a, b) => b.builtAt - a.builtAt);
  return c.json({ plans });
});

// ─── Restore ──────────────────────────────────────────────────────────────────

const VALID_MODES = new Set<RestoreJobMode>(['dry-run', 'execute']);

routes.post('/snapshots/:id/restore', async (c) => {
  const tenantId = tenantOf(c);
  const snap = getRepo().snapshots.findById(c.req.param('id'));
  if (!snap || snap.tenantId !== tenantId) return c.json({ error: 'snapshot not found' }, 404);
  if (snap.status !== 'complete') return c.json({ error: 'snapshot must be complete before restoring' }, 400);

  const body = await c.req.json<{
    targetOrgId?: string; diffPlanId?: string; mode?: string; confirm?: boolean;
  }>();
  const { targetOrgId, diffPlanId, mode } = body;

  if (!targetOrgId || !diffPlanId || !mode) {
    return c.json({ error: 'targetOrgId, diffPlanId, mode required' }, 400);
  }
  if (!VALID_MODES.has(mode as RestoreJobMode)) {
    return c.json({ error: 'mode must be dry-run or execute' }, 400);
  }
  if (mode === 'execute' && body.confirm !== true) {
    return c.json({ error: 'confirm: true required for execute mode' }, 400);
  }

  const diffPlan = getRepo().diffPlans.findById(diffPlanId);
  if (!diffPlan || diffPlan.tenantId !== tenantId) return c.json({ error: 'diff plan not found' }, 404);
  if (diffPlan.snapshotId !== snap.id) return c.json({ error: 'diff plan does not belong to this snapshot' }, 400);

  const targetOrg = getRepo().connectedOrgs.findById(targetOrgId);
  if (!targetOrg || targetOrg.tenantId !== tenantId) return c.json({ error: 'target org not found' }, 404);

  const jobId = randomUUID();
  const now = Date.now();

  const job: RestoreJob = {
    id: jobId, tenantId, snapshotId: snap.id, targetOrgId, mode: mode as RestoreJobMode,
    status: 'pending', diffPlanStorageKey: diffPlan.storageKey,
    appliedChangesSummary: null, startedAt: now, completedAt: null, error: null,
  };
  getRepo().restoreJobs.insert(job);

  // Fire and forget — poll GET /restores/:id for status
  queueMicrotask(async () => {
    const repo = getRepo();
    repo.restoreJobs.updateStatus(jobId, 'running');
    try {
      const diffDoc = await getDiffPlanStore().load(diffPlan.storageKey);
      const accessToken = await getVault().getAccessToken(tenantId, targetOrgId);
      const targetAdapter = createCrmAdapter(targetOrg, accessToken);
      const result = await getRestoreExecutor().execute({
        doc: diffDoc, targetAdapter, dryRun: mode === 'dry-run',
      });
      const summary = JSON.stringify({
        applied: result.applied, skipped: result.skipped,
        failed: result.failed, errorCount: result.errors.length,
      });
      repo.restoreJobs.updateStatus(jobId, result.failed > 0 ? 'partial' : 'complete', {
        appliedChangesSummary: summary, completedAt: Date.now(),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      repo.restoreJobs.updateStatus(jobId, 'failed', { completedAt: Date.now(), error: message });
    }
  });

  return c.json({ jobId }, 202);
});

routes.get('/restores', (c) => {
  const tenantId = tenantOf(c);
  const limitStr = c.req.query('limit');
  const limit = limitStr ? Number.parseInt(limitStr, 10) : 50;
  const jobs = getRepo().restoreJobs.findByTenant(tenantId, Number.isFinite(limit) ? limit : 50);
  return c.json({ jobs });
});

routes.get('/restores/:id', (c) => {
  const tenantId = tenantOf(c);
  const job = getRepo().restoreJobs.findById(c.req.param('id'));
  if (!job || job.tenantId !== tenantId) return c.json({ error: 'not found' }, 404);
  return c.json(job);
});

export { routes as backupRoutes };
