import { beforeEach, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { defaultSettings, emptyReadingState, type ReadingReturn } from './model';
import { applyReadingReturn, loadReadingMigrationBackup, openReadingDb, readingTransaction } from './storage';
import { applyReadingReturnBatch, previewReadingReturnBatch } from './batch';
import { readReadingWorkspace, readingProjectFingerprint, updateReadingProjects } from './workspace';

const operationId = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const incoming = (field: 'read' | 'note' | 'interest' | 'candidate', value: boolean | string, n = 1): ReadingReturn => ({
  version: 1, format: 'gsm-reading-changes', accountId: '42', snapshotId: 'snapshot',
  operations: [{ id: operationId(n), repoId: 1, field, base: emptyReadingState()[field], value } as ReadingReturn['operations'][number]],
});
beforeEach(async () => {
  vi.stubGlobal('indexedDB', new IDBFactory());
  await readingTransaction('42', data => {
    for (const id of ['1', '2']) { data.states[id] = emptyReadingState(); data.names[id] = `acme/tool${id}`; }
    data.snapshots.snapshot = { base: { '1': emptyReadingState(), '2': emptyReadingState() }, allowed: defaultSettings.operations, generatedAt: '2026-10-01T00:00:00Z' };
  });
});
const fingerprints = async () => { const data = await readReadingWorkspace('42'); return Object.fromEntries(Object.keys(data.states).map(id => [id, readingProjectFingerprint(data, id)])); };

it('sources every accepted operation including new no-op intent and preserves the latest valid import on duplicate', async () => {
  const input = incoming('read', false);
  const result = await applyReadingReturn('42', input, {}, undefined, undefined, { fileName: 'phone.json', importId: 'first' });
  expect(result).toMatchObject({ unchanged: 1, importId: 'first' });
  const first = await readReadingWorkspace('42');
  expect(first.projectSources?.['1']).toMatchObject({ fileName: 'phone.json', operationId: operationId(1), importId: 'first' });
  expect(first.latestImport).toMatchObject({ id: 'first', ids: ['1'] });
  await applyReadingReturn('42', input, {}, undefined, undefined, { importId: 'duplicate' });
  const duplicate = await readReadingWorkspace('42');
  expect(duplicate.latestImport).toEqual(first.latestImport); expect(duplicate.projectSources).toEqual(first.projectSources);
  expect(readingProjectFingerprint(duplicate, '1')).toBe(readingProjectFingerprint(first, '1'));
});
it('batch provenance includes noncandidate changes and does not replace the latest import with duplicates', async () => {
  const files = [{ name: 'notes.json', input: incoming('note', 'new note') }, { name: 'read.json', input: incoming('read', true, 2) }];
  await applyReadingReturnBatch('42', await previewReadingReturnBatch('42', files), {}, { importId: 'batch' });
  const data = await readReadingWorkspace('42');
  expect(data.projectSources?.['1']).toMatchObject({ fileName: 'read.json', importId: 'batch' });
  expect(data.latestImport?.ids).toEqual(['1']);
  await applyReadingReturnBatch('42', await previewReadingReturnBatch('42', files), {}, { importId: 'copy' });
  expect((await readReadingWorkspace('42')).latestImport).toEqual(data.latestImport);
});
it('kept desktop changes do not create accepted project provenance or latest import', async () => {
  await applyReadingReturn('42', incoming('note', 'phone'), { [operationId(1)]: 'desktop' });
  const data = await readReadingWorkspace('42'); expect(data.projectSources).toEqual({}); expect(data.latestImport).toBeUndefined();
});
it('read and same-value edits preserve completion, genuine note, interest and candidate edits reopen', async () => {
  await updateReadingProjects('42', ['1'], { processed: true }, await fingerprints());
  await updateReadingProjects('42', ['1'], { read: true, note: '', interest: 'neutral', candidate: false }, await fingerprints());
  expect((await readReadingWorkspace('42')).processing?.['1'].processed).toBe(true);
  for (const patch of [{ note: 'new note' }, { interest: 'interested' as const }, { candidate: true }]) {
    await updateReadingProjects('42', ['1'], patch, await fingerprints());
    expect((await readReadingWorkspace('42')).processing?.['1'].processed).toBe(false);
    await updateReadingProjects('42', ['1'], { processed: true }, await fingerprints());
  }
});
it('ignored auto completes and manual restore remains pending across reads and duplicate imports', async () => {
  const input = incoming('interest', 'ignored');
  await applyReadingReturn('42', input, {});
  expect((await readReadingWorkspace('42')).processing?.['1']).toMatchObject({ processed: true, reason: 'ignored' });
  await updateReadingProjects('42', ['1'], { processed: false }, await fingerprints());
  await updateReadingProjects('42', ['1'], { read: true, interest: 'ignored' }, await fingerprints());
  await applyReadingReturn('42', input, {});
  expect((await readReadingWorkspace('42')).processing?.['1'].processed).toBe(false);
  await updateReadingProjects('42', ['1'], { interest: 'neutral' }, await fingerprints());
  await updateReadingProjects('42', ['1'], { interest: 'ignored' }, await fingerprints());
  expect((await readReadingWorkspace('42')).processing?.['1']).toMatchObject({ processed: true, reason: 'ignored' });
});
it('accepted no-op new import changes provenance but never requeues a completed project', async () => {
  await updateReadingProjects('42', ['1'], { processed: true }, await fingerprints());
  const before = readingProjectFingerprint(await readReadingWorkspace('42'), '1');
  await applyReadingReturn('42', incoming('note', ''), {}, undefined, undefined, { importId: 'new' });
  const data = await readReadingWorkspace('42'); expect(data.processing?.['1'].processed).toBe(true);
  expect(readingProjectFingerprint(data, '1')).not.toBe(before); expect(data.latestImport?.ids).toEqual(['1']);
});
it('an actual new imported note requeues and atomically saves receipt and source', async () => {
  await updateReadingProjects('42', ['1'], { processed: true }, await fingerprints());
  await applyReadingReturn('42', incoming('note', 'phone note'), {}, undefined, undefined, { importId: 'note' });
  const data = await readReadingWorkspace('42');
  expect(data.processing?.['1'].processed).toBe(false); expect(data.applied[operationId(1)]).toBeDefined(); expect(data.projectSources?.['1'].importId).toBe('note');
});
it('one stale row aborts all changes, including an ignored decision and provenance', async () => {
  const expected = await fingerprints();
  await updateReadingProjects('42', ['2'], { processed: true }, expected);
  await expect(updateReadingProjects('42', ['1', '2'], { interest: 'ignored' }, expected)).rejects.toThrow('项目已变化');
  const data = await readReadingWorkspace('42'); expect(data.states['1'].interest).toBe('neutral'); expect(data.states['2'].interest).toBe('neutral');
});
it('fingerprints protect source, names, processing and change-then-restore without depending on Star observations', async () => {
  const original = await fingerprints();
  await readingTransaction('42', data => { data.starObservations!['1'] = { starred: false, checkedAt: '2026-10-06' }; });
  expect((await fingerprints())['1']).toBe(original['1']);
  await readingTransaction('42', data => { data.names['1'] = 'acme/renamed'; });
  await readingTransaction('42', data => { data.names['1'] = 'acme/tool1'; });
  expect((await fingerprints())['1']).not.toBe(original['1']);
  await expect(updateReadingProjects('42', ['1'], { read: true }, original)).rejects.toThrow('项目已变化');
});
it('account-local metadata never appears in another account or phone state', async () => {
  await applyReadingReturn('42', incoming('interest', 'ignored'), {});
  const first = await readReadingWorkspace('42'), other = await readReadingWorkspace('43');
  expect(Object.keys(first.states['1']).sort()).toEqual(['candidate', 'interest', 'note', 'read']);
  expect(other.projectSources).toEqual({}); expect(other.processing).toEqual({}); expect(other.starObservations).toEqual({}); expect(other.latestImport).toBeUndefined();
});
it('workspace migration backup and initialization commit together once and failed migration preserves old record', async () => {
  const old = { storageVersion: 2, artifactVersion: 3, candidateVersion: 4, settings: defaultSettings, states: { '1': { ...emptyReadingState(), candidate: true } }, names: { '1': 'acme/tool1' }, applied: {}, sequence: 1 };
  const db = await openReadingDb();
  await new Promise<void>((resolve, reject) => { const tx = db.transaction('accounts', 'readwrite'); tx.objectStore('accounts').put(old, '44'); tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error); }); db.close();
  await expect(readingTransaction('44', () => { throw Error('disk failure'); })).rejects.toThrow('disk failure');
  expect(await loadReadingMigrationBackup('44', 'workspace-v5')).toBeNull();
  const data = await readReadingWorkspace('44'); expect(data.states['1'].candidate).toBe(true); expect(data.processing).toEqual({});
  const backup = await loadReadingMigrationBackup('44', 'workspace-v5'); expect(backup?.data).toEqual(old);
  await readingTransaction('44', data => { data.states['1'].note = 'after'; });
  expect(await loadReadingMigrationBackup('44', 'workspace-v5')).toEqual(backup);
});
it('invalid patch and missing fingerprints cannot partially update any project', async () => {
  await expect(updateReadingProjects('42', ['1', '2'], { note: 'bulk overwrite' }, await fingerprints())).rejects.toThrow('逐项');
  await expect(updateReadingProjects('42', ['1'], { note: 'x'.repeat(12001) }, await fingerprints())).rejects.toThrow('修改无效');
  await expect(updateReadingProjects('42', ['1'], { read: true }, {})).rejects.toThrow('项目已变化');
  expect((await readReadingWorkspace('42')).states['1'].read).toBe(false);
});
it('first workspace migration backfills legacy ignored decisions exactly once and respects a later manual restore', async () => {
  const old = { storageVersion: 2, artifactVersion: 3, candidateVersion: 4, settings: defaultSettings, states: { '1': { ...emptyReadingState(), interest: 'ignored' } }, names: { '1': 'acme/tool1' }, applied: {}, sequence: 1 };
  const db = await openReadingDb();
  await new Promise<void>((resolve, reject) => { const tx = db.transaction('accounts', 'readwrite'); tx.objectStore('accounts').put(old, '44'); tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error); }); db.close();
  const migrated = await readReadingWorkspace('44'); expect(migrated.processing?.['1']).toMatchObject({ processed: true, reason: 'ignored' });
  await updateReadingProjects('44', ['1'], { processed: false }, { '1': readingProjectFingerprint(migrated, '1') });
  expect((await readReadingWorkspace('44')).processing?.['1'].processed).toBe(false);
  expect((await loadReadingMigrationBackup('44', 'workspace-v5'))?.data).toEqual(old);
});
