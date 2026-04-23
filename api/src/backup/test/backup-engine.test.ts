import { describe, it, expect, mock } from 'bun:test';
import { BackupEngine } from '../backup-engine.js';
import type { BackupRepo } from '../repo.js';
import type { CredentialVault } from '../credential-vault.js';
import type { GitSync } from '../git-sync.js';
import type { ConnectedOrg, BackupScope, Snapshot } from '../types.js';
import type { CRMAdapter, CrmRecord } from '../crm/types.js';
import type { ObjectBackend, PutResult, BackendId } from '../../object/backend.js';

type MockFn = ReturnType<typeof mock>;

function makeOrg(): ConnectedOrg {
  return {
    id: 'org-1', tenantId: 'tenant-a', crmType: 'salesforce',
    displayName: 'Acme', instanceUrl: 'https://acme.my.sf.com',
    externalOrgId: '00D01', isSandbox: false, oauthRefreshTokenEncrypted: 'enc',
    oauthAccessTokenCache: null, accessTokenExpiresAt: null, gitRemoteUrl: null,
    connectedAt: 1000, lastUsedAt: null,
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
    id: 'snap-1', tenantId: 'tenant-a', connectedOrgId: 'org-1', backupScopeId: 'scope-1',
    status: 'pending', archiveStorageKey: null, archiveBackendId: null, gitCommitSha: null,
    recordCount: null, fileCount: null, metadataItemCount: null, sizeBytes: null,
    startedAt: 1000, completedAt: null, error: null,
  };
}

function makeRepo(snap: Snapshot, scope: BackupScope, org: ConnectedOrg): BackupRepo {
  return {
    connectedOrgs: {
      insert: mock(), findById: mock(() => org),
      findByTenant: mock(() => []), update: mock(), delete: mock(),
    },
    backupScopes: {
      insert: mock(), findById: mock(() => scope), findByOrg: mock(() => []), delete: mock(),
    },
    snapshots: {
      insert: mock(), findById: mock(() => snap), findByTenant: mock(() => []), updateStatus: mock(),
    },
    diffPlans: { insert: mock(), findById: mock(), findBySnapshot: mock(() => []) },
    restoreJobs: { insert: mock(), findById: mock(), findByTenant: mock(() => []), updateStatus: mock() },
  } as unknown as BackupRepo;
}

function makeVault(accessToken = 'tok-abc'): CredentialVault {
  return { getAccessToken: mock(() => Promise.resolve(accessToken)) } as unknown as CredentialVault;
}

function makeGitSync(sha = 'abc1234'): GitSync {
  return { commitSnapshot: mock(() => Promise.resolve({ commitSha: sha })) } as unknown as GitSync;
}

function makeAdapter(records: Record<string, CrmRecord[]> = {}): CRMAdapter {
  return {
    listObjects: mock(() => Promise.resolve([])),
    describe: mock(() => Promise.resolve({ name: 'Account', label: 'Account', fields: [], childRelationships: [] })),
    queryRecords: mock(async function* (objectName: string) {
      for (const r of records[objectName] ?? []) yield r;
    }) as CRMAdapter['queryRecords'],
    downloadFile: mock(() => Promise.resolve(new Uint8Array(0))),
    upsertRecord: mock(() => Promise.resolve('')),
    deployMetadata: mock(() => Promise.resolve({ success: true, errors: [] })),
    uploadFile: mock(() => Promise.resolve('')),
  };
}

function makeBackend(): ObjectBackend {
  return {
    id: 'minio' as BackendId,
    put: mock(async (key: string, body: Uint8Array) => ({
      backendId: 'test' as BackendId,
      objectKey: key,
      storageClass: 'STANDARD',
      sizeBytes: body.length,
    } as unknown as PutResult)),
    get: mock(async () => new Uint8Array(0)),
    presignGet: mock(async () => ''),
    delete: mock(async () => {}),
    setStorageClass: mock(async () => {}),
    list: mock(async function* () {}),
  } as unknown as ObjectBackend;
}

describe('BackupEngine', () => {
  it('sets status to complete and writes counts on success', async () => {
    const snap = makeSnapshot();
    const scope = makeScope();
    const org = makeOrg();
    const repo = makeRepo(snap, scope, org);
    const vault = makeVault();
    const gitSync = makeGitSync();
    const adapter = makeAdapter({ Account: [{ Id: 'a1' }, { Id: 'a2' }] });
    const backend = makeBackend();

    const engine = new BackupEngine({
      repo, vault, gitSync, backend,
      adapterFactory: () => adapter,
    });

    await engine.run('snap-1');

    const updateStatus = repo.snapshots.updateStatus as MockFn;
    expect(updateStatus).toHaveBeenCalledWith('snap-1', 'running');
    const secondCall = updateStatus.mock.calls[1] as [string, string, Record<string, unknown>];
    expect(secondCall[1]).toBe('complete');
    expect(secondCall[2]['recordCount']).toBe(2);
    expect(secondCall[2]['gitCommitSha']).toBe('abc1234');
    expect(secondCall[2]['archiveBackendId']).toBe('test');
  });

  it('sets status to failed when adapter throws', async () => {
    const snap = makeSnapshot();
    const repo = makeRepo(snap, makeScope(), makeOrg());
    const adapter = makeAdapter();
    (adapter.describe as MockFn).mockImplementation(() => Promise.reject(new Error('SF unavailable')));
    const backend = makeBackend();

    const engine = new BackupEngine({
      repo, vault: makeVault(), gitSync: makeGitSync(), backend,
      adapterFactory: () => adapter,
    });

    await expect(engine.run('snap-1')).rejects.toThrow('SF unavailable');

    const updateStatus = repo.snapshots.updateStatus as MockFn;
    const secondCall = updateStatus.mock.calls[1] as [string, string, Record<string, unknown>];
    expect(secondCall[1]).toBe('failed');
    expect(secondCall[2]['error']).toContain('SF unavailable');
  });

  it('completes successfully even when git sync fails', async () => {
    const snap = makeSnapshot();
    const repo = makeRepo(snap, makeScope(), makeOrg());
    const gitSync = makeGitSync();
    (gitSync.commitSnapshot as MockFn).mockImplementation(() => Promise.reject(new Error('git fail')));
    const backend = makeBackend();

    const engine = new BackupEngine({
      repo, vault: makeVault(), gitSync, backend, adapterFactory: () => makeAdapter(),
    });

    await engine.run('snap-1');

    const updateStatus = repo.snapshots.updateStatus as MockFn;
    const secondCall = updateStatus.mock.calls[1] as [string, string];
    expect(secondCall[1]).toBe('complete');
  });

  it('throws when snapshot not found', async () => {
    const repo = makeRepo(makeSnapshot(), makeScope(), makeOrg());
    (repo.snapshots.findById as MockFn).mockImplementation(() => null);

    const engine = new BackupEngine({
      repo, vault: makeVault(), gitSync: makeGitSync(), backend: makeBackend(),
      adapterFactory: () => makeAdapter(),
    });

    await expect(engine.run('nonexistent')).rejects.toThrow('Snapshot not found: nonexistent');
  });
});
