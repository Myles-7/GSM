import Database from 'better-sqlite3';
import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import tasksRouter from '../../src/routes/tasks.js';
import { config } from '../../src/config.js';
import { encrypt } from '../../src/services/crypto.js';
import { initializeSyncV2, pushOperations } from '../../src/services/syncV2.js';
import { createTask, getTask, initializeTasks, taskEvents, type CreateTask } from '../../src/services/taskRunner.js';

const connection = vi.hoisted(() => ({ db: undefined as unknown as Database.Database }));
vi.mock('../../src/db/connection.js', () => ({ getDb: () => connection.db }));
vi.mock('../../src/config.js', () => ({ config: { apiSecret: 'task-api-secret', encryptionKey: '1'.repeat(64) } }));

const account = { workspaceId: 'workspace', githubUserId: 42 };
const base: CreateTask = { ...account, requestId: 'request-a', configId: 'deepseek', kind: 'chat', input: { prompt: 'Explain this' } };
const app = () => express().use(express.json()).use(tasksRouter);
const post = (body: unknown) => request(app()).post('/api/tasks').auth(config.apiSecret, { type: 'bearer' }).send(body);
const lookup = (requestId = base.requestId, identity = account) => request(app())
  .get(`/api/tasks/by-request/${encodeURIComponent(requestId)}`).auth(config.apiSecret, { type: 'bearer' }).query(identity);

