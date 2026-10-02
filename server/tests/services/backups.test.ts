import { afterEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { backupBeforeMigration, createBackup, restoreBackup, startBackupScheduler, verifyBackup } from '../../src/services/backups.js';

const directories: string[] = [];
function temporary() { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsm-backups-')); directories.push(dir); return dir; }
afterEach(() => { for (const dir of directories.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });

describe('SQLite backups', () => {
  it('captures committed WAL rows and restores to a new verified file', async () => {
    const dir = temporary();
    const db = new Database(path.join(dir, 'live.db'));
    try {
      db.pragma('journal_mode = WAL');
      db.exec("CREATE TABLE records(value TEXT); INSERT INTO records VALUES ('committed');");
      const backup = await createBackup(db, path.join(dir, 'backups'));
      const restored = path.join(dir, 'restored.db');
      restoreBackup(backup, restored);
      const copy = new Database(restored);
      try { expect(copy.prepare('SELECT value FROM records').pluck().get()).toBe('committed'); } finally { copy.close(); }
      expect(() => restoreBackup(backup, restored)).toThrow();
    } finally { db.close(); }
  });
  it('retains seven daily and four weekly snapshots without deleting other files', async () => {
    const dir = temporary(); const db = new Database(':memory:');
    try {
      db.exec('CREATE TABLE records(value TEXT)');
      fs.writeFileSync(path.join(dir, 'keep.txt'), 'keep');
      for (let i = 1; i <= 9; i++) await createBackup(db, dir, 'daily', new Date(Date.UTC(2026, 0, i)));
      for (let i = 1; i <= 6; i++) await createBackup(db, dir, 'weekly', new Date(Date.UTC(2026, 0, i)));
      expect(fs.readdirSync(dir).filter(name => name.startsWith('daily-'))).toHaveLength(7);
      expect(fs.readdirSync(dir).filter(name => name.startsWith('weekly-'))).toHaveLength(4);
      expect(fs.existsSync(path.join(dir, 'keep.txt'))).toBe(true);
    } finally { db.close(); }
  });
  it('rejects corrupt input without creating a restore destination', () => {
    const dir = temporary(); const source = path.join(dir, 'bad.sqlite');
    fs.writeFileSync(source, 'not sqlite');
    expect(() => verifyBackup(source)).toThrow();
    expect(() => restoreBackup(source, path.join(dir, 'restore.db'))).toThrow();
    expect(fs.existsSync(path.join(dir, 'restore.db'))).toBe(false);
  });
  it('creates migration snapshots and does not duplicate daily/weekly backups after restart', async () => {
    const dir = temporary(); const db = new Database(':memory:');
    try {
      db.exec('CREATE TABLE records(value TEXT)');
      expect(await backupBeforeMigration(db, dir)).toContain('migration-');
      const errors: unknown[] = [];
      await startBackupScheduler(db, dir, error => { errors.push(error); })();
      await startBackupScheduler(db, dir, error => { errors.push(error); })();
      expect(errors).toEqual([]);
      expect(fs.readdirSync(dir).filter(name => name.startsWith('daily-'))).toHaveLength(1);
      expect(fs.readdirSync(dir).filter(name => name.startsWith('weekly-'))).toHaveLength(1);
    } finally { db.close(); }
  });
  it('propagates migration backup failures so callers can abort migration', async () => {
    const dir = temporary(); const occupied = path.join(dir, 'not-a-directory');
    fs.writeFileSync(occupied, 'occupied');
    const db = new Database(':memory:');
    try { await expect(backupBeforeMigration(db, occupied)).rejects.toThrow(); } finally { db.close(); }
  });
});
