import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppStoreState } from '../store/types';
import type { Repository } from '../types';
import type { WorkbenchProposal } from '../types/aiWorkbench';
import { createInitialState } from '../store/initialState';
import { organizationTransaction } from '../store/helpers/aiOrganizationTransaction';
const mocks = vi.hoisted(() => ({ state: {} as AppStoreState, proposals: new Map<string, WorkbenchProposal>(), sync: vi.fn(), writes: 0 }));
vi.mock('../store/useAppStore', () => ({ useAppStore: { getState: () => mocks.state } }));
vi.mock('./autoSync', () => ({ forceSyncToBackend: mocks.sync }));
vi.mock('./repositoryChatStorage', () => ({ repositoryChatStorage: {
  getProposal: async (id: string) => structuredClone(mocks.proposals.get(id) ?? null),
  listProposals: async () => [...mocks.proposals.values()].map(p => structuredClone(p)),
  getSession: async () => ({ id: 'session', ownerId: '7' }),
  saveProposal: async (proposal: WorkbenchProposal) => { mocks.proposals.set(proposal.id, structuredClone(proposal)); },
} }));
import { applyOrganizationProposal, editOrganizationProposal, reconcileOrganizationProposal, restoreOrganizationProposal, retryOrganizationSync } from './aiOrganizationExecution';

