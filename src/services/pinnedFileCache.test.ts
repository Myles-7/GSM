import { describe, expect, it, vi } from 'vitest';
import { bindFileCacheIdentity, readPinnedFile } from './pinnedFileCache';
describe('pinned file cache', () => {
  it('reuses pinned reads but separates versions and accounts', async () => {
    bindFileCacheIdentity('account-a');
    const read = vi.fn().mockResolvedValue({ content: 'old' });
    const signal = new AbortController().signal;
    await readPinnedFile('repo:sha:path', signal, read);
    await readPinnedFile('repo:sha:path', signal, read);
    expect(read).toHaveBeenCalledOnce();
    await readPinnedFile('repo:new-sha:path', signal, read);
    bindFileCacheIdentity('account-b');
    await readPinnedFile('repo:sha:path', signal, read);
    expect(read).toHaveBeenCalledTimes(3);
  });
  it('never caches a canceled read', async () => {
    bindFileCacheIdentity('cancel-fixture');
    const controller = new AbortController();
    const read = vi.fn().mockImplementation(async () => { controller.abort(); return 'late'; });
    await expect(readPinnedFile('file', controller.signal, read)).rejects.toMatchObject({ name: 'AbortError' });
    const fresh = vi.fn().mockResolvedValue('new');
    expect(await readPinnedFile('file', new AbortController().signal, fresh)).toBe('new');
    expect(fresh).toHaveBeenCalledOnce();
  });
  it('does not cache reads without an account binding', async () => {
    bindFileCacheIdentity('');
    const read = vi.fn().mockResolvedValue('fresh');
    const signal = new AbortController().signal;
    await readPinnedFile('same-path', signal, read);
    await readPinnedFile('same-path', signal, read);
    expect(read).toHaveBeenCalledTimes(2);
  });
});
