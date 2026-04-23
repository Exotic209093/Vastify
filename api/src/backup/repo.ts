import type { Database, SQLQueryBindings } from 'bun:sqlite';
import type {
  ConnectedOrg, BackupScope, Snapshot, DiffPlan, RestoreJob,
  SnapshotStatus, RestoreJobStatus,
} from './types.js';

export interface BackupRepo {
  connectedOrgs: {
    insert(org: ConnectedOrg): void;
    findById(id: string): ConnectedOrg | null;
    findByTenant(tenantId: string): ConnectedOrg[];
    update(id: string, patch: Partial<Pick<ConnectedOrg,
      'oauthRefreshTokenEncrypted' | 'oauthAccessTokenCache' | 'accessTokenExpiresAt' |
      'lastUsedAt' | 'gitRemoteUrl'>>): void;
    delete(id: string): void;
  };
  backupScopes: {
    insert(scope: BackupScope): void;
    findById(id: string): BackupScope | null;
    findByOrg(connectedOrgId: string): BackupScope[];
    delete(id: string): void;
  };
  snapshots: {
    insert(snap: Snapshot): void;
    findById(id: string): Snapshot | null;
    findByTenant(tenantId: string, limit?: number): Snapshot[];
    updateStatus(id: string, status: SnapshotStatus, patch?: Partial<Pick<Snapshot,
      'archiveStorageKey' | 'archiveBackendId' | 'gitCommitSha' |
      'recordCount' | 'fileCount' | 'metadataItemCount' | 'sizeBytes' |
      'completedAt' | 'error'>>): void;
  };
  diffPlans: {
    insert(plan: DiffPlan): void;
    findById(id: string): DiffPlan | null;
    findBySnapshot(snapshotId: string, targetOrgId: string): DiffPlan[];
  };
  restoreJobs: {
    insert(job: RestoreJob): void;
    findById(id: string): RestoreJob | null;
    findByTenant(tenantId: string, limit?: number): RestoreJob[];
    updateStatus(id: string, status: RestoreJobStatus, patch?: Partial<Pick<RestoreJob,
      'diffPlanStorageKey' | 'appliedChangesSummary' | 'completedAt' | 'error'>>): void;
  };
}

function b(v: boolean): number { return v ? 1 : 0; }
function bool(v: number | null | undefined): boolean { return v === 1; }

