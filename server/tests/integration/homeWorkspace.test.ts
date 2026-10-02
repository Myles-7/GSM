import 'fake-indexeddb/auto';
import Database from 'better-sqlite3';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HomeApi } from '../../../src/home/api';
import { HomeSync } from '../../../src/home/sync';
import type { HomeOperation } from '../../../src/home/types';
import { createApp } from '../../src/index.js';
import { runMigrations } from '../../src/db/migrations.js';
import { encrypt } from '../../src/services/crypto.js';
import { config } from '../../src/config.js';
import { getTask, runTask, stopTaskRunner } from '../../src/services/taskRunner.js';

const holder = vi.hoisted(() => ({ db: undefined as unknown as Database.Database }));
vi.mock('../../src/db/connection.js', () => ({ getDb: () => holder.db, closeDb: vi.fn() }));
vi.mock('../../src/config.js', () => ({ config: {
  apiSecret: 'integration-api-secret', encryptionKey: '1'.repeat(64), nodeEnv: 'test',
} }));
vi.mock('../../src/services/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn(), errorFromError: vi.fn() },
  morganLoggerStream: { write: vi.fn() },
}));

const repository = {
  id: 1, name: 'sample', full_name: 'acme/sample',
  html_url: 'https://github.com/acme/sample', owner: { login: 'acme' },
  custom_description: 'original',
};
const commit = 'a'.repeat(40);

