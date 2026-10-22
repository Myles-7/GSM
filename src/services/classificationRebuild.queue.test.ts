import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Repository } from '../types';
import type { AppStoreSet, AppStoreState } from '../store/types';
import { createInitialState } from '../store/initialState';
import { createClassificationSlice } from '../store/slices/classificationSlice';

const mocks = vi.hoisted(() => ({ state: {} as AppStoreState, sync: vi.fn() }));
const setState: AppStoreSet = update => { const patch = typeof update === 'function' ? update(mocks.state) : update; mocks.state = { ...mocks.state, ...patch }; };
vi.mock('../store/useAppStore', () => ({ useAppStore: { getState: () => mocks.state, setState: (update: Parameters<AppStoreSet>[0]) => { const patch = typeof update === 'function' ? update(mocks.state) : update; mocks.state = { ...mocks.state, ...patch }; } } }));
vi.mock('./classificationSync', () => ({ syncAIClassification: mocks.sync }));
const repo = (id: number, summary = 'CLI developer tool'): Repository => ({ id, name: `project-${id}`, full_name: `owner/project-${id}`, description: null, html_url: `https://github.com/owner/project-${id}`, stargazers_count: 0, forks_count: 0, forks: 0, language: 'TypeScript', created_at: '2026-01-01', updated_at: '2026-01-01', pushed_at: '2026-01-01', owner: { login: 'owner', avatar_url: '' }, topics: [], ai_summary: summary });
function fixture(repositories = [repo(1)]) {
  const initial = { ...createInitialState(), user: { id: 42, login: 'owner', name: 'Owner', avatar_url: '', email: null }, repositories, searchResults: repositories, language: 'zh' } as unknown as AppStoreState;
  mocks.state = { ...initial, ...createClassificationSlice(setState, () => mocks.state) };
}
let queue: typeof import('./aiClassificationRebuild');
let engine: typeof import('./classificationEngine');
beforeEach(async () => {
  vi.useFakeTimers(); vi.resetModules(); mocks.sync.mockReset().mockResolvedValue(undefined); fixture();
  engine = await import('./classificationEngine');
  queue = await import('./aiClassificationRebuild');
});
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
const tick = () => vi.advanceTimersByTimeAsync(800);

