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
