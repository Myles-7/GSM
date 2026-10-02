import { Router, type RequestHandler } from 'express';
import type Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { getDb } from '../db/connection.js';
import { config } from '../config.js';
import { decrypt } from '../services/crypto.js';
import { discoveryAvailability } from './discovery.js';
import { taskKinds } from '../services/taskModel.js';
import { assertWorkspace, bootstrapWorkspace, COLLECTIONS, getWorkspace, getRecord, pullChanges, pushOperations, snapshotPage, SyncError } from '../services/syncV2.js';

export interface GithubIdentity { id: number; login: string }
const verificationCache = new WeakMap<Database.Database, { hash: string; expiresAt: number; identity: GithubIdentity }>();
export async function verifyServerGithubAccount(db: Database.Database, force = false): Promise<GithubIdentity> {
  const row = db.prepare("SELECT value FROM settings WHERE key='github_token'").get() as { value: string } | undefined;
  if (!row?.value) throw new SyncError('BACKEND_GITHUB_CREDENTIAL_REQUIRED', 409);
  let token: string;
  try { token = decrypt(row.value, config.encryptionKey); } catch { throw new SyncError('BACKEND_GITHUB_CREDENTIAL_INVALID', 409); }
  const hash = createHash('sha256').update(token).digest('hex');
  const cached = verificationCache.get(db);
  if (!force && cached?.hash === hash && cached.expiresAt > Date.now()) return cached.identity;
  verificationCache.delete(db);
  const response = await fetch('https://api.github.com/user', { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new SyncError('BACKEND_GITHUB_VERIFICATION_FAILED', 502);
  const user = await response.json() as GithubIdentity;
  if (!Number.isSafeInteger(user.id) || user.id < 1 || typeof user.login !== 'string') throw new SyncError('BACKEND_GITHUB_VERIFICATION_FAILED', 502);
  const identity = { id: user.id, login: user.login };
  verificationCache.set(db, { hash, identity, expiresAt: Date.now() + 300000 });
  return identity;
}
/** Mount after API authentication and before legacy routers. Canonical data lives in v2. */
export const legacySyncV2Guard: RequestHandler = async (req, res, next) => {
  const protectedData = (req.method !== 'GET' && /^\/api\/(?:repositories|releases|categories)(?:\/|$)/.test(req.path)) || /^\/api\/sync\/import$/.test(req.path) || (req.method !== 'GET' && req.path === '/api/settings');
  const workspace = protectedData ? getWorkspace(getDb()) : null;
  if (workspace) {
    // Credential rotation is not a business snapshot. Permit this one narrow
    // legacy call only after verifying that the replacement belongs to the bound account.
    if (req.method === 'PUT' && req.path === '/api/settings' && req.body && Object.keys(req.body).length === 1 && typeof req.body.github_token === 'string' && req.body.github_token && !req.body.github_token.startsWith('***')) {
      try {
        const response = await fetch('https://api.github.com/user', { headers: { Authorization: `Bearer ${req.body.github_token}`, Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(15000) });
        if (!response.ok) { res.status(400).json({ code: 'GITHUB_CREDENTIAL_INVALID', error: 'GitHub credential could not be verified' }); return; }
        const identity = await response.json() as { id?: number };
        if (identity.id !== workspace.githubUserId) { res.status(403).json({ code: 'BACKEND_ACCOUNT_MISMATCH', error: 'Credential belongs to another GitHub account' }); return; }
        next(); return;
      } catch { res.status(502).json({ code: 'GITHUB_VERIFICATION_UNAVAILABLE', error: 'Unable to verify replacement credential' }); return; }
    }
    res.status(409).json({ error: 'Use the account-bound sync v2 API', code: 'SYNC_V2_REQUIRED' }); return;
  }
  next();
};
export function createSyncV2Router(options: { db?: () => Database.Database; verifyAccount?: (db: Database.Database) => Promise<GithubIdentity>; requireSecret?: boolean } = {}) {
  const router = Router();
  const database = options.db ?? getDb;
  const verify = options.verifyAccount ?? verifyServerGithubAccount;
  const handle = (fn: (req: Parameters<RequestHandler>[0], res: Parameters<RequestHandler>[1], db: Database.Database) => Promise<void> | void): RequestHandler => async (req, res) => {
    try {
      if (options.requireSecret !== false && !config.apiSecret) throw new SyncError('API_SECRET_REQUIRED', 503);
      await fn(req, res, database());
    } catch (err) {
      const known = err instanceof SyncError;
      res.status(known ? err.status : 500).json({ error: known ? err.code : 'Sync operation failed', code: known ? err.code : 'SYNC_INTERNAL_ERROR' });
    }
  };
  const identity = async (db: Database.Database, workspaceId: unknown, githubUserId: unknown) => {
    const userId = typeof githubUserId === 'string' && /^\d+$/.test(githubUserId) ? Number(githubUserId) : githubUserId;
    if (typeof workspaceId !== 'string' || typeof userId !== 'number') throw new SyncError('WORKSPACE_IDENTITY_REQUIRED');
    const workspace = assertWorkspace(db, workspaceId, userId);
    const actual = await verify(db);
    if (actual.id !== workspace.githubUserId) throw new SyncError('BACKEND_ACCOUNT_MISMATCH', 403);
    return workspace;
  };
  router.get('/api/capabilities', handle(async (_req, res, db) => {
    let github: { configured: boolean; verified: boolean; id?: number; login?: string; error?: string };
    const configured = !!(db.prepare("SELECT value FROM settings WHERE key='github_token'").get() as { value?: string } | undefined)?.value;
    try { github = { configured, verified: true, ...await verify(db) }; } catch (err) { github = { configured, verified: false, error: err instanceof SyncError ? err.code : 'BACKEND_GITHUB_VERIFICATION_FAILED' }; }
    const aiConfigs = (db.prepare('SELECT id,name,api_type,base_url,model,is_active,api_key_encrypted FROM ai_configs').all() as Record<string, unknown>[]).map(row => {
      let available = false;
      try { available = !!decrypt(String(row.api_key_encrypted ?? ''), config.encryptionKey).trim(); } catch { /* Unreadable credentials are unavailable. */ }
      let baseUrl = '';
      try { const url = new URL(String(row.base_url)); url.username = ''; url.password = ''; url.search = ''; url.hash = ''; baseUrl = url.toString(); } catch { /* Invalid configuration. */ }
      return { id: row.id, name: row.name, apiType: row.api_type, baseUrl, model: row.model, isActive: !!row.is_active, available, credentialSource: 'backend' };
    });
    const workspace = getWorkspace(db);
    const lastCheckedAt = getRecord(db,'organization','default')?.data?.githubStarsLastCheckedAt;
    res.json({ protocolVersion: 2, discovery: discoveryAvailability(db), workspace, github, ai: { configured: aiConfigs.some(c => c.available) }, aiConfigs, tasks: { kinds: taskKinds, refreshStars: {available:!!workspace && github.verified && github.id===workspace.githubUserId,...(typeof lastCheckedAt==='string'?{lastCheckedAt}:{})}, maxConcurrentRequests: 2, eventRetentionDays: 30 }, sync: { enabled: true, collections: COLLECTIONS, tombstoneRetentionDays: 90, maxBatchSize: 500, canonical: true } });
  }));
  router.get('/api/diagnostics', handle((_req, res, db) => {
    const hasTable = (name: string) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);
    // Counts and protocol state only: never credentials, paths, task inputs or message bodies.
    res.json({
      protocols: { sync: 2, tasks: 1 },
      database: { journalMode: db.pragma('journal_mode', { simple: true }), schemaVersion: hasTable('schema_version') ? (db.prepare('SELECT MAX(version) AS version FROM schema_version').get() as { version: number }).version : null },
      workspace: getWorkspace(db),
      sync: { records: db.prepare('SELECT collection,deleted,COUNT(*) AS count FROM sync_v2_records GROUP BY collection,deleted').all(), changes: (db.prepare('SELECT COUNT(*) AS count FROM sync_v2_changes').get() as { count: number }).count, conflicts: (db.prepare('SELECT COUNT(*) AS count FROM sync_v2_conflicts').get() as { count: number }).count },
      tasks: hasTable('ai_tasks') ? db.prepare('SELECT status,COUNT(*) AS count FROM ai_tasks GROUP BY status').all() : [],
    });
  }));
  router.post('/api/sync/v2/bootstrap', handle(async (req, res, db) => {
    const actual = options.verifyAccount ? await verify(db) : await verifyServerGithubAccount(db, true);
    if (actual.id !== req.body?.githubUserId) throw new SyncError('BACKEND_ACCOUNT_MISMATCH', 403);
    res.json(bootstrapWorkspace(db, req.body));
  }));
  router.post(['/api/sync/v2/operations', '/api/sync/v2/push'], handle(async (req, res, db) => {
    await identity(db, req.body?.workspaceId, req.body?.githubUserId);
    res.json(pushOperations(db, req.body));
  }));
  router.get(['/api/sync/v2/changes', '/api/sync/v2/pull'], handle(async (req, res, db) => {
    await identity(db, req.query.workspaceId, req.query.githubUserId);
    res.json(pullChanges(db, Number(req.query.cursor ?? 0), Number(req.query.limit ?? 200)));
  }));
  router.get('/api/sync/v2/snapshot', handle(async (req, res, db) => {
    const workspace = await identity(db, req.query.workspaceId, req.query.githubUserId);
    if (req.query.snapshotId !== undefined && typeof req.query.snapshotId !== 'string') throw new SyncError('INVALID_PAGE');
    res.json(snapshotPage(db, workspace.id, req.query.snapshotId, Number(req.query.offset ?? 0), Number(req.query.limit ?? 200)));
  }));
  return router;
}
export default createSyncV2Router();
