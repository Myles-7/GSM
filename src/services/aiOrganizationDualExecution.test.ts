import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createInitialState } from '../store/initialState';
import type { Repository } from '../types';
import type { WorkbenchProposal } from '../types/aiWorkbench';
import type { AppStoreState } from '../store/types';
import { createCategorySlice } from '../store/slices/categorySlice';
import { createClassificationSlice } from '../store/slices/classificationSlice';
const mocks = vi.hoisted(() => ({ proposals: new Map<string, WorkbenchProposal>(), sync: vi.fn(), state: {} as AppStoreState, listeners: new Set<(state: AppStoreState, previous: AppStoreState) => void>() }));
vi.mock('../store/useAppStore', () => ({ useAppStore: {
  getState: () => mocks.state,
  setState: (patch: Partial<AppStoreState>) => { const previous = mocks.state; mocks.state = { ...previous, ...patch }; mocks.listeners.forEach(listener => listener(mocks.state, previous)); },
  subscribe: (listener: (state: AppStoreState, previous: AppStoreState) => void) => { mocks.listeners.add(listener); return () => mocks.listeners.delete(listener); },
} }));
vi.mock('./autoSync', () => ({ forceSyncToBackend: mocks.sync }));
vi.mock('./repositoryChatStorage', () => ({ repositoryChatStorage: {
  getProposal: async (id: string) => structuredClone(mocks.proposals.get(id)),
  saveProposal: async (p: WorkbenchProposal) => { mocks.proposals.set(p.id, structuredClone(p)); },
  getSession: async () => ({ id: 'session', ownerId: '42' }),
  listProposals: async () => [...mocks.proposals.values()].map(p => structuredClone(p)),
} }));
import { useAppStore } from '../store/useAppStore';
import { createDualOrganizationDraft } from './aiOrganizationDual';
import { applyOrganizationProposal, editOrganizationProposal, reconcileOrganizationProposal, restoreOrganizationProposal, retryOrganizationSync } from './aiOrganizationExecution';
import { classificationMembership } from '../store/helpers/classificationSchemes';
import { continueLegacyCategoryProposal, createManualOrganizationProposal, editCategoryTree, previewCategoryApplication } from './aiOrganizationTree';
import { organizationDraftSchema } from './aiOrganizationSchema';
const date = '2026-10-06T00:00:00Z';
const repository = (id: number, patch: Partial<Repository> = {}): Repository => ({ id, name: `tool-${id}`, full_name: `fixture/tool-${id}`, description: 'A scientific tool',
  html_url: `https://github.com/fixture/tool-${id}`, stargazers_count: 1, forks: 0, forks_count: 0, language: 'Python', topics: [],
  owner: { login: 'fixture', avatar_url: '' }, created_at: date, updated_at: date, pushed_at: date,
  custom_description: 'Keep my description', custom_tags: ['personal'], category_id: null, subcategory_id: null, ...patch });
