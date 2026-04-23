# Vastify CRM Backup — Plan 1: Foundation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create `api/src/backup/` with shared types, SQLite schema tables (added to the existing `api/src/db/schema.sql`), a BackupRepo for CRUD, the CredentialVault, Salesforce and HubSpot CRM adapters, and the SchemaWalker — giving a fully tested schema-discovery engine that can describe any Salesforce/HubSpot object graph.

**Architecture:** New directory `api/src/backup/` bolted onto the existing Vastify API. All types are local to `api/src/backup/types.ts`. The database layer re-uses the existing `getDb()` singleton from `api/src/db/client.ts` (bun:sqlite). The 5 new backup tables are added to the existing idempotent `api/src/db/schema.sql` — they are picked up automatically when the server boots. No new package scaffolding, no workspaces, no migration runner changes needed beyond editing the SQL file.

**Tech Stack:** Bun 1.3+, bun:sqlite (via `bun:sqlite`), bun test, TypeScript ESM (`"type": "module"`, `.js` extensions on imports), native `fetch`, `node:crypto`. No new npm dependencies required in Plan 1.

**Reference code:** `reference/crm-backup-source/` contains draft implementations for most modules — adapt them to Vastify conventions (bun:sqlite API, Hono, bun test) rather than writing from scratch.

---

## File Map

| File | Action | Purpose |
|---|---|---|
| `api/src/backup/types.ts` | Create | All backup entity types (`ConnectedOrg`, `BackupScope`, `Snapshot`, `DiffPlan`, `RestoreJob`) |
| `api/src/backup/errors.ts` | Create | Shared error classes |
| `api/src/backup/crm/types.ts` | Create | `CRMAdapter` interface + descriptor types |
| `api/src/backup/crm/salesforce-adapter.ts` | Create | Salesforce REST read path |
| `api/src/backup/crm/hubspot-adapter.ts` | Create | HubSpot CRM v3 read-only |
| `api/src/backup/credential-vault.ts` | Create | AES-256-GCM vault + OAuth refresh |
| `api/src/backup/schema-walker.ts` | Create | DAG builder + cycle detection |
| `api/src/backup/repo.ts` | Create | BackupRepo CRUD for all 5 backup tables (bun:sqlite) |
| `api/src/db/schema.sql` | Modify | Add 5 backup tables + indexes |
| `api/src/backup/test/repo.test.ts` | Create | Repo unit tests (in-memory SQLite) |
| `api/src/backup/test/credential-vault.test.ts` | Create | Vault unit tests |
| `api/src/backup/test/salesforce-adapter.test.ts` | Create | SF adapter tests with mocked fetch |
| `api/src/backup/test/hubspot-adapter.test.ts` | Create | HS adapter tests with mocked fetch |
| `api/src/backup/test/schema-walker.test.ts` | Create | Walker tests with stub adapter |

---

## Task 1: Backup types

**Files:**
- Create: `api/src/backup/types.ts`

- [ ] **Step 1: Create types.ts**

Create `api/src/backup/types.ts`:

```typescript
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
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd api && bun run typecheck 2>&1 | tail -10
```

Expected: exit 0.

---

## Task 2: Error classes + CRM adapter types

**Files:**
- Create: `api/src/backup/errors.ts`
- Create: `api/src/backup/crm/types.ts`

- [ ] **Step 1: Create errors.ts**

Create `api/src/backup/errors.ts`:

```typescript
export class BackupWriteNotImplementedError extends Error {
  constructor(method: string) {
    super(`${method} is not implemented in Plan 1 — implement in Plan 2`);
    this.name = 'BackupWriteNotImplementedError';
  }
}

export class HubSpotWriteNotSupportedError extends Error {
  constructor() {
    super('HubSpot write operations are not supported');
    this.name = 'HubSpotWriteNotSupportedError';
  }
}

export class CredentialNotFoundError extends Error {
  constructor(connectedOrgId: string) {
    super(`No credentials found for connected org: ${connectedOrgId}`);
    this.name = 'CredentialNotFoundError';
  }
}

export class TokenRefreshError extends Error {
  constructor(crmType: string, status: number, body: string) {
    super(`${crmType} token refresh failed (${status}): ${body}`);
    this.name = 'TokenRefreshError';
  }
}
```

- [ ] **Step 2: Create crm/types.ts**

Create `api/src/backup/crm/types.ts`:

```typescript
export interface ObjectDescriptor {
  name: string;
  label: string;
  labelPlural: string;
}

export interface FieldDescriptor {
  name: string;
  label: string;
  type: string;
  referenceTo: string[];
  relationshipName?: string;
  nillable: boolean;
  externalId: boolean;
}

export interface RelationshipDescriptor {
  name: string;
  type: 'lookup' | 'master-detail' | 'junction';
  childObject: string;
  childField: string;
}

export interface ObjectSchema {
  name: string;
  label: string;
  fields: FieldDescriptor[];
  childRelationships: RelationshipDescriptor[];
}

export type CrmRecord = Record<string, unknown>;

export interface FileRef {
  id: string;
  name: string;
  size: number;
  contentType: string;
}

export interface IdRemap {
  get(sourceId: string): string | undefined;
  set(sourceId: string, targetId: string): void;
}

export interface MetadataItem {
  type: string;
  fullName: string;
  body: Record<string, unknown>;
}

export interface DeployResult {
  success: boolean;
  errors: Array<{ name: string; message: string }>;
}

export interface CRMAdapter {
  listObjects(): Promise<ObjectDescriptor[]>;
  describe(objectName: string): Promise<ObjectSchema>;
  queryRecords(objectName: string, fields: string[], where?: string): AsyncGenerator<CrmRecord>;
  downloadFile(fileRef: FileRef): Promise<Uint8Array>;
  upsertRecord(objectName: string, record: CrmRecord, idRemap: IdRemap): Promise<string>;
  deployMetadata(metadata: MetadataItem[]): Promise<DeployResult>;
  uploadFile(
    file: Uint8Array,
    meta: { name: string; contentType: string },
    linkTo: { objectName: string; recordId: string },
  ): Promise<string>;
}
```

Note: `downloadFile` returns `Uint8Array` instead of `Buffer` — Bun uses `Uint8Array` natively and it's compatible everywhere `Buffer` is expected.

---

## Task 3: SQLite backup tables

**Files:**
- Modify: `api/src/db/schema.sql`

- [ ] **Step 1: Append backup tables to schema.sql**

Open `api/src/db/schema.sql` and append the following block at the end of the file (after the existing `savings_snapshots` table and its indexes):

```sql
-- ============================================================
-- Backup subsystem tables (added Plan 1)
-- ============================================================

CREATE TABLE IF NOT EXISTS connected_orgs (
  id                        TEXT PRIMARY KEY,
  tenant_id                 TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  crm_type                  TEXT NOT NULL CHECK (crm_type IN ('salesforce','hubspot')),
  display_name              TEXT NOT NULL,
  instance_url              TEXT NOT NULL,
  external_org_id           TEXT NOT NULL,
  is_sandbox                INTEGER NOT NULL DEFAULT 0,
  oauth_refresh_token_enc   TEXT NOT NULL,
  oauth_access_token_cache  TEXT,
  access_token_expires_at   INTEGER,
  git_remote_url            TEXT,
  connected_at              INTEGER NOT NULL,
  last_used_at              INTEGER,
  UNIQUE(tenant_id, external_org_id)
);

CREATE TABLE IF NOT EXISTS backup_scopes (
  id                TEXT PRIMARY KEY,
  tenant_id         TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  connected_org_id  TEXT NOT NULL REFERENCES connected_orgs(id) ON DELETE CASCADE,
  name              TEXT NOT NULL,
  root_object       TEXT NOT NULL,
  max_depth         INTEGER NOT NULL DEFAULT 3,
  include_files     INTEGER NOT NULL DEFAULT 1,
  include_metadata  INTEGER NOT NULL DEFAULT 1,
  created_at        INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS backup_snapshots (
  id                      TEXT PRIMARY KEY,
  tenant_id               TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  connected_org_id        TEXT NOT NULL REFERENCES connected_orgs(id),
  backup_scope_id         TEXT NOT NULL REFERENCES backup_scopes(id),
  status                  TEXT NOT NULL CHECK (status IN ('pending','running','complete','failed')),
  archive_storage_key     TEXT,
  archive_backend_id      TEXT,
  git_commit_sha          TEXT,
  record_count            INTEGER,
  file_count              INTEGER,
  metadata_item_count     INTEGER,
  size_bytes              INTEGER,
  started_at              INTEGER NOT NULL,
  completed_at            INTEGER,
  error                   TEXT
);

CREATE TABLE IF NOT EXISTS diff_plans (
  id                TEXT PRIMARY KEY,
  tenant_id         TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  snapshot_id       TEXT NOT NULL REFERENCES backup_snapshots(id),
  target_org_id     TEXT NOT NULL REFERENCES connected_orgs(id),
  storage_key       TEXT NOT NULL,
  backend_id        TEXT NOT NULL,
  target_state_hash TEXT NOT NULL,
  summary_counts    TEXT NOT NULL,
  built_at          INTEGER NOT NULL,
  expires_at        INTEGER
);

CREATE TABLE IF NOT EXISTS restore_jobs (
  id                        TEXT PRIMARY KEY,
  tenant_id                 TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  snapshot_id               TEXT NOT NULL REFERENCES backup_snapshots(id),
  target_org_id             TEXT NOT NULL REFERENCES connected_orgs(id),
  mode                      TEXT NOT NULL CHECK (mode IN ('dry-run','execute')),
  status                    TEXT NOT NULL CHECK (status IN ('pending','running','complete','partial','failed')),
  diff_plan_storage_key     TEXT,
  applied_changes_summary   TEXT,
  started_at                INTEGER NOT NULL,
  completed_at              INTEGER,
  error                     TEXT
);

CREATE INDEX IF NOT EXISTS idx_connected_orgs_tenant   ON connected_orgs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_backup_scopes_org       ON backup_scopes(connected_org_id);
CREATE INDEX IF NOT EXISTS idx_backup_snapshots_tenant ON backup_snapshots(tenant_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_backup_snapshots_org    ON backup_snapshots(connected_org_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_diff_plans_lookup       ON diff_plans(snapshot_id, target_org_id, built_at DESC);
CREATE INDEX IF NOT EXISTS idx_restore_jobs_tenant     ON restore_jobs(tenant_id, started_at DESC);
```

