import type Database from 'better-sqlite3';
import { CURRENT_SCHEMA_VERSION, runMigrations } from './migrations.js';
import { backupBeforeMigration } from '../services/backups.js';

/** Startup must retain a verified pre-image before touching an existing schema. */
export async function runStartupMigrations(db: Database.Database, backupDirectory: string): Promise<void> {
  const existing = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_version'").get();
  if (existing) {
    const { version } = db.prepare('SELECT MAX(version) AS version FROM schema_version').get() as { version: number | null };
    if ((version ?? 0) < CURRENT_SCHEMA_VERSION) await backupBeforeMigration(db, backupDirectory);
  }
  runMigrations(db);
}