function draft(repositories = useAppStore.getState().repositories) {
  const p: WorkbenchProposal = { id: 'draft', sessionId: 'session', ownerId: '42', createdAt: date, updatedAt: date, operations: [],
    organization: createDualOrganizationDraft({ repositories, scopeName: 'all', configId: 'fixture', instruction: 'Organize' }) };
  p.organization!.status = 'ready'; p.organization!.structureReady = true;
  for (const id of ['purpose', 'technology'] as const) {
    const scheme = p.organization!.dual!.schemes[id];
    scheme.ready = true; scheme.proposedCategoryIds = [`${id}-new`, `${id}-child`];
    scheme.categories.push({ id: `${id}-new`, name: `${id} tools`, icon: 'folder', parentId: null, isNew: true }, { id: `${id}-child`, name: 'CLI', icon: 'folder', parentId: `${id}-new`, isNew: true });
    for (const entry of scheme.entries) Object.assign(entry, { categoryId: `${id}-new`, subcategoryId: `${id}-child`, disposition: 'move', reason: 'Fact-based', selected: !entry.before.locked });
  }
  p.organization!.dual!.understanding.forEach(row => { row.status = 'understood'; row.purpose = ['Science']; row.technology = ['CLI']; });
  p.organization!.categories = p.organization!.dual!.schemes.purpose.categories;
  p.organization!.entries = p.organization!.dual!.schemes.purpose.entries;
  mocks.proposals.set(p.id, structuredClone(p)); return p;
}
beforeEach(() => {
  mocks.proposals.clear(); mocks.listeners.clear(); mocks.sync.mockReset().mockResolvedValue(undefined);
  const set: Parameters<typeof createCategorySlice>[0] = update => useAppStore.setState(typeof update === 'function' ? update(mocks.state) : update);
  const get = () => mocks.state;
  mocks.state = { ...createInitialState(), ...createCategorySlice(set, get), ...createClassificationSlice(set, get), user: { id: 42, login: 'fixture' } as never, repositories: [repository(1), repository(2)], searchResults: [repository(1), repository(2)] } as unknown as AppStoreState;
});
describe('confirmed dual classification application and recovery', () => {
  it('aggregates full-library confirmation while isolating a locked and an invalid target', () => {
    useAppStore.setState({ repositories: Array.from({ length: 369 }, (_, i) => repository(i + 1)) });
    const p = draft();
    p.organization!.dual!.schemes.purpose.entries[0].subcategoryId = 'invalid';
    useAppStore.getState().repositories[1].category_locked = true;
    const preview = previewCategoryApplication(p);
    expect(preview.conflicts.filter(row => row.schemeId === 'purpose').map(row => row.repositoryId)).toEqual([1, 2]);
    expect(preview.eligible.find(row => row.schemeId === 'purpose')?.repositoryIds).toHaveLength(367);
    expect(preview.eligible.find(row => row.schemeId === 'technology')?.repositoryIds).toHaveLength(369);
    expect(useAppStore.getState().customCategories).toEqual([]);
  });
  it('publishes both schemes once and restores without changing personal data or star state', async () => {
    const p = draft(); const listener = vi.fn(); const unsubscribe = useAppStore.subscribe(listener);
    const applied = await applyOrganizationProposal(p.id, p.updatedAt); unsubscribe();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(applied.organization!.status).toBe('applied');
    for (const repo of useAppStore.getState().repositories) {
      expect(classificationMembership(repo, 'purpose').categoryId).toBe('purpose-new');
      expect(classificationMembership(repo, 'technology').categoryId).toBe('technology-new');
      expect(repo.custom_description).toBe('Keep my description'); expect(repo.custom_tags).toEqual(['personal']);
    }
    const restored = await restoreOrganizationProposal(p.id, applied.updatedAt);
    expect(restored.organization!.status).toBe('restored');
    expect(useAppStore.getState().repositories.every(repo => repo.category_id === null && repo.classifications?.technology?.categoryId === null)).toBe(true);
    expect(useAppStore.getState().customCategories).toEqual([]);
    expect(useAppStore.getState().classificationSchemes?.technology?.customCategories).toEqual([]);
  });
  it('keeps purpose locks while independently arranging technology; authorization selects a move explicitly', async () => {
    useAppStore.setState({ repositories: [repository(1, { category_id: 'devtools', category_locked: true }), repository(2)] });
    const p = draft(); expect(p.organization!.dual!.schemes.purpose.entries[0].selected).toBe(false);
    const edited = await editOrganizationProposal(p.id, p.updatedAt, { schemeId: 'purpose', repositoryId: 1, patch: { overrideLocked: true } });
    expect(edited.organization!.dual!.schemes.purpose.entries[0].selected).toBe(true);
    await applyOrganizationProposal(p.id, edited.updatedAt);
    expect(useAppStore.getState().repositories[0].category_locked).toBe(true);
    expect(useAppStore.getState().repositories[0].classifications?.technology?.locked).toBe(false);
  });
  it('skips a stale independent repository instead of overwriting it', async () => {
    const p = draft(); useAppStore.setState({ repositories: useAppStore.getState().repositories.map(repo => repo.id === 1 ? { ...repo, custom_description: 'New facts' } : repo) });
    const result = await applyOrganizationProposal(p.id, p.updatedAt);
    expect(result.organization!.dual!.schemes.purpose.entries[0].status).toBe('conflict');
    expect(useAppStore.getState().repositories[0].category_id).toBeNull();
    expect(useAppStore.getState().repositories[1].category_id).toBe('purpose-new');
  });
  it('requires latest confirmation and the same account', async () => {
    const p = draft();
    await expect(applyOrganizationProposal(p.id, 'stale')).rejects.toThrow('Draft changed');
    useAppStore.setState({ user: { id: 43 } as never });
    await expect(applyOrganizationProposal(p.id, p.updatedAt)).rejects.toThrow('account');
    expect(mocks.sync).not.toHaveBeenCalled();
  });
  it('retires a builtin only after complete coverage and restores its mapping and structure', async () => {
    useAppStore.setState({ repositories: [repository(1, { category_id: 'devtools' }), repository(2, { category_id: 'devtools' })] });
    const p = draft(); p.organization!.dual!.schemes.purpose.retireCategoryIds = ['devtools']; mocks.proposals.set(p.id, p);
    const result = await applyOrganizationProposal(p.id, p.updatedAt);
    expect(useAppStore.getState().hiddenDefaultCategoryIds).toContain('devtools');
    expect(useAppStore.getState().defaultCategoryOverrides.devtools).toMatchObject({ retired: true, mergedInto: 'purpose-new', retirementTargets: ['purpose-new'] });
    await restoreOrganizationProposal(p.id, result.updatedAt);
    expect(useAppStore.getState().defaultCategoryOverrides.devtools).toBeUndefined();
    expect(useAppStore.getState().repositories.every(repo => repo.category_id === 'devtools')).toBe(true);
  });
  it('refuses full retirement when a retained or out-of-scope member remains', async () => {
    useAppStore.setState({ repositories: [repository(1, { category_id: 'devtools' }), repository(2, { category_id: 'devtools' })] });
    const p = draft(useAppStore.getState().repositories.slice(0, 1)); p.organization!.dual!.schemes.purpose.cleanupReplaced = false; p.organization!.dual!.schemes.purpose.retireCategoryIds = ['devtools']; mocks.proposals.set(p.id, p);
    await expect(applyOrganizationProposal(p.id, p.updatedAt)).rejects.toThrow('affected repositories');
    expect(useAppStore.getState().repositories[0].category_id).toBe('devtools');
  });
  it('does not remove new categories when an unselected member moved there after application', async () => {
    const p = draft(); p.organization!.dual!.schemes.purpose.entries[1].selected = false; mocks.proposals.set(p.id, p);
    const applied = await applyOrganizationProposal(p.id, p.updatedAt);
    useAppStore.getState().assignRepositoryCategory(2, 'purpose-new');
    const restored = await restoreOrganizationProposal(p.id, applied.updatedAt);
    expect(restored.organization!.dual!.schemes.purpose.entries[0].error).toContain('Recovery paused');
    expect(useAppStore.getState().repositories[1].category_id).toBe('purpose-new');
    expect(useAppStore.getState().customCategories.some(c => c.id === 'purpose-new')).toBe(true);
  });
  it('sync retry never replays local changes and reports sync failure independently', async () => {
    mocks.sync.mockRejectedValueOnce(new Error('Offline')); const p = draft();
    const applied = await applyOrganizationProposal(p.id, p.updatedAt);
    expect(applied.organization!.status).toBe('applied'); expect(applied.syncError).toBeTruthy();
    const transaction = vi.spyOn(useAppStore.getState(), 'applyClassificationTransactions');
    const synced = await retryOrganizationSync(p.id);
    expect(synced.syncError).toBeUndefined(); expect(transaction).not.toHaveBeenCalled();
    await expect(applyOrganizationProposal(p.id, synced.updatedAt)).rejects.toThrow('review a draft');
    transaction.mockRestore();
  });
  it('reconciles a crash from durable intent without replaying a write', async () => {
    const p = draft(); const applied = await applyOrganizationProposal(p.id, p.updatedAt);
    applied.organization!.status = 'applying';
    for (const scheme of Object.values(applied.organization!.dual!.schemes)) { scheme.application!.status = 'prepared'; scheme.after = undefined; scheme.createdCategoryIds = []; scheme.entries.forEach(e => { e.status = 'pending'; }); }
    const transaction = vi.spyOn(useAppStore.getState(), 'applyClassificationTransactions');
    const reconciled = await reconcileOrganizationProposal(applied);
    expect(reconciled.organization!.status).toBe('applied'); expect(transaction).not.toHaveBeenCalled();
    expect(reconciled.organization!.dual!.schemes.technology.createdCategoryIds).toContain('technology-new');
    transaction.mockRestore();
  });
});

