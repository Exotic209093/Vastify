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
}