- [ ] **Step 2: Verify schema loads**

```bash
cd api && bun -e "import { getDb } from './src/db/client.ts'; getDb(); console.log('schema OK')"
```

Expected: `schema OK` with no errors.

---

## Task 4: BackupRepo

**Files:**
- Create: `api/src/backup/repo.ts`
- Create: `api/src/backup/test/repo.test.ts`

bun:sqlite API differences from better-sqlite3:
- Import: `import { Database } from 'bun:sqlite'` 
- `db.prepare(sql)` returns a `Statement` — same `.get()`, `.all()`, `.run()` methods
- Named params use `$name` prefix: `stmt.get({ $id: 'foo' })`
- Row type: cast with `as Record<string, unknown>`
- `stmt.run()` returns `{ changes: number, lastInsertRowid: bigint }`

- [ ] **Step 1: Write the failing test**

Create `api/src/backup/test/repo.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { createBackupRepo } from '../repo.js';
import type { ConnectedOrg, BackupScope, Snapshot } from '../types.js';

function makeDb(): Database {
  const db = new Database(':memory:');
  // Apply the schema SQL — read from file or inline the backup tables
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
```

- [ ] **Step 2: Run tests to confirm failure**

```bash
cd api && bun test src/backup/test/repo.test.ts 2>&1 | tail -5
```

Expected: FAIL — `Cannot find module '../repo.js'`

- [ ] **Step 3: Implement BackupRepo**

Create `api/src/backup/repo.ts`:

```typescript
import type { Database } from 'bun:sqlite';
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
        const vals: unknown[] = [];
        if (patch.oauthRefreshTokenEncrypted !== undefined) { sets.push('oauth_refresh_token_enc = ?'); vals.push(patch.oauthRefreshTokenEncrypted); }
        if (patch.oauthAccessTokenCache !== undefined) { sets.push('oauth_access_token_cache = ?'); vals.push(patch.oauthAccessTokenCache); }
        if (patch.accessTokenExpiresAt !== undefined) { sets.push('access_token_expires_at = ?'); vals.push(patch.accessTokenExpiresAt); }
        if (patch.lastUsedAt !== undefined) { sets.push('last_used_at = ?'); vals.push(patch.lastUsedAt); }
        if (patch.gitRemoteUrl !== undefined) { sets.push('git_remote_url = ?'); vals.push(patch.gitRemoteUrl); }
        if (sets.length === 0) return;
        db.prepare(`UPDATE connected_orgs SET ${sets.join(', ')} WHERE id = ?`).run(...vals, id);
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
        const vals: unknown[] = [status];
        if (patch.archiveStorageKey !== undefined) { sets.push('archive_storage_key = ?'); vals.push(patch.archiveStorageKey); }
        if (patch.archiveBackendId !== undefined) { sets.push('archive_backend_id = ?'); vals.push(patch.archiveBackendId); }
        if (patch.gitCommitSha !== undefined) { sets.push('git_commit_sha = ?'); vals.push(patch.gitCommitSha); }
        if (patch.recordCount !== undefined) { sets.push('record_count = ?'); vals.push(patch.recordCount); }
        if (patch.fileCount !== undefined) { sets.push('file_count = ?'); vals.push(patch.fileCount); }
        if (patch.metadataItemCount !== undefined) { sets.push('metadata_item_count = ?'); vals.push(patch.metadataItemCount); }
        if (patch.sizeBytes !== undefined) { sets.push('size_bytes = ?'); vals.push(patch.sizeBytes); }
        if (patch.completedAt !== undefined) { sets.push('completed_at = ?'); vals.push(patch.completedAt); }
        if (patch.error !== undefined) { sets.push('error = ?'); vals.push(patch.error); }
        db.prepare(`UPDATE backup_snapshots SET ${sets.join(', ')} WHERE id = ?`).run(...vals, id);
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
        const vals: unknown[] = [status];
        if (patch.diffPlanStorageKey !== undefined) { sets.push('diff_plan_storage_key = ?'); vals.push(patch.diffPlanStorageKey); }
        if (patch.appliedChangesSummary !== undefined) { sets.push('applied_changes_summary = ?'); vals.push(patch.appliedChangesSummary); }
        if (patch.completedAt !== undefined) { sets.push('completed_at = ?'); vals.push(patch.completedAt); }
        if (patch.error !== undefined) { sets.push('error = ?'); vals.push(patch.error); }
        db.prepare(`UPDATE restore_jobs SET ${sets.join(', ')} WHERE id = ?`).run(...vals, id);
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
```

