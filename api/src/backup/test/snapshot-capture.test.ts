import { describe, it, expect, mock } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { captureSnapshot } from '../snapshot-capture.js';
import type { CRMAdapter, CrmRecord, FieldDescriptor } from '../crm/types.js';
import type { BackupScope } from '../types.js';
import type { SchemaGraph } from '../schema-walker.js';
import type { ObjectBackend, PutResult, BackendId } from '../../object/backend.js';

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
    id: 'minio' as BackendId,
    put: mock(async (key: string, body: Uint8Array) => {
      uploaded.set(key, body);
      return { backendId: 'test' as BackendId, objectKey: key, storageClass: 'STANDARD', sizeBytes: body.length } as unknown as PutResult;
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