export function createBackupRepo(db: Database): BackupRepo {
  return {
    connectedOrgs: {
      insert(org) {
        db.prepare(`
          INSERT INTO connected_orgs
            (id, tenant_id, crm_type, display_name, instance_url, external_org_id,
             is_sandbox, oauth_refresh_token_enc, oauth_access_token_cache,
             access_token_expires_at, git_remote_url, connected_at, last_used_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
        `).run(
          org.id, org.tenantId, org.crmType, org.displayName, org.instanceUrl,
          org.externalOrgId, b(org.isSandbox), org.oauthRefreshTokenEncrypted,
          org.oauthAccessTokenCache, org.accessTokenExpiresAt, org.gitRemoteUrl,
          org.connectedAt, org.lastUsedAt,
        );
      },
      findById(id) {
        const row = db.prepare('SELECT * FROM connected_orgs WHERE id = ?').get(id) as Record<string, unknown> | null;
        return row ? rowToOrg(row) : null;
      },
      findByTenant(tenantId) {
        const rows = db.prepare('SELECT * FROM connected_orgs WHERE tenant_id = ? ORDER BY connected_at DESC').all(tenantId) as Record<string, unknown>[];
        return rows.map(rowToOrg);
      },
      update(id, patch) {
        const sets: string[] = [];
        const vals: SQLQueryBindings[] = [];
        if (patch.oauthRefreshTokenEncrypted !== undefined) { sets.push('oauth_refresh_token_enc = ?'); vals.push(patch.oauthRefreshTokenEncrypted); }
        if (patch.oauthAccessTokenCache !== undefined) { sets.push('oauth_access_token_cache = ?'); vals.push(patch.oauthAccessTokenCache ?? null); }
        if (patch.accessTokenExpiresAt !== undefined) { sets.push('access_token_expires_at = ?'); vals.push(patch.accessTokenExpiresAt ?? null); }
        if (patch.lastUsedAt !== undefined) { sets.push('last_used_at = ?'); vals.push(patch.lastUsedAt ?? null); }
        if (patch.gitRemoteUrl !== undefined) { sets.push('git_remote_url = ?'); vals.push(patch.gitRemoteUrl ?? null); }
        if (sets.length === 0) return;
        vals.push(id);
        db.prepare(`UPDATE connected_orgs SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
      },
      delete(id) { db.prepare('DELETE FROM connected_orgs WHERE id = ?').run(id); },
    },

    backupScopes: {
      insert(scope) {
        db.prepare(`
          INSERT INTO backup_scopes
            (id, tenant_id, connected_org_id, name, root_object, max_depth,
             include_files, include_metadata, created_at)
          VALUES (?,?,?,?,?,?,?,?,?)
        `).run(scope.id, scope.tenantId, scope.connectedOrgId, scope.name, scope.rootObject,
          scope.maxDepth, b(scope.includeFiles), b(scope.includeMetadata), scope.createdAt);
      },
      findById(id) {
        const row = db.prepare('SELECT * FROM backup_scopes WHERE id = ?').get(id) as Record<string, unknown> | null;
        return row ? rowToScope(row) : null;
      },
      findByOrg(connectedOrgId) {
        const rows = db.prepare('SELECT * FROM backup_scopes WHERE connected_org_id = ? ORDER BY created_at DESC').all(connectedOrgId) as Record<string, unknown>[];
        return rows.map(rowToScope);
      },
      delete(id) { db.prepare('DELETE FROM backup_scopes WHERE id = ?').run(id); },
    },

    snapshots: {
      insert(snap) {
        db.prepare(`
          INSERT INTO backup_snapshots
            (id, tenant_id, connected_org_id, backup_scope_id, status,
             archive_storage_key, archive_backend_id, git_commit_sha,
             record_count, file_count, metadata_item_count, size_bytes,
             started_at, completed_at, error)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        `).run(snap.id, snap.tenantId, snap.connectedOrgId, snap.backupScopeId, snap.status,
          snap.archiveStorageKey, snap.archiveBackendId, snap.gitCommitSha,
          snap.recordCount, snap.fileCount, snap.metadataItemCount, snap.sizeBytes,
          snap.startedAt, snap.completedAt, snap.error);
      },
      findById(id) {
        const row = db.prepare('SELECT * FROM backup_snapshots WHERE id = ?').get(id) as Record<string, unknown> | null;
        return row ? rowToSnapshot(row) : null;
      },
      findByTenant(tenantId, limit = 50) {
        const rows = db.prepare('SELECT * FROM backup_snapshots WHERE tenant_id = ? ORDER BY started_at DESC LIMIT ?').all(tenantId, limit) as Record<string, unknown>[];
        return rows.map(rowToSnapshot);
      },
      updateStatus(id, status, patch = {}) {
        const sets: string[] = ['status = ?'];
        const vals: SQLQueryBindings[] = [status];
        if (patch.archiveStorageKey !== undefined) { sets.push('archive_storage_key = ?'); vals.push(patch.archiveStorageKey ?? null); }
        if (patch.archiveBackendId !== undefined) { sets.push('archive_backend_id = ?'); vals.push(patch.archiveBackendId ?? null); }
        if (patch.gitCommitSha !== undefined) { sets.push('git_commit_sha = ?'); vals.push(patch.gitCommitSha ?? null); }
        if (patch.recordCount !== undefined) { sets.push('record_count = ?'); vals.push(patch.recordCount ?? null); }
        if (patch.fileCount !== undefined) { sets.push('file_count = ?'); vals.push(patch.fileCount ?? null); }
        if (patch.metadataItemCount !== undefined) { sets.push('metadata_item_count = ?'); vals.push(patch.metadataItemCount ?? null); }
        if (patch.sizeBytes !== undefined) { sets.push('size_bytes = ?'); vals.push(patch.sizeBytes ?? null); }
        if (patch.completedAt !== undefined) { sets.push('completed_at = ?'); vals.push(patch.completedAt ?? null); }
        if (patch.error !== undefined) { sets.push('error = ?'); vals.push(patch.error ?? null); }
        vals.push(id);
        db.prepare(`UPDATE backup_snapshots SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
      },
    },

    diffPlans: {
      insert(plan) {
        db.prepare(`
          INSERT INTO diff_plans
            (id, tenant_id, snapshot_id, target_org_id, storage_key, backend_id,
             target_state_hash, summary_counts, built_at, expires_at)
          VALUES (?,?,?,?,?,?,?,?,?,?)
        `).run(plan.id, plan.tenantId, plan.snapshotId, plan.targetOrgId,
          plan.storageKey, plan.backendId, plan.targetStateHash,
          plan.summaryCounts, plan.builtAt, plan.expiresAt);
      },
      findById(id) {
        const row = db.prepare('SELECT * FROM diff_plans WHERE id = ?').get(id) as Record<string, unknown> | null;
        return row ? rowToDiffPlan(row) : null;
      },
      findBySnapshot(snapshotId, targetOrgId) {
        const rows = db.prepare('SELECT * FROM diff_plans WHERE snapshot_id = ? AND target_org_id = ? ORDER BY built_at DESC').all(snapshotId, targetOrgId) as Record<string, unknown>[];
        return rows.map(rowToDiffPlan);
      },
    },

    restoreJobs: {
      insert(job) {
        db.prepare(`
          INSERT INTO restore_jobs
            (id, tenant_id, snapshot_id, target_org_id, mode, status,
             diff_plan_storage_key, applied_changes_summary, started_at, completed_at, error)
          VALUES (?,?,?,?,?,?,?,?,?,?,?)
        `).run(job.id, job.tenantId, job.snapshotId, job.targetOrgId, job.mode, job.status,
          job.diffPlanStorageKey, job.appliedChangesSummary, job.startedAt, job.completedAt, job.error);
      },
      findById(id) {
        const row = db.prepare('SELECT * FROM restore_jobs WHERE id = ?').get(id) as Record<string, unknown> | null;
        return row ? rowToRestoreJob(row) : null;
      },
      findByTenant(tenantId, limit = 50) {
        const rows = db.prepare('SELECT * FROM restore_jobs WHERE tenant_id = ? ORDER BY started_at DESC LIMIT ?').all(tenantId, limit) as Record<string, unknown>[];
        return rows.map(rowToRestoreJob);
      },
      updateStatus(id, status, patch = {}) {
        const sets: string[] = ['status = ?'];
        const vals: SQLQueryBindings[] = [status];
        if (patch.diffPlanStorageKey !== undefined) { sets.push('diff_plan_storage_key = ?'); vals.push(patch.diffPlanStorageKey ?? null); }
        if (patch.appliedChangesSummary !== undefined) { sets.push('applied_changes_summary = ?'); vals.push(patch.appliedChangesSummary ?? null); }
        if (patch.completedAt !== undefined) { sets.push('completed_at = ?'); vals.push(patch.completedAt ?? null); }
        if (patch.error !== undefined) { sets.push('error = ?'); vals.push(patch.error ?? null); }
        vals.push(id);
        db.prepare(`UPDATE restore_jobs SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
      },
    },
  };
}

function rowToOrg(r: Record<string, unknown>): ConnectedOrg {
  return {
    id: r['id'] as string, tenantId: r['tenant_id'] as string,
    crmType: r['crm_type'] as 'salesforce' | 'hubspot',
    displayName: r['display_name'] as string, instanceUrl: r['instance_url'] as string,
    externalOrgId: r['external_org_id'] as string, isSandbox: bool(r['is_sandbox'] as number),
    oauthRefreshTokenEncrypted: r['oauth_refresh_token_enc'] as string,
    oauthAccessTokenCache: (r['oauth_access_token_cache'] as string | null) ?? null,
    accessTokenExpiresAt: (r['access_token_expires_at'] as number | null) ?? null,
    gitRemoteUrl: (r['git_remote_url'] as string | null) ?? null,
    connectedAt: r['connected_at'] as number,
    lastUsedAt: (r['last_used_at'] as number | null) ?? null,
  };
}

function rowToScope(r: Record<string, unknown>): BackupScope {
  return {
    id: r['id'] as string, tenantId: r['tenant_id'] as string,
    connectedOrgId: r['connected_org_id'] as string, name: r['name'] as string,
    rootObject: r['root_object'] as string, maxDepth: r['max_depth'] as number,
    includeFiles: bool(r['include_files'] as number),
    includeMetadata: bool(r['include_metadata'] as number),
    createdAt: r['created_at'] as number,
  };
}

function rowToSnapshot(r: Record<string, unknown>): Snapshot {
  return {
    id: r['id'] as string, tenantId: r['tenant_id'] as string,
    connectedOrgId: r['connected_org_id'] as string, backupScopeId: r['backup_scope_id'] as string,
    status: r['status'] as SnapshotStatus,
    archiveStorageKey: (r['archive_storage_key'] as string | null) ?? null,
    archiveBackendId: (r['archive_backend_id'] as string | null) ?? null,
    gitCommitSha: (r['git_commit_sha'] as string | null) ?? null,
    recordCount: (r['record_count'] as number | null) ?? null,
    fileCount: (r['file_count'] as number | null) ?? null,
    metadataItemCount: (r['metadata_item_count'] as number | null) ?? null,
    sizeBytes: (r['size_bytes'] as number | null) ?? null,
    startedAt: r['started_at'] as number,
    completedAt: (r['completed_at'] as number | null) ?? null,
    error: (r['error'] as string | null) ?? null,
  };
}

function rowToDiffPlan(r: Record<string, unknown>): DiffPlan {
  return {
    id: r['id'] as string, tenantId: r['tenant_id'] as string,
    snapshotId: r['snapshot_id'] as string, targetOrgId: r['target_org_id'] as string,
    storageKey: r['storage_key'] as string, backendId: r['backend_id'] as string,
    targetStateHash: r['target_state_hash'] as string,
    summaryCounts: r['summary_counts'] as string,
    builtAt: r['built_at'] as number,
    expiresAt: (r['expires_at'] as number | null) ?? null,
  };
}

function rowToRestoreJob(r: Record<string, unknown>): RestoreJob {
  return {
    id: r['id'] as string, tenantId: r['tenant_id'] as string,
    snapshotId: r['snapshot_id'] as string, targetOrgId: r['target_org_id'] as string,
    mode: r['mode'] as 'dry-run' | 'execute', status: r['status'] as RestoreJobStatus,
    diffPlanStorageKey: (r['diff_plan_storage_key'] as string | null) ?? null,
    appliedChangesSummary: (r['applied_changes_summary'] as string | null) ?? null,
    startedAt: r['started_at'] as number,
    completedAt: (r['completed_at'] as number | null) ?? null,
    error: (r['error'] as string | null) ?? null,
  };
}
