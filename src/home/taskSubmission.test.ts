import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HomeApi, HomeApiError } from './api';
import { HomeDatabase } from './database';
import type { HomeTask } from './types';
import { lookupPendingTaskRequest, PendingTaskRequestError, readPendingTaskRequest, recoverPendingTaskRequest, submitTaskRequest, type PendingTaskRequest } from './taskSubmission';

const identity = { workspaceId: 'home', githubUserId: 42 };
const request = (): PendingTaskRequest => ({ requestId: 'original-request', ...identity, configId: 'model', kind: 'custom_discovery', input: { channelId: 'custom:one', prompt: 'find a tool', date: '2026-09-30', language: 'zh' } });
const receipt = (value: PendingTaskRequest): HomeTask => ({ id: 'server-task', requestId: value.requestId, kind: value.kind, input: value.input, status: 'queued', createdAt: '2026-09-30', updatedAt: '2026-09-30' });
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const context = () => ({ db: new HomeDatabase(crypto.randomUUID()), api: new HomeApi('https://pc.test', () => 'test-secret'), identity });
afterEach(() => vi.unstubAllGlobals());

describe('durable task submission and explicit recovery', () => {
  it('recovers a lost response through authenticated lookup without another POST or losing offline work', async () => {
    const sync = context(); const original = request();
    await sync.db.edit('discovery_config', 'default', { name: 'offline channel draft' });
    await sync.db.setMetadata('composer:conversation', { prompt: 'unsent question' });
    const fetch = vi.fn().mockRejectedValueOnce(new TypeError('connection lost')).mockResolvedValueOnce(json(receipt(original)));
    vi.stubGlobal('fetch', fetch);
    await expect(submitTaskRequest(sync, original)).rejects.toMatchObject({ name: 'PendingTaskRequestError', request: original });
    expect(await readPendingTaskRequest(sync)).toEqual(original);
    expect(await lookupPendingTaskRequest(sync)).toEqual(receipt(original));
    expect(await readPendingTaskRequest(sync)).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[0][1]).toMatchObject({ method: 'POST', body: JSON.stringify(original), headers: { Authorization: 'Bearer test-secret' } });
    expect(fetch.mock.calls[1]).toEqual(['https://pc.test/api/tasks/by-request/original-request?workspaceId=home&githubUserId=42', expect.objectContaining({ method: 'GET', headers: expect.objectContaining({ Authorization: 'Bearer test-secret' }) })]);
    expect(await sync.db.pending()).toHaveLength(1);
    expect(await sync.db.metadata('composer:conversation')).toEqual({ prompt: 'unsent question' });
  });

  it('releases a definitive rejected POST so a changed model and channel can be submitted', async () => {
    const sync = context(); const original = request();
    const next = { ...original, requestId: 'new-context', configId: 'fixed-model', input: { ...original.input, channelId: 'custom:two' } };
    const fetch = vi.fn().mockResolvedValueOnce(json({ code: 'AI_CONFIG_REQUIRED', error: 'AI_CONFIG_REQUIRED', accepted: false }, 400)).mockResolvedValueOnce(json(receipt(next), 202));
    vi.stubGlobal('fetch', fetch);
    await expect(submitTaskRequest(sync, original)).rejects.toThrow('电脑未接收任务：请在电脑配置可用的 DeepSeek 模型');
    expect(await readPendingTaskRequest(sync)).toBeNull();
    expect(await submitTaskRequest(sync, next)).toEqual(receipt(next));
    expect(fetch.mock.calls[1][1].body).toBe(JSON.stringify(next));
  });

  it.each([
    [400, 'INVALID_TASK', undefined],
    [401, 'UNAUTHORIZED', false],
    [403, 'FORBIDDEN', false],
    [500, 'TASK_ERROR', false],
    [503, 'TASK_ERROR', undefined],
    [409, 'REQUEST_ID_CONFLICT', true],
    [409, 'REQUEST_ID_CONFLICT', false],
  ])('preserves uncertain submissions for HTTP %s / %s / accepted %s', async (status, code, accepted) => {
    const sync = context(); const original = request();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ code, error: code, ...(accepted === undefined ? {} : { accepted }) }, status)));
    await expect(submitTaskRequest(sync, original)).rejects.toBeInstanceOf(PendingTaskRequestError);
    expect(await readPendingTaskRequest(sync)).toEqual(original);
  });

  it('keeps a 404 lookup pending, then explicitly replays its original ID and releases a definitive rejection', async () => {
    const sync = context(); const original = request(); await sync.db.claimTaskRequest(original);
    const fetch = vi.fn().mockResolvedValueOnce(json({ code: 'TASK_NOT_FOUND' }, 404))
      .mockResolvedValueOnce(json({ code: 'TASK_NOT_FOUND' }, 404))
      .mockResolvedValueOnce(json({ code: 'INVALID_TASK', error: 'INVALID_TASK', accepted: false }, 400));
    vi.stubGlobal('fetch', fetch);
    expect(await lookupPendingTaskRequest(sync)).toBeNull();
    expect(await readPendingTaskRequest(sync)).toEqual(original);
    expect(fetch).toHaveBeenCalledTimes(1);
    await expect(recoverPendingTaskRequest(sync)).rejects.toBeInstanceOf(HomeApiError);
    expect(fetch.mock.calls[2][1]).toMatchObject({ method: 'POST', body: JSON.stringify(original) });
    expect(await readPendingTaskRequest(sync)).toBeNull();
  });

  it('returns a duplicate receipt for the exact pending payload and blocks another context without dispatching it', async () => {
    const sync = context(); const original = request(); await sync.db.claimTaskRequest(original);
    const fetch = vi.fn().mockResolvedValue(json(receipt(original), 202)); vi.stubGlobal('fetch', fetch);
    const different = { ...original, requestId: 'new-context', input: { ...original.input, channelId: 'custom:two' } };
    await expect(submitTaskRequest(sync, different)).rejects.toMatchObject({ name: 'PendingTaskRequestError', request: original });
    expect(fetch).not.toHaveBeenCalled();
    expect(await submitTaskRequest(sync, { ...original, requestId: 'duplicate-client-id' })).toEqual(receipt(original));
    expect(fetch.mock.calls[0][1].body).toBe(JSON.stringify(original));
    expect(await readPendingTaskRequest(sync)).toBeNull();
  });

  it('does not clear a newer request when a stale POST rejection arrives', async () => {
    const sync = context(); const original = request(); const newer = { ...original, requestId: 'newer-request', input: { ...original.input, channelId: 'custom:two' } };
    vi.stubGlobal('fetch', vi.fn(async () => {
      await sync.db.confirmTaskRequest(original.requestId);
      await sync.db.claimTaskRequest(newer);
      return json({ code: 'INVALID_TASK', error: 'INVALID_TASK', accepted: false }, 400);
    }));
    await expect(submitTaskRequest(sync, original)).rejects.toBeInstanceOf(HomeApiError);
    expect(await readPendingTaskRequest(sync)).toEqual(newer);
  });

  it('does not clear a newer request when the recovered receipt belongs to an older submission', async () => {
    const sync = context(); const original = request(); const newer = { ...original, requestId: 'newer-request' };
    await sync.db.claimTaskRequest(original);
    vi.stubGlobal('fetch', vi.fn(async () => {
      await sync.db.confirmTaskRequest(original.requestId); await sync.db.claimTaskRequest(newer);
      return json(receipt(original));
    }));
    expect(await lookupPendingTaskRequest(sync)).toEqual(receipt(original));
    expect(await readPendingTaskRequest(sync)).toEqual(newer);
  });

  it.each([
    { requestId: 'corrupt' },
    { ...request(), input: ['wrong shape'] },
    { ...request(), githubUserId: 99 },
    { ...request(), workspaceId: 'other-workspace' },
    false,
  ])('guards malformed or foreign pending metadata without dispatch or mutation: %j', async value => {
    const sync = context(); await sync.db.setMetadata('unconfirmedTask', value);
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    await expect(recoverPendingTaskRequest(sync)).rejects.toBeInstanceOf(PendingTaskRequestError);
    await expect(submitTaskRequest(sync, request())).rejects.toBeInstanceOf(PendingTaskRequestError);
    expect(fetch).not.toHaveBeenCalled(); expect(await sync.db.metadata('unconfirmedTask')).toEqual(value);
  });

  it('rejects a mismatched receipt while preserving its original pending context', async () => {
    const sync = context(); const original = request(); await sync.db.claimTaskRequest(original);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ ...receipt(original), input: { ...original.input, channelId: 'custom:another' } })));
    await expect(lookupPendingTaskRequest(sync)).rejects.toThrow('电脑返回的任务与上次提交不一致');
    expect(await readPendingTaskRequest(sync)).toEqual(original);
  });
});
