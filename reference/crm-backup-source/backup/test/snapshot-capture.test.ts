import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync, statSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { captureSnapshot } from '../src/snapshot-capture.js';
import type { CRMAdapter, CrmRecord, FileRef } from '../src/crm/types.js';
import type { BackupScope } from '@infinity-docs/shared';
import type { SchemaGraph } from '../src/schema-walker.js';
import type { FieldDescriptor } from '../src/crm/types.js';

function makeAdapter(records: Record<string, CrmRecord[]> = {}): CRMAdapter {
  return {
    listObjects: vi.fn(),
    describe: vi.fn(),
    queryRecords: vi.fn(async function* (objectName: string) {
      for (const r of records[objectName] ?? []) yield r;
    }) as CRMAdapter['queryRecords'],
    downloadFile: vi.fn().mockResolvedValue(Buffer.from('FAKE_FILE_CONTENT')),
    upsertRecord: vi.fn(),
    deployMetadata: vi.fn(),
    uploadFile: vi.fn(),
  };
}

function makeScope(overrides: Partial<BackupScope> = {}): BackupScope {
  return {
    id: 's1', tenantId: 'tenant-a', connectedOrgId: 'org-1',
    name: 'Test Scope', rootObject: 'Account', maxDepth: 2,
    includeFiles: false, includeMetadata: true, createdAt: 1000,
    ...overrides,
  };
}

const accountField: FieldDescriptor = {
  name: 'Id', label: 'Account ID', type: 'id',
  referenceTo: [], nillable: false, externalId: false,
};

function makeGraph(objectNames: string[]): SchemaGraph {
  const nodes = new Map(objectNames.map((n, i) => [
    n, { objectName: n, depth: i, fields: [accountField] },
  ]));
  return { rootObject: objectNames[0] ?? 'Account', nodes, edges: [] };
}

describe('captureSnapshot', () => {
  let snapshotsDir: string;
  let snapshotId: string;

  beforeEach(() => {
    snapshotsDir = join(tmpdir(), `capture-test-${randomUUID()}`);
    mkdirSync(snapshotsDir, { recursive: true });
    snapshotId = randomUUID();
  });

  afterEach(() => {
    rmSync(snapshotsDir, { recursive: true, force: true });
  });

  it('creates a zip archive at the expected path', async () => {
    const adapter = makeAdapter({ Account: [{ Id: 'a1', Name: 'Acme' }] });
    const scope = makeScope();
    const graph = makeGraph(['Account']);

    const result = await captureSnapshot(adapter, scope, graph, snapshotId, 'tenant-a', { snapshotsDir });

    expect(result.archiveStorageKey).toBe(`tenant-a/${snapshotId}.zip`);
    const absPath = join(snapshotsDir, result.archiveStorageKey);
    expect(existsSync(absPath)).toBe(true);
    expect(statSync(absPath).size).toBeGreaterThan(0);
    const bytes = readFileSync(absPath);
    expect(bytes[0]).toBe(0x50); // P
    expect(bytes[1]).toBe(0x4b); // K
  });

  it('returns correct record and metadata counts', async () => {
    const adapter = makeAdapter({
      Account: [{ Id: 'a1' }, { Id: 'a2' }],
      Contact: [{ Id: 'c1' }],
    });
    const scope = makeScope();
    const graph = makeGraph(['Account', 'Contact']);

    const result = await captureSnapshot(adapter, scope, graph, snapshotId, 'tenant-a', { snapshotsDir });

    expect(result.recordCount).toBe(3);
    expect(result.metadataItemCount).toBe(2);
    expect(result.fileCount).toBe(0);
    expect(result.sizeBytes).toBeGreaterThan(0);
  });

  it('returns zero counts for an empty graph', async () => {
    const adapter = makeAdapter();
    const scope = makeScope();
    const graph: SchemaGraph = { rootObject: 'Account', nodes: new Map(), edges: [] };

    const result = await captureSnapshot(adapter, scope, graph, snapshotId, 'tenant-a', { snapshotsDir });

    expect(result.recordCount).toBe(0);
    expect(result.metadataItemCount).toBe(0);
    expect(result.fileCount).toBe(0);
  });

  it('calls downloadFile for ContentVersion records when includeFiles is true', async () => {
    const cvRecord: CrmRecord = { Id: 'cv001', Title: 'AttachmentA', ContentSize: 512, FileType: 'PDF' };
    const adapter = makeAdapter({ ContentVersion: [cvRecord] });
    const scope = makeScope({ includeFiles: true });
    const graph = makeGraph(['Account', 'ContentVersion']);

    const result = await captureSnapshot(adapter, scope, graph, snapshotId, 'tenant-a', { snapshotsDir });

    expect(adapter.downloadFile).toHaveBeenCalledWith({
      id: 'cv001',
      name: 'AttachmentA.pdf',
      size: 512,
      contentType: 'application/octet-stream',
    } satisfies FileRef);
    expect(result.fileCount).toBe(1);
  });

  it('skips file download when includeFiles is false even if ContentVersion is in graph', async () => {
    const adapter = makeAdapter({ ContentVersion: [{ Id: 'cv001', Title: 'A', ContentSize: 100, FileType: 'PDF' }] });
    const scope = makeScope({ includeFiles: false });
    const graph = makeGraph(['Account', 'ContentVersion']);

    await captureSnapshot(adapter, scope, graph, snapshotId, 'tenant-a', { snapshotsDir });

    expect(adapter.downloadFile).not.toHaveBeenCalled();
  });
});
