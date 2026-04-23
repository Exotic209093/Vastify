# Vastify CRM Backup — Plan 3: Diff Engine & Restore Executor

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement `DiffEngine` (reads a snapshot zip from ObjectBackend, queries a target CRM org, classifies each record as insert/update/skip-delete), `DiffPlanStore` (persists the plan document to ObjectBackend as JSON), and `RestoreExecutor` (drift check + topological apply with IdRemap, dry-run mode, continues past individual record failures). Wire five new Hono routes into the existing backup routes file.

**Architecture:** Everything new lives in `api/src/backup/`. DiffEngine downloads the snapshot zip via `ObjectBackend.get()`, parses the NDJSON record files, queries the target org via its `CRMAdapter`, and classifies changes. DiffPlanStore serialises the `DiffPlanDocument` to JSON and uploads/downloads it through the same ObjectBackend. RestoreExecutor applies changes in the topological order recorded in the diff plan. The five new routes are appended to `api/src/backup/routes.ts`; no other files change except a one-dep add (`unzipper`).

**Tech Stack:** Bun 1.3+, bun test, `unzipper` (reading zip from a Uint8Array). New npm dep: `unzipper`, `@types/unzipper`.

**Prerequisite:** Plan 2 complete — `api/src/backup/routes.ts`, `BackupEngine`, `GitSync`, `SnapshotCapture`, and all Plan 1 pieces exist.

**Context — key existing APIs:**

- `ObjectBackend.get(key)` returns `Promise<Uint8Array>` — use this to read snapshot zips and diff plan JSON.
- `ObjectBackend.put(key, body: Uint8Array, opts)` — use this to store diff plan JSON.
- `BackupRepo.diffPlans.insert(plan)` / `.findById(id)` — SQLite index for diff plan metadata.
- `BackupRepo.restoreJobs.insert(job)` / `.updateStatus(id, status, patch)` — SQLite job tracking.
- `createCrmAdapter(org, accessToken)` exported from `backup-engine.ts` — instantiates the right CRM adapter without needing the full engine.

---

## File Map

| File | Action | Purpose |
|---|---|---|
| `api/src/backup/diff-types.ts` | Create | `DiffPlanDocument`, `DiffChange`, `DiffOp` types |
| `api/src/backup/diff-engine.ts` | Create | Reads snapshot zip, queries target, classifies changes |
| `api/src/backup/diff-plan-store.ts` | Create | Save/load `DiffPlanDocument` via ObjectBackend |
| `api/src/backup/restore-executor.ts` | Create | Drift check + topological apply with IdRemap |
| `api/src/backup/routes.ts` | Modify | Add 5 diff and restore routes |
| `api/src/backup/test/diff-engine.test.ts` | Create | DiffEngine unit tests |
| `api/src/backup/test/diff-plan-store.test.ts` | Create | DiffPlanStore round-trip tests |
| `api/src/backup/test/restore-executor.test.ts` | Create | RestoreExecutor tests |
| `api/package.json` | Modify | Add `unzipper`, `@types/unzipper` |

---

## Task 1: Add unzipper dependency + define DiffPlanDocument types

**Files:**
- Modify: `api/package.json`
- Create: `api/src/backup/diff-types.ts`

- [ ] **Step 1: Install unzipper**

```bash
cd api && bun add unzipper && bun add -d @types/unzipper
```

Expected: `bun.lock` updated, `node_modules/unzipper` present.

- [ ] **Step 2: Create diff-types.ts**

Create `api/src/backup/diff-types.ts`:

```typescript
import type { CrmRecord } from './crm/types.js';

export type DiffOp = 'insert' | 'update' | 'skip-delete';

export interface DiffChange {
  op: DiffOp;
  objectName: string;
  sourceRecord: CrmRecord;
  targetId: string | null;
}

export interface DiffPlanDocument {
  id: string;
  snapshotId: string;
  tenantId: string;
  targetOrgId: string;
  targetStateHash: string;
  builtAt: number;
  objectOrder: string[];
  changes: DiffChange[];
  counts: {
    insert: number;
    update: number;
    skipDelete: number;
  };
}
```

- [ ] **Step 3: Typecheck**

```bash
cd api && bun run typecheck 2>&1 | tail -5
```

Expected: exit 0.

---

## Task 2: DiffEngine

**Files:**
- Create: `api/src/backup/diff-engine.ts`
- Create: `api/src/backup/test/diff-engine.test.ts`

DiffEngine reads a snapshot zip from ObjectBackend (`backend.get(key)` → `Uint8Array`), parses `schema-graph.json` to determine topological object order, reads each `records/{objectName}.ndjson`, queries the target org for the same object IDs, and classifies:
- **insert** — in snapshot, not in target
- **update** — in both
- **skip-delete** — in target, not in snapshot (noted but not acted on without explicit confirmation)

Also computes `targetStateHash`: SHA-256 of all target record IDs sorted deterministically, stored in the plan for drift detection by the RestoreExecutor.

- [ ] **Step 1: Write the failing test**

Create `api/src/backup/test/diff-engine.test.ts`:

