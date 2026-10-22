import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { accountFixture, repositoryFixture } from './testFixtures';
import { emptyExplorationAccount, loadExploration, parseExplorationBackup, readExplorationDocuments, serializeExploration, updateExploration } from './storage';

describe('account local exploration storage', () => {
  it('upgrades an early local graph without deleting its index when adding the document cache', async () => {
    const account = accountFixture([repositoryFixture(1)], ['direct']);
    await new Promise<void>((resolve, reject) => { const request = indexedDB.deleteDatabase('gsm-project-exploration'); request.onsuccess = () => resolve(); request.onerror = () => reject(request.error); });
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('gsm-project-exploration', 1); request.onupgradeneeded = () => request.result.createObjectStore('accounts', { keyPath: 'ownerId' });
      request.onerror = () => reject(request.error); request.onsuccess = () => { const db = request.result, transaction = db.transaction('accounts', 'readwrite'); transaction.objectStore('accounts').put(account); transaction.oncomplete = () => { db.close(); resolve(); }; transaction.onerror = () => { db.close(); reject(transaction.error); }; };
    });
    expect(await loadExploration('42')).toEqual(account);
    expect(await readExplorationDocuments('42', 1, 'not-cached')).toBeNull();
  });
  it('persists complete publications and corrections, restoring after reload', async () => {
    const owner = crypto.randomUUID(); const account = { ...accountFixture([repositoryFixture(1)], ['direct']), ownerId: owner };
    const saved = await updateExploration(owner, () => account);
    expect(await loadExploration(owner)).toEqual(saved);
    expect(await loadExploration('another-account')).toEqual(emptyExplorationAccount('another-account'));
  });
  it('retains the previous complete publication when validation or a stale revision fails', async () => {
    const owner = crypto.randomUUID(); const initial = await updateExploration(owner, () => ({ ...accountFixture([repositoryFixture(1)], ['direct']), ownerId: owner }));
    await expect(updateExploration(owner, current => { current.index!.profiles['1'].relations[0].evidenceIds = ['missing']; return current; })).rejects.toThrow();
    expect(await loadExploration(owner)).toEqual(initial);
    await expect(updateExploration(owner, current => current, undefined, 0)).rejects.toThrow('其他页面');
  });
  it('rejects another account, bad references, missing evidence, and unsupported formats on import', () => {
    const account = accountFixture([repositoryFixture(1)], ['direct']); const content = serializeExploration(account);
    expect(parseExplorationBackup(content, '42').index).toEqual(account.index);
    expect(() => parseExplorationBackup(content, '99')).toThrow('其他账号');
    expect(() => parseExplorationBackup('{"format":"other"}', '42')).toThrow();
    account.index!.profiles['1'].relations[0].targetId = 'unknown'; expect(() => parseExplorationBackup(serializeExploration(account), '42')).toThrow('目标');
  });
  it('does not allow an old account guard to publish and does not export interrupted jobs', async () => {
    const owner = crypto.randomUUID(); await expect(updateExploration(owner, current => current, () => { throw new Error('account switched'); })).rejects.toThrow('account switched');
    expect((await loadExploration(owner)).revision).toBe(0);
    const account = accountFixture([]); account.task = { id: 'task', type: 'build', status: 'running', startedAt: 'now', model: 'model', fingerprint: 'source', completed: 0, total: 0, draft: {} };
    expect(parseExplorationBackup(serializeExploration(account), '42').task).toBeNull();
  });
});
