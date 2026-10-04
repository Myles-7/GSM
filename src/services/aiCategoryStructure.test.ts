import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppStoreState } from '../store/types';
import type { Category, Repository } from '../types';
import type { WorkbenchProposal } from '../types/aiWorkbench';
import { createInitialState } from '../store/initialState';
import { organizationTransaction } from '../store/helpers/aiOrganizationTransaction';
import { organizationCategories, repositoryCategorySuggestions } from '../store/helpers/repositoryOrganization';
const mocks = vi.hoisted(() => ({ state: {} as AppStoreState, proposals: new Map<string, WorkbenchProposal>(), sync: vi.fn(), generate: vi.fn(), writes: 0 }));
vi.mock('../store/useAppStore', () => ({ useAppStore: { getState: () => mocks.state } }));
vi.mock('./autoSync', () => ({ forceSyncToBackend: mocks.sync }));
vi.mock('./aiService', () => ({ AIService: class { generateChatText = mocks.generate; } }));
vi.mock('./repositoryChatStorage', () => ({ repositoryChatStorage: {
  getProposal: async (id: string) => structuredClone(mocks.proposals.get(id) ?? null),
  listProposals: async () => [...mocks.proposals.values()].map(p => structuredClone(p)),
  getSession: async () => ({ id: 'session', ownerId: '7' }),
  saveProposal: async (p: WorkbenchProposal) => { mocks.proposals.set(p.id, structuredClone(p)); },
  saveSession: async () => {}, saveMessage: async () => {},
} }));
import { acceptOriginalStructureGroup, applyCategoryStructure, buildStructureChange, editCategoryStructure, migrateStructureSelection, proposeCategoryStructure, reconcileCategoryStructure, restoreCategoryStructure, runStructureGeneration } from './aiCategoryStructure';
import { editOrganizationProposal, retryOrganizationSync } from './aiOrganizationExecution';
import { organizationDraftSchema } from './aiOrganizationSchema';
const category = (id: string, name: string): Category => ({ id, name, icon: 'folder', keywords: [id], isCustom: true });
const repo = (id: number, categoryId: string, subgroup: string | null = null) => ({ id, full_name: `fixture/repo-${id}`, name: `repo-${id}`, description: 'Developer CLI', topics: ['cli'], category_id: categoryId, subcategory_id: subgroup, custom_description: 'Keep this', custom_tags: ['personal'] } as Repository);
beforeEach(() => {
  mocks.proposals.clear(); mocks.sync.mockReset().mockResolvedValue(undefined); mocks.generate.mockReset(); mocks.writes = 0;
  mocks.state = { ...createInitialState(), user: { id: 7, login: 'fixture', name: 'Fixture', avatar_url: '', email: null }, customCategories: [category('source', 'Source'), category('target', 'Target')],
    repositories: [repo(1, 'source', 'source-group'), repo(2, 'target')], repositoryOrder: [1, 2],
    subcategories: [{ id: 'source-group', name: 'Original group', icon: 'folder', parentId: 'source' }], subcategoryOrder: ['source-group'], categoryListIdMap: { source: 'source-list', target: 'target-list' },
    applyAIOrganization: (input: Parameters<AppStoreState['applyAIOrganization']>[0]) => { Object.assign(mocks.state, organizationTransaction(mocks.state, input)); mocks.writes++; },
  } as unknown as AppStoreState;
});
const propose = (suggestions: Parameters<typeof proposeCategoryStructure>[0]['suggestions']) => proposeCategoryStructure({ sessionId: 'session', configId: 'manual', instruction: 'Organize structure', suggestions });
async function merge(sourceIds = ['source']) {
  let p = await propose([{ kind: 'merge', sourceIds, targetId: 'target', name: 'Target' }]);
  for (const e of p.organization!.entries) {
    p = await editOrganizationProposal(p.id, p.updatedAt, { repositoryId: e.repositoryId, patch: { categoryId: 'target', subcategoryId: null } });
  }
  return p;
}
describe('reviewed category structure transactions', () => {
  it('preserves manual merge destinations during refinement while re-evaluating other members', async () => {
    let p = await proposeCategoryStructure({ sessionId: 'session', configId: 'manual', instruction: 'Merge tools', aiGenerated: true,
      suggestions: [{ kind: 'merge', sourceIds: ['source'], targetId: 'target', name: 'Target' }] });
    p = await editOrganizationProposal(p.id, p.updatedAt, { repositoryId: 1, patch: { categoryId: 'target', subcategoryId: null } });
    expect(p.organization?.structureOperations?.[0].manual).toBe(false);
    const next = await proposeCategoryStructure({ sessionId: 'session', configId: 'manual', instruction: 'Refine groups', previous: p,
      suggestions: [], preservePrevious: true, preserveManualOnly: true, aiGenerated: true });
    expect(next.organization?.structureOperations).toHaveLength(1);
    expect(next.organization?.entries[0]).toMatchObject({ categoryId: 'target', manual: true });
    expect(next.organization?.entries[1]).toMatchObject({ manual: false, disposition: 'insufficient', reason: '' });
    expect(next.organization?.batches[0].status).toBe('pending');
    expect(mocks.writes).toBe(0);
  });
  it('AI can propose an empty main category without applying it or marking it already applied', async () => {
    mocks.state.aiConfigs = [{ id: 'model', name: 'Fixture', model: 'fixture', apiKey: 'fixture', baseUrl: 'https://fixture.invalid', isActive: true }];
    mocks.generate.mockResolvedValue('{"operations":[{"kind":"create","name":"New domain"}]}');
    await runStructureGeneration({ sessionId: 'session', configId: 'model', instruction: 'Create a better top-level category' });
    const proposal = [...mocks.proposals.values()][0];
    expect(mocks.proposals.size).toBe(1);
    expect(proposal.organization).toMatchObject({ status: 'ready', entries: [], structureOperations: [{ kind: 'create', status: 'pending', manual: false }] });
    expect(mocks.writes).toBe(0); expect(mocks.state.customCategories).toHaveLength(2);
  });
  it('keeps a reviewable interrupted draft on model failure and retries its structure stage', async () => {
    mocks.state.aiConfigs = [{ id: 'model', name: 'Fixture', model: 'fixture', apiKey: 'fixture', baseUrl: 'https://fixture.invalid', isActive: true }];
    mocks.generate.mockRejectedValueOnce(new Error('429 rate limit')).mockResolvedValue('{"operations":[]}');
    await expect(runStructureGeneration({ sessionId: 'session', configId: 'model', instruction: 'Organize categories' })).rejects.toThrow('429');
    const p = [...mocks.proposals.values()][0]; expect(p.organization).toMatchObject({ status: 'interrupted', structureReady: false });
    await runStructureGeneration({ sessionId: 'session', configId: 'model', instruction: 'Organize categories', previous: p, retryOnly: true });
    expect([...mocks.proposals.values()][0].organization?.status).toBe('ready'); expect(mocks.writes).toBe(0);
  });
  it('creates an empty main category only after explicit apply and restores it', async () => {
    const p = await propose([{ kind: 'create', name: 'New empty category' }]);
    const op = p.organization!.structureOperations![0];
    expect(mocks.state.customCategories).toHaveLength(2);
    expect(p.organization!.entries).toEqual([]);
    const applied = await applyCategoryStructure(p.id, p.updatedAt, op.id);
    expect(mocks.state.customCategories.find(c => c.id === op.targetId)?.name).toBe('New empty category');
    expect(mocks.writes).toBe(1);
    await restoreCategoryStructure(p.id, applied.updatedAt, op.id);
    expect(mocks.state.customCategories).toHaveLength(2);
  });
  it('renames without changing stable membership, lock, description or list binding', async () => {
    mocks.state.repositories[0].category_locked = true;
    const p = await propose([{ kind: 'rename', targetId: 'source', name: 'Renamed' }]);
    const applied = await applyCategoryStructure(p.id, p.updatedAt, p.organization!.structureOperations![0].id);
    expect(mocks.state.repositories[0]).toMatchObject({ category_id: 'source', subcategory_id: 'source-group', category_locked: true, custom_category: 'Renamed', custom_description: 'Keep this', custom_tags: ['personal'] });
    expect(mocks.state.categoryListIdMap.source).toBe('source-list');
    expect(applied.organization?.structureOperations?.[0].status).toBe('success');
  });
  it('rejects duplicate names and dependent or cyclic merge plans', async () => {
    await expect(propose([{ kind: 'create', name: 'Target' }])).rejects.toThrow('Duplicate category');
    await expect(propose([{ kind: 'merge', sourceIds: ['source'], targetId: 'target', name: 'Target' }, { kind: 'merge', sourceIds: ['target'], targetId: 'source', name: 'Source' }])).rejects.toThrow();
    expect(mocks.writes).toBe(0);
  });
  it('includes source and target members and blocks unresolved second-level redesign', async () => {
    const p = await propose([{ kind: 'merge', sourceIds: ['source'], targetId: 'target', name: 'Target' }]);
    expect(p.organization?.scope.repositoryIds).toEqual([1, 2]);
    expect(() => buildStructureChange(p, p.organization!.structureOperations![0].id)).toThrow('Resolve');
    expect(mocks.writes).toBe(0);
  });
  it('requires individual locked authorization and leaves lock intact after merge', async () => {
    mocks.state.repositories[0].category_locked = true;
    let p = await merge(); const op = p.organization!.structureOperations![0];
    expect(() => buildStructureChange(p, op.id)).toThrow();
    p = await editOrganizationProposal(p.id, p.updatedAt, { repositoryId: 1, patch: { overrideLocked: true, selected: true } });
    await applyCategoryStructure(p.id, p.updatedAt, op.id);
    expect(mocks.state.repositories[0]).toMatchObject({ category_id: 'target', category_locked: true });
    expect(mocks.state.customCategories.map(c => c.id)).toEqual(['target']);
  });
  it('blocks the entire merge if a member outside page filters is added', async () => {
    const p = await merge(); mocks.state.repositories.push(repo(3, 'source'));
    await expect(applyCategoryStructure(p.id, p.updatedAt, p.organization!.structureOperations![0].id)).rejects.toThrow('membership changed');
    expect(mocks.writes).toBe(0);
    expect(mocks.state.repositories[0].category_id).toBe('source');
  });
  it('merges multiple sources atomically, removes replaced empty subgroups and restores definitions', async () => {
    mocks.state.customCategories.push(category('other', 'Other')); mocks.state.repositories.push(repo(3, 'other'));
    const p = await merge(['source', 'other']); const op = p.organization!.structureOperations![0];
    const applied = await applyCategoryStructure(p.id, p.updatedAt, op.id);
    expect(mocks.writes).toBe(1); expect(mocks.state.subcategories).toEqual([]);
    expect(mocks.state.customCategories.map(c => c.id)).toEqual(['target']);
    expect(mocks.state.categoryListIdMap).toEqual({ target: 'target-list' });
    await restoreCategoryStructure(p.id, applied.updatedAt, op.id);
    expect(mocks.state.repositories.map(r => r.category_id)).toEqual(['source', 'target', 'other']);
    expect(mocks.state.subcategories[0].id).toBe('source-group');
    expect(mocks.state.categoryListIdMap.source).toBe('source-list');
  });
  it('hides built-in sources and persists retirement so later suggestions exclude them', async () => {
    mocks.state.repositories[0].category_id = 'devtools'; mocks.state.repositories[0].subcategory_id = null;
    const p = await merge(['devtools']); const op = p.organization!.structureOperations![0];
    await applyCategoryStructure(p.id, p.updatedAt, op.id);
    expect(mocks.state.hiddenDefaultCategoryIds).toContain('devtools');
    expect(mocks.state.defaultCategoryOverrides.devtools.mergedInto).toBe('target');
    const categories = organizationCategories(mocks.state);
    expect(categories.find(c => c.id === 'devtools')?.mergedInto).toBe('target');
    expect(repositoryCategorySuggestions(mocks.state.repositories[0], categories)).not.toContain('devtools');
  });
  it('separates local success from sync failure and sync retry never replays writes', async () => {
    mocks.sync.mockRejectedValueOnce(new Error('offline'));
    const p = await merge(); const applied = await applyCategoryStructure(p.id, p.updatedAt, p.organization!.structureOperations![0].id);
    expect(applied.syncError).toBeTruthy(); expect(mocks.writes).toBe(1);
    await retryOrganizationSync(p.id); expect(mocks.writes).toBe(1);
  });
  it('refuses restore after later membership or structure edits without reverting anything', async () => {
    const p = await merge(); const op = p.organization!.structureOperations![0];
    const applied = await applyCategoryStructure(p.id, p.updatedAt, op.id);
    mocks.state.repositories[0].category_locked = true;
    await expect(restoreCategoryStructure(p.id, applied.updatedAt, op.id)).rejects.toThrow('membership changed');
    expect(mocks.writes).toBe(1);
    mocks.state.repositories[0].category_locked = false; mocks.state.customCategories[0].name = 'Later edit';
    await expect(restoreCategoryStructure(p.id, applied.updatedAt, op.id)).rejects.toThrow('structure');
    expect(mocks.state.customCategories[0].name).toBe('Later edit');
  });
  it('allows explicit original grouping mapping without inventing repository evidence', async () => {
    const p = await propose([{ kind: 'merge', sourceIds: ['source'], targetId: 'target', name: 'Target' }]);
    const resolved = await acceptOriginalStructureGroup(p.id, p.updatedAt, 1);
    const entry = resolved.organization!.entries[0];
    expect(entry).toMatchObject({ manual: true, disposition: 'move', categoryId: 'target' });
    expect(resolved.organization!.categories.find(c => c.id === entry.subcategoryId)).toMatchObject({ name: 'Original group', parentId: 'target', isNew: true });
  });
  it('partial migration creates an ordinary assignment record and preserves source structure', async () => {
    let p = await merge();
    p = await editOrganizationProposal(p.id, p.updatedAt, { repositoryId: 2, patch: { selected: false } });
    const migrated = await migrateStructureSelection(p.id, p.updatedAt);
    expect(migrated.organization?.purpose).toBe('repositories');
    expect(mocks.state.customCategories.map(c => c.id)).toEqual(['source', 'target']);
    expect(mocks.state.subcategories).toHaveLength(1);
  });
  it('reconciles an interrupted structure journal without replaying writes', async () => {
    const p = await merge(); const op = p.organization!.structureOperations![0];
    const applied = await applyCategoryStructure(p.id, p.updatedAt, op.id);
    applied.organization!.status = 'applying'; applied.organization!.structureOperations![0].status = 'pending';
    const reconciled = await reconcileCategoryStructure(applied);
    expect(reconciled.organization?.structureOperations?.[0].status).toBe('success'); expect(mocks.writes).toBe(1);
  });
  it('rejects stale confirmation, wrong account and invalid versioned structure', async () => {
    let p = await propose([{ kind: 'create', name: 'New' }]); const op = p.organization!.structureOperations![0];
    p = await editCategoryStructure(p.id, p.updatedAt, op.id, { name: 'Adjusted' });
    await expect(applyCategoryStructure(p.id, 'stale', op.id)).rejects.toThrow('Draft changed');
    mocks.state.user = { id: 8 } as AppStoreState['user'];
    await expect(applyCategoryStructure(p.id, p.updatedAt, op.id)).rejects.toThrow('account');
    expect(organizationDraftSchema.safeParse({ ...p.organization, version: 1 }).success).toBe(false);
  });
});