```typescript
import { describe, it, expect, mock, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, rmSync, createWriteStream } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import archiver from 'archiver';
import { DiffEngine } from '../diff-engine.js';
import type { CRMAdapter, CrmRecord } from '../crm/types.js';
import type { ObjectBackend } from '../../object/backend.js';

function makeAdapter(targetRecords: Record<string, CrmRecord[]>): CRMAdapter {
  return {
    listObjects: mock(() => Promise.resolve([])),
    describe: mock(() => Promise.resolve({ name: '', label: '', fields: [], childRelationships: [] })),
    queryRecords: mock(async function* (objectName: string) {
      for (const r of targetRecords[objectName] ?? []) yield r;
    }) as CRMAdapter['queryRecords'],
    downloadFile: mock(),
    upsertRecord: mock(),
    deployMetadata: mock(),
    uploadFile: mock(),
  };
}

async function buildTestZip(
  snapshotRecords: Record<string, CrmRecord[]>,
): Promise<Uint8Array> {
  const tmp = join(tmpdir(), `diff-test-${randomUUID()}.zip`);
  const output = createWriteStream(tmp);
  const arc = archiver('zip', { zlib: { level: 1 } });
  const closed = new Promise<void>((res, rej) => {
    output.on('close', res);
    output.on('error', rej);
    arc.on('error', rej);
  });
  arc.pipe(output);

  const objectNames = Object.keys(snapshotRecords);
  const schemaGraph = {
    rootObject: objectNames[0] ?? 'Contact',
    nodes: Object.fromEntries(objectNames.map((n, i) => [n, { objectName: n, depth: i }])),
    edges: [] as unknown[],
  };
  arc.append(JSON.stringify(schemaGraph), { name: 'schema-graph.json' });

  for (const [objectName, records] of Object.entries(snapshotRecords)) {
    if (records.length > 0) {
      arc.append(records.map((r) => JSON.stringify(r)).join('\n') + '\n', {
        name: `records/${objectName}.ndjson`,
      });
    }
  }

  await arc.finalize();
  await closed;

  const { readFileSync, unlinkSync } = await import('node:fs');
  const bytes = new Uint8Array(readFileSync(tmp).buffer);
  unlinkSync(tmp);
  return bytes;
}

function makeBackend(zipData: Uint8Array): ObjectBackend {
  return {
    get: mock(async () => zipData),
    put: mock(async (key: string, body: Uint8Array) => ({ key, backendId: 'test', storageClass: 'STANDARD' })),
    presignGet: mock(async () => ''),
    delete: mock(async () => {}),
    setStorageClass: mock(async () => {}),
    list: mock(async function* () {}),
  } as unknown as ObjectBackend;
}

describe('DiffEngine', () => {
  const tenantId = 'tenant-a';
  const targetOrgId = 'org-target';
  const snapshotId = 'snap-1';

  it('classifies snapshot records not in target as insert, shared as update', async () => {
    const zipData = await buildTestZip({
      Contact: [{ Id: 'existing-001', Name: 'Alice' }, { Id: 'new-001', Name: 'Bob' }],
    });
    const adapter = makeAdapter({ Contact: [{ Id: 'existing-001' }] });
    const engine = new DiffEngine(makeBackend(zipData));

    const doc = await engine.buildDiff({
      planId: 'plan-1', snapshotId, tenantId, targetOrgId,
      snapshotStorageKey: `tenants/${tenantId}/snapshots/${snapshotId}.zip`,
      targetAdapter: adapter,
    });

    const inserts = doc.changes.filter((c) => c.op === 'insert');
    const updates = doc.changes.filter((c) => c.op === 'update');
    expect(inserts).toHaveLength(1);
    expect(inserts[0]?.sourceRecord['Id']).toBe('new-001');
    expect(updates).toHaveLength(1);
    expect(updates[0]?.targetId).toBe('existing-001');
    expect(doc.counts.insert).toBe(1);
    expect(doc.counts.update).toBe(1);
  });

  it('classifies target-only records as skip-delete', async () => {
    const zipData = await buildTestZip({ Contact: [{ Id: 'snap-001' }] });
    const adapter = makeAdapter({ Contact: [{ Id: 'snap-001' }, { Id: 'ghost-001' }] });
    const engine = new DiffEngine(makeBackend(zipData));

    const doc = await engine.buildDiff({
      planId: 'plan-1', snapshotId, tenantId, targetOrgId,
      snapshotStorageKey: `tenants/${tenantId}/snapshots/${snapshotId}.zip`,
      targetAdapter: adapter,
    });

    const skipDeletes = doc.changes.filter((c) => c.op === 'skip-delete');
    expect(skipDeletes).toHaveLength(1);
    expect(skipDeletes[0]?.targetId).toBe('ghost-001');
    expect(doc.counts.skipDelete).toBe(1);
  });

  it('produces deterministic targetStateHash regardless of query order', async () => {
    const zipData = await buildTestZip({ Contact: [] });
    const adapter1 = makeAdapter({ Contact: [{ Id: 'id-b' }, { Id: 'id-a' }] });
    const adapter2 = makeAdapter({ Contact: [{ Id: 'id-a' }, { Id: 'id-b' }] });

    const storageKey = `tenants/${tenantId}/snapshots/${snapshotId}.zip`;
    const engine1 = new DiffEngine(makeBackend(zipData));
    const engine2 = new DiffEngine(makeBackend(zipData));

    const [doc1, doc2] = await Promise.all([
      engine1.buildDiff({ planId: 'p1', snapshotId, tenantId, targetOrgId, snapshotStorageKey: storageKey, targetAdapter: adapter1 }),
      engine2.buildDiff({ planId: 'p2', snapshotId, tenantId, targetOrgId, snapshotStorageKey: storageKey, targetAdapter: adapter2 }),
    ]);

    expect(doc1.targetStateHash).toBe(doc2.targetStateHash);
    expect(doc1.targetStateHash).toHaveLength(64);
  });

  it('populates metadata fields on result', async () => {
    const zipData = await buildTestZip({ Account: [], Contact: [] });
    const engine = new DiffEngine(makeBackend(zipData));

    const doc = await engine.buildDiff({
      planId: 'my-plan', snapshotId, tenantId, targetOrgId,
      snapshotStorageKey: `tenants/${tenantId}/snapshots/${snapshotId}.zip`,
      targetAdapter: makeAdapter({}),
    });

    expect(doc.id).toBe('my-plan');
    expect(doc.snapshotId).toBe(snapshotId);
    expect(doc.tenantId).toBe(tenantId);
    expect(doc.targetOrgId).toBe(targetOrgId);
    expect(doc.builtAt).toBeGreaterThan(0);
    expect(doc.objectOrder).toContain('Account');
    expect(doc.objectOrder).toContain('Contact');
  });
});
```

