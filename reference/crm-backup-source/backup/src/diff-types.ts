import type { CrmRecord } from './crm/types.js';

export type DiffOp = 'insert' | 'update' | 'skip-delete';

export type DiffChange =
  | { op: 'insert';      objectName: string; sourceRecord: CrmRecord; targetId: null }
  | { op: 'update';      objectName: string; sourceRecord: CrmRecord; targetId: string }
  | { op: 'skip-delete'; objectName: string; sourceRecord: CrmRecord; targetId: string };

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