describe('classification rebuild queue and local mutation', () => {
  it('preserves both locked memberships and their taxonomy during automatic evidence updates', async () => {
    queue.enqueueAIClassificationRebuild([1]); await tick();
    const original = mocks.state.repositories[0];
    const technology = { ...original.classifications!.technology!, locked: true };
    const purpose = { category_id: original.category_id, subcategory_id: original.subcategory_id, category_locked: true };
    mocks.state = { ...mocks.state, repositories: [{ ...original, ...purpose, classifications: { technology }, ai_summary: 'data analysis and visualization dashboard', ai_platforms: ['Go'], language: 'Go' }] };
    queue.enqueueAIClassificationRebuild([1]); await tick();
    expect(mocks.state.repositories[0]).toMatchObject({ ...purpose, classifications: { technology } });
    expect(mocks.state.customCategories.some(category => category.id === purpose.category_id)).toBe(true);
    expect(mocks.state.subcategories.some(group => group.id === purpose.subcategory_id)).toBe(true);
    expect(mocks.state.classificationSchemes!.technology!.customCategories.some(category => category.id === technology.categoryId)).toBe(true);
    expect(mocks.state.classificationSchemes!.generation!.status).toBe('ready');
    expect(mocks.state.repositories[0].classificationInsights?.purpose).toBeUndefined();
    queue.enqueueAIClassificationRebuild([1], { force: true, overwriteLocks: true }); await tick();
    expect(mocks.state.repositories[0].category_locked).toBe(false);
    expect(mocks.state.repositories[0].classifications!.technology!.locked).toBe(false);
    expect(mocks.state.repositories[0].category_id).not.toBe(purpose.category_id);
  });
  it('retains a locked builtin category, its custom name, and subgroup through startup recovery', async () => {
    const category = (await import('../store/schema')).defaultCategories.find(item => item.id !== 'all' && item.id !== 'pending')!;
    const subgroup = { id: 'personal-locked-group', parentId: category.id, name: 'My locked projects', icon: 'folder' };
    mocks.state = { ...mocks.state, repositories: [{ ...mocks.state.repositories[0], category_id: category.id, subcategory_id: subgroup.id, category_locked: true }],
      subcategories: [subgroup], subcategoryOrder: [subgroup.id], categoryOrder: [category.id], defaultCategoryOverrides: { [category.id]: { name: 'My category' } } };
    queue.enqueueAIClassificationRebuild([1], { force: true }); await tick();
    expect(mocks.state.repositories[0]).toMatchObject({ category_id: category.id, subcategory_id: subgroup.id, category_locked: true });
    expect(mocks.state.hiddenDefaultCategoryIds).not.toContain(category.id);
    expect(mocks.state.categoryOrder).toContain(category.id);
    expect(mocks.state.defaultCategoryOverrides[category.id].name).toBe('My category');
    expect(mocks.state.subcategories).toContainEqual(subgroup);
    expect(mocks.state.classificationSchemes!.generation!.status).toBe('ready');
  });
  it('discards a debounce timer belonging to an account that signed out', async () => {
    queue.enqueueAIClassificationRebuild([1]);
    fixture([repo(2)]);
    mocks.state = { ...mocks.state, user: { ...mocks.state.user!, id: 99 } };
    await tick();
    expect(mocks.sync).not.toHaveBeenCalled();
    expect(mocks.state.repositories[0].category_id).toBeUndefined();
  });
  it('debounces a burst and commits both schemes through the real slice once', async () => {
    queue.enqueueAIClassificationRebuild([1]);
    await vi.advanceTimersByTimeAsync(400);
    queue.enqueueAIClassificationRebuild([1]);
    await vi.advanceTimersByTimeAsync(799);
    expect(mocks.sync).not.toHaveBeenCalled();
    expect(mocks.state.classificationSchemes?.generation?.status).toBe('stale');
    await vi.advanceTimersByTimeAsync(1);
    expect(mocks.sync).toHaveBeenCalledOnce();
    expect(mocks.state.classificationSchemes?.generation).toMatchObject({ status: 'ready', generation: 1, repositoryIds: [1], queuedRepositoryIds: [] });
    expect(mocks.state.repositories[0].category_id).toBeTruthy();
    expect(mocks.state.repositories[0].classifications?.technology?.categoryId).toBeTruthy();
  });
  it('does not enqueue unchanged evidence after ready or delivery status changes', async () => {
    queue.enqueueAIClassificationRebuild([1]); await tick();
    const generated = mocks.state.classificationSchemes!.generation!;
    mocks.state.setClassificationGeneration({ syncPending: true, error: 'SYNC_PENDING:offline' });
    queue.enqueueAIClassificationRebuild([1]);
    await vi.advanceTimersByTimeAsync(2000);
    expect(mocks.sync).toHaveBeenCalledOnce();
    expect(mocks.state.classificationSchemes!.generation!.generation).toBe(generated.generation);
    expect(mocks.state.classificationSchemes!.generation!.status).toBe('ready');
  });
  it('retains all prior classification data if full replacement validation fails', async () => {
    const valid = engine.buildAIClassification(mocks.state.repositories, 'zh');
    mocks.state.replaceAIClassification(valid);
    const before = mocks.state;
    const corrupt = { ...engine.buildAIClassification(mocks.state.repositories, 'zh'), assignments: { '1': { purpose: { categoryId: 'missing', subcategoryId: null, locked: false }, technology: valid.assignments['1'].technology } } };
    vi.spyOn(engine, 'buildAIClassification').mockReturnValueOnce(corrupt);
    expect(await queue.flushAIClassificationRebuild()).toBe(false);
    expect(mocks.state.repositories).toBe(before.repositories);
    expect(mocks.state.customCategories).toBe(before.customCategories);
    expect(mocks.state.subcategories).toBe(before.subcategories);
    expect(mocks.state.classificationSchemes!.technology).toBe(before.classificationSchemes!.technology);
    expect(mocks.sync).not.toHaveBeenCalled();
  });
  it('does not mutate the new account after an earlier delivery finishes', async () => {
    let finish: () => void = () => {};
    mocks.sync.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    const working = queue.flushAIClassificationRebuild();
    expect(mocks.sync).toHaveBeenCalledOnce();
    const other = [repo(2, 'personal note application')];
    fixture(other);
    mocks.state = { ...mocks.state, user: { ...mocks.state.user!, id: 99, login: 'second' } };
    const afterSwitch = mocks.state;
    finish(); await working;
    expect(mocks.state).toBe(afterSwitch);
    expect(mocks.state.repositories[0].id).toBe(2);
  });
  it('honors a forced rebuild queued while an unchanged generation is awaiting delivery', async () => {
    let finish: () => void = () => {};
    mocks.sync.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    const first = queue.flushAIClassificationRebuild();
    expect(mocks.state.classificationSchemes!.generation!.status).toBe('ready');
    queue.enqueueAIClassificationRebuild([1], { force: true });
    finish(); await first; await tick();
    expect(mocks.sync).toHaveBeenCalledTimes(2);
    expect(mocks.state.classificationSchemes!.generation!.generation).toBe(2);
  });
  it('does not carry the previous account queued forced rebuild into the next account', async () => {
    let finish: () => void = () => {};
    mocks.sync.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    const first = queue.flushAIClassificationRebuild();
    queue.enqueueAIClassificationRebuild([1], { force: true });
    fixture([repo(2, 'personal note application')]);
    mocks.state = { ...mocks.state, user: { ...mocks.state.user!, id: 99, login: 'second' } };
    const afterSwitch = mocks.state;
    finish(); await first; await tick();
    expect(mocks.state).toBe(afterSwitch);
    expect(mocks.sync).toHaveBeenCalledOnce();
  });
  it('keeps a rebuild explicitly queued by the new account during the old delivery', async () => {
    let finish: () => void = () => {};
    mocks.sync.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    const first = queue.flushAIClassificationRebuild();
    fixture([repo(2, 'knowledge base and notes')]);
    mocks.state = { ...mocks.state, user: { ...mocks.state.user!, id: 99, login: 'second' } };
    queue.enqueueAIClassificationRebuild([2]);
    finish(); await first; await tick();
    expect(mocks.state.user!.id).toBe(99);
    expect(mocks.state.classificationSchemes!.generation!.repositoryIds).toEqual([2]);
    expect(mocks.state.repositories[0].category_id).toBe('ai-purpose-knowledge');
    expect(mocks.sync).toHaveBeenCalledTimes(2);
  });
  it('preserves the other scheme and existing sibling IDs/names when refining again', async () => {
    const repositories = Array.from({ length: 60 }, (_, index) => repo(index + 100, index < 24 ? 'coding agent for software engineering' : index < 48 ? 'browser agent for browser automation' : 'agent platform'));
    fixture(repositories);
    mocks.state.replaceAIClassification(engine.buildAIClassification(repositories, 'zh'));
    const original = 'ai-purpose-ai-agent';
    expect(mocks.state.subcategories.some(group => group.id === original)).toBe(true);
    // A user moves projects back into the general group, while keeping two
    // already derived sibling groups and giving those groups personal names.
    const coding = `${original}-coding`; const browser = `${original}-browser`;
    const moved = mocks.state.repositories.map((repository, index) => index < 36 ? { ...repository, category_id: 'ai-purpose-ai', subcategory_id: original } : repository);
    const renamed = mocks.state.subcategories.map(group => group.id === coding ? { ...group, name: 'My coding projects' } : group.id === browser ? { ...group, name: 'My browser projects' } : group);
    setState({ repositories: moved, searchResults: moved, subcategories: renamed });
    const technology = mocks.state.classificationSchemes!.technology;
    const technicalMembership = mocks.state.repositories.map(repository => repository.classifications?.technology);
    const technicalInsights = mocks.state.repositories.map(repository => repository.classificationInsights?.technology);
    const result = await queue.refineAIClassification('purpose', original);
    expect(result.changed).toBe(true);
    expect(mocks.state.classificationSchemes!.technology).toBe(technology);
    expect(mocks.state.repositories.map(repository => repository.classifications?.technology)).toEqual(technicalMembership);
    expect(mocks.state.repositories.map(repository => repository.classificationInsights?.technology)).toEqual(technicalInsights);
    expect(new Set(mocks.state.subcategories.map(group => group.id)).size).toBe(mocks.state.subcategories.length);
    expect(new Set(mocks.state.subcategoryOrder).size).toBe(mocks.state.subcategoryOrder.length);
    expect(mocks.state.subcategories.find(group => group.id === coding)?.name).toBe('My coding projects');
    expect(mocks.state.subcategories.find(group => group.id === browser)?.name).toBe('My browser projects');
    const ids = new Set(mocks.state.subcategories.map(group => group.id));
    expect(mocks.state.repositories.every(repository => repository.subcategory_id && ids.has(repository.subcategory_id))).toBe(true);
  });
});