- [ ] **Step 2: Run test to confirm failure**

```bash
cd api && bun test src/backup/test/diff-engine.test.ts 2>&1 | tail -5
```

Expected: FAIL — `Cannot find module '../diff-engine.js'`

- [ ] **Step 3: Create diff-engine.ts**

Create `api/src/backup/diff-engine.ts`:

```typescript
import { createHash } from 'node:crypto';
import { Open } from 'unzipper';
import type { CRMAdapter, CrmRecord } from './crm/types.js';
import type { ObjectBackend } from '../object/backend.js';
import type { DiffPlanDocument, DiffChange } from './diff-types.js';

interface ArchiveSchemaGraph {
  rootObject: string;
  nodes: Record<string, { objectName: string; depth: number }>;
  edges: Array<{ parentObject: string; childObject: string; isCycleBreak: boolean }>;
}

export class DiffEngine {
  constructor(private backend: ObjectBackend) {}

  async buildDiff(params: {
    planId: string;
    snapshotId: string;
    tenantId: string;
    targetOrgId: string;
    snapshotStorageKey: string;
    targetAdapter: CRMAdapter;
  }): Promise<DiffPlanDocument> {
    const { planId, snapshotId, tenantId, targetOrgId, snapshotStorageKey, targetAdapter } = params;

    const zipBytes = await this.backend.get(snapshotStorageKey);
    // unzipper works with Buffers — convert from Uint8Array
    const zipBuffer = Buffer.from(zipBytes);
    const dir = await Open.buffer(zipBuffer);

    const schemaEntry = dir.files.find((f) => f.path === 'schema-graph.json');
    if (!schemaEntry) throw new Error('schema-graph.json not found in snapshot archive');
    const schemaGraph: ArchiveSchemaGraph = JSON.parse(
      (await schemaEntry.buffer()).toString('utf8'),
    );

    const objectOrder = topoSort(schemaGraph.nodes, schemaGraph.edges);
    const changes: DiffChange[] = [];
    const allTargetIds: string[] = [];

    for (const objectName of objectOrder) {
      const ndjsonEntry = dir.files.find((f) => f.path === `records/${objectName}.ndjson`);
      const snapshotRecords: CrmRecord[] = [];
      if (ndjsonEntry) {
        const raw = (await ndjsonEntry.buffer()).toString('utf8');
        for (const line of raw.split('\n')) {
          const trimmed = line.trim();
          if (trimmed) snapshotRecords.push(JSON.parse(trimmed) as CrmRecord);
        }
      }

      const targetIdSet = new Set<string>();
      for await (const record of targetAdapter.queryRecords(objectName, ['Id'])) {
        const id = getId(record);
        if (id !== null) { targetIdSet.add(id); allTargetIds.push(id); }
      }

      const snapshotIdSet = new Set<string>();
      for (const record of snapshotRecords) {
        const id = getId(record);
        if (id !== null) snapshotIdSet.add(id);
      }

      for (const record of snapshotRecords) {
        const sourceId = getId(record);
        if (sourceId === null) continue;
        if (targetIdSet.has(sourceId)) {
          changes.push({ op: 'update', objectName, sourceRecord: record, targetId: sourceId });
        } else {
          changes.push({ op: 'insert', objectName, sourceRecord: record, targetId: null });
        }
      }

      for (const targetId of targetIdSet) {
        if (!snapshotIdSet.has(targetId)) {
          changes.push({ op: 'skip-delete', objectName, sourceRecord: {}, targetId });
        }
      }
    }

    return {
      id: planId, snapshotId, tenantId, targetOrgId,
      targetStateHash: stateHash(allTargetIds),
      builtAt: Date.now(), objectOrder, changes,
      counts: {
        insert: changes.filter((c) => c.op === 'insert').length,
        update: changes.filter((c) => c.op === 'update').length,
        skipDelete: changes.filter((c) => c.op === 'skip-delete').length,
      },
    };
  }
}

function getId(record: CrmRecord): string | null {
  const id = record['Id'] ?? record['id'];
  return typeof id === 'string' ? id : null;
}

function stateHash(ids: string[]): string {
  return createHash('sha256').update([...ids].sort().join('\n')).digest('hex');
}

function topoSort(
  nodes: Record<string, { objectName: string; depth: number }>,
  edges: Array<{ parentObject: string; childObject: string; isCycleBreak: boolean }>,
): string[] {
  const objectNames = Object.keys(nodes);
  const inDegree = new Map<string, number>(objectNames.map((n) => [n, 0]));
  const children = new Map<string, string[]>(objectNames.map((n) => [n, []]));

  for (const edge of edges) {
    if (edge.isCycleBreak || !inDegree.has(edge.childObject)) continue;
    inDegree.set(edge.childObject, (inDegree.get(edge.childObject) ?? 0) + 1);
    children.get(edge.parentObject)?.push(edge.childObject);
  }

  const queue: string[] = [];
  for (const [name, deg] of inDegree) { if (deg === 0) queue.push(name); }

  const result: string[] = [];
  while (queue.length > 0) {
    const node = queue.shift()!;
    result.push(node);
    for (const child of children.get(node) ?? []) {
      const newDeg = (inDegree.get(child) ?? 0) - 1;
      inDegree.set(child, newDeg);
      if (newDeg === 0) queue.push(child);
    }
  }

  const visited = new Set(result);
  const remaining = objectNames
    .filter((n) => !visited.has(n))
    .sort((a, b) => (nodes[a]?.depth ?? 0) - (nodes[b]?.depth ?? 0));

  return [...result, ...remaining];
}
```

