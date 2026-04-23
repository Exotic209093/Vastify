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
