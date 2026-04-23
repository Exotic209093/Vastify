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
  archiveBackendId: string;
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

  const zipBytes = new Uint8Array(readFileSync(tmpPath).buffer);
  const sizeBytes = statSync(tmpPath).size;
  unlinkSync(tmpPath);

  const putResult = await backend.put(storageKey, zipBytes, { storageClass: 'STANDARD', contentType: 'application/zip' });

  return {
    archiveStorageKey: storageKey,
    archiveBackendId: String(putResult.backendId),
    recordCount,
    fileCount,
    metadataItemCount,
    sizeBytes,
  };
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
