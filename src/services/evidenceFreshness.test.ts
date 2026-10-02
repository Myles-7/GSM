import { describe, expect, it, vi } from 'vitest';
import { checkEvidenceFreshness } from './evidenceFreshness';
import type { ToolEvidence } from '../types/repositoryChat';
const source = (id: string, patch: Partial<ToolEvidence> = {}): ToolEvidence => ({ id, source: 'github',
  repoFullName: 'a/b', path: 'README.md', url: 'https://github.com/a/b/blob/old/README.md', refSha: 'old',
  excerpt: 'old fact', retrievedAt: '', ...patch });
describe('historical evidence freshness', () => {
  it('checks each repository once and never modifies historical evidence', async () => {
    const head = vi.fn().mockResolvedValue('new'), update = vi.fn();
    const items = [source('1'), source('2', { refSha: 'new' })];
    await checkEvidenceFreshness(items, { head }, new AbortController().signal, update);
    expect(head).toHaveBeenCalledOnce();
    expect(update.mock.calls).toEqual([['1', 'changed'], ['2', 'current']]);
    expect(items[0].refSha).toBe('old');
  });
  it('requires rebinding local evidence and compares hashes after authorization', async () => {
    const items = [source('local', { source: 'local', contentHash: 'old' })], update = vi.fn();
    await checkEvidenceFreshness(items, { head: vi.fn() }, new AbortController().signal, update);
    expect(update).toHaveBeenLastCalledWith('local', 'rebind');
    await checkEvidenceFreshness(items, { head: vi.fn(), local: async () => 'new' }, new AbortController().signal, update);
    expect(update).toHaveBeenLastCalledWith('local', 'changed');
  });
  it('does not call failed reads current or publish late canceled checks', async () => {
    const update = vi.fn(), controller = new AbortController();
    await checkEvidenceFreshness([source('1')], { head: async () => { throw Error('offline'); } }, controller.signal, update);
    expect(update).toHaveBeenCalledWith('1', 'unknown');
    update.mockClear();
    await expect(checkEvidenceFreshness([source('1')], { head: async () => { controller.abort(); return 'old'; } }, controller.signal, update)).rejects.toMatchObject({ name: 'AbortError' });
    expect(update).not.toHaveBeenCalled();
  });
});