- [ ] **Step 4: Run tests**

```bash
cd api && bun test src/backup/test/diff-engine.test.ts
```

Expected: All 4 DiffEngine tests PASS.

---

## Task 3: DiffPlanStore

**Files:**
- Create: `api/src/backup/diff-plan-store.ts`
- Create: `api/src/backup/test/diff-plan-store.test.ts`

DiffPlanStore serialises a `DiffPlanDocument` to JSON, uploads it via `ObjectBackend.put()`, and reads it back with `ObjectBackend.get()`. The storage key is `tenants/{tenantId}/diff-plans/{planId}.json`.

- [ ] **Step 1: Write the failing test**

Create `api/src/backup/test/diff-plan-store.test.ts`:

```typescript
import { describe, it, expect, mock } from 'bun:test';
import { DiffPlanStore } from '../diff-plan-store.js';
import type { DiffPlanDocument } from '../diff-types.js';
import type { ObjectBackend } from '../../object/backend.js';

function makeDoc(overrides: Partial<DiffPlanDocument> = {}): DiffPlanDocument {
  return {
    id: 'plan-1', snapshotId: 'snap-1', tenantId: 'tenant-a', targetOrgId: 'org-1',
    targetStateHash: 'abc123', builtAt: 1000,
    objectOrder: ['Account', 'Contact'],
    changes: [{ op: 'insert', objectName: 'Account', sourceRecord: { Id: 'acc-1', Name: 'Acme' }, targetId: null }],
    counts: { insert: 1, update: 0, skipDelete: 0 },
    ...overrides,
  };
}

function makeBackend(): { backend: ObjectBackend; storage: Map<string, Uint8Array> } {
  const storage = new Map<string, Uint8Array>();
  const backend: ObjectBackend = {
    put: mock(async (key: string, body: Uint8Array) => {
      storage.set(key, body);
      return { key, backendId: 'test', storageClass: 'STANDARD' };
    }),
    get: mock(async (key: string) => {
      const data = storage.get(key);
      if (!data) throw new Error(`Key not found: ${key}`);
      return data;
    }),
    presignGet: mock(async () => ''),
    delete: mock(async () => {}),
    setStorageClass: mock(async () => {}),
    list: mock(async function* () {}),
  } as unknown as ObjectBackend;
  return { backend, storage };
}

describe('DiffPlanStore', () => {
  it('round-trips a DiffPlanDocument through the backend', async () => {
    const { backend } = makeBackend();
    const store = new DiffPlanStore(backend);
    const doc = makeDoc();

    const storageKey = await store.save('tenant-a', 'plan-1', doc);
    expect(storageKey).toBe('tenants/tenant-a/diff-plans/plan-1.json');

    const loaded = await store.load(storageKey);
    expect(loaded).toEqual(doc);
  });

  it('preserves the full changes array', async () => {
    const { backend } = makeBackend();
    const store = new DiffPlanStore(backend);
    const doc = makeDoc({
      changes: [
        { op: 'insert', objectName: 'Account', sourceRecord: { Id: 'a1' }, targetId: null },
        { op: 'update', objectName: 'Contact', sourceRecord: { Id: 'c1', AccountId: 'a1' }, targetId: 'tgt-c1' },
        { op: 'skip-delete', objectName: 'Contact', sourceRecord: {}, targetId: 'ghost-01' },
      ],
      counts: { insert: 1, update: 1, skipDelete: 1 },
    });

    const key = await store.save('tenant-a', 'plan-2', doc);
    const loaded = await store.load(key);
    expect(loaded.changes).toHaveLength(3);
    expect(loaded.changes[0]?.op).toBe('insert');
    expect(loaded.changes[1]?.op).toBe('update');
    expect(loaded.changes[2]?.op).toBe('skip-delete');
  });

  it('uses tenant-scoped key so two tenants do not collide', async () => {
    const { backend } = makeBackend();
    const store = new DiffPlanStore(backend);
    const key1 = await store.save('tenant-a', 'plan-1', makeDoc());
    const key2 = await store.save('tenant-b', 'plan-1', makeDoc({ tenantId: 'tenant-b' }));
    expect(key1).not.toBe(key2);
    expect(key1.startsWith('tenants/tenant-a/')).toBe(true);
    expect(key2.startsWith('tenants/tenant-b/')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to confirm failure**

```bash
cd api && bun test src/backup/test/diff-plan-store.test.ts 2>&1 | tail -5
```

Expected: FAIL — `Cannot find module '../diff-plan-store.js'`

- [ ] **Step 3: Create diff-plan-store.ts**

Create `api/src/backup/diff-plan-store.ts`:

```typescript
import type { ObjectBackend } from '../object/backend.js';
import type { DiffPlanDocument } from './diff-types.js';

