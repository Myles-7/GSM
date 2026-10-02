import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HomeApi } from './api';
import { HomeDatabase } from './database';
import type { HomeTask } from './types';
import { confirmRecoveredTask } from './taskRecovery';
import { readPendingTaskRequest, type PendingTaskRequest } from './taskSubmission';

const identity = { workspaceId: 'home', githubUserId: 42 };
const original = (): PendingTaskRequest => ({ requestId: 'lost-reply', ...identity, configId: 'model', kind: 'research', input: { sessionId: 'conversation', userMessageId: 'question-one', prompt: 'find a tool' } });
const receipt = (request: PendingTaskRequest): HomeTask => ({ ...request, id: 'server-task', status: 'completed', createdAt: '2026-09-30', updatedAt: '2026-09-30' });
const context = () => ({ db: new HomeDatabase(crypto.randomUUID()), api: new HomeApi('https://pc.test', () => 'test-secret'), identity });
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });

afterEach(() => vi.unstubAllGlobals());

describe('recovered task receipt integration', () => {
  it('confirms a lost reply through an authenticated matching receipt and preserves offline work', async () => {
    const sync = context(); const request = original();
    await sync.db.claimTaskRequest(request);
    await sync.db.edit('discovery_config', 'default', { name: 'keep channel draft' });
    await sync.db.setMetadata('composer:conversation', { prompt: 'keep question' });
    const next = { ...request, requestId: 'next-question', input: { ...request.input, userMessageId: 'question-two', prompt: 'compare these tools' } };
    await expect(sync.db.claimTaskRequest(next)).rejects.toThrow('尚未确认');
    const fetch = vi.fn().mockResolvedValue(json(receipt(request))); vi.stubGlobal('fetch', fetch);

    await confirmRecoveredTask(sync, receipt(request));

    expect(fetch).toHaveBeenCalledExactlyOnceWith('https://pc.test/api/tasks/by-request/lost-reply?workspaceId=home&githubUserId=42', expect.objectContaining({ method: 'GET', headers: expect.objectContaining({ Authorization: 'Bearer test-secret' }) }));
    expect(await readPendingTaskRequest(sync)).toBeNull();
    expect(await sync.db.claimTaskRequest(next)).toEqual(next);
    expect(await sync.db.pending()).toHaveLength(1);
    expect(await sync.db.metadata('composer:conversation')).toEqual({ prompt: 'keep question' });
  });

  it('does not confirm a cached task belonging to a foreign pending account', async () => {
    const sync = context(); const request = { ...original(), githubUserId: 43 };
    await sync.db.claimTaskRequest(request);
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);

    await expect(confirmRecoveredTask(sync, receipt(request))).rejects.toThrow('属于其他账户或工作区');

    expect(fetch).not.toHaveBeenCalled();
    expect(await sync.db.metadata('unconfirmedTask')).toEqual(request);
  });

  it.each([
    { input: { ...original().input, prompt: 'forged question' } },
    { githubUserId: 43 },
    { workspaceId: 'other-workspace' },
    { requestId: 'other-request' },
  ])('preserves the request when the server receipt differs from the saved submission: %j', async mismatch => {
    const sync = context(); const request = original(); await sync.db.claimTaskRequest(request);
    const fetch = vi.fn().mockResolvedValue(json({ ...receipt(request), ...mismatch })); vi.stubGlobal('fetch', fetch);

    await expect(confirmRecoveredTask(sync, receipt(request))).rejects.toThrow('电脑返回的任务与上次提交不一致');

    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0][1]).toMatchObject({ method: 'GET' });
    expect(await readPendingTaskRequest(sync)).toEqual(request);
  });

  it('keeps a cached task pending when authenticated lookup finds no receipt', async () => {
    const sync = context(); const request = original(); await sync.db.claimTaskRequest(request);
    const fetch = vi.fn().mockResolvedValue(json({ code: 'TASK_REQUEST_NOT_FOUND' }, 404)); vi.stubGlobal('fetch', fetch);

    await confirmRecoveredTask(sync, receipt(request));

    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0][1]).toMatchObject({ method: 'GET' });
    expect(await readPendingTaskRequest(sync)).toEqual(request);
  });

  it('does not look up a task when no submission is pending', async () => {
    const sync = context(); const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    await confirmRecoveredTask(sync, receipt(original()));
    expect(fetch).not.toHaveBeenCalled();
  });

  it('does not discard a different unconfirmed request when an older task is viewed', async () => {
    const sync = context(); const request = original(); await sync.db.claimTaskRequest(request);
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    await confirmRecoveredTask(sync, { requestId: 'older' } as HomeTask);
    expect(fetch).not.toHaveBeenCalled();
    expect(await readPendingTaskRequest(sync)).toEqual(request);
  });

  it('guards malformed pending records before any lookup or mutation', async () => {
    const sync = context(); const malformed = { requestId: 'lost-reply' };
    await sync.db.setMetadata('unconfirmedTask', malformed);
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    await expect(confirmRecoveredTask(sync, receipt(original()))).rejects.toThrow('本机记录格式无效');
    expect(fetch).not.toHaveBeenCalled();
    expect(await sync.db.metadata('unconfirmedTask')).toEqual(malformed);
  });
});