- [ ] **Step 4: Run repo tests**

```bash
cd api && bun test src/backup/test/repo.test.ts
```

Expected: All BackupRepo tests PASS.

---

## Task 5: CredentialVault

**Files:**
- Create: `api/src/backup/credential-vault.ts`
- Create: `api/src/backup/test/credential-vault.test.ts`

The CredentialVault code from the original plan is fully compatible with Bun — it uses `node:crypto` which Bun supports natively. The only adaptation needed is imports and test framework.

- [ ] **Step 1: Create credential-vault.ts**

Adapt `reference/crm-backup-source/` (or copy from the original Plan 1) — all the crypto code is identical. The only change:
- Import `BackupRepo` type from `./repo.js` instead of `@infinity-docs/persistence`
- Import `ConnectedOrg` from `./types.js` instead of `@infinity-docs/shared`

Key import lines:

```typescript
import { createCipheriv, createDecipheriv, randomBytes, hkdfSync } from 'node:crypto';
import type { BackupRepo } from './repo.js';
import type { ConnectedOrg } from './types.js';
import { CredentialNotFoundError, TokenRefreshError } from './errors.js';
```

The rest of the implementation is identical to the original Plan 1 CredentialVault (AES-256-GCM, HKDF per-tenant key derivation, OAuth refresh for SF and HubSpot).

- [ ] **Step 2: Create credential-vault.test.ts**

Create `api/src/backup/test/credential-vault.test.ts` — adapted from Plan 1 original:
- Replace `import { describe, it, expect, vi, beforeEach } from 'vitest'` → `import { describe, it, expect, mock, beforeEach, spyOn, afterEach } from 'bun:test'`
- Replace `vi.fn()` → `mock()`
- Replace `vi.stubGlobal('fetch', vi.fn().mockResolvedValue(...))` → `spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({...}), {status:200}))`
- Replace `vi.unstubAllGlobals()` → restore the spy in `afterEach`
- Replace `BackupRepo` import from `@infinity-docs/persistence` → `../repo.js`

The test structure (vault round-trips, different IV per encryption, tenant key isolation, cached token return, expired token refresh) is identical.

- [ ] **Step 3: Run tests**

```bash
cd api && bun test src/backup/test/credential-vault.test.ts
```

Expected: All credential-vault tests PASS.

---

## Task 6: SalesforceAdapter

**Files:**
- Create: `api/src/backup/crm/salesforce-adapter.ts`
- Create: `api/src/backup/test/salesforce-adapter.test.ts`

The SalesforceAdapter code from the original Plan 1 is fully compatible. Changes:
- Import from local paths instead of `@infinity-docs/*` packages
- `downloadFile` returns `Uint8Array` instead of `Buffer` — change `Buffer.from(await resp.arrayBuffer())` to `new Uint8Array(await resp.arrayBuffer())`
- Throw `BackupWriteNotImplementedError` for write paths (identical)

Tests: same structure, replace vitest with bun:test as described in Task 5.

- [ ] **Step 1: Create salesforce-adapter.ts**

```typescript
import type {
  CRMAdapter, ObjectDescriptor, ObjectSchema, CrmRecord,
  FileRef, IdRemap, MetadataItem, DeployResult,
} from './types.js';
import { BackupWriteNotImplementedError } from '../errors.js';
```