export class DiffPlanStore {
  constructor(private backend: ObjectBackend) {}

  async save(tenantId: string, planId: string, doc: DiffPlanDocument): Promise<string> {
    const storageKey = `tenants/${tenantId}/diff-plans/${planId}.json`;
    const json = JSON.stringify(doc);
    const bytes = new TextEncoder().encode(json);
    await this.backend.put(storageKey, bytes, { storageClass: 'STANDARD', contentType: 'application/json' });
    return storageKey;
  }

  async load(storageKey: string): Promise<DiffPlanDocument> {
    const bytes = await this.backend.get(storageKey);
    const json = new TextDecoder().decode(bytes);
    return JSON.parse(json) as DiffPlanDocument;
  }
}
```

- [ ] **Step 4: Run tests**

```bash
cd api && bun test src/backup/test/diff-plan-store.test.ts
```

Expected: All DiffPlanStore tests PASS.

---

## Task 4: RestoreExecutor

**Files:**
- Create: `api/src/backup/restore-executor.ts`
- Create: `api/src/backup/test/restore-executor.test.ts`

RestoreExecutor:
1. Re-queries the target org for all record IDs in `doc.objectOrder`, recomputes the state hash, and compares it to `doc.targetStateHash` — if they differ, throws a drift error.
2. In dry-run mode: drift check runs, no writes occur, all changes counted as skipped.
3. In execute mode: applies `insert` and `update` changes in topological order; `skip-delete` entries are counted as skipped. Continues past individual record failures. Builds an `IdRemap` so child records can reference newly created parent IDs.

- [ ] **Step 1: Write the failing test**

Create `api/src/backup/test/restore-executor.test.ts`:

```typescript
import { describe, it, expect, mock } from 'bun:test';
import { createHash } from 'node:crypto';
import { RestoreExecutor } from '../restore-executor.js';
import type { CRMAdapter, CrmRecord, IdRemap } from '../crm/types.js';
import type { DiffPlanDocument } from '../diff-types.js';

function hashIds(ids: string[]): string {
  return createHash('sha256').update([...ids].sort().join('\n')).digest('hex');
}

function makeAdapter(
  targetIds: Record<string, string[]>,
  upsertImpl?: (obj: string, record: CrmRecord, remap: IdRemap) => Promise<string>,
): CRMAdapter {
  return {
    listObjects: mock(() => Promise.resolve([])),
    describe: mock(),
    queryRecords: mock(async function* (objectName: string) {
      for (const id of targetIds[objectName] ?? []) yield { Id: id };
    }) as CRMAdapter['queryRecords'],
    downloadFile: mock(),
    upsertRecord: upsertImpl ?? mock(() => Promise.resolve('new-id')),
    deployMetadata: mock(),
    uploadFile: mock(),
  };
}

function makeDoc(targetStateHash: string, overrides: Partial<DiffPlanDocument> = {}): DiffPlanDocument {
  return {
    id: 'plan-1', snapshotId: 'snap-1', tenantId: 'tenant-a', targetOrgId: 'org-t',
    targetStateHash, builtAt: 1000,
    objectOrder: ['Account', 'Contact'],
    changes: [
      { op: 'insert', objectName: 'Account', sourceRecord: { Id: 'src-acc-1', Name: 'Acme' }, targetId: null },
      { op: 'update', objectName: 'Contact', sourceRecord: { Id: 'src-con-1', AccountId: 'src-acc-1' }, targetId: 'tgt-con-1' },
      { op: 'skip-delete', objectName: 'Contact', sourceRecord: {}, targetId: 'ghost-001' },
    ],
    counts: { insert: 1, update: 1, skipDelete: 1 },
    ...overrides,
  };
}

