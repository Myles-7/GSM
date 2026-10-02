import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';

export type BackupKind = 'daily' | 'weekly' | 'migration';
const limits: Record<BackupKind, number> = { daily: 7, weekly: 4, migration: 4 };

/** Only our completed SQLite files are rotated; partial and unrelated files are untouched. */
export function rotateBackups(directory: string, kind: BackupKind): void {
  const files = fs.readdirSync(directory)
    .filter(name => new RegExp(`^${kind}-\\d{4}-\\d{2}-\\d{2}T[\\d-]+Z-[a-f0-9]{8}\\.sqlite$`).test(name))
    .sort().reverse();
  for (const name of files.slice(limits[kind])) fs.unlinkSync(path.join(directory, name));
}

export function verifyBackup(filename: string): void {
  const candidate = new Database(filename, { readonly: true, fileMustExist: true });
  try {
    const result = candidate.pragma('integrity_check') as Array<{ integrity_check: string }>;
    if (result.length !== 1 || result[0].integrity_check !== 'ok') throw new Error('SQLite backup integrity check failed');
  } finally { candidate.close(); }
}

/** SQLite's online backup API includes committed WAL contents without stopping the server. */
export async function createBackup(db: Database.Database, directory: string, kind: BackupKind = 'daily', now = new Date()): Promise<string> {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  const filename = path.join(directory, `${kind}-${stamp}-${crypto.randomBytes(4).toString('hex')}.sqlite`);
  const temporary = filename + '.partial';
  try {
    await db.backup(temporary);
    fs.chmodSync(temporary, 0o600);
    verifyBackup(temporary);
    fs.renameSync(temporary, filename);
    rotateBackups(directory, kind);
    return filename;
  } catch (error) {
    fs.rmSync(temporary, { force: true });
    throw error;
  }
}

/** Call and await before any schema migration. Failure must abort startup/migration. */
export function backupBeforeMigration(db: Database.Database, directory: string): Promise<string> {
  return createBackup(db, directory, 'migration');
}

/** One daily snapshot per UTC day and one weekly snapshot per UTC Monday-based week. */
export function startBackupScheduler(db: Database.Database, directory: string, onError: (error: unknown) => void = console.error): () => Promise<void> {
  let active: Promise<void> | undefined;
  let stopped = false;
  const tick = () => {
    if (stopped || active) return;
    active = (async () => {
      fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
      const now = new Date();
      const day = now.toISOString().slice(0, 10);
      const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - (now.getUTCDay() + 6) % 7));
      const week = monday.toISOString().slice(0, 10);
      const names = fs.readdirSync(directory);
      if (!names.some(name => name.startsWith(`daily-${day}T`) && name.endsWith('.sqlite'))) await createBackup(db, directory, 'daily', now);
      if (!names.some(name => name.startsWith('weekly-') && name.endsWith('.sqlite') && name.slice(7, 17) >= week)) await createBackup(db, directory, 'weekly', now);
    })().catch(onError).finally(() => { active = undefined; });
  };
  tick();
  const timer = setInterval(tick, 60 * 60 * 1000);
  timer.unref();
  return async () => { stopped = true; clearInterval(timer); await active; };
}

/** Restore only to a NEW path. Caller must stop the service before replacing the live DB. */
export function restoreBackup(source: string, destination: string): void {
  verifyBackup(source);
  fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
  fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
  fs.chmodSync(destination, 0o600);
  verifyBackup(destination);
}
