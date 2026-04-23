import { Database } from 'bun:sqlite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { log } from '../util/logger.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = resolve(__dirname, './schema.sql');

let db: Database | null = null;

export function getDb(): Database {
  if (db) return db;
  const path = process.env.DB_PATH ?? './vastify.db';
  db = new Database(path, { create: true });
  db.exec('PRAGMA foreign_keys = ON;');
  runMigrations(db);
  log.info('db ready', { path });
  return db;
}

function runMigrations(conn: Database): void {
  const schema = readFileSync(SCHEMA_PATH, 'utf-8');
  conn.exec(schema);
  runAlterMigrations(conn);
}

function runAlterMigrations(conn: Database): void {
  const alters = [
    'ALTER TABLE tenants ADD COLUMN sf_org_id TEXT',
    'ALTER TABLE tenants ADD COLUMN display_name TEXT',
    'ALTER TABLE tenants ADD COLUMN provisioned_at INTEGER',
  ];
  for (const sql of alters) {
    try {
      conn.exec(sql);
    } catch (err: unknown) {
      if (!(err instanceof Error && err.message.includes('duplicate column name'))) {
        throw err;
      }
    }
  }
  conn.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_tenants_sf_org_id ON tenants(sf_org_id)');
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}

/** Test-only: swap in an in-memory DB. */
export function setTestDb(instance: Database): void {
  db = instance;
  instance.exec(readFileSync(SCHEMA_PATH, 'utf-8'));
  runAlterMigrations(instance);
}
