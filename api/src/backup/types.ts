export type CrmType = 'salesforce' | 'hubspot';
export type SnapshotStatus = 'pending' | 'running' | 'complete' | 'failed';
export type RestoreJobStatus = 'pending' | 'running' | 'complete' | 'partial' | 'failed';
export type RestoreJobMode = 'dry-run' | 'execute';

export interface ConnectedOrg {
  id: string;
  tenantId: string;
  crmType: CrmType;
  displayName: string;
  instanceUrl: string;
  externalOrgId: string;
  isSandbox: boolean;
  oauthRefreshTokenEncrypted: string;
  oauthAccessTokenCache: string | null;
  accessTokenExpiresAt: number | null;
  gitRemoteUrl: string | null;
  connectedAt: number;
  lastUsedAt: number | null;
}

export interface BackupScope {
  id: string;
  tenantId: string;
  connectedOrgId: string;
  name: string;
  rootObject: string;
  maxDepth: number;
  includeFiles: boolean;
  includeMetadata: boolean;
  createdAt: number;
}

export interface Snapshot {
  id: string;
  tenantId: string;
  connectedOrgId: string;
  backupScopeId: string;
  status: SnapshotStatus;
  archiveStorageKey: string | null;
  archiveBackendId: string | null;
  gitCommitSha: string | null;
  recordCount: number | null;
  fileCount: number | null;
  metadataItemCount: number | null;
  sizeBytes: number | null;
  startedAt: number;
  completedAt: number | null;
  error: string | null;
}

export interface DiffPlan {
  id: string;
  tenantId: string;
  snapshotId: string;
  targetOrgId: string;
  storageKey: string;
  backendId: string;
  targetStateHash: string;
  summaryCounts: string;
  builtAt: number;
  expiresAt: number | null;
}

export interface RestoreJob {
  id: string;
  tenantId: string;
  snapshotId: string;
  targetOrgId: string;
  mode: RestoreJobMode;
  status: RestoreJobStatus;
  diffPlanStorageKey: string | null;
  appliedChangesSummary: string | null;
  startedAt: number;
  completedAt: number | null;
  error: string | null;
}
