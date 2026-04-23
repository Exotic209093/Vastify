import { createWriteStream, mkdirSync, statSync, renameSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import archiver from 'archiver';
import type { CRMAdapter, FileRef } from './crm/types.js';
import type { BackupScope } from '@infinity-docs/shared';
import type { SchemaGraph } from './schema-walker.js';

export interface SnapshotCaptureOptions {
  snapshotsDir: string;
  parallelism?: number;
}

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
  opts: SnapshotCaptureOptions,
): Promise<SnapshotCaptureResult> {
  const key = `${tenantId}/${snapshotId}.zip`;
  const absPath = join(opts.snapshotsDir, key);
  const tmpPath = `${absPath}.tmp`;
  mkdirSync(dirname(absPath), { recursive: true });

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

  // 1. Metadata: write each object schema from the graph
  for (const [objectName, node] of graph.nodes) {
    arc.append(
      JSON.stringify({ objectName, fields: node.fields }, null, 2),
      { name: `metadata/objects/${objectName}.json` },
    );
    metadataItemCount++;
  }

  // 2. Records: NDJSON per object, with limited parallelism
  const parallelism = opts.parallelism ?? 4;
  const objectNames = [...graph.nodes.keys()];

  for (let i = 0; i < objectNames.length; i += parallelism) {
    const batch = objectNames.slice(i, i + parallelism);
    await Promise.all(
      batch.map(async (objectName) => {
        const node = graph.nodes.get(objectName);
        if (!node) return;
        const fields = node.fields.map((f) => f.name);
        const lines: string[] = [];
        for await (const record of adapter.queryRecords(objectName, fields)) {
          lines.push(JSON.stringify(record));
          recordCount++;
        }
        if (lines.length > 0) {
          arc.append(lines.join('\n') + '\n', { name: `records/${objectName}.ndjson` });
        }
      }),
    );
  }

  // 3. Files: binary download for ContentVersion (Salesforce only)
  if (scope.includeFiles && graph.nodes.has('ContentVersion')) {
    fileCount = await captureFileBlobs(adapter, arc);
  }

  // 4. Schema graph
  arc.append(
    JSON.stringify(
      {
        rootObject: graph.rootObject,
        nodes: Object.fromEntries(
          [...graph.nodes.entries()].map(([k, v]) => [k, { objectName: v.objectName, depth: v.depth }]),
        ),
        edges: graph.edges,
      },
      null,
      2,
    ),
    { name: 'schema-graph.json' },
  );

  // 5. Manifest (written last so counts are final)
  arc.append(
    JSON.stringify(
      {
        schemaVersion: 1,
        snapshotId,
        tenantId,
        scopeId: scope.id,
        scopeName: scope.name,
        rootObject: scope.rootObject,
        recordCount,
        fileCount,
        metadataItemCount,
        capturedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
    { name: 'manifest.json' },
  );

  try {
    await Promise.all([arc.finalize(), closed]);
  } catch (err) {
    output.close();
    rmSync(tmpPath, { force: true });
    throw err;
  }

  renameSync(tmpPath, absPath);
  const { size: sizeBytes } = statSync(absPath);

  return { archiveStorageKey: key, recordCount, fileCount, metadataItemCount, sizeBytes };
}

async function captureFileBlobs(
  adapter: CRMAdapter,
  arc: ReturnType<typeof archiver>,
): Promise<number> {
  let count = 0;
  const refs: FileRef[] = [];

  for await (const record of adapter.queryRecords(
    'ContentVersion',
    ['Id', 'Title', 'ContentSize', 'FileType'],
    'IsLatest = TRUE',
  )) {
    refs.push({
      id: String(record['Id'] ?? ''),
      name: `${String(record['Title'] ?? 'file')}.${String(record['FileType'] ?? 'bin').toLowerCase()}`,
      size: Number(record['ContentSize'] ?? 0),
      contentType: 'application/octet-stream',
    });
  }

  for (const ref of refs) {
    const buffer = await adapter.downloadFile(ref);
    arc.append(buffer, { name: `files/${ref.id}.bin` });
    arc.append(
      JSON.stringify({ id: ref.id, name: ref.name, size: ref.size }),
      { name: `files/${ref.id}.meta.json` },
    );
    count++;
  }

  return count;
}
