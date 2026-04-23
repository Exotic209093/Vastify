import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BackupEngine } from '../src/backup-engine.js';
import type { BackupRepo } from '@infinity-docs/persistence';
import type { CredentialVault } from '../src/credential-vault.js';
import type { GitSync } from '../src/git-sync.js';
import type { ConnectedOrg, BackupScope, Snapshot } from '@infinity-docs/shared';
import type { CRMAdapter, CrmRecord } from '../src/crm/types.js';

function makeOrg(): ConnectedOrg {
  return {
    id: 'org-1', tenantId: 'tenant-a', crmType: 'salesforce',
    displayName: 'Acme', instanceUrl: 'https://acme.my.sf.com',
    externalOrgId: '00D01', isSandbox: false,
    oauthRefreshTokenEncrypted: 'enc', oauthAccessTokenCache: null,
    accessTokenExpiresAt: null, gitRemoteUrl: null, connectedAt: 1000, lastUsedAt: null,
  };
}

function makeScope(): BackupScope {
  return {
    id: 'scope-1', tenantId: 'tenant-a', connectedOrgId: 'org-1',
    name: 'All Accounts', rootObject: 'Account', maxDepth: 2,
    includeFiles: false, includeMetadata: true, createdAt: 1000,
  };
}

function makeSnapshot(): Snapshot {
  return {
    id: 'snap-1', tenantId: 'tenant-a', connectedOrgId: 'org-1',
    backupScopeId: 'scope-1', status: 'pending',
    archiveStorageKey: null, archiveStorageAdapter: null, gitCommitSha: null,
    recordCount: null, fileCount: null, metadataItemCount: null, sizeBytes: null,
    startedAt: 1000, completedAt: null, error: null,
  };
}

function makeRepo(snap: Snapshot, scope: BackupScope, org: ConnectedOrg): BackupRepo {
  return {
    connectedOrgs: {
      insert: vi.fn(), findById: vi.fn().mockReturnValue(org),
      findByTenant: vi.fn(), update: vi.fn(), delete: vi.fn(),
    },
    backupScopes: {
      insert: vi.fn(), findById: vi.fn().mockReturnValue(scope),
      findByOrg: vi.fn(), delete: vi.fn(),
    },
    snapshots: {
      insert: vi.fn(), findById: vi.fn().mockReturnValue(snap),
      findByTenant: vi.fn(), updateStatus: vi.fn(),
    },
    diffPlans: { insert: vi.fn(), findById: vi.fn(), findBySnapshot: vi.fn() },
    restoreJobs: { insert: vi.fn(), findById: vi.fn(), findByTenant: vi.fn(), updateStatus: vi.fn() },
  } as unknown as BackupRepo;
}

function makeVault(accessToken = 'tok-abc'): CredentialVault {
  return {
    getAccessToken: vi.fn().mockResolvedValue(accessToken),
    encrypt: vi.fn(),
    decrypt: vi.fn(),
    storeInitialCredentials: vi.fn(),
  } as unknown as CredentialVault;
}

function makeGitSync(sha = 'abc1234'): GitSync {
  return {
    commitSnapshot: vi.fn().mockResolvedValue({ commitSha: sha }),
  } as unknown as GitSync;
}

function makeAdapter(records: Record<string, CrmRecord[]> = {}): CRMAdapter {
  return {
    listObjects: vi.fn(),
    describe: vi.fn().mockResolvedValue({ name: 'Account', label: 'Account', fields: [], childRelationships: [] }),
    queryRecords: vi.fn(async function* (objectName: string) {
      for (const r of records[objectName] ?? []) yield r;
    }) as CRMAdapter['queryRecords'],
    downloadFile: vi.fn().mockResolvedValue(Buffer.from('')),
    upsertRecord: vi.fn(),
    deployMetadata: vi.fn(),
    uploadFile: vi.fn(),
  };
}

