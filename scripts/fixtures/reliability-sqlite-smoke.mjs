// Run only against verified online-backup copies, never the live service DB.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const root = path.resolve(import.meta.dirname, '../..');
const source = process.env.GSM_SMOKE_BACKUP_ROOT;
if (!source || !path.isAbsolute(source)) throw Error('Verified backup directory required');
const output = path.join(root, 'output/reliability/sqlite-smoke');
fs.mkdirSync(output, { recursive: true });
process.env.DATA_DIR = path.join(output, 'config');
process.env.ENCRYPTION_KEY = 'f'.repeat(64);
globalThis.fetch = async () => { throw Error('SQLITE_SMOKE_NETWORK_FORBIDDEN'); };
const require = createRequire(path.join(root, 'server/package.json'));
const Database = require('better-sqlite3');
const { runStartupMigrations } = await import('../../server/dist/db/startupMigrations.js');
const { CURRENT_SCHEMA_VERSION } = await import('../../server/dist/db/migrations.js');
const { decrypt } = await import('../../server/dist/services/crypto.js');
const { normalizeEncryptionKey } = await import('../../server/dist/config.js');
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const reports = [];
for (const [label, filename, keyFile] of [['repository', 'data.db', '.encryption-key'], ['service', 'service-data.db', 'service-encryption.key']]) {
  const original = path.join(source, filename), destination = path.join(output, `${label}.db`);
  const sourceHash = hash(original); fs.copyFileSync(original, destination, fs.constants.COPYFILE_EXCL);
  const db = new Database(destination); db.pragma('foreign_keys=ON');
  try {
    assert.equal(db.pragma('integrity_check', { simple: true }), 'ok');
    const version = db.prepare('SELECT MAX(version) version FROM schema_version').get().version;
    const tables = ['repositories', 'releases', 'ai_configs', 'settings', 'sync_v2_records'].filter(name => db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name));
    const saved = tables.map(name => ({ name, columns: db.prepare(`PRAGMA table_info(${name})`).all().map(column => column.name), rows: db.prepare(`SELECT * FROM ${name}`).all() }));
    await runStartupMigrations(db, path.join(output, label + '-migration-backup'));
    assert.equal(db.prepare('SELECT MAX(version) version FROM schema_version').get().version, CURRENT_SCHEMA_VERSION);
    for (const table of saved) assert.deepEqual(db.prepare(`SELECT ${table.columns.map(name => '"' + name + '"').join(',')} FROM ${table.name}`).all(), table.rows);
    assert.equal(db.pragma('integrity_check', { simple: true }), 'ok');
    assert.deepEqual(db.pragma('foreign_key_check'), []);
    // Verify that the copied protected key still decrypts saved provider keys.
    let decryptedKeys = 0;
    if (tables.includes('ai_configs')) {
      const key = normalizeEncryptionKey(fs.readFileSync(path.join(source, keyFile), 'utf8'));
      for (const row of db.prepare('SELECT api_key_encrypted FROM ai_configs').all()) if (row.api_key_encrypted) {
        assert.ok(decrypt(row.api_key_encrypted, key).length > 0); decryptedKeys++;
      }
    }
    const stable = db.prepare('SELECT COUNT(*) count FROM ai_tasks').get().count;
    await runStartupMigrations(db, path.join(output, label + '-migration-backup'));
    assert.equal(db.prepare('SELECT COUNT(*) count FROM ai_tasks').get().count, stable);
    reports.push({ label, fromVersion: version, toVersion: CURRENT_SCHEMA_VERSION, integrity: 'ok', businessTablesPreserved: tables.length, decryptableProviderKeys: decryptedKeys, idempotent: true });
  } finally { db.close(); }
  assert.equal(hash(original), sourceHash);
}
fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify(reports, null, 2));
console.log(JSON.stringify(reports));
