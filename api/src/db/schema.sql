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