describe('BackupEngine', () => {
  let snapshotsDir: string;

  beforeEach(async () => {
    const { mkdirSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { tmpdir } = await import('node:os');
    const { randomUUID } = await import('node:crypto');
    snapshotsDir = join(tmpdir(), `engine-test-${randomUUID()}`);
    mkdirSync(snapshotsDir, { recursive: true });
  });

  it('sets status to running then complete with counts on success', async () => {
    const snap = makeSnapshot();
    const scope = makeScope();
    const org = makeOrg();
    const repo = makeRepo(snap, scope, org);
    const vault = makeVault();
    const gitSync = makeGitSync();
    const adapter = makeAdapter({ Account: [{ Id: 'a1' }, { Id: 'a2' }] });

    const engine = new BackupEngine({
      repo, vault, gitSync,
      snapshotCapture: { snapshotsDir },
      log: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } as unknown as import('pino').Logger,
      adapterFactory: () => adapter,
    });

    await engine.run('snap-1');

    const updateStatus = repo.snapshots.updateStatus as ReturnType<typeof vi.fn>;
    expect(updateStatus).toHaveBeenCalledWith('snap-1', 'running');
    const [, secondStatus, secondPatch] = updateStatus.mock.calls[1] as [string, string, Record<string, unknown>];
    expect(secondStatus).toBe('complete');
    expect(secondPatch['recordCount']).toBe(2);
    expect(secondPatch['gitCommitSha']).toBe('abc1234');
    expect(secondPatch['archiveStorageAdapter']).toBe('local');
  });

  it('sets status to failed when adapter throws', async () => {
    const snap = makeSnapshot();
    const scope = makeScope();
    const org = makeOrg();
    const repo = makeRepo(snap, scope, org);
    const vault = makeVault();
    const gitSync = makeGitSync();
    const adapter = makeAdapter();
    (adapter.describe as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('SF unavailable'));

    const engine = new BackupEngine({
      repo, vault, gitSync,
      snapshotCapture: { snapshotsDir },
      log: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } as unknown as import('pino').Logger,
      adapterFactory: () => adapter,
    });

    await expect(engine.run('snap-1')).rejects.toThrow('SF unavailable');

    const updateStatus = repo.snapshots.updateStatus as ReturnType<typeof vi.fn>;
    const [, failStatus, failPatch] = updateStatus.mock.calls[1] as [string, string, Record<string, unknown>];
    expect(failStatus).toBe('failed');
    expect(String(failPatch['error'])).toContain('SF unavailable');
  });

  it('completes successfully even when git sync fails', async () => {
    const snap = makeSnapshot();
    const scope = makeScope();
    const org = makeOrg();
    const repo = makeRepo(snap, scope, org);
    const vault = makeVault();
    const gitSync = makeGitSync();
    (gitSync.commitSnapshot as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('push failed'));
    const adapter = makeAdapter();
    const warnSpy = vi.fn();

    const engine = new BackupEngine({
      repo, vault, gitSync,
      snapshotCapture: { snapshotsDir },
      log: { error: vi.fn(), warn: warnSpy, info: vi.fn() } as unknown as import('pino').Logger,
      adapterFactory: () => adapter,
    });

    await engine.run('snap-1');

    const updateStatus = repo.snapshots.updateStatus as ReturnType<typeof vi.fn>;
    const [, secondStatus] = updateStatus.mock.calls[1] as [string, string];
    expect(secondStatus).toBe('complete');
    expect(warnSpy).toHaveBeenCalled();
  });

  it('throws when snapshot is not found', async () => {
    const repo = makeRepo(makeSnapshot(), makeScope(), makeOrg());
    (repo.snapshots.findById as ReturnType<typeof vi.fn>).mockReturnValue(undefined);

    const engine = new BackupEngine({
      repo, vault: makeVault(), gitSync: makeGitSync(),
      snapshotCapture: { snapshotsDir },
      log: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } as unknown as import('pino').Logger,
      adapterFactory: () => makeAdapter(),
    });

    await expect(engine.run('nonexistent')).rejects.toThrow('Snapshot not found: nonexistent');
  });
});