const date = '2026-09-28T00:00:00.000Z';
const repo = (id: number): Repository => ({ id, name: `repo-${id}`, full_name: `fixture/repo-${id}`, description: '', html_url: '', stargazers_count: 1, forks: 0, forks_count: 0, language: null, topics: [], created_at: date, updated_at: date, pushed_at: date, owner: { login: 'fixture', avatar_url: '' }, category_id: null, subcategory_id: null, custom_description: 'Personal', custom_tags: ['mine'] });
function fixture(): WorkbenchProposal {
  return { id: 'proposal', ownerId: '7', sessionId: 'session', createdAt: date, updatedAt: date, operations: [], organization: {
    version: 1, revision: 1, configId: 'model', maxNewSubcategories: 6, structureReady: true,
    scope: { name: 'pending', repositoryIds: [1, 2] }, instruction: 'Organize', status: 'ready', createdCategoryIds: [],
    categories: [{ id: 'new-main', name: 'Tools', parentId: null, icon: 'folder', isNew: true }, { id: 'new-child', name: 'CLI', parentId: 'new-main', icon: 'folder', isNew: true }, { id: 'unused', name: 'Unused', parentId: null, icon: 'folder', isNew: true }],
    entries: [1, 2].map(id => ({ repositoryId: id, before: { categoryId: null, subcategoryId: null, locked: false }, categoryId: 'new-main', subcategoryId: 'new-child', reason: 'CLI tool', disposition: 'move', selected: true, overrideLocked: false, manual: false, status: 'pending' })),
    batches: [{ repositoryIds: [1, 2], status: 'complete' }],
  } };
}
beforeEach(() => {
  mocks.proposals.clear(); mocks.proposals.set('proposal', fixture()); mocks.sync.mockReset().mockResolvedValue(undefined); mocks.writes = 0;
  mocks.state = { ...createInitialState(), user: { id: 7, login: 'fixture' }, repositories: [repo(1), repo(2)],
    applyAIOrganization: input => { const patch = organizationTransaction(mocks.state, input); Object.assign(mocks.state, patch); mocks.writes++; },
  } as AppStoreState;
});
describe('organization apply and restore safety', () => {
  it('creates only referenced categories and applies in one write, preserving personal metadata', async () => {
    const result = await applyOrganizationProposal('proposal', date);
    expect(mocks.writes).toBe(1);
    expect(mocks.state.customCategories.map(c => c.id)).toEqual(['new-main']);
    expect(mocks.state.subcategories.map(c => c.id)).toEqual(['new-child']);
    expect(mocks.state.repositories[0]).toMatchObject({ category_id: 'new-main', subcategory_id: 'new-child', custom_description: 'Personal', custom_tags: ['mine'] });
    expect(result.organization?.entries.every(e => e.status === 'success')).toBe(true);
    await expect(applyOrganizationProposal('proposal', result.updatedAt)).rejects.toThrow('Generate a new draft');
    expect(mocks.writes).toBe(1);
  });
  it('supports staged apply for successive batches sharing newly created categories', async () => {
    const p1 = await applyOrganizationProposal('proposal', date, undefined, [1]);
    expect(p1.organization?.entries.find(e => e.repositoryId === 1)?.status).toBe('success');
    expect(p1.organization?.entries.find(e => e.repositoryId === 2)?.status).toBe('pending');
    expect(mocks.state.customCategories.map(c => c.id)).toEqual(['new-main']);

    const p2 = await applyOrganizationProposal('proposal', p1.updatedAt, undefined, [2]);
    expect(p2.organization?.entries.find(e => e.repositoryId === 2)?.status).toBe('success');
  });
  it('skips stale membership without hiding successful independent assignments', async () => {
    mocks.state.repositories[0].category_locked = true;
    const result = await applyOrganizationProposal('proposal', date);
    expect(result.organization?.entries.map(e => e.status)).toEqual(['conflict', 'success']);
    expect(mocks.state.repositories[0].category_id).toBeNull();
  });
  it('does not create any category for deselected suggestions', async () => {
    mocks.proposals.get('proposal')!.organization!.entries.forEach(e => { e.selected = false; });
    await applyOrganizationProposal('proposal', date);
    expect(mocks.state.customCategories).toEqual([]);
  });
  it('requires explicit lock override and preserves the lock after apply', async () => {
    mocks.state.repositories[0].category_locked = true;
    mocks.proposals.get('proposal')!.organization!.entries[0].before.locked = true;
    const p = await editOrganizationProposal('proposal', date, { repositoryId: 1, patch: { overrideLocked: true, selected: true } });
    await applyOrganizationProposal('proposal', p.updatedAt);
    expect(mocks.state.repositories[0]).toMatchObject({ category_id: 'new-main', category_locked: true });
  });
  it('refuses old revisions, stale confirmations and foreign accounts', async () => {
    const next = fixture(); next.id = 'next'; next.organization!.revision = 2; mocks.proposals.set('next', next);
    await expect(applyOrganizationProposal('proposal', date)).rejects.toThrow('latest');
    mocks.proposals.delete('next');
    await expect(applyOrganizationProposal('proposal', 'old')).rejects.toThrow('Draft changed');
    mocks.state.user!.id = 8;
    await expect(applyOrganizationProposal('proposal', date)).rejects.toThrow('account');
    expect(mocks.writes).toBe(0);
  });
  it('separates sync failure; retry never replays data writes', async () => {
    mocks.sync.mockRejectedValueOnce(new Error('offline'));
    const p = await applyOrganizationProposal('proposal', date);
    expect(p.syncError).toBeTruthy(); expect(p.organization?.status).toBe('applied');
    const retried = await retryOrganizationSync('proposal');
    expect(retried.syncError).toBeUndefined(); expect(mocks.writes).toBe(1);
  });
  it('restores compatible membership and removes unchanged empty created categories', async () => {
    const applied = await applyOrganizationProposal('proposal', date);
    mocks.state.repositories[0].custom_description = 'Changed independently';
    const restored = await restoreOrganizationProposal('proposal', applied.updatedAt);
    expect(restored.organization?.entries.every(e => e.status === 'restored')).toBe(true);
    expect(mocks.state.customCategories).toEqual([]); expect(mocks.state.subcategories).toEqual([]);
    expect(mocks.state.repositories[0]).toMatchObject({ category_id: null, custom_description: 'Changed independently' });
  });
  it('does not delete a renamed category or overwrite a later repository move during restore', async () => {
    const applied = await applyOrganizationProposal('proposal', date);
    mocks.state.customCategories[0].name = 'Renamed';
    mocks.state.repositories[0].subcategory_id = null;
    const restored = await restoreOrganizationProposal('proposal', applied.updatedAt);
    expect(restored.organization?.entries[0].status).toBe('conflict');
    expect(mocks.state.customCategories[0].name).toBe('Renamed');
  });
  it('keeps a created category that the user subsequently hid', async () => {
    const applied = await applyOrganizationProposal('proposal', date);
    mocks.state.customCategories[0].isHidden = true;
    await restoreOrganizationProposal('proposal', applied.updatedAt);
    expect(mocks.state.customCategories[0]).toMatchObject({ id: 'new-main', isHidden: true });
  });
  it('reconciles interrupted write journals without writing data', async () => {
    const applied = await applyOrganizationProposal('proposal', date);
    applied.organization!.status = 'applying';
    applied.organization!.entries.forEach(e => { e.status = 'pending'; });
    const result = await reconcileOrganizationProposal(applied);
    expect(result.organization?.entries.every(e => e.status === 'success')).toBe(true);
    expect(mocks.writes).toBe(1);
  });
  it('rejects invalid parent membership atomically and stopped requests write nothing', async () => {
    const p = mocks.proposals.get('proposal')!; p.organization!.entries[0].subcategoryId = 'missing';
    await expect(applyOrganizationProposal('proposal', date)).rejects.toThrow();
    mocks.proposals.set('proposal', fixture());
    const controller = new AbortController(); controller.abort();
    await expect(applyOrganizationProposal('proposal', date, controller.signal)).rejects.toThrow();
    expect(mocks.writes).toBe(0);
  });
  it('rolls back uncommitted additions from createdCategoryIds when apply throws, allowing retry', async () => {
    const originalApply = (mocks.state as any).applyAIOrganization;
    let failOnce = true;
    (mocks.state as any).applyAIOrganization = (input: any) => {
      if (failOnce) {
        failOnce = false;
        throw new Error('Simulated store write failure');
      }
      return originalApply(input);
    };

    const failed = await applyOrganizationProposal('proposal', date);
    expect(failed.organization?.status).toBe('interrupted');
    expect(failed.organization?.createdCategoryIds).toEqual([]);
    expect(failed.organization?.entries[0].status).toBe('conflict');

    failed.organization!.entries.forEach(e => { e.status = 'pending'; e.selected = true; delete e.error; });
    await mocks.proposals.set(failed.id, structuredClone(failed));

    const retried = await applyOrganizationProposal('proposal', failed.updatedAt);
    expect(retried.organization?.status).toBe('applied');
    expect(retried.organization?.entries.every(e => e.status === 'success')).toBe(true);
    expect(mocks.state.customCategories.map(c => c.id)).toEqual(['new-main']);

    (mocks.state as any).applyAIOrganization = originalApply;
  });
});