describe('RestoreExecutor', () => {
  it('applies inserts and updates; counts skip-deletes as skipped', async () => {
    const targetIds = { Account: [], Contact: ['tgt-con-1', 'ghost-001'] };
    const hash = hashIds(['tgt-con-1', 'ghost-001']);
    const upsertRecord = mock(() => Promise.resolve('new-tgt-acc-1'));
    const adapter = makeAdapter(targetIds, upsertRecord);

    const executor = new RestoreExecutor();
    const result = await executor.execute({ doc: makeDoc(hash), targetAdapter: adapter, dryRun: false });

    expect(result.applied).toBe(2);
    expect(result.skipped).toBe(1);
    expect(result.failed).toBe(0);
    expect(result.errors).toHaveLength(0);
    expect(upsertRecord).toHaveBeenCalledTimes(2);
  });

  it('dry-run: passes drift check but makes no writes', async () => {
    const targetIds = { Account: [], Contact: ['tgt-con-1', 'ghost-001'] };
    const hash = hashIds(['tgt-con-1', 'ghost-001']);
    const upsertRecord = mock(() => Promise.resolve(''));
    const adapter = makeAdapter(targetIds, upsertRecord);

    const executor = new RestoreExecutor();
    const result = await executor.execute({ doc: makeDoc(hash), targetAdapter: adapter, dryRun: true });

    expect(upsertRecord).not.toHaveBeenCalled();
    expect(result.applied).toBe(0);
    expect(result.skipped).toBe(3);
    expect(result.failed).toBe(0);
  });

  it('throws on drift: target state changed since diff was built', async () => {
    const targetIds = { Account: ['unexpected-new-record'], Contact: [] };
    const staleHash = hashIds(['tgt-con-1']);
    const adapter = makeAdapter(targetIds);

    const executor = new RestoreExecutor();
    await expect(
      executor.execute({ doc: makeDoc(staleHash), targetAdapter: adapter, dryRun: false }),
    ).rejects.toThrow('drifted');
  });

  it('records idRemap from insert so child records can reference parent', async () => {
    const hash = hashIds([]);
    const doc: DiffPlanDocument = {
      id: 'plan-1', snapshotId: 'snap-1', tenantId: 'tenant-a', targetOrgId: 'org-t',
      targetStateHash: hash, builtAt: 1000, objectOrder: ['Account'],
      changes: [{ op: 'insert', objectName: 'Account', sourceRecord: { Id: 'src-1' }, targetId: null }],
      counts: { insert: 1, update: 0, skipDelete: 0 },
    };
    const adapter = makeAdapter({ Account: [] }, async () => 'tgt-assigned-1');
    const executor = new RestoreExecutor();
    const result = await executor.execute({ doc, targetAdapter: adapter, dryRun: false });

    expect(result.idRemap['src-1']).toBe('tgt-assigned-1');
  });

  it('continues past individual record failures; counts them', async () => {
    const hash = hashIds([]);
    const doc: DiffPlanDocument = {
      id: 'plan-1', snapshotId: 'snap-1', tenantId: 'tenant-a', targetOrgId: 'org-t',
      targetStateHash: hash, builtAt: 1000, objectOrder: ['Account'],
      changes: [
        { op: 'insert', objectName: 'Account', sourceRecord: { Id: 'src-1' }, targetId: null },
        { op: 'insert', objectName: 'Account', sourceRecord: { Id: 'src-2' }, targetId: null },
      ],
      counts: { insert: 2, update: 0, skipDelete: 0 },
    };

    let callCount = 0;
    const adapter = makeAdapter({ Account: [] }, async () => {
      callCount++;
      if (callCount === 1) throw new Error('CRM API rate limit');
      return 'tgt-2';
    });

    const executor = new RestoreExecutor();
    const result = await executor.execute({ doc, targetAdapter: adapter, dryRun: false });

    expect(result.applied).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.errors[0]?.message).toContain('rate limit');
  });
});
```

- [ ] **Step 2: Run test to confirm failure**

```bash
cd api && bun test src/backup/test/restore-executor.test.ts 2>&1 | tail -5
```

Expected: FAIL — `Cannot find module '../restore-executor.js'`

- [ ] **Step 3: Create restore-executor.ts**

Create `api/src/backup/restore-executor.ts`:

```typescript
import { createHash } from 'node:crypto';
import type { CRMAdapter, CrmRecord, IdRemap } from './crm/types.js';
import type { DiffPlanDocument } from './diff-types.js';

export interface RestoreResult {
  applied: number;
  skipped: number;
  failed: number;
  idRemap: Record<string, string>;
  errors: Array<{ objectName: string; sourceId: string; message: string }>;
}

