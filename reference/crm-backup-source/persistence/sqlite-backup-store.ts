import Database from 'better-sqlite3';
import { runMigrations } from './migrations.js';
import { createBackupRepo, type BackupRepo } from './backup-repo.js';

export interface SqliteBackupStoreOptions {
  dbPath: string;
}

export interface SqliteBackupStoreHandle {
  repo: BackupRepo;
}

export function createSqliteBackupStore(opts: SqliteBackupStoreOptions): SqliteBackupStoreHandle {
  const db = new Database(opts.dbPath);
  runMigrations(db);
  return { repo: createBackupRepo(db) };
}
