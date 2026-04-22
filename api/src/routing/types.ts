import type { BackendId, StorageClass } from '../object/backend.ts';

export type Kind = 'file' | 'record';

export interface RuleMatch {
  kind: Kind;
  sizeBytesMax?: number;
  sizeBytesMin?: number;
  ageDaysMin?: number;
  ageDaysMax?: number;
  mimeRegex?: string;
  entity?: string;
}

export interface RuleTarget {
  backendId: BackendId;
  storageClass: StorageClass;
}

export interface RoutingRule {
  id: string;
  tenantId: string;
  priority: number;
  match: RuleMatch;
  target: RuleTarget;
  enabled: boolean;
}

export interface RoutingContext {
  tenantId: string;
  kind: Kind;
  sizeBytes?: number;
  ageDays?: number;
  mime?: string;
  entity?: string;
}

export interface RoutingDecision {
  backendId: BackendId;
  storageClass: StorageClass;
  ruleId: string | null; // null = used fallback
}
