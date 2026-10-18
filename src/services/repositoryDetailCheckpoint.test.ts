import 'fake-indexeddb/auto';
import { afterEach, expect, it, vi } from 'vitest';
import { clearDetailResponseCheckpoint, readDetailResponseCheckpoint, saveDetailResponseCheckpoint } from './repositoryDetailCheckpoint';
import { holdRepositoryIdentityWrites, releaseRepositoryIdentityWrites } from './repositoryIdentityGate';

afterEach(() => { vi.restoreAllMocks(); });
it('bounds each owner independently, expires responses and never reads another owner', async () => {
  const now = Date.now();
  const clock = vi.spyOn(Date, 'now');
  for (let id = 1; id <= 21; id++) { clock.mockReturnValue(now + id); await saveDetailResponseCheckpoint(901, id, `response-${id}`); }
  await saveDetailResponseCheckpoint(902, 1, 'other owner');
  expect(await readDetailResponseCheckpoint(901, 1)).toBeUndefined();
  expect((await readDetailResponseCheckpoint(901, 21))?.response).toBe('response-21');
  expect((await readDetailResponseCheckpoint(902, 1))?.response).toBe('other owner');
  expect(await readDetailResponseCheckpoint(903, 21)).toBeUndefined();
  clock.mockReturnValue(now + 86400050);
  expect(await readDetailResponseCheckpoint(901, 21)).toBeUndefined();
});
it('rejects oversized responses and maintenance writes, and preserves a checkpoint after a failed replacement', async () => {
  expect(await saveDetailResponseCheckpoint(904, 1, 'x'.repeat(96001))).toBe(false);
  await saveDetailResponseCheckpoint(904, 1, 'original');
  holdRepositoryIdentityWrites('904', 'fixture');
  try { await expect(clearDetailResponseCheckpoint(904, 1)).rejects.toThrow('MAINTENANCE'); }
  finally { releaseRepositoryIdentityWrites('904'); }
  const fault = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => { throw new Error('disk'); });
  await expect(saveDetailResponseCheckpoint(904, 1, 'replacement')).rejects.toThrow('disk'); fault.mockRestore();
  expect((await readDetailResponseCheckpoint(904, 1))?.response).toBe('original');
  await clearDetailResponseCheckpoint(904, 1);
  expect(await readDetailResponseCheckpoint(904, 1)).toBeUndefined();
});
