import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrations.js';
import { initializeTasks } from '../../src/services/taskRunner.js';

describe('home backend migration', () => {
  it('creates durable tables on a fresh database and preserves legacy data on repeated startup', () => {
    const db = new Database(':memory:');
    try {
      runMigrations(db);
      for (const name of ['ai_tasks', 'ai_task_events', 'ai_proposal_effects', 'sync_v2_records', 'sync_v2_operations']) {
        expect(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name)).toEqual({ name });
      }
      db.prepare('INSERT INTO settings(key,value) VALUES(?,?)').run('github_token', 'encrypted-value');
      db.prepare('INSERT INTO repositories(id,name,full_name,html_url,owner_login,custom_description) VALUES(?,?,?,?,?,?)').run(1, 'repo', 'owner/repo', 'https://github.com/owner/repo', 'owner', 'Keep my edit');
      runMigrations(db);
      initializeTasks(db);
      expect(db.prepare('SELECT custom_description FROM repositories WHERE id=1').get()).toEqual({ custom_description: 'Keep my edit' });
      expect(db.prepare("SELECT value FROM settings WHERE key='github_token'").get()).toEqual({ value: 'encrypted-value' });
      expect(db.prepare('SELECT MAX(version) AS version FROM schema_version').get()).toEqual({ version: 4 });
    } finally { db.close(); }
  });
});