export class RestoreExecutor {
  async execute(params: {
    doc: DiffPlanDocument;
    targetAdapter: CRMAdapter;
    dryRun: boolean;
  }): Promise<RestoreResult> {
    const { doc, targetAdapter, dryRun } = params;

    const currentHash = await computeStateHash(targetAdapter, doc.objectOrder);
    if (currentHash !== doc.targetStateHash) {
      throw new Error(
        `Target org has drifted since diff was built (hash mismatch). Re-run diff before restoring.`,
      );
    }

    if (dryRun) {
      return {
        applied: 0,
        skipped: doc.changes.length,
        failed: 0,
        idRemap: {},
        errors: [],
      };
    }

    const remapMap = new Map<string, string>();
    const idRemap: IdRemap = {
      get(sourceId) { return remapMap.get(sourceId); },
      set(sourceId, targetId) { remapMap.set(sourceId, targetId); },
    };

    let applied = 0;
    let skipped = 0;
    let failed = 0;
    const errors: RestoreResult['errors'] = [];

    for (const objectName of doc.objectOrder) {
      for (const change of doc.changes.filter((c) => c.objectName === objectName)) {
        if (change.op === 'skip-delete') {
          skipped++;
          continue;
        }

        const sourceId = getId(change.sourceRecord);

        try {
          const newId = await targetAdapter.upsertRecord(change.objectName, change.sourceRecord, idRemap);
          if (sourceId !== null) remapMap.set(sourceId, newId);
          applied++;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          errors.push({ objectName: change.objectName, sourceId: sourceId ?? 'unknown', message });
          failed++;
        }
      }
    }

    return {
      applied, skipped, failed,
      idRemap: Object.fromEntries(remapMap),
      errors,
    };
  }
}

async function computeStateHash(adapter: CRMAdapter, objectOrder: string[]): Promise<string> {
  const ids: string[] = [];
  for (const objectName of objectOrder) {
    for await (const record of adapter.queryRecords(objectName, ['Id'])) {
      const id = record['Id'] ?? record['id'];
      if (typeof id === 'string') ids.push(id);
    }
  }
  return createHash('sha256').update([...ids].sort().join('\n')).digest('hex');
}

function getId(record: CrmRecord): string | null {
  const id = record['Id'] ?? record['id'];
  return typeof id === 'string' ? id : null;
}
```

- [ ] **Step 4: Run tests**

```bash
cd api && bun test src/backup/test/restore-executor.test.ts
```

Expected: All RestoreExecutor tests PASS.

---

## Task 5: Add diff and restore routes

**Files:**
- Modify: `api/src/backup/routes.ts`

Add 5 new routes at the bottom of `api/src/backup/routes.ts`, before the final `export { routes as backupRoutes }` line.

First add the new imports at the top of the file (after the existing imports):

```typescript
import { DiffEngine } from './diff-engine.js';
import { DiffPlanStore } from './diff-plan-store.js';
import { RestoreExecutor } from './restore-executor.js';
import { createCrmAdapter } from './backup-engine.js';
import type { DiffPlan, RestoreJob, RestoreJobMode } from './types.js';
```

Then add two more lazy singletons alongside the existing ones (`_repo`, `_vault`, `_gitSync`):

```typescript
let _diffPlanStore: DiffPlanStore | undefined;
let _restoreExecutor: RestoreExecutor | undefined;

function getDiffPlanStore() {
  if (!_diffPlanStore) _diffPlanStore = new DiffPlanStore(getBackend());
  return _diffPlanStore;
}

function getRestoreExecutor() {
  if (!_restoreExecutor) _restoreExecutor = new RestoreExecutor();
  return _restoreExecutor;
}
```

Also add a `getBackend()` helper alongside the existing `getEngine()` (if not already there):

```typescript
function getBackend() {
  const backends = getBackends();
  const backend = backends.values().next().value;
  if (!backend) throw new Error('No storage backend configured');
  return backend;
}
```

Then append the following routes before `export`:

- [ ] **Step 1: Add diff routes**

```typescript
// ─── Diff ─────────────────────────────────────────────────────────────────────

