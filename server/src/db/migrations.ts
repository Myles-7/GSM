import type Database from 'better-sqlite3';
import { initializeSchema } from './schema.js';
import { logger } from '../services/logger.js';
import { initializeSyncV2 } from '../services/syncV2.js';
import { initializeTasks } from '../services/taskRunner.js';
import { initializeIdentityMigration } from '../services/repositoryIdentity.js';

const migrations: Record<number, (db: Database.Database) => void> = {
  1: (db) => {
    initializeSchema(db);
  },
  2: (db) => {
    initializeSchema(db);
  },
  3: (db) => {
    initializeSyncV2(db);
    initializeTasks(db);
  },
  4: initializeIdentityMigration,
  // v4 databases can already have schema_version=4 while missing columns that
  // were added later through initializeSchema(). Keep this additive migration
  // explicit so existing databases do not silently skip those columns.
  5: (db) => {
    initializeSchema(db);
  },
  6: (db) => {
    initializeSyncV2(db);
    initializeTasks(db);
  },
};
export const CURRENT_SCHEMA_VERSION = Math.max(...Object.keys(migrations).map(Number));

export function runMigrations(db: Database.Database): void {
  // Ensure schema_version table exists first
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const currentVersionRow = db
    .prepare('SELECT MAX(version) as version FROM schema_version')
    .get() as { version: number | null } | undefined;

  const currentVersion = currentVersionRow?.version ?? 0;
  const targetVersion = CURRENT_SCHEMA_VERSION;

  if (currentVersion >= targetVersion) {
    return;
  }

  const applyMigration = db.transaction(() => {
    for (let v = currentVersion + 1; v <= targetVersion; v++) {
      const migration = migrations[v];
      if (migration) {
        logger.info('db.migration', `Applying migration v${v}...`);
        migration(db);
        db.prepare('INSERT OR REPLACE INTO schema_version (version) VALUES (?)').run(v);
        logger.info('db.migration', `Migration v${v} applied.`);
      }
    }
  });

  applyMigration();
}