describe('home clients through the production HTTP application', () => {
  let app: ReturnType<typeof createApp>;
  let desktop: HomeSync;
  let phone: HomeSync;
  let loseNextAcknowledgement: boolean;
  let dispatched: Array<{ clientId: string; operations: HomeOperation[] }>;
  let providerRequests: Array<{ url: string; body: Record<string, unknown> }>;

  beforeEach(async () => {
    holder.db = new Database(':memory:');
    runMigrations(holder.db);
    holder.db.prepare('INSERT INTO settings(key,value) VALUES(?,?)')
      .run('github_token', encrypt('fixture-github-token', config.encryptionKey));
    holder.db.prepare('INSERT INTO ai_configs(id,name,api_type,base_url,api_key_encrypted,model,is_active) VALUES(?,?,?,?,?,?,?)')
      .run('deepseek', 'Fixture model', 'deepseek', 'https://api.deepseek.com', encrypt('fixture-model-key', config.encryptionKey), 'deepseek-chat', 1);
    app = createApp();
    loseNextAcknowledgement = false;
    dispatched = [];
    providerRequests = [];

    // Only this explicit allowlist is reachable: no real GitHub or paid provider calls.
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.href === 'https://api.github.com/user') {
        return Response.json({ id: 42, login: 'fixture-user' });
      }
      if (url.href === 'https://api.deepseek.com/chat/completions') {
        providerRequests.push({ url: url.href, body: JSON.parse(String(init?.body)) });
        expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer fixture-model-key');
        const delta = (value: object) => `data: ${JSON.stringify({ choices: [{ delta: value }] })}\n\n`;
        return new Response(delta({ reasoning_content: 'private-provider-reasoning' }) +
          delta({ content: `Documented behavior [acme/sample@${commit}:README.md]` }) + 'data: [DONE]\n\n',
        { headers: { 'Content-Type': 'text/event-stream' } });
      }
      if (!url.hostname.endsWith('.integration.test')) throw new Error(`Unexpected external request: ${url.href}`);
      const method = init?.method ?? 'GET';
      const path = `${url.pathname}${url.search}`;
      const outgoing = method === 'POST' ? request(app).post(path) : request(app).get(path);
      const headers = new Headers(init?.headers);
      headers.forEach((value, key) => outgoing.set(key, value));
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      if (body) outgoing.send(body);
      const response = await outgoing;
      if (path === '/api/sync/v2/operations') {
        dispatched.push(structuredClone(body));
        if (loseNextAcknowledgement && response.status === 200) {
          loseNextAcknowledgement = false;
          throw new TypeError('Connection lost after server committed');
        }
      }
      return new Response(response.text, { status: response.status, headers: { 'Content-Type': 'application/json' } });
    }));

    const desktopApi = new HomeApi(`https://desktop-${crypto.randomUUID()}.integration.test`, () => 'integration-api-secret');
    const bootstrap = { githubUserId: 42, source: 'desktop', records: [{ collection: 'repositories', id: '1', data: repository }] };
    const preview = await desktopApi.request<{ previewToken: string }>('/sync/v2/bootstrap', bootstrap);
    expect((await desktopApi.capabilities()).workspace).toBeNull();
    await desktopApi.request('/sync/v2/bootstrap', { ...bootstrap, confirm: true, previewToken: preview.previewToken });
    const capabilities = await desktopApi.capabilities();
    expect(capabilities.github).toMatchObject({ id: 42, verified: true });
    expect(capabilities.aiConfigs).toContainEqual(expect.objectContaining({ id: 'deepseek', apiType: 'deepseek', available: true }));
    desktop = new HomeSync(desktopApi, capabilities);
    const phoneApi = new HomeApi(`https://phone-${crypto.randomUUID()}.integration.test`, () => 'integration-api-secret');
    phone = new HomeSync(phoneApi, await phoneApi.capabilities());
    await desktop.sync();
    await phone.sync();
    expect(desktop.view.status).toBe('synced');
    expect(phone.view.status).toBe('synced');
  });

  afterEach(async () => {
    await stopTaskRunner();
    holder.db.close();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('replays a committed operation after reconnect and resolves competing edits without losing either draft', async () => {
    await desktop.db.edit('repositories', '1', { ...repository, custom_description: 'desktop first' });
    loseNextAcknowledgement = true;
    await desktop.sync();
    expect(desktop.view.status).toBe('offline');
    await desktop.db.edit('repositories', '1', { ...repository, custom_description: 'desktop latest' });
    await desktop.sync();
    expect(desktop.view.status).toBe('synced');
    expect(dispatched).toHaveLength(3);
    expect(dispatched[1]).toEqual(dispatched[0]);
    expect(dispatched[2].operations[0].baseVersion).toBe(2);

    // Phone's edit still starts at version 1. Pulling remote changes must retain this draft.
    await phone.db.edit('repositories', '1', { ...repository, custom_description: 'phone draft' });
    await phone.sync();
    expect(phone.view).toMatchObject({ status: 'conflict', conflicts: 1 });
    expect((await phone.db.list('repositories'))[0].data?.custom_description).toBe('phone draft');
    const pending = (await phone.db.pending())[0];
    expect(pending.conflict).toMatchObject({ version: 3, data: { custom_description: 'desktop latest' } });
    expect(dispatched[3].clientId).not.toBe(dispatched[0].clientId);

    await phone.db.resolve('repositories:1', true);
    await phone.sync();
    await desktop.sync();
    expect(phone.view.status).toBe('synced');
    expect(await phone.db.pending()).toEqual([]);
    expect(await desktop.db.list('repositories')).toEqual(await phone.db.list('repositories'));
    expect((await desktop.db.list('repositories'))[0]).toMatchObject({ version: 4, data: { custom_description: 'phone draft' } });
    expect(holder.db.prepare('SELECT custom_description FROM repositories WHERE id=1').get())
      .toEqual({ custom_description: 'phone draft' });
  });

  it('submits a durable HTTP task once and replicates its pinned evidence and final conversation to another client', async () => {
    await phone.db.edit('sessions', 'conversation', { id: 'conversation', ownerId: '42', title: 'Explain sample' });
    await phone.db.edit('messages', 'question', { id: 'question', sessionId: 'conversation', role: 'user', content: 'Explain sample' });
    await phone.sync();
    const payload = { ...phone.identity, requestId: 'stable-task-request', configId: 'deepseek', kind: 'chat',
      input: { sessionId: 'conversation', userMessageId: 'question', prompt: 'Explain sample', repositories: ['acme/sample'] } };
    const task = await phone.api.request<{ id: string; status: string }>('/tasks', payload);
    expect(task.status).toBe('queued');
    expect((await phone.api.request<{ id: string }>('/tasks', payload)).id).toBe(task.id);
    expect(providerRequests).toHaveLength(0);

    await runTask(holder.db, getTask(holder.db, task.id, phone.identity.workspaceId, 42), {
      evidence: async () => [{ repository: 'acme/sample', commit, retrievedAt: '2026-09-29T00:00:00.000Z',
        metadata: { id: 1 }, readme: 'Documented behavior', tree: ['README.md'], files: [], limitations: [] }],
    });
    const taskQuery = new URLSearchParams({ workspaceId: phone.identity.workspaceId, githubUserId: '42' });
    const completed = await phone.api.request<Record<string, unknown>>(`/tasks/${task.id}?${taskQuery}`);
    expect(completed.status).toBe('completed');
    expect(completed).not.toHaveProperty('checkpoint');
    expect(providerRequests).toHaveLength(1);
    expect(providerRequests[0].body).toMatchObject({ model: 'deepseek-chat', stream: true });
    await phone.api.request('/tasks', payload);
    await runTask(holder.db, getTask(holder.db, task.id, phone.identity.workspaceId, 42));
    expect(providerRequests).toHaveLength(1);

    await desktop.sync();
    await phone.sync();
    const messages = await desktop.db.list('messages');
    expect(messages).toHaveLength(2);
    expect(messages).toEqual(await phone.db.list('messages'));
    const answer = messages.find(row => row.id === task.id)!;
    expect(answer.data).toMatchObject({ role: 'assistant', sessionId: 'conversation', status: 'complete',
      content: `Documented behavior [acme/sample@${commit}:README.md]` });
    const evidence = await desktop.db.list('evidence');
    expect(evidence).toHaveLength(1);
    expect(answer.data?.evidenceIds).toEqual([evidence[0].id]);
    expect(evidence[0].data).toMatchObject({ refSha: commit, path: 'README.md', excerpt: 'Documented behavior' });
    expect(await desktop.db.list('sessions')).toEqual(await phone.db.list('sessions'));
    const publicData = JSON.stringify({ completed, records: await desktop.db.list() });
    for (const secret of ['fixture-model-key', 'fixture-github-token', 'private-provider-reasoning']) {
      expect(publicData).not.toContain(secret);
    }
  });

  it('enforces application authentication and blocks the legacy write bypass after bootstrap', async () => {
    expect((await request(app).get('/api/capabilities')).status).toBe(401);
    expect((await request(app).post('/api/tasks').send({ ...phone.identity })).status).toBe(401);
    const legacy = await request(app).post('/api/repositories').set('Authorization', 'Bearer integration-api-secret').send(repository);
    expect(legacy.status).toBe(409);
    expect(legacy.body.code).toBe('SYNC_V2_REQUIRED');
    await expect(phone.api.request(`/sync/v2/changes?workspaceId=${phone.identity.workspaceId}&githubUserId=43`))
      .rejects.toMatchObject({ status: 403, code: 'WORKSPACE_ACCOUNT_MISMATCH' });
  });
});
