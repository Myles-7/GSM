import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { defaultSettings, emptyReadingState, type ReadingReturn, type ReadingSnapshot } from './model';
import { applyReadingReturn, loadReadingData, loadReadingMigrationBackup, openReadingDb, readingTransaction, rememberSnapshot } from './storage';
import { applyReadingReturnBatch, previewReadingReturnBatch } from './batch';
import { candidateFingerprint, candidateTransaction, clearCandidateIfUnchanged, readCandidateWorkspace, saveStarBatch, updateStarBatch, type ReadingStarBatch } from './candidates';

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const snapshot = (): ReadingSnapshot => ({ version: 1, id: 'snapshot', accountId: '42', generatedAt: '2026-10-01T00:00:00Z', title: 'test', settings: structuredClone(defaultSettings), sections: [{ id: 'repositories', title: 'test', updatedAt: '', items: [{ id: 1, name: 'acme/tool', url: '', categoryId: '', category: '', summary: 'large AI text', description: '', tags: [], language: '', stars: 1, updated: '', analysis: [], sources: [], generatedAt: '', reason: '', state: emptyReadingState() }] }] });
const incoming = (id = 1): ReadingReturn => ({ version: 1, format: 'gsm-reading-changes', accountId: '42', snapshotId: 'snapshot', operations: [{ id: uuid(id), repoId: 1, field: 'candidate', value: true, base: false }] });
const batch = (): ReadingStarBatch => ({ id: 'batch', accountId: '42', createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z', status: 'running', rows: [{ repoId: 1, name: 'acme/tool', sourceFingerprint: 'old', status: 'sending' }] });
beforeEach(() => vi.stubGlobal('indexedDB', new IDBFactory()));

async function rawAccount() {
  const db = await openReadingDb();
  try {
    return await new Promise<unknown>((resolve, reject) => { const req = db.transaction('accounts').objectStore('accounts').get('42'); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
  } finally { db.close(); }
}
describe('candidate provenance and durable Star batches', () => {
  it('migrates v3 transactionally, preserves historical candidates, and backs up once', async () => {
    const old = { storageVersion: 2, artifactVersion: 3, settings: defaultSettings, states: { '1': { ...emptyReadingState(), candidate: true } }, names: { '1': 'acme/tool' }, applied: {}, sequence: 1 };
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('gsm-html-reading', 3);
      req.onupgradeneeded = () => { for (const name of ['accounts', 'migration-backups']) req.result.createObjectStore(name); for (const name of ['snapshots', 'discovery-cache']) req.result.createObjectStore(name).createIndex('account', 'accountId'); };
      req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
    });
    await new Promise<void>((resolve, reject) => { const tx = db.transaction(['accounts', 'snapshots'], 'readwrite'); tx.objectStore('accounts').put(old, '42'); tx.objectStore('snapshots').put({ accountId: '42', snapshotId: 'legacy', data: { base: {}, allowed: defaultSettings.operations } }, ['42', 'legacy']); tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error); }); db.close();
    await expect(candidateTransaction('42', () => { throw Error('migration fails'); })).rejects.toThrow('migration fails');
    expect(await rawAccount()).toEqual(old); expect(await loadReadingMigrationBackup('42', 'candidates-v4')).toBeNull();
    const data = await readCandidateWorkspace('42'); expect(data.states['1'].candidate).toBe(true); expect(data.candidateSources).toEqual({}); expect(data.snapshots).toEqual({});
    expect((await loadReadingData('42')).snapshots.legacy).toBeDefined();
    expect((await loadReadingMigrationBackup('42', 'candidates-v4'))?.data).toEqual(old);
    await candidateTransaction('42', d => { d.states['1'].note = 'new note'; });
    expect((await loadReadingMigrationBackup('42', 'candidates-v4'))?.data).toEqual(old);
  });
  it('records real file/snapshot metadata exactly once and keeps lightweight account storage', async () => {
    await rememberSnapshot('42', snapshot());
    const result = await applyReadingReturn('42', incoming(), {}, undefined, undefined, { fileName: 'phone.json', importId: 'accepted' });
    expect(result.importId).toBe('accepted');
    const source = (await readCandidateWorkspace('42')).candidateSources['1'];
    expect(source).toMatchObject({ operationId: uuid(1), fileName: 'phone.json', snapshotId: 'snapshot', generatedAt: '2026-10-01T00:00:00Z', importId: 'accepted', importedAt: expect.any(String) });
    await applyReadingReturn('42', incoming(), {}, undefined, undefined, { fileName: 'copied.json', importId: 'duplicate' });
    expect((await readCandidateWorkspace('42')).candidateSources['1']).toEqual(source);
    expect(await rawAccount()).not.toHaveProperty('candidateSources'); expect(await rawAccount()).not.toHaveProperty('starBatches');
    expect(JSON.stringify(source)).not.toContain('large AI text');
  });
  it('rolls back sources, receipts and state if a later import field fails', async () => {
    await rememberSnapshot('42', snapshot()); await readingTransaction('42', d => { d.states['1'] = { ...emptyReadingState(), note: 'desktop' }; });
    const input = incoming(); input.operations.push({ id: uuid(2), repoId: 1, field: 'note', base: '', value: 'phone' });
    await expect(applyReadingReturn('42', input, {})).rejects.toThrow('冲突');
    const data = await readCandidateWorkspace('42'); expect(data.candidateSources).toEqual({}); expect(data.applied).toEqual({}); expect(data.states['1'].candidate).toBe(false);
  });
  it('does not create provenance for desktop-kept candidate edits', async () => {
    await rememberSnapshot('42', snapshot()); await applyReadingReturn('42', incoming(), { [uuid(1)]: 'desktop' });
    expect((await readCandidateWorkspace('42')).candidateSources).toEqual({});
  });
  it('groups accepted batch candidate sources by one import and ignores repeated files', async () => {
    await rememberSnapshot('42', snapshot());
    const files = [{ name: 'one.json', input: incoming(1) }, { name: 'two.json', input: incoming(2) }];
    const preview = await previewReadingReturnBatch('42', files);
    expect((await applyReadingReturnBatch('42', preview, {}, { importId: 'group' })).importId).toBe('group');
    const source = (await readCandidateWorkspace('42')).candidateSources['1']; expect(source.importId).toBe('group');
    await applyReadingReturnBatch('42', await previewReadingReturnBatch('42', files)); expect((await readCandidateWorkspace('42')).candidateSources['1']).toEqual(source);
  });
  it('durably isolates sources and recoverable batches by account and rejects cross-account writes', async () => {
    await rememberSnapshot('42', snapshot()); await applyReadingReturn('42', incoming(), {}); await saveStarBatch('42', batch());
    await updateStarBatch('42', 'batch', saved => { saved.rows[0].status = 'local-pending'; saved.rows[0].outcome = 'starred'; saved.pauseReason = 'sync'; });
    expect((await readCandidateWorkspace('42')).starBatches.batch.rows[0]).toMatchObject({ status: 'local-pending', outcome: 'starred' });
    const other = await readCandidateWorkspace('43'); expect(other.candidateSources).toEqual({}); expect(other.starBatches).toEqual({});
    await expect(saveStarBatch('43', batch())).rejects.toThrow('其他');
    await expect(candidateTransaction('43', data => { data.starBatches.bad = batch(); })).rejects.toThrow('其他');
    expect((await readCandidateWorkspace('43')).starBatches).toEqual({});
  });
  it('clears only the captured candidate and preserves reading fields', async () => {
    await rememberSnapshot('42', snapshot()); await applyReadingReturn('42', incoming(), {});
    const fingerprint = candidateFingerprint(await readCandidateWorkspace('42'), 1);
    await readingTransaction('42', d => { d.states['1'].note = 'keep'; d.states['1'].read = true; d.states['1'].interest = 'interested'; });
    expect(await candidateTransaction('42', d => clearCandidateIfUnchanged(d, 1, fingerprint))).toBe(true);
    expect((await readCandidateWorkspace('42')).states['1']).toEqual({ candidate: false, note: 'keep', read: true, interest: 'interested' });
  });
  it('guards later accepted reimports and manual candidate false→true transitions', async () => {
    await rememberSnapshot('42', snapshot()); await applyReadingReturn('42', incoming(), {});
    const first = candidateFingerprint(await readCandidateWorkspace('42'), 1);
    await applyReadingReturn('42', incoming(2), {});
    expect(await candidateTransaction('42', d => clearCandidateIfUnchanged(d, 1, first))).toBe(false);
    const second = candidateFingerprint(await readCandidateWorkspace('42'), 1);
    await readingTransaction('42', d => { d.states['1'].candidate = false; }); await readingTransaction('42', d => { d.states['1'].candidate = true; });
    expect(await candidateTransaction('42', d => clearCandidateIfUnchanged(d, 1, second))).toBe(false);
    expect((await readCandidateWorkspace('42')).states['1'].candidate).toBe(true);
  });
  it('single no-op imports report unchanged while receipting accepted candidate intent', async () => {
    await rememberSnapshot('42', snapshot()); await applyReadingReturn('42', incoming(), {});
    const original = await readCandidateWorkspace('42'); const fingerprint = candidateFingerprint(original, 1);
    const input = incoming(2); input.operations.push({ id: uuid(3), repoId: 1, field: 'note', base: '', value: 'new note' });
    const result = await applyReadingReturn('42', input, {}, undefined, undefined, { fileName: 'again.json', importId: 'new intent' });
    expect(result).toMatchObject({ applied: 1, unchanged: 1, duplicate: 0, importId: 'new intent' });
    const saved = await readCandidateWorkspace('42'); expect(saved.applied[uuid(2)]).toBe(JSON.stringify(input.operations[0])); expect(saved.applied[uuid(3)]).toBeDefined();
    expect(saved.candidateSources['1']).toMatchObject({ operationId: uuid(2), importId: 'new intent', fileName: 'again.json' });
    expect(candidateFingerprint(saved, 1)).not.toBe(fingerprint); expect(saved.states['1'].note).toBe('new note');
    expect(await applyReadingReturn('42', input, {})).toEqual({ applied: 0, duplicate: 2, kept: 0 });
  });
  it('batch no-op imports count actual mutations and retain accepted provenance and receipts', async () => {
    await rememberSnapshot('42', snapshot()); await applyReadingReturn('42', incoming(), {});
    const first = incoming(2); const second = incoming(3); first.operations.push({ id: uuid(4), repoId: 1, field: 'note', base: '', value: 'new note' });
    const preview = await previewReadingReturnBatch('42', [{ name: 'one.json', input: first }, { name: 'two.json', input: second }]);
    expect(preview.rows.find(row => row.field === 'candidate')).toMatchObject({ current: true, status: 'ready' });
    const result = await applyReadingReturnBatch('42', preview, {}, { importId: 'group' });
    expect(result).toMatchObject({ applied: 1, unchanged: 1, duplicate: 1, kept: 0 });
    const saved = await readCandidateWorkspace('42'); expect(saved.candidateSources['1'].importId).toBe('group');
    for (const id of [2, 3, 4]) expect(saved.applied[uuid(id)]).toBeDefined();
    expect(saved.states['1']).toMatchObject({ candidate: true, note: 'new note' });
    const again = await applyReadingReturnBatch('42', await previewReadingReturnBatch('42', preview.files));
    expect(again).toMatchObject({ applied: 0, duplicate: 3 }); expect(again).not.toHaveProperty('unchanged');
  });
});
