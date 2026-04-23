import type Database from 'better-sqlite3';
import { MIGRATION_001_INIT } from './schema/001_init.sql.js';
import { MIGRATION_002_RATE_LIMIT } from './schema/002_rate_limit.sql.js';
import { MIGRATION_003_CALLBACK_DLQ } from './schema/003_callback_dlq.sql.js';
import { MIGRATION_004_BACKUP } from './schema/004_backup.sql.js';

interface Migration {
  version: number;
  sql: string;
}

const MIGRATIONS: Migration[] = [
  { version: 1, sql: MIGRATION_001_INIT },
  { version: 2, sql: MIGRATION_002_RATE_LIMIT },
  { version: 3, sql: MIGRATION_003_CALLBACK_DLQ },
  { version: 4, sql: MIGRATION_004_BACKUP },
];

/**
 * Apply pending migrations in version order. Enables WAL + foreign_keys.
 * Safe to call on every startup — each version runs at most once.
 */
export function runMigrations(db: Database.Database): void {
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('synchronous = NORMAL');

  db.exec(`CREATE TABLE IF NOT EXISTS schema_version (
    version    INTEGER PRIMARY KEY,
    applied_at TEXT    NOT NULL
  )`);

  const currentRow = db
    .prepare('SELECT COALESCE(MAX(version), 0) AS v FROM schema_version')
    .get() as { v: number } | undefined;
  const current = currentRow?.v ?? 0;

  const insert = db.prepare(
    'INSERT INTO schema_version (version, applied_at) VALUES (?, ?)',
  );

  for (const migration of MIGRATIONS) {
    if (migration.version <= current) continue;
    const tx = db.transaction(() => {
      db.exec(migration.sql);
      insert.run(migration.version, new Date().toISOString());
    });
    tx();
  }
}
