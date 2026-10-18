import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrations.js';
import { runStartupMigrations } from '../../src/db/startupMigrations.js';
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
      expect(db.prepare('SELECT MAX(version) AS version FROM schema_version').get()).toEqual({ version: 6 });
    } finally { db.close(); }
  });

  it('backs up a real old v4 before startup migration and remains idempotent', async () => {
    const db = new Database(':memory:');
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gsm-v4-startup-'));
    try {
      db.exec(`
        CREATE TABLE schema_version(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime('now')));
        INSERT INTO schema_version(version) VALUES (1),(2),(3),(4);
        CREATE TABLE repositories (
          id INTEGER PRIMARY KEY, name TEXT NOT NULL, full_name TEXT NOT NULL UNIQUE,
          description TEXT, html_url TEXT NOT NULL, stargazers_count INTEGER DEFAULT 0,
          language TEXT, created_at TEXT, updated_at TEXT, pushed_at TEXT, starred_at TEXT,
          owner_login TEXT NOT NULL, owner_avatar_url TEXT, topics TEXT, ai_summary TEXT,
          ai_tags TEXT, ai_platforms TEXT, analyzed_at TEXT, analysis_failed INTEGER DEFAULT 0,
          custom_description TEXT, custom_tags TEXT, custom_category TEXT, category_locked INTEGER DEFAULT 0,
          last_edited TEXT, subscribed_to_releases INTEGER DEFAULT 0
        );
        CREATE TABLE settings(key TEXT PRIMARY KEY, value TEXT);
        CREATE TABLE sync_v2_workspace(id TEXT PRIMARY KEY, github_user_id INTEGER NOT NULL, initialized_at TEXT NOT NULL, floor_seq INTEGER NOT NULL DEFAULT 0);
        CREATE TABLE sync_v2_records(collection TEXT NOT NULL,id TEXT NOT NULL,data TEXT,version INTEGER NOT NULL,seq INTEGER NOT NULL,deleted INTEGER NOT NULL,PRIMARY KEY(collection,id));
        CREATE TABLE sync_v2_changes(seq INTEGER PRIMARY KEY AUTOINCREMENT,record TEXT NOT NULL,created_at INTEGER NOT NULL);
        CREATE TABLE sync_v2_operations(client_id TEXT NOT NULL,op_id TEXT NOT NULL,digest TEXT NOT NULL,result TEXT NOT NULL,PRIMARY KEY(client_id,op_id));
        CREATE TABLE sync_v2_conflicts(id TEXT PRIMARY KEY,collection TEXT NOT NULL,record_id TEXT NOT NULL,incoming TEXT NOT NULL,current_record TEXT,created_at INTEGER NOT NULL);
        CREATE TABLE sync_v2_previews(id TEXT PRIMARY KEY,digest TEXT NOT NULL,github_user_id INTEGER NOT NULL,expires_at INTEGER NOT NULL);
        CREATE TABLE sync_v2_snapshots(id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL,boundary INTEGER NOT NULL,expires_at INTEGER NOT NULL);
        CREATE TABLE sync_v2_snapshot_rows(snapshot_id TEXT NOT NULL,ordinal INTEGER NOT NULL,record TEXT NOT NULL,PRIMARY KEY(snapshot_id,ordinal));
        INSERT INTO repositories(id,name,full_name,html_url,owner_login,custom_description) VALUES(7,'legacy','owner/legacy','https://github.com/owner/legacy','owner','keep');
        INSERT INTO settings(key,value) VALUES('sentinel','preserve');
      `);
      await runStartupMigrations(db, directory);
      expect(db.prepare('SELECT custom_description FROM repositories WHERE id=7').get()).toEqual({ custom_description: 'keep' });
      expect(db.prepare("SELECT value FROM settings WHERE key='sentinel'").get()).toEqual({ value: 'preserve' });
      const columns = (db.prepare('PRAGMA table_info(repositories)').all() as { name: string }[]).map(row => row.name);
      expect(columns).toEqual(expect.arrayContaining(['classifications', 'category_id', 'subcategory_id', 'ai_details', 'license']));
      expect(db.prepare('SELECT MAX(version) AS version FROM schema_version').get()).toEqual({ version: 6 });
      const files = fs.readdirSync(directory);
      expect(files).toHaveLength(1);
      expect(files[0]).toMatch(/^migration-.*\.sqlite$/);
      const before = new Database(path.join(directory, files[0]), { readonly: true });
      try {
        expect(before.pragma('integrity_check', { simple: true })).toBe('ok');
        expect(before.prepare('SELECT MAX(version) AS version FROM schema_version').get()).toEqual({ version: 4 });
        expect(before.prepare('SELECT custom_description FROM repositories WHERE id=7').get()).toEqual({ custom_description: 'keep' });
        expect(before.prepare("SELECT value FROM settings WHERE key='sentinel'").get()).toEqual({ value: 'preserve' });
        expect((before.prepare('PRAGMA table_info(repositories)').all() as { name: string }[]).map(row => row.name)).not.toContain('classifications');
      } finally { before.close(); }
      await runStartupMigrations(db, directory);
      expect(fs.readdirSync(directory)).toEqual(files);
      expect(db.prepare('SELECT custom_description FROM repositories WHERE id=7').get()).toEqual({ custom_description: 'keep' });
    } finally { db.close(); fs.rmSync(directory, { recursive: true, force: true }); }
  });

  it('aborts before migration when the pre-migration backup cannot be created', async () => {
    const db = new Database(':memory:');
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gsm-v4-backup-fail-'));
    const occupied = path.join(directory, 'occupied');
    fs.writeFileSync(occupied, 'not a directory');
    try {
      db.exec('CREATE TABLE schema_version(version INTEGER PRIMARY KEY); INSERT INTO schema_version VALUES(4)');
      await expect(runStartupMigrations(db, occupied)).rejects.toThrow();
      expect(db.prepare('SELECT MAX(version) AS version FROM schema_version').get()).toEqual({ version: 4 });
      expect(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='repositories'").get()).toBeUndefined();
    } finally { db.close(); fs.rmSync(directory, { recursive: true, force: true }); }
  });
});
