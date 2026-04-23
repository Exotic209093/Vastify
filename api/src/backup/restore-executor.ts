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
