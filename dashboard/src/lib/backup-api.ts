import { authApi } from './api';

export interface ConnectedOrg {
  id: string;
  tenantId: string;
  crmType: 'salesforce' | 'hubspot';
  displayName: string;
  instanceUrl: string;
  externalOrgId: string;
  isSandbox: boolean;
  gitRemoteUrl: string | null;
  connectedAt: number;
  lastUsedAt: number | null;
}

export interface BackupScope {
  id: string;
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
  status: 'pending' | 'running' | 'complete' | 'failed';
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
  mode: 'dry-run' | 'execute';
  status: 'pending' | 'running' | 'complete' | 'partial' | 'failed';
  diffPlanStorageKey: string | null;
  appliedChangesSummary: string | null;
  startedAt: number;
  completedAt: number | null;
  error: string | null;
}

export const listOrgs = () => authApi<{ orgs: ConnectedOrg[] }>('/v1/backup/orgs').then((r) => r.orgs);

export const listScopes = (connectedOrgId: string) =>
  authApi<{ scopes: BackupScope[] }>(`/v1/backup/scopes?connectedOrgId=${connectedOrgId}`).then((r) => r.scopes);

export const createScope = (body: Pick<BackupScope, 'connectedOrgId' | 'name' | 'rootObject' | 'maxDepth' | 'includeFiles' | 'includeMetadata'>) =>
  authApi<{ scopeId: string }>('/v1/backup/scopes', { json: body });

export const listSnapshots = () => authApi<{ snapshots: Snapshot[] }>('/v1/backup/snapshots').then((r) => r.snapshots);
export const getSnapshot = (id: string) => authApi<Snapshot>(`/v1/backup/snapshots/${id}`);
export const triggerSnapshot = (connectedOrgId: string, scopeId: string) =>
  authApi<{ snapshotId: string }>('/v1/backup/snapshots', { json: { connectedOrgId, scopeId } });

export const buildDiff = (snapshotId: string, targetOrgId: string) =>
  authApi<{ diffPlanId: string }>(`/v1/backup/snapshots/${snapshotId}/diff`, { json: { targetOrgId } });
export const getDiffPlan = (diffPlanId: string) => authApi<DiffPlan>(`/v1/backup/diff-plans/${diffPlanId}`);
export const listDiffPlansForSnapshot = (snapshotId: string) =>
  authApi<{ plans: DiffPlan[] }>(`/v1/backup/snapshots/${snapshotId}/diff-plans`).then((r) => r.plans);

export const triggerRestore = (snapshotId: string, body: { targetOrgId: string; diffPlanId: string; mode: 'dry-run' | 'execute'; confirm?: boolean }) =>
  authApi<{ jobId: string }>(`/v1/backup/snapshots/${snapshotId}/restore`, { json: body });
export const getRestoreJob = (jobId: string) => authApi<RestoreJob>(`/v1/backup/restores/${jobId}`);
export const listRestoreJobs = () => authApi<{ jobs: RestoreJob[] }>('/v1/backup/restores').then((r) => r.jobs);
