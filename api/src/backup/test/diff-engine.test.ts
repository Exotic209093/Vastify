import { describe, it, expect, mock } from 'bun:test';
import { createWriteStream } from 'node:fs';
import { join } from 'node:path';
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
    put: mock(async (key: string, _body: Uint8Array) => ({ key, backendId: 'test', storageClass: 'STANDARD' })),
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