Full implementation from Plan 1 original — only the `downloadFile` return type changes from `Buffer` to `Uint8Array`:
```typescript
async downloadFile(fileRef: FileRef): Promise<Uint8Array> {
  // ...
  return new Uint8Array(await resp.arrayBuffer());
}
```

- [ ] **Step 2: Create salesforce-adapter.test.ts**

Adapt Plan 1 original tests with bun:test syntax. Mocked `arrayBuffer()` must return an `ArrayBuffer`:
```typescript
arrayBuffer: async () => Buffer.from('PDF content here').buffer
```

- [ ] **Step 3: Run tests**

```bash
cd api && bun test src/backup/test/salesforce-adapter.test.ts
```

Expected: All Salesforce adapter tests PASS.

---

## Task 7: HubSpotAdapter

**Files:**
- Create: `api/src/backup/crm/hubspot-adapter.ts`
- Create: `api/src/backup/test/hubspot-adapter.test.ts`

Same adaptation pattern as Task 6 — copy from Plan 1 original, update imports, replace `Buffer` with `Uint8Array` in the `downloadFile` signature.

- [ ] **Step 1: Create hubspot-adapter.ts**

```typescript
import type { CRMAdapter, ObjectDescriptor, ObjectSchema, CrmRecord, FileRef, IdRemap, MetadataItem, DeployResult } from './types.js';
import { HubSpotWriteNotSupportedError } from '../errors.js';
```

Full implementation from Plan 1 original (standard objects list, properties endpoint, search endpoint with cursor pagination, write methods throw `HubSpotWriteNotSupportedError`).

- [ ] **Step 2: Create hubspot-adapter.test.ts**

Adapt Plan 1 original tests with bun:test syntax.

- [ ] **Step 3: Run tests**

```bash
cd api && bun test src/backup/test/hubspot-adapter.test.ts
```

Expected: All HubSpot adapter tests PASS.

---

## Task 8: SchemaWalker

**Files:**
- Create: `api/src/backup/schema-walker.ts`
- Create: `api/src/backup/test/schema-walker.test.ts`

SchemaWalker is pure TypeScript with no external deps. The implementation from Plan 1 original is 100% compatible with Bun — copy it directly.

Changes:
- Import `CRMAdapter` from `./crm/types.js` (local, not `@infinity-docs/backup`)
- Tests: replace vitest with bun:test

- [ ] **Step 1: Copy schema-walker.ts**

Copy `walkSchema`, `SchemaNode`, `SchemaEdge`, `SchemaGraph` from Plan 1 original, updating the import path.

- [ ] **Step 2: Create schema-walker.test.ts**

Adapt Plan 1 original tests (FLAT_SCHEMA, DEEP_SCHEMA, CYCLIC_SCHEMA test cases) using bun:test. No mock framework changes needed since these tests use stub adapters (plain objects), not `vi.fn()`.

- [ ] **Step 3: Run tests**

```bash
cd api && bun test src/backup/test/schema-walker.test.ts
```

Expected: All schema-walker tests PASS.

---

## Task 9: Full test suite + typecheck

- [ ] **Step 1: Run all backup tests**

```bash
cd api && bun test src/backup/
```

Expected: All tests in `src/backup/test/` pass (repo, credential-vault, salesforce-adapter, hubspot-adapter, schema-walker).

- [ ] **Step 2: Typecheck**

```bash
cd api && bun run typecheck
```

Expected: exit 0, no errors.

- [ ] **Step 3: Commit**

```bash
git add api/src/backup api/src/db/schema.sql
git commit -m "feat(backup): Plan 1 complete — types, SQLite tables, BackupRepo, CredentialVault, CRM adapters, SchemaWalker"
```

---

## What's next

**Plan 2 covers:**
- `SnapshotCapture` — schema walk → record fetch → metadata fetch → file download → zip archive uploaded to existing ObjectBackend
- `GitSync` — per-tenant git repo with per-org branches, one commit per snapshot
- `BackupEngine` — orchestrates vault → walk → capture → git → status updates
- Hono routes for connected orgs, scopes, snapshots (mounted at `/v1/backup/`)
- Config additions (`BACKUP_GIT_DATA_DIR`, `BACKUP_SNAPSHOTS_DIR`, vault key env vars)

**Plan 3 covers:**
- `DiffEngine` — reads snapshot archive from ObjectBackend, queries target CRM, classifies insert/update/skip-delete
- `DiffPlanStore` — persists diff documents to ObjectBackend
- `RestoreExecutor` — drift check + topological apply with IdRemap
- Additional Hono routes for diff and restore operations