describe('integrated category editing without a model', () => {
  it('creates an explicitly requested empty category and child in one draft and one transaction', async () => {
    const manual = await createManualOrganizationProposal('session', '');
    const parent = await editCategoryTree(manual.id, manual.updatedAt, 'purpose', { kind: 'create', name: 'My tools' });
    const parentId = parent.organization!.dual!.schemes.purpose.structureOperations![0].targetId;
    const child = await editCategoryTree(parent.id, parent.updatedAt, 'purpose', { kind: 'create', parentId, name: 'CLI' });
    expect(useAppStore.getState().customCategories).toEqual([]);
    const listener = vi.fn(); const unsubscribe = useAppStore.subscribe(listener);
    const applied = await applyOrganizationProposal(child.id, child.updatedAt); unsubscribe();
    expect(listener).toHaveBeenCalledTimes(1); expect(applied.organization!.status).toBe('applied');
    expect(useAppStore.getState().customCategories.find(cat => cat.id === parentId)?.name).toBe('My tools');
    expect(useAppStore.getState().subcategories.some(cat => cat.parentId === parentId && cat.name === 'CLI')).toBe(true);
    expect(useAppStore.getState().repositories.every(repo => repo.category_id === null)).toBe(true);
    expect(applied.organization!.dual!.understanding.every(row => row.status === 'pending')).toBe(true);
    organizationDraftSchema.parse(applied.organization);
  });
  it('renames an existing category without changing identity, lock, lists or the other scheme', async () => {
    useAppStore.setState({ repositories: [repository(1, { category_id: 'devtools', category_locked: true })], categoryListIdMap: { devtools: 'remote-list' } });
    const manual = await createManualOrganizationProposal('session', '');
    const renamed = await editCategoryTree(manual.id, manual.updatedAt, 'purpose', { kind: 'rename', targetId: 'devtools', name: 'Development' });
    await applyOrganizationProposal(renamed.id, renamed.updatedAt);
    expect(useAppStore.getState().defaultCategoryOverrides.devtools.name).toBe('Development');
    expect(useAppStore.getState().repositories[0].category_id).toBe('devtools');
    expect(useAppStore.getState().repositories[0].category_locked).toBe(true);
    expect(useAppStore.getState().categoryListIdMap.devtools).toBe('remote-list');
    expect(useAppStore.getState().classificationSchemes?.technology?.initialized).not.toBe(true);
  });
  it('applies an independent creation, leaves a locked merge pending, then completes it without replay', async () => {
    useAppStore.setState({ customCategories: [{ id: 'writing', name: 'Writing', icon: 'folder', keywords: [], isCustom: true }, { id: 'chat', name: 'Chat', icon: 'folder', keywords: [], isCustom: true }],
      subcategories: [{ id: 'old-child', parentId: 'writing', name: 'Editing', icon: 'folder' }],
      repositories: [repository(1, { category_id: 'writing', subcategory_id: 'old-child', category_locked: true }), repository(2, { category_id: 'chat' })] });
    const manual = await createManualOrganizationProposal('session', '');
    const merged = await editCategoryTree(manual.id, manual.updatedAt, 'purpose', { kind: 'merge', sourceIds: ['writing', 'chat'], name: 'AI Apps' });
    const extra = await editCategoryTree(merged.id, merged.updatedAt, 'purpose', { kind: 'create', name: 'Independent' });
    expect(previewCategoryApplication(extra).deferred).toHaveLength(1);
    const partial = await applyOrganizationProposal(extra.id, extra.updatedAt);
    expect(partial.organization!.status).toBe('ready');
    expect(useAppStore.getState().repositories[0].category_id).toBe('writing');
    expect(useAppStore.getState().customCategories.some(cat => cat.name === 'Independent')).toBe(true);
    const authorized = await editOrganizationProposal(partial.id, partial.updatedAt, { schemeId: 'purpose', repositoryId: 1, patch: { overrideLocked: true } });
    const targetId = authorized.organization!.dual!.schemes.purpose.structureOperations!.find(op => op.kind === 'merge')!.targetId;
    const complete = await applyOrganizationProposal(authorized.id, authorized.updatedAt);
    expect(complete.organization!.status).toBe('applied');
    expect(useAppStore.getState().repositories.every(repo => repo.category_id === targetId)).toBe(true);
    expect(useAppStore.getState().subcategories.find(cat => cat.id === 'old-child')?.parentId).toBe(targetId);
    expect(useAppStore.getState().repositories[0].category_locked).toBe(true);
    expect(useAppStore.getState().customCategories.filter(cat => cat.name === 'Independent')).toHaveLength(1);
    await restoreOrganizationProposal(complete.id, complete.updatedAt);
    expect(useAppStore.getState().repositories[0].category_id).toBe('writing');
    expect(useAppStore.getState().subcategories.find(cat => cat.id === 'old-child')?.parentId).toBe('writing');
  });
  it('holds same-name subgroups until the user resolves their names, preserving subgroup IDs', async () => {
    useAppStore.setState({ customCategories: [{ id: 'a', name: 'A', icon: 'folder', keywords: [], isCustom: true }, { id: 'b', name: 'B', icon: 'folder', keywords: [], isCustom: true }],
      subcategories: [{ id: 'ga', name: 'General', parentId: 'a', icon: 'folder' }, { id: 'gb', name: 'General', parentId: 'b', icon: 'folder' }],
      repositories: [repository(1, { category_id: 'a', subcategory_id: 'ga' }), repository(2, { category_id: 'b', subcategory_id: 'gb' })] });
    const manual = await createManualOrganizationProposal('session', '');
    const merged = await editCategoryTree(manual.id, manual.updatedAt, 'purpose', { kind: 'merge', sourceIds: ['a', 'b'], name: 'Combined' });
    expect(previewCategoryApplication(merged).deferred[0].reason).toContain('Duplicate subgroup');
    const renamed = await editCategoryTree(merged.id, merged.updatedAt, 'purpose', { kind: 'rename', targetId: 'gb', name: 'B General' });
    await applyOrganizationProposal(renamed.id, renamed.updatedAt);
    expect(useAppStore.getState().subcategories.map(cat => cat.id)).toEqual(['ga', 'gb']);
    expect(useAppStore.getState().subcategories.find(cat => cat.id === 'gb')?.name).toBe('B General');
  });
  it('withdraws a merge without writing memberships or losing the old targets', async () => {
    useAppStore.setState({ repositories: [repository(1, { category_id: 'devtools' }), repository(2, { category_id: 'ai' })] });
    const manual = await createManualOrganizationProposal('session', '');
    const merged = await editCategoryTree(manual.id, manual.updatedAt, 'purpose', { kind: 'merge', sourceIds: ['devtools'], targetId: 'ai' });
    const operationId = merged.organization!.dual!.schemes.purpose.structureOperations![0].id;
    const withdrawn = await editCategoryTree(merged.id, merged.updatedAt, 'purpose', { kind: 'withdraw', operationId });
    expect(withdrawn.organization!.dual!.schemes.purpose.entries[0].categoryId).toBe('devtools');
    expect(withdrawn.organization!.dual!.schemes.purpose.structureOperations).toEqual([]);
    expect(useAppStore.getState().repositories[0].category_id).toBe('devtools');
  });
  it('accepts an explicit same-name subgroup mapping and restores both original identities', async () => {
    useAppStore.setState({ customCategories: [{ id: 'a', name: 'A', icon: 'folder', keywords: [], isCustom: true }, { id: 'b', name: 'B', icon: 'folder', keywords: [], isCustom: true }],
      subcategories: [{ id: 'ga', name: 'General', parentId: 'a', icon: 'folder' }, { id: 'gb', name: 'General', parentId: 'b', icon: 'folder' }],
      repositories: [repository(1, { category_id: 'a', subcategory_id: 'ga' }), repository(2, { category_id: 'b', subcategory_id: 'gb' })] });
    const manual = await createManualOrganizationProposal('session', '');
    const merged = await editCategoryTree(manual.id, manual.updatedAt, 'purpose', { kind: 'merge', sourceIds: ['a', 'b'], name: 'Combined' });
    const target = merged.organization!.dual!.schemes.purpose.structureOperations![0].targetId;
    const mapped = await editOrganizationProposal(merged.id, merged.updatedAt, { schemeId: 'purpose', repositoryId: 2, patch: { subcategoryId: 'ga' } });
    expect(previewCategoryApplication(mapped).deferred).toEqual([]);
    const applied = await applyOrganizationProposal(mapped.id, mapped.updatedAt);
    expect(applied.organization!.status).toBe('applied');
    expect(useAppStore.getState().subcategories).toEqual([{ id: 'ga', name: 'General', parentId: target, icon: 'folder' }]);
    expect(applied.organization!.dual!.schemes.purpose.categories.some(cat => cat.id === 'gb')).toBe(false);
    organizationDraftSchema.parse(JSON.parse(JSON.stringify(applied.organization)));
    const interrupted = structuredClone(mapped); interrupted.organization!.status = 'applying';
    interrupted.organization!.dual!.schemes.purpose.application = structuredClone(applied.organization!.dual!.schemes.purpose.application);
    interrupted.organization!.dual!.schemes.purpose.application!.status = 'prepared';
    mocks.proposals.set(interrupted.id, structuredClone(interrupted));
    const transaction = vi.spyOn(useAppStore.getState(), 'applyClassificationTransactions');
    const reconciled = await reconcileOrganizationProposal(interrupted);
    expect(transaction).not.toHaveBeenCalled(); transaction.mockRestore();
    expect(reconciled.organization!.status).toBe('applied');
    organizationDraftSchema.parse(reconciled.organization);
    await restoreOrganizationProposal(reconciled.id, reconciled.updatedAt);
    expect(useAppStore.getState().subcategories.map(cat => cat.id)).toEqual(['ga', 'gb']);
    expect(useAppStore.getState().repositories[1].subcategory_id).toBe('gb');
  });
  it('defers the entire merge if a target-category subgroup change is deselected', async () => {
    useAppStore.setState({ customCategories: [{ id: 'a', name: 'A', icon: 'folder', keywords: [], isCustom: true }, { id: 'b', name: 'B', icon: 'folder', keywords: [], isCustom: true }],
      subcategories: [{ id: 'ga', name: 'General', parentId: 'a', icon: 'folder' }],
      repositories: [repository(1, { category_id: 'a', subcategory_id: 'ga' }), repository(2, { category_id: 'b' })] });
    const manual = await createManualOrganizationProposal('session', '');
    const merged = await editCategoryTree(manual.id, manual.updatedAt, 'purpose', { kind: 'merge', sourceIds: ['b'], targetId: 'a' });
    const mapped = await editOrganizationProposal(merged.id, merged.updatedAt, { schemeId: 'purpose', repositoryId: 1, patch: { subcategoryId: null, selected: false } });
    const deselected = await editOrganizationProposal(mapped.id, mapped.updatedAt, { schemeId: 'purpose', repositoryId: 1, patch: { selected: false } });
    expect(previewCategoryApplication(deselected).deferred).toHaveLength(1);
    expect(previewCategoryApplication(deselected).transactions).toEqual([]);
  });
  it('continues legacy pending changes in a new revision, omitting successful writes and reporting stale merges', async () => {
    useAppStore.setState({ customCategories: [{ id: 'a', name: 'A', icon: 'folder', keywords: [], isCustom: true }, { id: 'b', name: 'B', icon: 'folder', keywords: [], isCustom: true }] });
    const original = await createManualOrganizationProposal('session', '');
    const before = original.organization!.dual!.schemes.purpose.before;
    delete original.organization!.dual; original.organization!.version = 2;
    original.organization!.structureOperations = [
      { id: 'rename-pending', kind: 'rename', targetId: 'devtools', sourceIds: [], name: 'Development', icon: 'folder', keywords: [], reason: 'Manual', selected: true, status: 'pending', members: [], before },
      { id: 'rename-completed', kind: 'rename', targetId: 'ai', sourceIds: [], name: 'Already applied', icon: 'folder', keywords: [], reason: 'Manual', selected: true, status: 'success', members: [], before },
      { id: 'merge-stale', kind: 'merge', targetId: 'a', sourceIds: ['b'], name: 'A', icon: 'folder', keywords: [], reason: 'Manual', selected: true, status: 'pending', members: [{ repositoryId: 1, before: { categoryId: 'b', subcategoryId: null, locked: false } }], before },
    ];
    organizationDraftSchema.parse(original.organization); mocks.proposals.set(original.id, structuredClone(original));
    const next = await continueLegacyCategoryProposal(original.id, original.updatedAt, '');
    expect(next.sessionId).toBe(original.sessionId); expect(next.id).not.toBe(original.id);
    expect(next.organization!.revision).toBe(original.organization!.revision + 1);
    expect(next.organization!.dual!.schemes.purpose.structureOperations?.map(op => op.name)).toEqual(['Development']);
    expect(next.organization!.dual!.errors[0]).toMatchObject({ stage: 'legacy', repositoryIds: [1] });
    expect(mocks.proposals.get(original.id)).toEqual(original);
    expect(useAppStore.getState().defaultCategoryOverrides).toEqual({});
    expect(organizationDraftSchema.parse(JSON.parse(JSON.stringify(next.organization))).dual!.schemes.purpose.structureOperations).toHaveLength(1);
  });
  it('writes a technology category without changing the purpose projection', async () => {
    const manual = await createManualOrganizationProposal('session', '');
    const next = await editCategoryTree(manual.id, manual.updatedAt, 'technology', { kind: 'create', name: 'Rust' });
    await applyOrganizationProposal(next.id, next.updatedAt);
    expect(useAppStore.getState().classificationSchemes?.technology?.customCategories.some(cat => cat.name === 'Rust')).toBe(true);
    expect(useAppStore.getState().customCategories).toEqual([]);
  });
  it('withdraws merge-dependent edits while retaining the preceding independent rename', async () => {
    const manual = await createManualOrganizationProposal('session', '');
    const renamed = await editCategoryTree(manual.id, manual.updatedAt, 'purpose', { kind: 'rename', targetId: 'devtools', name: 'My Developer Tools' });
    const merged = await editCategoryTree(renamed.id, renamed.updatedAt, 'purpose', { kind: 'merge', sourceIds: ['devtools'], targetId: 'ai' });
    const added = await editCategoryTree(merged.id, merged.updatedAt, 'purpose', { kind: 'create', parentId: 'ai', name: 'Temporary Group' });
    const operationId = added.organization!.dual!.schemes.purpose.structureOperations!.find(op => op.kind === 'merge')!.id;
    const withdrawn = await editCategoryTree(added.id, added.updatedAt, 'purpose', { kind: 'withdraw', operationId });
    expect(withdrawn.organization!.dual!.schemes.purpose.structureOperations?.map(op => op.kind)).toEqual(['rename']);
    expect(withdrawn.organization!.dual!.schemes.purpose.categories.some(cat => cat.name === 'Temporary Group')).toBe(false);
    await applyOrganizationProposal(withdrawn.id, withdrawn.updatedAt);
    expect(useAppStore.getState().defaultCategoryOverrides.devtools.name).toBe('My Developer Tools');
  });
});