describe('task creation receipts over HTTP', () => {
  beforeEach(() => {
    connection.db = new Database(':memory:');
    initializeSyncV2(connection.db);
    initializeTasks(connection.db);
    connection.db.exec(`INSERT INTO sync_v2_workspace(id,github_user_id,initialized_at) VALUES('workspace',42,'2026-09-30');
      CREATE TABLE ai_configs(id TEXT,api_key_encrypted TEXT,base_url TEXT,model TEXT,reasoning_effort TEXT);`);
    connection.db.prepare('INSERT INTO ai_configs VALUES(?,?,?,?,?)')
      .run('deepseek', encrypt('private-provider-key', config.encryptionKey), 'https://api.deepseek.com', 'deepseek-chat', null);
    vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Unexpected provider call'); }));
  });
  afterEach(() => { connection.db.close(); vi.restoreAllMocks(); vi.unstubAllGlobals(); config.apiSecret = 'task-api-secret'; });

  it('retrieves an accepted request without changing it or calling a provider and keeps replay idempotent', async () => {
    const created = await post(base);
    expect(created.status).toBe(202);
    const before = getTask(connection.db, created.body.id, account.workspaceId, account.githubUserId);
    const beforeEvents = taskEvents(connection.db, created.body.id, 0);
    const encryptedKey = connection.db.prepare('SELECT api_key_encrypted key FROM ai_configs').get() as { key: string };
    for (let index = 0; index < 2; index++) {
      const receipt = await lookup();
      expect(receipt.status).toBe(200);
      expect(receipt.body).toEqual(created.body);
      expect(receipt.body).not.toHaveProperty('checkpoint');
      expect(receipt.text).not.toContain('private-provider-key');
      expect(receipt.text).not.toContain(encryptedKey.key);
    }
    expect(getTask(connection.db, created.body.id, account.workspaceId, account.githubUserId)).toEqual(before);
    expect(taskEvents(connection.db, created.body.id, 0)).toEqual(beforeEvents);
    expect((await post(base)).body.id).toBe(created.body.id);
    expect(connection.db.prepare('SELECT COUNT(*) n FROM ai_tasks').get()).toEqual({ n: 1 });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('returns the specific missing-receipt code and keeps the generic task lookup', async () => {
    const missing = await lookup('not-accepted');
    expect(missing.status).toBe(404);
    expect(missing.body).toEqual({ error: 'TASK_REQUEST_NOT_FOUND', code: 'TASK_REQUEST_NOT_FOUND' });
    const created = createTask(connection.db, base);
    const task = await request(app()).get(`/api/tasks/${created.id}`).auth(config.apiSecret, { type: 'bearer' }).query(account);
    expect(task.status).toBe(200);
    expect(task.body.id).toBe(created.id);
  });

  it.each([
    [{ ...base, kind: 'invalid' }, 'INVALID_TASK'],
    [{ ...base, input: { unexpected: true } }, 'INVALID_TASK'],
    [{ ...base, kind: 'summary', input: {} }, 'REPOSITORY_EVIDENCE_REQUIRED'],
    [{ ...base, input: { repositories: ['owner/repo', 'owner/repo'] } }, 'INVALID_REPOSITORIES'],
    [{ ...base, kind: 'research', input: {} }, 'RESEARCH_QUERY_REQUIRED'],
    [{ ...base, kind: 'custom_discovery', input: {} }, 'DISCOVERY_CHANNEL_QUERY_REQUIRED'],
    [{ ...base, configId: 'missing' }, 'AI_CONFIG_REQUIRED'],
    [{ ...base, input: { projectId: 'missing' } }, 'PROJECT_NOT_FOUND'],
  ])('marks only proven validation rejection as unaccepted (%s)', async (body, code) => {
    const rejected = await post(body);
    expect(rejected.status).toBe(400);
    expect(rejected.body).toEqual({ error: code, code, accepted: false });
    expect(connection.db.prepare('SELECT COUNT(*) n FROM ai_tasks').get()).toEqual({ n: 0 });
    expect((await lookup()).status).toBe(404);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    ['invalid', 'https://api.deepseek.com', 'deepseek-chat', 'AI_CONFIG_DECRYPT_FAILED'],
    ['encrypted', 'https://example.com', 'deepseek-chat', 'DEEPSEEK_ENDPOINT_REQUIRED'],
    ['encrypted', 'https://api.deepseek.com', '', 'DEEPSEEK_MODEL_REQUIRED'],
  ])('definitively rejects unusable configuration before accepting work (%s)', async (key, endpoint, model, code) => {
    connection.db.prepare('UPDATE ai_configs SET api_key_encrypted=?,base_url=?,model=?')
      .run(key === 'encrypted' ? encrypt('private-provider-key', config.encryptionKey) : key, endpoint, model);
    const rejected = await post(base);
    expect(rejected.status).toBe(400);
    expect(rejected.body).toEqual({ error: code, code, accepted: false });
    expect((await lookup()).status).toBe(404);
  });

  it('definitively rejects foreign project context only after validating the workspace account', async () => {
    pushOperations(connection.db, { ...account, clientId: 'test', operations: [{ opId: 'project', collection: 'projects', id: 'project', kind: 'put', baseVersion: 0,
      data: { ownerId: '43', name: 'Other account', instructions: '', repositories: [] } }] });
    const rejected = await post({ ...base, input: { projectId: 'project' } });
    expect(rejected.status).toBe(409);
    expect(rejected.body).toEqual({ error: 'PROJECT_ACCOUNT_MISMATCH', code: 'PROJECT_ACCOUNT_MISMATCH', accepted: false });
  });

  it('never marks reuse of an accepted request as unaccepted, including an invalid changed payload', async () => {
    const accepted = createTask(connection.db, base);
    const conflict = await post({ ...base, input: { prompt: 'Changed request' } });
    expect(conflict.status).toBe(409);
    expect(conflict.body).toEqual({ error: 'REQUEST_ID_CONFLICT', code: 'REQUEST_ID_CONFLICT' });
    const invalid = await post({ ...base, kind: 'invalid' });
    expect(invalid.status).toBe(400);
    expect(invalid.body).toEqual({ error: 'INVALID_TASK', code: 'INVALID_TASK' });
    expect((await lookup()).body.id).toBe(accepted.id);
  });

  it('keeps definitive rejection durable when a delayed original arrives after configuration is repaired', async () => {
    connection.db.exec('DELETE FROM ai_configs');
    expect((await post(base)).body).toEqual({ error: 'AI_CONFIG_REQUIRED', code: 'AI_CONFIG_REQUIRED', accepted: false });
    const stored = connection.db.prepare('SELECT * FROM ai_task_request_rejections').get();
    expect(JSON.stringify(stored)).not.toContain(base.input.prompt);
    const bytes = connection.db.serialize(); connection.db.close(); connection.db = new Database(bytes);
    initializeTasks(connection.db);
    connection.db.prepare('INSERT INTO ai_configs VALUES(?,?,?,?,?)')
      .run('deepseek', encrypt('private-provider-key', config.encryptionKey), 'https://api.deepseek.com', 'deepseek-chat', null);
    expect((await post({ ...base, requestId: 'new-request-after-repair' })).status).toBe(202);
    const delayed = await post(base);
    expect(delayed.status).toBe(400);
    expect(delayed.body).toEqual({ error: 'AI_CONFIG_REQUIRED', code: 'AI_CONFIG_REQUIRED', accepted: false });
    expect(connection.db.prepare('SELECT COUNT(*) n FROM ai_tasks').get()).toEqual({ n: 1 });
    expect(connection.db.prepare('SELECT COUNT(*) n FROM ai_task_request_rejections').get()).toEqual({ n: 1 });
    expect((await lookup()).status).toBe(404);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects changed rejected payloads before validation and preserves the original rejection', async () => {
    connection.db.exec('DELETE FROM ai_configs');
    await post(base);
    for (const changed of [{ ...base, input: { prompt: 'Changed' } }, { ...base, kind: 'invalid' }]) {
      const conflict = await post(changed);
      expect(conflict.status).toBe(409);
      expect(conflict.body).toEqual({ error: 'REQUEST_ID_CONFLICT', code: 'REQUEST_ID_CONFLICT' });
    }
    connection.db.exec('DROP TABLE ai_configs');
    expect((await post(base)).body).toEqual({ error: 'AI_CONFIG_REQUIRED', code: 'AI_CONFIG_REQUIRED', accepted: false });
  });

  it('preserves uncertainty if a rejection receipt cannot be stored', async () => {
    connection.db.exec("CREATE TRIGGER fail_task_rejection BEFORE INSERT ON ai_task_request_rejections BEGIN SELECT RAISE(ABORT, 'REJECTION_WRITE_FAILED'); END");
    const rejected = await post({ ...base, configId: 'missing' });
    expect(rejected.status).toBe(500);
    expect(rejected.body).toEqual({ error: 'TASK_ERROR', code: 'TASK_ERROR' });
    expect(connection.db.prepare('SELECT COUNT(*) n FROM ai_task_request_rejections').get()).toEqual({ n: 0 });
    expect(connection.db.prepare('SELECT COUNT(*) n FROM ai_tasks').get()).toEqual({ n: 0 });
  });

  it('does not expose or reuse rejection receipts across workspace accounts', async () => {
    connection.db.exec('DELETE FROM ai_configs');
    await post(base);
    const stored = connection.db.prepare('SELECT * FROM ai_task_request_rejections').get();
    for (const identity of [{ ...account, githubUserId: 43 }, { ...account, workspaceId: 'other-workspace' }]) {
      const foreign = await post({ ...base, ...identity });
      expect(foreign.status).toBe(403);
      expect(foreign.body).toEqual({ error: 'WORKSPACE_ACCOUNT_MISMATCH', code: 'WORKSPACE_ACCOUNT_MISMATCH' });
      expect((await lookup(base.requestId, identity)).status).toBe(403);
    }
    connection.db.prepare('UPDATE sync_v2_workspace SET github_user_id=43').run();
    const reassigned = await post({ ...base, githubUserId: 43 });
    expect(reassigned.status).toBe(409);
    expect(reassigned.body).toEqual({ error: 'REQUEST_ID_CONFLICT', code: 'REQUEST_ID_CONFLICT' });
    expect(connection.db.prepare('SELECT * FROM ai_task_request_rejections').get()).toEqual(stored);
  });

  it.each(['', 'x'.repeat(151), 42, null])('does not promise rejection for malformed request identity (%s)', async requestId => {
    const response = await post({ ...base, requestId });
    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'INVALID_TASK', code: 'INVALID_TASK' });
  });

  it('validates workspace identity before returning any receipt and never exposes another account', async () => {
    const accepted = createTask(connection.db, base);
    for (const identity of [{ ...account, githubUserId: 43 }, { ...account, workspaceId: 'other-workspace' }]) {
      const receipt = await lookup(base.requestId, identity);
      expect(receipt.status).toBe(403);
      expect(receipt.body).toEqual({ error: 'WORKSPACE_ACCOUNT_MISMATCH', code: 'WORKSPACE_ACCOUNT_MISMATCH' });
      const rejected = await post({ ...base, ...identity });
      expect(rejected.status).toBe(403);
      expect(rejected.body).toEqual(receipt.body);
      expect(receipt.text).not.toContain(accepted.id);
    }
    connection.db.prepare('UPDATE ai_tasks SET github_user_id=43 WHERE id=?').run(accepted.id);
    expect((await lookup()).body).toEqual({ error: 'TASK_REQUEST_NOT_FOUND', code: 'TASK_REQUEST_NOT_FOUND' });
    expect((await post(base)).body).toEqual({ error: 'REQUEST_ID_CONFLICT', code: 'REQUEST_ID_CONFLICT' });
  });

  it('keeps missing and uninitialized workspace identity distinct from definitive task rejection', async () => {
    const malformed = await post({ ...base, githubUserId: 0 });
    expect(malformed.status).toBe(400);
    expect(malformed.body).toEqual({ error: 'WORKSPACE_IDENTITY_REQUIRED', code: 'WORKSPACE_IDENTITY_REQUIRED' });
    const noIdentity = await request(app()).get(`/api/tasks/by-request/${base.requestId}`).auth(config.apiSecret, { type: 'bearer' });
    expect(noIdentity.status).toBe(400);
    connection.db.exec('DELETE FROM sync_v2_workspace');
    const uninitialized = await post(base);
    expect(uninitialized.status).toBe(409);
    expect(uninitialized.body).toEqual({ error: 'WORKSPACE_UNINITIALIZED', code: 'WORKSPACE_UNINITIALIZED' });
  });

  it('requires API authentication for both submission and receipt lookup', async () => {
    for (const response of [await request(app()).post('/api/tasks').send(base),
      await request(app()).get(`/api/tasks/by-request/${base.requestId}`).query(account),
      await request(app()).get(`/api/tasks/by-request/${base.requestId}`).auth('wrong-secret', { type: 'bearer' }).query(account)]) {
      expect(response.status).toBe(401);
      expect(response.body).toEqual({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
    }
    config.apiSecret = '';
    const disabled = await lookup();
    expect(disabled.status).toBe(503);
    expect(disabled.body).toEqual({ error: 'API_SECRET_REQUIRED', code: 'API_SECRET_REQUIRED' });
  });

  it('preserves ambiguity for SQLite failure, including a rolled back task insert', async () => {
    connection.db.exec("CREATE TRIGGER fail_task_event BEFORE INSERT ON ai_task_events BEGIN SELECT RAISE(ABORT, 'STATE_WRITE_FAILED'); END");
    const failed = await post(base);
    expect(failed.status).toBe(500);
    expect(failed.body).toEqual({ error: 'STATE_WRITE_FAILED', code: 'STATE_WRITE_FAILED' });
    expect(connection.db.prepare('SELECT COUNT(*) n FROM ai_tasks').get()).toEqual({ n: 0 });
    expect((await lookup()).status).toBe(404);
  });

  it('preserves ambiguity for missing database tables and unavailable rejection verification', async () => {
    connection.db.exec('DROP TABLE ai_configs');
    const failure = await post(base);
    expect(failure.status).toBe(500);
    expect(failure.body).toEqual({ error: 'TASK_ERROR', code: 'TASK_ERROR' });
    connection.db.exec('DROP TABLE ai_tasks');
    const unverified = await post({ ...base, kind: 'invalid' });
    expect(unverified.status).toBe(500);
    expect(unverified.body).toEqual({ error: 'TASK_ERROR', code: 'TASK_ERROR' });
    const receipt = await lookup();
    expect(receipt.status).toBe(500);
    expect(receipt.body).toEqual({ error: 'TASK_ERROR', code: 'TASK_ERROR' });
  });

  it('allows recovery of an accepted task when the original response failed after commit', async () => {
    connection.db.exec(`CREATE TRIGGER corrupt_receipt AFTER INSERT ON ai_tasks BEGIN
      UPDATE ai_tasks SET config_snapshot='invalid-json' WHERE id=NEW.id; END`);
    const ambiguous = await post(base);
    expect(ambiguous.status).toBe(500);
    expect(ambiguous.body).toEqual({ error: 'TASK_ERROR', code: 'TASK_ERROR' });
    expect(connection.db.prepare('SELECT COUNT(*) n FROM ai_tasks').get()).toEqual({ n: 1 });
    expect((await lookup()).status).toBe(500);
    connection.db.prepare('UPDATE ai_tasks SET config_snapshot=?').run(JSON.stringify({ model: 'deepseek-chat', baseUrl: 'https://api.deepseek.com', configId: 'deepseek', reasoningEffort: null }));
    const recovered = await lookup();
    expect(recovered.status).toBe(200);
    expect(recovered.body).toMatchObject({ ...base, status: 'queued', stage: 'queued' });
    expect(fetch).not.toHaveBeenCalled();
  });
});
