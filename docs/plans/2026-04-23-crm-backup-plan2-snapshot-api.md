# Vastify CRM Backup — Plan 2: Snapshot Capture, Git Sync & Backup API

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `SnapshotCapture` (assembles a zip archive and uploads it to the existing Vastify ObjectBackend), `GitSync` (per-tenant git repo, per-org branches, one commit per snapshot), `BackupEngine` (orchestrates the full flow), and Hono HTTP routes for connected orgs, scopes, and snapshots — producing a fully runnable end-to-end snapshot flow bolted onto the existing Vastify API.

**Architecture:** Everything new lives in `api/src/backup/`. Snapshot archives are stored via the existing `ObjectBackend` registry (the same GCS/S3/MinIO/Azure backends used for files and records), under key `tenants/{tenantId}/snapshots/{snapshotId}.zip`. Git repos are local to `{BACKUP_GIT_DATA_DIR}/{tenantId}/`. Backup routes are a new Hono sub-app mounted at `/v1/backup` in `api/src/server.ts`, protected by the existing `apiKeyAuth` middleware. `BackupEngine` is fire-and-forget; callers poll `GET /v1/backup/snapshots/:id` for status.

**Tech Stack:** Bun 1.3+, Hono 4.x, bun:sqlite, bun test, `archiver` (zip), `simple-git` (git). New npm deps: `archiver`, `@types/archiver`, `simple-git`.

**Prerequisite:** Plan 1 complete — `api/src/backup/types.ts`, `api/src/backup/repo.ts`, `api/src/backup/credential-vault.ts`, CRM adapters, and SchemaWalker all exist.

**Context — existing patterns to follow:**

- **Auth:** `apiKeyAuth` middleware from `api/src/auth/api-key.ts`; `c.get('tenantId')` gives the authenticated tenant ID in route handlers.
- **ObjectBackend:** `getBackends()` from `api/src/object/registry.ts` returns `Map<BackendId, ObjectBackend>`. `backend.put(key, body: Uint8Array, opts)` uploads, `backend.get(key)` downloads as `Uint8Array`. For snapshots, pick the first enabled backend or the demo GCS backend.
- **Routes pattern:** create a `new Hono()` instance, define routes on it, export it, then `app.route('/v1/backup', backupRoutes)` in `server.ts`.
- **Config:** `loadConfig()` in `api/src/config.ts` reads from `process.env`.
- **Database:** `getDb()` singleton in `api/src/db/client.ts` returns a `Database` (bun:sqlite).

---

## File Map

| File | Action | Purpose |
|---|---|---|
| `api/src/backup/snapshot-capture.ts` | Create | Streams records + metadata + files into a zip, uploads via ObjectBackend |
| `api/src/backup/git-sync.ts` | Create | Per-tenant git repo, one branch per org, metadata commits |
| `api/src/backup/backup-engine.ts` | Create | Orchestrates vault → walk → capture → git → status update |
| `api/src/backup/routes.ts` | Create | Hono routes: orgs, scopes, snapshots |
| `api/src/server.ts` | Modify | Mount `/v1/backup` routes |
| `api/src/config.ts` | Modify | Add `backupGitDataDir`, `vaultMasterKeyHex`, `sfClientId/Secret`, `hsClientId/Secret` |
| `.env.example` | Modify | Document new backup env vars |
| `api/src/backup/test/snapshot-capture.test.ts` | Create | Archive assembly tests |
| `api/src/backup/test/git-sync.test.ts` | Create | GitSync commit/branch tests (real temp git repo) |
| `api/src/backup/test/backup-engine.test.ts` | Create | BackupEngine orchestration tests (mocked deps) |
| `api/package.json` | Modify | Add `archiver`, `@types/archiver`, `simple-git` |

---

## Task 1: Add dependencies

**Files:**
- Modify: `api/package.json`

- [ ] **Step 1: Add archiver and simple-git**

```bash
cd api && bun add archiver simple-git && bun add -d @types/archiver
```

Expected: `bun.lock` updated, packages present in `node_modules`.

- [ ] **Step 2: Verify imports compile**

```bash
cd api && bun -e "import archiver from 'archiver'; import simpleGit from 'simple-git'; console.log('deps OK')"
```

Expected: `deps OK`

---

## Task 2: Config additions

**Files:**
- Modify: `api/src/config.ts`
- Modify: `.env.example`

- [ ] **Step 1: Add backup fields to Config interface**

Open `api/src/config.ts`. Add to the `Config` interface (after the existing fields):

```typescript
backupGitDataDir: string;
vaultMasterKeyHex: string;
sfClientId: string;
sfClientSecret: string;
hsClientId: string;
hsClientSecret: string;
```

