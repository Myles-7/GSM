import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { HomeDatabase } from './database';
import type { HomeRecord } from './types';

const row = (version: number, name = 'server'): HomeRecord => ({ collection: 'repositories', id: '1', version, seq: version, data: { name } });
const database = () => new HomeDatabase(crypto.randomUUID());
describe('durable home outbox', () => {
  it('refuses a category edit derived from a stale record version without replacing current data', async () => {
    const db = database();
    await db.applyRemote([{ collection: 'organization', id: 'default', version: 5, data: { name: 'current' } }], 5, true);
    await expect(db.edit('organization', 'default', { name: 'stale edit' }, 'user', 4)).rejects.toThrow('版本已改变');
    expect(await db.pending()).toEqual([]);
    expect((await db.list())[0].data?.name).toBe('current');
    await db.edit('organization', 'default', { name: 'fresh edit' }, 'user', 5);
    expect((await db.pending())[0].baseVersion).toBe(5);
  });
  it('backs up only data, restores pending edits and preserves newer local edits', async () => {
    const identity = { workspaceId: 'home', githubUserId: 42 };
    const source = database(); await source.applyRemote([row(1)], 1, true);
    await source.setMetadata('secret', 'device-credential');
    await source.edit('repositories', '1', { name: 'backup', apiKey: 'model-secret' });
    await source.edit('projects', 'new', { name: 'offline' });
    const text = await source.exportBackup(identity);
    expect(text).not.toContain('device-credential'); expect(text).not.toContain('model-secret');
    const target = database(); await target.edit('repositories', '1', { name: 'newer local' });
    const pending = await target.pending();
    await target.importBackup(text, identity);
    expect((await target.pending()).find(item => item.id === '1')).toEqual(pending[0]);
    expect((await target.list()).find(item => item.id === '1')?.data?.name).toBe('newer local');
    expect((await target.list()).find(item => item.id === 'new')?.data?.name).toBe('offline');
    expect(await target.metadata('initialized')).toBe(false);
    await target.applyRemote([row(5, 'server-new')], 5, true);
    expect((await target.list()).find(item => item.id === '1')?.data?.name).toBe('newer local');
  });
  it('refuses wrong identities, invalid operations and ambiguous in-flight requests without mutation', async () => {
    const identity = { workspaceId: 'home', githubUserId: 42 }; const source = database();
    await source.edit('repositories', '1', { name: 'saved' });
    const text = await source.exportBackup(identity); const target = database();
    await expect(target.importBackup(text, { ...identity, githubUserId: 43 })).rejects.toThrow('同一');
    await expect(target.importBackup(text, { ...identity, workspaceId: 'another' })).rejects.toThrow('同一');
    const malformed = JSON.parse(text); malformed.pending[0].key = 'projects:other';
    await expect(target.importBackup(JSON.stringify(malformed), identity)).rejects.toThrow('格式无效');
    expect(await target.list()).toEqual([]);
    await target.claimTaskRequest({ requestId: 'uncertain' });
    await expect(target.importBackup(text, identity)).rejects.toThrow('尚未确认');
    await expect(target.exportBackup(identity)).rejects.toThrow('尚未确认');
    await target.confirmTaskRequest('uncertain');
    await target.edit('projects', 'pending', { name: 'keep' }); await target.nextBatch();
    await expect(target.importBackup(text, identity)).rejects.toThrow('尚未确认');
    await expect(target.exportBackup(identity)).rejects.toThrow('尚未确认');
    expect((await target.list())[0].data?.name).toBe('keep');
  });
  it('replays an immutable in-flight operation after a newer edit and lost acknowledgement', async () => {
    const db = database(); await db.applyRemote([row(1)], 1, true);
    await db.edit('repositories', '1', { name: 'first' });
    const sent = await db.nextBatch();
    await db.edit('repositories', '1', { name: 'second' });
    expect(await db.nextBatch()).toEqual(sent);
    await db.applyRemote([row(2, 'first')], 2);
    expect((await db.list())[0].data?.name).toBe('second');
    await db.acknowledge(sent.operations[0], row(2, 'first'));
    await db.finishBatch(sent.operations);
    const next = await db.nextBatch();
    expect(next.operations[0].data?.name).toBe('second');
    expect(next.operations[0].baseVersion).toBe(2);
    expect(next.operations[0].opId).not.toBe(sent.operations[0].opId);
    await db.acknowledge(next.operations[0], row(3, 'second'));
    await db.finishBatch(next.operations);
    expect(await db.pending()).toEqual([]);
  });
  it('does not regress a newer remote revision when receiving an old retry receipt', async () => {
    const db = database(); await db.applyRemote([row(1)], 1, true);
    await db.edit('repositories', '1', { name: 'mine' }); const sent = await db.nextBatch();
    await db.applyRemote([row(3, 'other-device')], 3);
    await db.acknowledge(sent.operations[0], row(2, 'mine'));
    expect((await db.list())[0]).toEqual(row(3, 'other-device'));
    await db.applyRemote([row(2, 'old-log-page')], 3);
    expect((await db.list())[0]).toEqual(row(3, 'other-device'));
  });
  it('keeps the original base when a second offline edit follows a remote change', async () => {
    const db = database(); await db.applyRemote([row(1)], 1, true);
    await db.edit('repositories', '1', { name: 'first offline edit' });
    await db.applyRemote([row(2, 'other device')], 2);
    await db.edit('repositories', '1', { name: 'second offline edit' });
    expect((await db.pending())[0].baseVersion).toBe(1);
    expect((await db.list())[0].version).toBe(1);
    // The server must see base 1 and preserve a conflict, not treat this as editing base 2.
  });
  it('replaces a snapshot atomically while preserving local edits and deletion intent', async () => {
    const db = database(); await db.applyRemote([row(1), { ...row(1), id: 'old' }], 1, true);
    await db.edit('repositories', '1', null);
    await db.edit('projects', 'project', { name: 'offline project' });
    await db.applyRemote([row(4)], 4, true);
    expect(await db.list()).toEqual([expect.objectContaining({ id: 'project', data: { name: 'offline project' } })]);
    expect(await db.pending()).toHaveLength(2);
    expect(await db.metadata('cursor')).toBe(4);
  });
  it('uses the resolved server conflict as the base for subsequent edits', async () => {
    const db = database(); await db.applyRemote([row(1)], 1, true);
    await db.edit('repositories', '1', { name: 'mine' });
    const [pending] = await db.pending(); await db.reject(pending, row(4, 'remote'), 'VERSION_MISMATCH');
    await db.resolve(pending.key, false);
    await db.edit('repositories', '1', { name: 'next edit' });
    expect((await db.pending())[0].baseVersion).toBe(4);
  });
  it('keeps the original task request ID across retries and refuses to overwrite an uncertain submission', async () => {
    const db = database(); const input = { requestId: 'first', kind: 'chat', input: { prompt: 'hello' } };
    expect(await db.claimTaskRequest(input)).toEqual(input);
    expect(await db.claimTaskRequest({ ...input, requestId: 'retry' })).toEqual(input);
    await expect(db.claimTaskRequest({ ...input, input: { prompt: 'different' } })).rejects.toThrow('尚未确认');
    expect(await db.metadata('unconfirmedTask')).toEqual(input);
    await db.confirmTaskRequest('first');
    await db.claimTaskRequest({ ...input, requestId: 'next' });
    await db.confirmTaskRequest('first');
    expect((await db.metadata<{ requestId: string }>('unconfirmedTask'))?.requestId).toBe('next');
  });
});
