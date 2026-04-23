import { describe, it, expect, beforeEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { createBackupRepo } from '../repo.js';
import type { ConnectedOrg, BackupScope, Snapshot } from '../types.js';

function makeDb(): Database {
  const db = new Database(':memory:');
  db.run(`PRAGMA foreign_keys = ON`);
  db.run(`
    CREATE TABLE IF NOT EXISTS tenants (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, api_key_hash TEXT UNIQUE, created_at INTEGER
    )
  `);
  db.run(`INSERT INTO tenants VALUES ('tenant-a', 'Test', 'hash', 1000)`);
  db.run(`
    CREATE TABLE IF NOT EXISTS connected_orgs (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      crm_type TEXT NOT NULL CHECK (crm_type IN ('salesforce','hubspot')),
      display_name TEXT NOT NULL, instance_url TEXT NOT NULL, external_org_id TEXT NOT NULL,
      is_sandbox INTEGER NOT NULL DEFAULT 0, oauth_refresh_token_enc TEXT NOT NULL,
      oauth_access_token_cache TEXT, access_token_expires_at INTEGER, git_remote_url TEXT,
      connected_at INTEGER NOT NULL, last_used_at INTEGER,
      UNIQUE(tenant_id, external_org_id)
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS backup_scopes (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      connected_org_id TEXT NOT NULL REFERENCES connected_orgs(id) ON DELETE CASCADE,
      name TEXT NOT NULL, root_object TEXT NOT NULL,
      max_depth INTEGER NOT NULL DEFAULT 3,
      include_files INTEGER NOT NULL DEFAULT 1, include_metadata INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS backup_snapshots (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      connected_org_id TEXT NOT NULL REFERENCES connected_orgs(id),
      backup_scope_id TEXT NOT NULL REFERENCES backup_scopes(id),
      status TEXT NOT NULL CHECK (status IN ('pending','running','complete','failed')),
      archive_storage_key TEXT, archive_backend_id TEXT, git_commit_sha TEXT,
      record_count INTEGER, file_count INTEGER, metadata_item_count INTEGER, size_bytes INTEGER,
      started_at INTEGER NOT NULL, completed_at INTEGER, error TEXT
    )
  `);
  return db;
}

function makeOrg(overrides?: Partial<ConnectedOrg>): ConnectedOrg {
  return {
    id: 'org-1', tenantId: 'tenant-a', crmType: 'salesforce',
    displayName: 'Acme Prod', instanceUrl: 'https://acme.my.salesforce.com',
    externalOrgId: '00Dxx000001TEST', isSandbox: false,
    oauthRefreshTokenEncrypted: 'enc:refresh:token',
    oauthAccessTokenCache: null, accessTokenExpiresAt: null, gitRemoteUrl: null,
    connectedAt: 1000000, lastUsedAt: null, ...overrides,
  };
}

function makeScope(overrides?: Partial<BackupScope>): BackupScope {
  return {
    id: 'scope-1', tenantId: 'tenant-a', connectedOrgId: 'org-1',
    name: 'Accounts', rootObject: 'Account', maxDepth: 3,
    includeFiles: true, includeMetadata: true, createdAt: 1000001, ...overrides,
  };
}

describe('BackupRepo — connectedOrgs', () => {
  let repo: ReturnType<typeof createBackupRepo>;

  beforeEach(() => { repo = createBackupRepo(makeDb()); });

  it('inserts and retrieves a ConnectedOrg by id', () => {
    repo.connectedOrgs.insert(makeOrg());
    const result = repo.connectedOrgs.findById('org-1');
    expect(result).toMatchObject({ id: 'org-1', displayName: 'Acme Prod', isSandbox: false });
  });

  it('finds all orgs for a tenant', () => {
    repo.connectedOrgs.insert(makeOrg({ id: 'org-1' }));
    repo.connectedOrgs.insert(makeOrg({ id: 'org-2', externalOrgId: '00Dxx000002TEST' }));
    expect(repo.connectedOrgs.findByTenant('tenant-a')).toHaveLength(2);
  });

  it('updates access token cache', () => {
    repo.connectedOrgs.insert(makeOrg());
    repo.connectedOrgs.update('org-1', { oauthAccessTokenCache: 'new-token', accessTokenExpiresAt: 9999999 });
    const updated = repo.connectedOrgs.findById('org-1');
    expect(updated?.oauthAccessTokenCache).toBe('new-token');
    expect(updated?.accessTokenExpiresAt).toBe(9999999);
  });

  it('deletes an org', () => {
    repo.connectedOrgs.insert(makeOrg());
    repo.connectedOrgs.delete('org-1');
    expect(repo.connectedOrgs.findById('org-1')).toBeNull();
  });
});

describe('BackupRepo — backupScopes', () => {
  let repo: ReturnType<typeof createBackupRepo>;

  beforeEach(() => {
    const db = makeDb();
    repo = createBackupRepo(db);
    repo.connectedOrgs.insert(makeOrg());
  });

  it('inserts and retrieves a BackupScope by id', () => {
    repo.backupScopes.insert(makeScope());
    expect(repo.backupScopes.findById('scope-1')).toMatchObject({ rootObject: 'Account', maxDepth: 3 });
  });

  it('finds all scopes for a connected org', () => {
    repo.backupScopes.insert(makeScope({ id: 'scope-1' }));
    repo.backupScopes.insert(makeScope({ id: 'scope-2', name: 'Contacts' }));
    expect(repo.backupScopes.findByOrg('org-1')).toHaveLength(2);
  });
});

describe('BackupRepo — snapshots', () => {
  let repo: ReturnType<typeof createBackupRepo>;

  beforeEach(() => {
    const db = makeDb();
    repo = createBackupRepo(db);
    repo.connectedOrgs.insert(makeOrg());
    repo.backupScopes.insert(makeScope());
  });

  it('inserts a snapshot and finds it by tenant', () => {
    const snap: Snapshot = {
      id: 'snap-1', tenantId: 'tenant-a', connectedOrgId: 'org-1', backupScopeId: 'scope-1',
      status: 'pending', archiveStorageKey: null, archiveBackendId: null, gitCommitSha: null,
      recordCount: null, fileCount: null, metadataItemCount: null, sizeBytes: null,
      startedAt: 2000000, completedAt: null, error: null,
    };
    repo.snapshots.insert(snap);
    const results = repo.snapshots.findByTenant('tenant-a');
    expect(results).toHaveLength(1);
    expect(results[0]?.status).toBe('pending');
  });

  it('updates snapshot status to complete with counts', () => {
    const snap: Snapshot = {
      id: 'snap-1', tenantId: 'tenant-a', connectedOrgId: 'org-1', backupScopeId: 'scope-1',
      status: 'pending', archiveStorageKey: null, archiveBackendId: null, gitCommitSha: null,
      recordCount: null, fileCount: null, metadataItemCount: null, sizeBytes: null,
      startedAt: 2000000, completedAt: null, error: null,
    };
    repo.snapshots.insert(snap);
    repo.snapshots.updateStatus('snap-1', 'complete', {
      archiveStorageKey: 'tenants/tenant-a/snapshots/snap-1.zip',
      archiveBackendId: 'gcs',
      recordCount: 100, fileCount: 5, metadataItemCount: 20, sizeBytes: 204800, completedAt: 2001000,
    });
    const updated = repo.snapshots.findById('snap-1');
    expect(updated?.status).toBe('complete');
    expect(updated?.recordCount).toBe(100);
  });
});
