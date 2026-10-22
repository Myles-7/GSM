import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ snapshot: vi.fn(), begin: vi.fn(), error: vi.fn(), finish: vi.fn() }));
vi.mock('./aiTaskJournal', () => ({
  aiTaskJournal: { snapshot: mocks.snapshot, begin: mocks.begin }, taskError: (error: unknown) => String(error),
}));
import { retainPageTaskFailure } from './pageTaskFailure';
beforeEach(() => { vi.clearAllMocks(); mocks.snapshot.mockReturnValue([]); mocks.begin.mockReturnValue({ error: mocks.error, finish: mocks.finish }); });
describe('business page failure records', () => {
  it('retains a failed operation with its destination in task records', () => {
    const metadata = { target: { view: 'repositories', id: 'classification' } };
    retainPageTaskFailure('42', 'organization', 'sync failure', metadata);
    expect(mocks.begin).toHaveBeenCalledWith('42', 'organization', [], undefined, undefined, metadata);
    expect(mocks.error).toHaveBeenCalledWith('sync failure');
    expect(mocks.finish).toHaveBeenCalledWith('failed');
  });
  it('deduplicates only the same account and destination and ignores missing owners', () => {
    mocks.snapshot.mockReturnValue([{ owner: '42', kind: 'organization', error: 'sync failure', target: { view: 'repositories' } }]);
    retainPageTaskFailure('', 'organization', 'sync failure', {});
    retainPageTaskFailure('42', 'organization', 'sync failure', { target: { view: 'repositories' } });
    expect(mocks.begin).not.toHaveBeenCalled();
    retainPageTaskFailure('99', 'organization', 'sync failure', { target: { view: 'repositories' } });
    expect(mocks.begin).toHaveBeenCalledOnce();
  });
});