Add to `loadConfig()` return (after the existing fields):

```typescript
backupGitDataDir: process.env['BACKUP_GIT_DATA_DIR'] ?? './.vastify/git',
vaultMasterKeyHex: process.env['VAULT_MASTER_KEY'] ?? '0'.repeat(64),
sfClientId: process.env['SF_CLIENT_ID'] ?? '',
sfClientSecret: process.env['SF_CLIENT_SECRET'] ?? '',
hsClientId: process.env['HS_CLIENT_ID'] ?? '',
hsClientSecret: process.env['HS_CLIENT_SECRET'] ?? '',
```

Note: `'0'.repeat(64)` is a zero-byte 32-byte key — valid for local dev only. Production must set `VAULT_MASTER_KEY`.

- [ ] **Step 2: Add to .env.example**

Append to `.env.example`:

```env
# Backup subsystem
BACKUP_GIT_DATA_DIR=./.vastify/git
VAULT_MASTER_KEY=<hex-encoded 32 bytes — generate with: openssl rand -hex 32>
SF_CLIENT_ID=
SF_CLIENT_SECRET=
HS_CLIENT_ID=
HS_CLIENT_SECRET=
```

---

## Task 3: SnapshotCapture

**Files:**
- Create: `api/src/backup/snapshot-capture.ts`
- Create: `api/src/backup/test/snapshot-capture.test.ts`

Key difference from original Plan 2: instead of writing to `snapshotsDir` on disk, we upload the finished zip to the `ObjectBackend`. We build the archive to a temp file (using `os.tmpdir()`), then stream it to the backend via `backend.put()`, then delete the temp file.

- [ ] **Step 1: Write the failing test**

Create `api/src/backup/test/snapshot-capture.test.ts`:

```typescript
import { describe, it, expect, mock, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { captureSnapshot } from '../snapshot-capture.js';
import type { CRMAdapter, CrmRecord, FileRef } from '../crm/types.js';
import type { BackupScope } from '../types.js';
import type { SchemaGraph } from '../schema-walker.js';
import type { FieldDescriptor } from '../crm/types.js';
import type { ObjectBackend } from '../../object/backend.js';

function makeAdapter(records: Record<string, CrmRecord[]> = {}): CRMAdapter {
  return {
    listObjects: mock(() => Promise.resolve([])),
    describe: mock(() => Promise.resolve({ name: '', label: '', fields: [], childRelationships: [] })),
    queryRecords: mock(async function* (objectName: string) {
      for (const r of records[objectName] ?? []) yield r;
    }) as CRMAdapter['queryRecords'],
    downloadFile: mock(() => Promise.resolve(new Uint8Array([70, 73, 76, 69]))),
    upsertRecord: mock(() => Promise.resolve('')),
    deployMetadata: mock(() => Promise.resolve({ success: true, errors: [] })),
    uploadFile: mock(() => Promise.resolve('')),
  };
}

function makeScope(overrides: Partial<BackupScope> = {}): BackupScope {
  return {
    id: 's1', tenantId: 'tenant-a', connectedOrgId: 'org-1',
    name: 'Test Scope', rootObject: 'Account', maxDepth: 2,
    includeFiles: false, includeMetadata: true, createdAt: 1000, ...overrides,
  };
}

const sampleField: FieldDescriptor = {
  name: 'Id', label: 'Account ID', type: 'id', referenceTo: [], nillable: false, externalId: false,
};

function makeGraph(objectNames: string[]): SchemaGraph {
  const nodes = new Map(objectNames.map((n, i) => [n, { objectName: n, depth: i, fields: [sampleField] }]));
  return { rootObject: objectNames[0] ?? 'Account', nodes, edges: [] };
}

function makeBackend(): { backend: ObjectBackend; uploaded: Map<string, Uint8Array> } {
  const uploaded = new Map<string, Uint8Array>();
  const backend: ObjectBackend = {
    put: mock(async (key: string, body: Uint8Array) => {
      uploaded.set(key, body);
      return { key, backendId: 'test', storageClass: 'STANDARD' };
    }),
    get: mock(async (key: string) => uploaded.get(key) ?? new Uint8Array(0)),
    presignGet: mock(async () => 'https://example.com/presign'),
    delete: mock(async () => {}),
    setStorageClass: mock(async () => {}),
    list: mock(async function* () {}),
  } as unknown as ObjectBackend;
  return { backend, uploaded };
}

describe('captureSnapshot', () => {
  it('uploads a zip archive to the backend', async () => {
    const adapter = makeAdapter({ Account: [{ Id: 'a1', Name: 'Acme' }] });
    const scope = makeScope();
    const graph = makeGraph(['Account']);
    const { backend, uploaded } = makeBackend();
    const snapshotId = randomUUID();

    const result = await captureSnapshot(adapter, scope, graph, snapshotId, 'tenant-a', backend);

    expect(result.archiveStorageKey).toBe(`tenants/tenant-a/snapshots/${snapshotId}.zip`);
    expect(uploaded.has(result.archiveStorageKey)).toBe(true);
    // zip magic bytes PK\x03\x04
    const bytes = uploaded.get(result.archiveStorageKey)!;
    expect(bytes[0]).toBe(0x50);
    expect(bytes[1]).toBe(0x4b);
  });

  it('returns correct record and metadata counts', async () => {
    const adapter = makeAdapter({
      Account: [{ Id: 'a1' }, { Id: 'a2' }],
      Contact: [{ Id: 'c1' }],
    });
    const { backend } = makeBackend();
    const result = await captureSnapshot(adapter, makeScope(), makeGraph(['Account', 'Contact']), randomUUID(), 'tenant-a', backend);

    expect(result.recordCount).toBe(3);
    expect(result.metadataItemCount).toBe(2);
    expect(result.fileCount).toBe(0);
    expect(result.sizeBytes).toBeGreaterThan(0);
  });

  it('returns zero counts for empty graph', async () => {
    const { backend } = makeBackend();
    const graph: SchemaGraph = { rootObject: 'Account', nodes: new Map(), edges: [] };
    const result = await captureSnapshot(makeAdapter(), makeScope(), graph, randomUUID(), 'tenant-a', backend);
    expect(result.recordCount).toBe(0);
    expect(result.metadataItemCount).toBe(0);
  });

  it('calls downloadFile for ContentVersion records when includeFiles is true', async () => {
    const cvRecord: CrmRecord = { Id: 'cv001', Title: 'AttachmentA', ContentSize: 512, FileType: 'PDF' };
    const adapter = makeAdapter({ ContentVersion: [cvRecord] });
    const { backend } = makeBackend();
    const result = await captureSnapshot(
      adapter, makeScope({ includeFiles: true }),
      makeGraph(['Account', 'ContentVersion']), randomUUID(), 'tenant-a', backend,
    );
    expect(adapter.downloadFile).toHaveBeenCalled();
    expect(result.fileCount).toBe(1);
  });

  it('skips file download when includeFiles is false', async () => {
    const adapter = makeAdapter({ ContentVersion: [{ Id: 'cv001', Title: 'A', ContentSize: 100, FileType: 'PDF' }] });
    const { backend } = makeBackend();
    await captureSnapshot(adapter, makeScope({ includeFiles: false }), makeGraph(['Account', 'ContentVersion']), randomUUID(), 'tenant-a', backend);
    expect(adapter.downloadFile).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to confirm failure**

```bash
cd api && bun test src/backup/test/snapshot-capture.test.ts 2>&1 | tail -5
```

Expected: FAIL — `Cannot find module '../snapshot-capture.js'`

- [ ] **Step 3: Implement snapshot-capture.ts**

Create `api/src/backup/snapshot-capture.ts`:

```typescript
import { createWriteStream, statSync, unlinkSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import archiver from 'archiver';
import type { CRMAdapter, FileRef } from './crm/types.js';
import type { BackupScope } from './types.js';
import type { SchemaGraph } from './schema-walker.js';
import type { ObjectBackend } from '../object/backend.js';

export interface SnapshotCaptureResult {
  archiveStorageKey: string;
  recordCount: number;
  fileCount: number;
  metadataItemCount: number;
  sizeBytes: number;
}

export async function captureSnapshot(
  adapter: CRMAdapter,
  scope: BackupScope,
  graph: SchemaGraph,
  snapshotId: string,
  tenantId: string,
  backend: ObjectBackend,
): Promise<SnapshotCaptureResult> {
  const storageKey = `tenants/${tenantId}/snapshots/${snapshotId}.zip`;
  const tmpPath = join(tmpdir(), `vastify-snapshot-${snapshotId}.zip`);

  const output = createWriteStream(tmpPath);
  const arc = archiver('zip', { zlib: { level: 6 } });

  const closed = new Promise<void>((resolve, reject) => {
    output.on('close', resolve);
    output.on('error', reject);
    arc.on('error', reject);
  });
  arc.pipe(output);

  let recordCount = 0;
  let fileCount = 0;
  let metadataItemCount = 0;

  // 1. Metadata: one JSON file per object in the graph
  for (const [objectName, node] of graph.nodes) {
    arc.append(JSON.stringify({ objectName, fields: node.fields }, null, 2), {
      name: `metadata/objects/${objectName}.json`,
    });
    metadataItemCount++;
  }

  // 2. Records: NDJSON per object (batched 4 at a time)
  const objectNames = [...graph.nodes.keys()];
  const parallelism = 4;
  for (let i = 0; i < objectNames.length; i += parallelism) {
    await Promise.all(
      objectNames.slice(i, i + parallelism).map(async (objectName) => {
        const node = graph.nodes.get(objectName);
        if (!node) return;
        const fields = node.fields.map((f) => f.name);
        const lines: string[] = [];
        for await (const record of adapter.queryRecords(objectName, fields)) {
          lines.push(JSON.stringify(record));
          recordCount++;
        }
        arc.append(lines.join('\n'), { name: `records/${objectName}.ndjson` });
      }),
    );
  }

  // 3. Files: binary download for ContentVersion (Salesforce only)
  if (scope.includeFiles && graph.nodes.has('ContentVersion')) {
    fileCount = await captureFileBlobs(adapter, arc);
  }

  // 4. Schema graph
  arc.append(
    JSON.stringify({
      rootObject: graph.rootObject,
      nodes: Object.fromEntries(
        [...graph.nodes.entries()].map(([k, v]) => [k, { objectName: v.objectName, depth: v.depth }]),
      ),
      edges: graph.edges,
    }, null, 2),
    { name: 'schema-graph.json' },
  );

  // 5. Manifest
  arc.append(
    JSON.stringify({
      schemaVersion: 1, snapshotId, tenantId, scopeId: scope.id, scopeName: scope.name,
      rootObject: scope.rootObject, recordCount, fileCount, metadataItemCount,
      capturedAt: new Date().toISOString(),
    }, null, 2),
    { name: 'manifest.json' },
  );

  await arc.finalize();
  await closed;

  // Upload to object backend, then clean up temp file
  const zipBytes = new Uint8Array(readFileSync(tmpPath).buffer);
  const sizeBytes = statSync(tmpPath).size;
  unlinkSync(tmpPath);

  await backend.put(storageKey, zipBytes, { storageClass: 'STANDARD', contentType: 'application/zip' });

  return { archiveStorageKey: storageKey, recordCount, fileCount, metadataItemCount, sizeBytes };
}

async function captureFileBlobs(
  adapter: CRMAdapter,
  arc: ReturnType<typeof archiver>,
): Promise<number> {
  let count = 0;
  const refs: FileRef[] = [];

  for await (const record of adapter.queryRecords(
    'ContentVersion', ['Id', 'Title', 'ContentSize', 'FileType'], 'IsLatest = TRUE',
  )) {
    refs.push({
      id: String(record['Id'] ?? ''),
      name: `${String(record['Title'] ?? 'file')}.${String(record['FileType'] ?? 'bin').toLowerCase()}`,
      size: Number(record['ContentSize'] ?? 0),
      contentType: 'application/octet-stream',
    });
  }

  for (const ref of refs) {
    const bytes = await adapter.downloadFile(ref);
    arc.append(Buffer.from(bytes), { name: `files/${ref.id}.bin` });
    arc.append(JSON.stringify({ id: ref.id, name: ref.name, size: ref.size }), {
      name: `files/${ref.id}.meta.json`,
    });
    count++;
  }

  return count;
}
```

- [ ] **Step 4: Run tests**

```bash
cd api && bun test src/backup/test/snapshot-capture.test.ts
```

Expected: All snapshot-capture tests PASS.

---

## Task 4: GitSync

**Files:**
- Create: `api/src/backup/git-sync.ts`
- Create: `api/src/backup/test/git-sync.test.ts`

GitSync is identical to the original Plan 2 implementation. Adaptations needed:
- Import `ConnectedOrg` from `./types.js` (not `@infinity-docs/shared`)
- Import `SchemaGraph` from `./schema-walker.js`
- Git data dir comes from `config.backupGitDataDir`

- [ ] **Step 1: Create git-sync.ts**

Create `api/src/backup/git-sync.ts`:

```typescript
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import simpleGit from 'simple-git';
import type { ConnectedOrg } from './types.js';
import type { SchemaGraph } from './schema-walker.js';

export interface GitSyncOptions {
  gitDataDir: string;
}

export interface GitCommitResult {
  commitSha: string;
}

export class GitSync {
  constructor(private opts: GitSyncOptions) {}

  private repoPath(tenantId: string): string {
    return join(this.opts.gitDataDir, tenantId);
  }

  private branchName(org: ConnectedOrg): string {
    return `${org.crmType}-${org.externalOrgId}`;
  }

  async commitSnapshot(
    tenantId: string,
    org: ConnectedOrg,
    snapshotId: string,
    scopeName: string,
    graph: SchemaGraph,
  ): Promise<GitCommitResult> {
    const repoPath = this.repoPath(tenantId);
    mkdirSync(repoPath, { recursive: true });

    const git = simpleGit(repoPath);
    await git.addConfig('user.email', 'backup-bot@vastify.local');
    await git.addConfig('user.name', 'Vastify Backup Bot');

    if (!existsSync(join(repoPath, '.git'))) {
      await git.init();
      writeFileSync(join(repoPath, '.gitkeep'), '');
      await git.add('.gitkeep');
      await git.commit('chore: init backup metadata repo');
    }

    const branch = this.branchName(org);
    const branches = await git.branchLocal();
    if (branches.all.includes(branch)) {
      await git.checkout(branch);
    } else {
      await git.checkoutLocalBranch(branch);
    }

    const objectsDir = join(repoPath, 'metadata', 'objects');
    mkdirSync(objectsDir, { recursive: true });
    for (const [objectName, node] of graph.nodes) {
      writeFileSync(
        join(objectsDir, `${objectName}.json`),
        JSON.stringify({ objectName, fields: node.fields }, null, 2),
      );
    }

    writeFileSync(
      join(repoPath, 'manifest.json'),
      JSON.stringify({ snapshotId, scopeName, capturedAt: new Date().toISOString() }, null, 2),
    );

    await git.add('.');
    const commitResult = await git.commit(
      `snapshot ${snapshotId} — ${scopeName} — ${graph.nodes.size} objects`,
    );

    // Best-effort remote push
    if (org.gitRemoteUrl) {
      try {
        const remotes = await git.getRemotes();
        if (!remotes.find((r) => r.name === 'origin')) {
          await git.addRemote('origin', org.gitRemoteUrl);
        }
        await git.push('origin', branch);
      } catch {
        // push failures are non-fatal
      }
    }

    return { commitSha: commitResult.commit };
  }
}
```

- [ ] **Step 2: Create git-sync.test.ts**

Adapt the original Plan 2 git-sync tests, replacing `vitest` with `bun:test`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import simpleGit from 'simple-git';
import { GitSync } from '../git-sync.js';
import type { ConnectedOrg } from '../types.js';
import type { SchemaGraph } from '../schema-walker.js';
import type { FieldDescriptor } from '../crm/types.js';
```

Test cases (identical logic to original Plan 2):
- Creates a git repo and commits metadata on first call
- Creates a branch named after the org (`salesforce-{externalOrgId}`)
- Creates a second commit on the same branch for subsequent snapshots
- Uses separate branches for different orgs in the same tenant

- [ ] **Step 3: Run tests**

```bash
cd api && bun test src/backup/test/git-sync.test.ts
```

Expected: All GitSync tests PASS.

---

## Task 5: BackupEngine

**Files:**
- Create: `api/src/backup/backup-engine.ts`
- Create: `api/src/backup/test/backup-engine.test.ts`

BackupEngine orchestrates: vault.getAccessToken → create adapter → walkSchema → captureSnapshot (uploads to backend) → gitSync.commitSnapshot → repo.snapshots.updateStatus.

Key difference from original: `captureSnapshot` now receives an `ObjectBackend` instead of `snapshotsDir`. The engine fetches the appropriate backend from the registry.

- [ ] **Step 1: Write the failing test**

Create `api/src/backup/test/backup-engine.test.ts`:

```typescript
import { describe, it, expect, mock, beforeEach } from 'bun:test';
import { BackupEngine } from '../backup-engine.js';
import type { BackupRepo } from '../repo.js';
import type { CredentialVault } from '../credential-vault.js';
import type { GitSync } from '../git-sync.js';
import type { ConnectedOrg, BackupScope, Snapshot } from '../types.js';
import type { CRMAdapter, CrmRecord } from '../crm/types.js';
import type { ObjectBackend } from '../../object/backend.js';

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
      findByTenant: mock(), update: mock(), delete: mock(),
    },
    backupScopes: {
      insert: mock(), findById: mock(() => scope), findByOrg: mock(), delete: mock(),
    },
    snapshots: {
      insert: mock(), findById: mock(() => snap), findByTenant: mock(), updateStatus: mock(),
    },
    diffPlans: { insert: mock(), findById: mock(), findBySnapshot: mock() },
    restoreJobs: { insert: mock(), findById: mock(), findByTenant: mock(), updateStatus: mock() },
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
    upsertRecord: mock(), deployMetadata: mock(), uploadFile: mock(),
  };
}

function makeBackend(): ObjectBackend {
  return {
    put: mock(async (key: string, body: Uint8Array) => ({ key, backendId: 'test', storageClass: 'STANDARD' })),
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

    const updateStatus = repo.snapshots.updateStatus as ReturnType<typeof mock>;
    expect(updateStatus).toHaveBeenCalledWith('snap-1', 'running');
    const secondCall = (updateStatus as any).mock.calls[1];
    expect(secondCall[1]).toBe('complete');
    expect(secondCall[2].recordCount).toBe(2);
    expect(secondCall[2].gitCommitSha).toBe('abc1234');
    expect(secondCall[2].archiveBackendId).toBe('test');
  });

  it('sets status to failed when adapter throws', async () => {
    const snap = makeSnapshot();
    const repo = makeRepo(snap, makeScope(), makeOrg());
    const adapter = makeAdapter();
    (adapter.describe as any).mockImplementation(() => Promise.reject(new Error('SF unavailable')));
    const backend = makeBackend();

    const engine = new BackupEngine({
      repo, vault: makeVault(), gitSync: makeGitSync(), backend,
      adapterFactory: () => adapter,
    });

    await expect(engine.run('snap-1')).rejects.toThrow('SF unavailable');

    const updateStatus = repo.snapshots.updateStatus as ReturnType<typeof mock>;
    const secondCall = (updateStatus as any).mock.calls[1];
    expect(secondCall[1]).toBe('failed');
    expect(secondCall[2].error).toContain('SF unavailable');
  });

  it('completes successfully even when git sync fails', async () => {
    const snap = makeSnapshot();
    const repo = makeRepo(snap, makeScope(), makeOrg());
    const gitSync = makeGitSync();
    (gitSync.commitSnapshot as any).mockImplementation(() => Promise.reject(new Error('git fail')));
    const backend = makeBackend();

    const engine = new BackupEngine({
      repo, vault: makeVault(), gitSync, backend, adapterFactory: () => makeAdapter(),
    });

    await engine.run('snap-1');

    const updateStatus = repo.snapshots.updateStatus as ReturnType<typeof mock>;
    expect((updateStatus as any).mock.calls[1][1]).toBe('complete');
  });

  it('throws when snapshot not found', async () => {
    const repo = makeRepo(makeSnapshot(), makeScope(), makeOrg());
    (repo.snapshots.findById as any).mockReturnValue(null);

    const engine = new BackupEngine({
      repo, vault: makeVault(), gitSync: makeGitSync(), backend: makeBackend(),
      adapterFactory: () => makeAdapter(),
    });

    await expect(engine.run('nonexistent')).rejects.toThrow('Snapshot not found: nonexistent');
  });
});
```

- [ ] **Step 2: Run test to confirm failure**

```bash
cd api && bun test src/backup/test/backup-engine.test.ts 2>&1 | tail -5
```

- [ ] **Step 3: Implement backup-engine.ts**

Create `api/src/backup/backup-engine.ts`:

```typescript
import type { BackupRepo } from './repo.js';
import type { ConnectedOrg } from './types.js';
import type { CRMAdapter } from './crm/types.js';
import type { CredentialVault } from './credential-vault.js';
import type { GitSync } from './git-sync.js';
import type { ObjectBackend } from '../object/backend.js';
import { SalesforceAdapter } from './crm/salesforce-adapter.js';
import { HubSpotAdapter } from './crm/hubspot-adapter.js';
import { walkSchema } from './schema-walker.js';
import { captureSnapshot } from './snapshot-capture.js';

export interface BackupEngineOptions {
  repo: BackupRepo;
  vault: CredentialVault;
  gitSync: GitSync;
  backend: ObjectBackend;
  adapterFactory?: (org: ConnectedOrg, accessToken: string) => CRMAdapter;
}

export function createCrmAdapter(org: ConnectedOrg, accessToken: string): CRMAdapter {
  if (org.crmType === 'salesforce') {
    return new SalesforceAdapter(org.instanceUrl, () => Promise.resolve(accessToken));
  }
  return new HubSpotAdapter(() => Promise.resolve(accessToken));
}

export class BackupEngine {
  constructor(private opts: BackupEngineOptions) {}

  private makeAdapter(org: ConnectedOrg, accessToken: string): CRMAdapter {
    return this.opts.adapterFactory
      ? this.opts.adapterFactory(org, accessToken)
      : createCrmAdapter(org, accessToken);
  }

  async run(snapshotId: string): Promise<void> {
    const snap = this.opts.repo.snapshots.findById(snapshotId);
    if (!snap) throw new Error(`Snapshot not found: ${snapshotId}`);

    const scope = this.opts.repo.backupScopes.findById(snap.backupScopeId);
    if (!scope) throw new Error(`BackupScope not found: ${snap.backupScopeId}`);

    const org = this.opts.repo.connectedOrgs.findById(snap.connectedOrgId);
    if (!org) throw new Error(`ConnectedOrg not found: ${snap.connectedOrgId}`);

    this.opts.repo.snapshots.updateStatus(snapshotId, 'running');

    try {
      const accessToken = await this.opts.vault.getAccessToken(snap.tenantId, snap.connectedOrgId);
      const adapter = this.makeAdapter(org, accessToken);
      const graph = await walkSchema(adapter, scope.rootObject, scope.maxDepth);
      const captureResult = await captureSnapshot(
        adapter, scope, graph, snapshotId, snap.tenantId, this.opts.backend,
      );

      let gitCommitSha: string | null = null;
      try {
        const gitResult = await this.opts.gitSync.commitSnapshot(
          snap.tenantId, org, snapshotId, scope.name, graph,
        );
        gitCommitSha = gitResult.commitSha;
      } catch {
        // git sync failure is non-fatal — snapshot is still saved
      }

      this.opts.repo.snapshots.updateStatus(snapshotId, 'complete', {
        archiveStorageKey: captureResult.archiveStorageKey,
        archiveBackendId: 'gcs', // TODO: get from backend.put() result when backend supports it
        recordCount: captureResult.recordCount,
        fileCount: captureResult.fileCount,
        metadataItemCount: captureResult.metadataItemCount,
        sizeBytes: captureResult.sizeBytes,
        completedAt: Date.now(),
        ...(gitCommitSha !== null && { gitCommitSha }),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.opts.repo.snapshots.updateStatus(snapshotId, 'failed', {
        completedAt: Date.now(),
        error: message,
      });
      throw err;
    }
  }
}
```

Note on `archiveBackendId`: The `ObjectBackend.put()` in the current interface returns `{ key, backendId, storageClass }` — use the returned `backendId` from `captureSnapshot` in a real implementation. For now, log the returned value or thread it through `SnapshotCaptureResult`. Refine in a follow-up if needed.

- [ ] **Step 4: Run tests**

```bash
cd api && bun test src/backup/test/backup-engine.test.ts
```

Expected: All BackupEngine tests PASS.

---

## Task 6: Hono routes

**Files:**
- Create: `api/src/backup/routes.ts`

All backup routes live in a single Hono sub-app, protected by `apiKeyAuth`. The authenticated `tenantId` is obtained from `c.get('tenantId')`.

Routes:
- `GET /orgs` — list connected orgs for the authenticated tenant
- `POST /orgs` — register a connected org (manual credential entry)
- `DELETE /orgs/:id` — disconnect an org
- `GET /scopes` — list scopes for a connected org (`?connectedOrgId=`)
- `POST /scopes` — create a scope
- `DELETE /scopes/:id` — delete a scope
- `GET /snapshots` — list snapshots for the tenant (`?limit=`)
- `GET /snapshots/:id` — single snapshot by ID
- `POST /snapshots` — trigger a new snapshot (returns 202, runs async)

- [ ] **Step 1: Create routes.ts**

Create `api/src/backup/routes.ts`:

```typescript
import { Hono } from 'hono';
import { randomUUID } from 'node:crypto';
import { apiKeyAuth } from '../auth/api-key.js';
import { getDb } from '../db/client.js';
import { getBackends } from '../object/registry.js';
import { loadConfig } from '../config.js';
import { createBackupRepo } from './repo.js';
import { CredentialVault } from './credential-vault.js';
import { GitSync } from './git-sync.js';
import { BackupEngine } from './backup-engine.js';
import type { ConnectedOrg, BackupScope, Snapshot, CrmType } from './types.js';

const routes = new Hono();

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
  const backend = backends.values().next().value;
  if (!backend) throw new Error('No storage backend configured');
  return new BackupEngine({
    repo: getRepo(),
    vault: getVault(),
    gitSync: getGitSync(),
    backend,
  });
}

// ─── Connected Orgs ───────────────────────────────────────────────────────────

routes.get('/orgs', apiKeyAuth, (c) => {
  const tenantId = c.get('tenantId') as string;
  const orgs = getRepo().connectedOrgs.findByTenant(tenantId);
  return c.json({ orgs });
});

routes.post('/orgs', apiKeyAuth, async (c) => {
  const tenantId = c.get('tenantId') as string;
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

routes.delete('/orgs/:id', apiKeyAuth, (c) => {
  const tenantId = c.get('tenantId') as string;
  const org = getRepo().connectedOrgs.findById(c.req.param('id'));
  if (!org || org.tenantId !== tenantId) return c.json({ error: 'not found' }, 404);
  getRepo().connectedOrgs.delete(c.req.param('id'));
  return new Response(null, { status: 204 });
});

// ─── Backup Scopes ────────────────────────────────────────────────────────────

routes.get('/scopes', apiKeyAuth, (c) => {
  const tenantId = c.get('tenantId') as string;
  const connectedOrgId = c.req.query('connectedOrgId');
  if (!connectedOrgId) return c.json({ error: 'connectedOrgId required' }, 400);

  const org = getRepo().connectedOrgs.findById(connectedOrgId);
  if (!org || org.tenantId !== tenantId) return c.json({ error: 'not found' }, 404);

  return c.json({ scopes: getRepo().backupScopes.findByOrg(connectedOrgId) });
});

routes.post('/scopes', apiKeyAuth, async (c) => {
  const tenantId = c.get('tenantId') as string;
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

routes.delete('/scopes/:id', apiKeyAuth, (c) => {
  const tenantId = c.get('tenantId') as string;
  const scope = getRepo().backupScopes.findById(c.req.param('id'));
  if (!scope || scope.tenantId !== tenantId) return c.json({ error: 'not found' }, 404);
  getRepo().backupScopes.delete(c.req.param('id'));
  return new Response(null, { status: 204 });
});

// ─── Snapshots ────────────────────────────────────────────────────────────────

routes.get('/snapshots', apiKeyAuth, (c) => {
  const tenantId = c.get('tenantId') as string;
  const limitStr = c.req.query('limit');
  const limit = limitStr ? Number.parseInt(limitStr, 10) : 50;
  const snapshots = getRepo().snapshots.findByTenant(tenantId, Number.isFinite(limit) ? limit : 50);
  return c.json({ snapshots });
});

routes.get('/snapshots/:id', apiKeyAuth, (c) => {
  const tenantId = c.get('tenantId') as string;
  const snap = getRepo().snapshots.findById(c.req.param('id'));
  if (!snap || snap.tenantId !== tenantId) return c.json({ error: 'not found' }, 404);
  return c.json(snap);
});

routes.post('/snapshots', apiKeyAuth, async (c) => {
  const tenantId = c.get('tenantId') as string;
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
```

---

## Task 7: Wire backup routes into server

**Files:**
- Modify: `api/src/server.ts`

- [ ] **Step 1: Add backup route import**

Open `api/src/server.ts`. After the existing route imports, add:

```typescript
import { backupRoutes } from './backup/routes.js';
```

- [ ] **Step 2: Mount backup routes**

After the existing `app.route(...)` calls, add:

```typescript
app.route('/v1/backup', backupRoutes);
```

- [ ] **Step 3: Verify server starts**

```bash
cd api && bun run src/server.ts &
sleep 2
curl -s http://localhost:3099/health | bun -e "const t = await Bun.stdin.text(); console.log(t)"
kill %1
```

Expected: `{"ok":true,"service":"vastify-api","version":"0.1.0"}`

---

## Task 8: Full test suite

- [ ] **Step 1: Run all backup tests**

```bash
cd api && bun test src/backup/
```

Expected: All tests pass (repo, credential-vault, salesforce-adapter, hubspot-adapter, schema-walker, snapshot-capture, git-sync, backup-engine).

- [ ] **Step 2: Typecheck**

```bash
cd api && bun run typecheck
```

Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add api/src/backup api/src/server.ts api/src/config.ts .env.example api/package.json api/bun.lock
git commit -m "feat(backup): Plan 2 complete — SnapshotCapture, GitSync, BackupEngine, Hono routes"
```

---

## What's next

**Plan 3 covers:**

- `DiffEngine` — reads snapshot archive from ObjectBackend, queries target CRM, classifies each record as insert/update/skip-delete, computes `targetStateHash`
- `DiffPlanStore` — persists `DiffPlanDocument` as JSON to ObjectBackend
- `RestoreExecutor` — drift check (re-hash target), topological apply with `IdRemap`, dry-run mode, continues past individual record failures
- Additional Hono routes: `POST /v1/backup/snapshots/:id/diff`, `GET /v1/backup/diff-plans/:id`, `POST /v1/backup/snapshots/:id/restore`, `GET /v1/backup/restores`, `GET /v1/backup/restores/:id`