// Build a diff plan for a complete snapshot vs a target connected org
routes.post('/snapshots/:id/diff', apiKeyAuth, async (c) => {
  const tenantId = c.get('tenantId') as string;
  const snap = getRepo().snapshots.findById(c.req.param('id'));
  if (!snap || snap.tenantId !== tenantId) return c.json({ error: 'snapshot not found' }, 404);
  if (snap.status !== 'complete') return c.json({ error: 'snapshot must be complete before diffing' }, 400);
  if (!snap.archiveStorageKey) return c.json({ error: 'snapshot has no archive' }, 400);

  const body = await c.req.json<{ targetOrgId?: string }>();
  if (!body.targetOrgId) return c.json({ error: 'targetOrgId required' }, 400);

  const targetOrg = getRepo().connectedOrgs.findById(body.targetOrgId);
  if (!targetOrg || targetOrg.tenantId !== tenantId) return c.json({ error: 'target org not found' }, 404);

  const planId = crypto.randomUUID();
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

// Get diff plan metadata from SQLite index
routes.get('/diff-plans/:id', apiKeyAuth, (c) => {
  const tenantId = c.get('tenantId') as string;
  const plan = getRepo().diffPlans.findById(c.req.param('id'));
  if (!plan || plan.tenantId !== tenantId) return c.json({ error: 'not found' }, 404);
  return c.json(plan);
});
```

- [ ] **Step 2: Add restore routes**

```typescript
// ─── Restore ──────────────────────────────────────────────────────────────────

const VALID_MODES = new Set<RestoreJobMode>(['dry-run', 'execute']);

// Trigger a restore job (returns 202, runs async)
routes.post('/snapshots/:id/restore', apiKeyAuth, async (c) => {
  const tenantId = c.get('tenantId') as string;
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

  const jobId = crypto.randomUUID();
  const now = Date.now();

  const job: RestoreJob = {
    id: jobId, tenantId, snapshotId: snap.id, targetOrgId, mode: mode as RestoreJobMode,
    status: 'pending', diffPlanStorageKey: diffPlan.storageKey,
    appliedChangesSummary: null, startedAt: now, completedAt: null, error: null,
  };
  getRepo().restoreJobs.insert(job);

  // Fire and forget
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

// List restore jobs for the authenticated tenant
routes.get('/restores', apiKeyAuth, (c) => {
  const tenantId = c.get('tenantId') as string;
  const limitStr = c.req.query('limit');
  const limit = limitStr ? Number.parseInt(limitStr, 10) : 50;
  const jobs = getRepo().restoreJobs.findByTenant(tenantId, Number.isFinite(limit) ? limit : 50);
  return c.json({ jobs });
});

// Get a single restore job by ID
routes.get('/restores/:id', apiKeyAuth, (c) => {
  const tenantId = c.get('tenantId') as string;
  const job = getRepo().restoreJobs.findById(c.req.param('id'));
  if (!job || job.tenantId !== tenantId) return c.json({ error: 'not found' }, 404);
  return c.json(job);
});
```

- [ ] **Step 3: Verify typecheck**

```bash
cd api && bun run typecheck
```

Expected: exit 0, no errors. Fix any import or type issues before proceeding.

---

## Task 6: Full test suite + verification

- [ ] **Step 1: Run all backup tests**

```bash
cd api && bun test src/backup/
```

Expected: All tests pass across all test files:
- `test/repo.test.ts`
- `test/credential-vault.test.ts`
- `test/salesforce-adapter.test.ts`
- `test/hubspot-adapter.test.ts`
- `test/schema-walker.test.ts`
- `test/snapshot-capture.test.ts`
- `test/git-sync.test.ts`
- `test/backup-engine.test.ts`
- `test/diff-engine.test.ts`
- `test/diff-plan-store.test.ts`
- `test/restore-executor.test.ts`

- [ ] **Step 2: Typecheck**

```bash
cd api && bun run typecheck
```

Expected: exit 0.

- [ ] **Step 3: Smoke-test the routes**

```bash
cd api && bun run src/server.ts &
sleep 2

# Health check
curl -s http://localhost:3099/health

# List orgs (expects empty array for demo tenant)
curl -s http://localhost:3099/v1/backup/orgs \
  -H "X-Vastify-Api-Key: vastify_demo_key_change_me"

kill %1
```

Expected: health returns `{"ok":true,...}`, orgs returns `{"orgs":[]}`.

- [ ] **Step 4: Commit**

```bash
git add api/src/backup api/package.json api/bun.lock
git commit -m "feat(backup): Plan 3 complete — DiffEngine, DiffPlanStore, RestoreExecutor, diff/restore routes"
```

---

## Self-Review Checklist

**Spec coverage:**

- [x] DiffEngine reads snapshot zip from ObjectBackend — Task 2
- [x] DiffEngine queries target org via CRMAdapter — Task 2
- [x] DiffEngine classifies insert/update/skip-delete — Task 2
- [x] DiffEngine computes deterministic targetStateHash — Task 2
- [x] DiffEngine topological object order (topoSort) — Task 2
- [x] DiffPlanStore save/load via ObjectBackend — Task 3
- [x] RestoreExecutor drift check — Task 4
- [x] RestoreExecutor topological apply in objectOrder — Task 4
- [x] RestoreExecutor dry-run mode (no writes) — Task 4
- [x] RestoreExecutor IdRemap for cross-record references — Task 4
- [x] RestoreExecutor continues past individual record failures — Task 4
- [x] `POST /v1/backup/snapshots/:id/diff` — Task 5
- [x] `GET /v1/backup/diff-plans/:id` — Task 5
- [x] `POST /v1/backup/snapshots/:id/restore` — Task 5
- [x] `GET /v1/backup/restores` — Task 5
- [x] `GET /v1/backup/restores/:id` — Task 5
- [x] Tenant isolation on all routes (tenantId check on every DB lookup) — Task 5
- [x] execute mode requires `confirm: true` guard — Task 5

**Key differentiators implemented:**

- Metadata and data in a single linked snapshot (schema-graph.json + records NDJSON + manifest in one zip)
- Relationship-aware restore: topological ordering respects parent-before-child; IdRemap resolves FK references
- Dry-run diff with record-by-record visibility before any writes
- Multi-org by design: every route enforces `tenantId` isolation
- Git-backed metadata history: one commit per snapshot on a per-org branch
- Storage vendor-agnostic: snapshot archives and diff plans go through the existing ObjectBackend (GCS/S3/Azure/MinIO)
