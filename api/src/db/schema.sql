-- Vastify metadata DB schema
-- Applied idempotently on boot. Source of truth for filterable-field indexes.
-- Everything in here can be rebuilt from the object backends (see reconciler).

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS tenants (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  api_key_hash  TEXT NOT NULL UNIQUE,
  created_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS files (
  id                     TEXT PRIMARY KEY,
  tenant_id              TEXT NOT NULL,
  sf_content_version_id  TEXT,
  original_name          TEXT,
  backend_id             TEXT NOT NULL,
  storage_class          TEXT NOT NULL,
  object_key             TEXT NOT NULL,
  size_bytes             INTEGER NOT NULL,
  mime_type              TEXT,
  created_at             INTEGER NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_files_tenant_time ON files(tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS records_index (
  tenant_id      TEXT NOT NULL,
  entity         TEXT NOT NULL,             -- 'Interaction' or 'ArchivedInteraction'
  pk             TEXT NOT NULL,
  backend_id     TEXT NOT NULL,
  storage_class  TEXT NOT NULL,
  object_key     TEXT NOT NULL,
  -- Denormalised filterable fields for Interaction / ArchivedInteraction:
  timestamp      INTEGER,
  channel        TEXT,
  type           TEXT,
  account_id     TEXT,
  contact_id     TEXT,
  subject        TEXT,
  is_archived    INTEGER NOT NULL DEFAULT 0,
  created_at     INTEGER NOT NULL,
  PRIMARY KEY (tenant_id, entity, pk),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_records_ts        ON records_index(tenant_id, entity, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_records_account   ON records_index(tenant_id, entity, account_id);
CREATE INDEX IF NOT EXISTS idx_records_contact   ON records_index(tenant_id, entity, contact_id);
CREATE INDEX IF NOT EXISTS idx_records_archived  ON records_index(tenant_id, is_archived, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_records_channel   ON records_index(tenant_id, entity, channel);

CREATE TABLE IF NOT EXISTS rules (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL,
  priority    INTEGER NOT NULL,
  match_json  TEXT NOT NULL,
  target_json TEXT NOT NULL,
  enabled     INTEGER NOT NULL DEFAULT 1,
  created_at  INTEGER NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_rules_tenant_priority ON rules(tenant_id, priority);

CREATE TABLE IF NOT EXISTS events (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id     TEXT NOT NULL,
  kind          TEXT NOT NULL,            -- 'file.uploaded', 'record.created', 'record.archived', etc.
  payload_json  TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_events_tenant_time ON events(tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS savings_snapshots (
  id                           INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id                    TEXT NOT NULL,
  at                           INTEGER NOT NULL,
  sf_data_bytes_avoided        INTEGER NOT NULL,
  sf_file_bytes_avoided        INTEGER NOT NULL,
  backend_bytes_by_class_json  TEXT NOT NULL,
  usd_saved_monthly_estimate   REAL NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_snapshots_tenant_time ON savings_snapshots(tenant_id, at DESC);

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
