import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Repository } from '../types';
import type { WorkbenchProposal } from '../types/aiWorkbench';
const mocks = vi.hoisted(() => ({ generate: vi.fn(), readme: vi.fn(), state: { user: { id: 7 }, aiConfigs: [{ id: 'model', apiKey: 'secret' }], githubToken: 'token', language: 'en' } }));
vi.mock('../store/useAppStore', () => ({ useAppStore: { getState: () => mocks.state } }));
vi.mock('./aiService', () => ({ AIService: class { generateChatText = mocks.generate; } }));
vi.mock('./repositoryDetailReadme', () => ({ getRepositoryDetailReadme: mocks.readme }));
import { generateOrganizationDraft, parseOrganizationJSON } from './aiOrganizationService';
import { organizationDraftSchema } from './aiOrganizationSchema';
const repositories = Array.from({ length: 23 }, (_, i) => ({ id: i + 1, full_name: `fixture/repo-${i}`, description: 'CLI utility', topics: ['cli'], category_id: null, subcategory_id: null }) as Repository);
function fixture(): WorkbenchProposal {
  return { id: 'p', sessionId: 's', ownerId: '7', createdAt: '', updatedAt: '', operations: [], organization: {
    version: 1, revision: 1, configId: 'model', maxNewSubcategories: 6, structureReady: false, scope: { name: 'pending', repositoryIds: repositories.map(r => r.id) }, instruction: 'Organize', status: 'generating', createdCategoryIds: [], categories: [],
    entries: repositories.map(r => ({ repositoryId: r.id, before: { categoryId: null, subcategoryId: null, locked: false }, categoryId: null, subcategoryId: null, disposition: 'insufficient', selected: false, overrideLocked: false, manual: false, reason: '', status: 'pending' })),
    batches: [{ repositoryIds: repositories.slice(0, 20).map(r => r.id), status: 'pending' }, { repositoryIds: repositories.slice(20).map(r => r.id), status: 'pending' }],
  } };
}
function defaultReply({ user }: { user: string }) {
  const prompt = JSON.parse(user);
  if (prompt.task.startsWith('Suggest')) return JSON.stringify({ categories: [{ ref: 'tools', name: 'Tools', parentRef: null }, { ref: 'cli', name: 'CLI', parentRef: 'tools' }] });
  return JSON.stringify({ assignments: prompt.repositories.map((r: { id: number }) => ({ repositoryId: r.id, categoryId: prompt.categories.find((c: { parentId: string | null }) => !c.parentId).id, subcategoryId: prompt.categories.find((c: { parentId: string | null }) => c.parentId).id, disposition: 'move', reason: 'CLI description' })) });
}
const run = (proposal = fixture(), overrides = {}) => generateOrganizationDraft({ proposal, repositories, configId: 'model', instruction: 'Organize', signal: new AbortController().signal, onUpdate: vi.fn(), ...overrides });
beforeEach(() => { mocks.state.user.id = 7; mocks.generate.mockReset().mockImplementation(defaultReply); mocks.readme.mockReset().mockResolvedValue({ content: 'README evidence' }); });
describe('AI organization generation', () => {
  it('generates stable category identities then complete batches of at most 20', async () => {
    const result = await run();
    expect(mocks.generate).toHaveBeenCalledTimes(3);
    expect(result.organization?.entries).toHaveLength(23);
    expect(result.organization?.entries.every(e => e.selected && e.disposition === 'move')).toBe(true);
    expect(result.organization?.categories[0].id).not.toBe('tools');
    expect(result.organization?.categories[0].icon).toBe('\u{1F4C1}');
    expect(result.organization?.batches.map(b => b.repositoryIds.length)).toEqual([20, 3]);
    expect(mocks.readme).not.toHaveBeenCalled();
    expect(organizationDraftSchema.safeParse(result.organization).success).toBe(true);
  });
  it('rejects incomplete and duplicate coverage but preserves the independent successful batch', async () => {
    mocks.generate.mockImplementationOnce(defaultReply).mockResolvedValueOnce(JSON.stringify({ assignments: [] })).mockImplementation(defaultReply);
    const result = await run();
    expect(result.organization?.batches.map(b => b.status)).toEqual(['failed', 'complete']);
    expect(result.organization?.entries.filter(e => e.selected)).toHaveLength(3);
    mocks.generate.mockClear();
    const retried = await run(result, { retryOnly: true });
    expect(mocks.generate).toHaveBeenCalledTimes(1);
    expect(retried.organization?.entries.filter(e => e.selected)).toHaveLength(23);
  });
  it('keeps insufficient evidence unselected and does not invent its destination', async () => {
    mocks.generate.mockImplementation(input => {
      const value = JSON.parse(defaultReply(input));
      if (value.assignments) value.assignments.forEach((e: { disposition: string }) => { e.disposition = 'insufficient'; });
      return JSON.stringify(value);
    });
    const result = await run();
    expect(result.organization?.entries.every(e => !e.selected && e.categoryId === null)).toBe(true);
  });
  it('preserves manually edited destinations unless explicitly replaced', async () => {
    const previous = await run();
    previous.organization!.entries[0] = { ...previous.organization!.entries[0], manual: true, categoryId: null, subcategoryId: null, disposition: 'unchanged', selected: false };
    mocks.generate.mockImplementation(input => JSON.parse(input.user).task.startsWith('Suggest') ? '{"categories":[]}' : defaultReply(input));
    expect((await run(previous)).organization?.entries[0]).toMatchObject({ manual: true, categoryId: null });
    expect((await run(previous, { replaceManual: true })).organization?.entries[0]).toMatchObject({ manual: false, disposition: 'move' });
  });
  it('does not select locked main-category moves automatically', async () => {
    const p = fixture(); p.organization!.entries[0].before.locked = true;
    expect((await run(p)).organization?.entries[0].selected).toBe(false);
  });
  it('uses README only for explicitly selected repositories and preserves old results on enrichment failure', async () => {
    const p = await run();
    mocks.readme.mockRejectedValueOnce(new Error('429 rate limit'));
    const result = await run(p, { retryOnly: true, enrichRepositoryIds: [1] });
    expect(mocks.readme).toHaveBeenCalledTimes(1);
    expect(result.organization?.entries).toEqual(p.organization?.entries);
    expect(result.organization?.batches[0]).toMatchObject({ status: 'failed', error: '429 rate limit' });
  });
  it('guards stopped and account-switched late responses before publishing them', async () => {
    const controller = new AbortController(); const updates = vi.fn();
    mocks.generate.mockImplementation(async input => { controller.abort(); return defaultReply(input); });
    await expect(run(fixture(), { signal: controller.signal, onUpdate: updates })).rejects.toThrow();
    expect(updates).not.toHaveBeenCalled();
    mocks.generate.mockImplementation(async input => { mocks.state.user.id = 8; return defaultReply(input); });
    await expect(run(fixture(), { onUpdate: updates })).rejects.toThrow('Account changed');
    expect(updates).not.toHaveBeenCalled();
  });
  it('validates structure parents and configurable subgroup limit', async () => {
    mocks.generate.mockResolvedValue('{"categories":[{"ref":"child","name":"Child","parentRef":"missing"}]}');
    await expect(run()).rejects.toThrow('parent');
    const p = fixture(); p.organization!.maxNewSubcategories = 1;
    mocks.generate.mockResolvedValue(JSON.stringify({ categories: [{ ref: 'm', name: 'Main', parentRef: null }, { ref: 'a', name: 'A', parentRef: 'm' }, { ref: 'b', name: 'B', parentRef: 'm' }] }));
    await expect(run(p)).rejects.toThrow('Too many');
  });
  it('supports fenced JSON without accepting malformed output', () => {
    expect(parseOrganizationJSON('Result:\n```json\n{"categories":[]}\n```')).toEqual({ categories: [] });
    expect(() => parseOrganizationJSON('not JSON')).toThrow();
  });
});

function incrementalFixture(): WorkbenchProposal {
  const p = fixture();
  const draft = p.organization!;
  draft.structureReady = true;
  draft.scope.repositoryIds = [1, 2, 3];
  draft.entries = draft.entries.slice(0, 3);
  draft.batches = [1, 2, 3].map(id => ({ repositoryIds: [id], status: 'pending' }));
  draft.categories = [{ id: 'tools-id', name: 'Tools', parentId: null, icon: 'folder', isNew: false }];
  return p;
}
const suggestion = (ref: string, parentRef: string | null = null, name = ref) => ({ ref, name, parentRef });
const assignment = (repositoryId: number, categoryId: string | null = 'tools-id', subcategoryId: string | null = null) => ({
  repositoryId, categoryId, subcategoryId, disposition: 'move', reason: 'Repository metadata',
});
const reply = (repositoryId: number, categoryId: string | null = 'tools-id', subcategoryId: string | null = null) =>
  JSON.stringify({ assignments: [assignment(repositoryId, categoryId, subcategoryId)] });

describe('incremental organization categories', () => {
  it('adds missing categories in later batches and exposes stable IDs for subsequent reuse without extra calls', async () => {
    const original = incrementalFixture();
    const snapshot = structuredClone(original);
    const onUpdate = vi.fn();
    mocks.generate.mockResolvedValueOnce(reply(1)).mockResolvedValueOnce(JSON.stringify({
      newCategories: [suggestion('child', 'science', 'Astronomy'), suggestion('science', null, 'Science')],
      assignments: [assignment(2, 'science', 'child')],
    })).mockImplementationOnce(({ user }: { user: string }) => {
      const prompt = JSON.parse(user);
      expect(prompt.maxNewSubcategoriesPerMain).toBe(6);
      const main = prompt.categories.find((c: { name: string }) => c.name === 'Science');
      const child = prompt.categories.find((c: { name: string }) => c.name === 'Astronomy');
      expect(main.id).not.toBe('science');
      expect(child.parentId).toBe(main.id);
      return reply(3, main.id, child.id);
    });
    const result = await run(original, { retryOnly: true, onUpdate });
    const draft = result.organization!;
    expect(mocks.generate).toHaveBeenCalledTimes(3);
    expect(draft.categories).toHaveLength(3);
    expect(draft.entries[2].categoryId).toBe(draft.entries[1].categoryId);
    expect(draft.entries[2].subcategoryId).toBe(draft.entries[1].subcategoryId);
    expect(draft.entries.every(e => e.selected && e.status === 'pending')).toBe(true);
    expect(draft).toMatchObject({ status: 'ready', createdCategoryIds: [] });
    expect(result.operations).toEqual([]);
    expect(original).toEqual(snapshot);
    for (const [published] of onUpdate.mock.calls) expect(organizationDraftSchema.safeParse(published.organization).success).toBe(true);
  });

  it('reuses existing and earlier suggested names per parent, including aliases, at the subgroup limit', async () => {
    const p = incrementalFixture();
    p.organization!.maxNewSubcategories = 1;
    p.organization!.categories.push({ id: 'old-child', name: 'Existing', parentId: 'tools-id', icon: 'folder', isNew: false });
    mocks.generate.mockResolvedValueOnce(JSON.stringify({
      newCategories: [suggestion('main-alias', null, ' tools '), suggestion('cli', 'main-alias', 'CLI')],
      assignments: [assignment(1, 'main-alias', 'cli')],
    })).mockResolvedValueOnce(JSON.stringify({
      newCategories: [suggestion('tools-again', null, 'TOOLS'), suggestion('cli-again', 'tools-again', ' cli '), suggestion('same-cli', 'tools-id', 'CLI')],
      assignments: [assignment(2, 'tools-again', 'same-cli')],
    })).mockResolvedValueOnce(JSON.stringify({
      newCategories: [suggestion('old-alias', 'tools-id', 'existing')],
      assignments: [assignment(3, 'tools-id', 'old-alias')],
    }));
    const draft = (await run(p, { retryOnly: true })).organization!;
    expect(draft.batches.every(b => b.status === 'complete')).toBe(true);
    expect(draft.categories).toHaveLength(3);
    expect(draft.categories[0]).toEqual(p.organization!.categories[0]);
    expect(draft.entries[0].categoryId).toBe('tools-id');
    expect(draft.entries[1].subcategoryId).toBe(draft.entries[0].subcategoryId);
    expect(draft.entries[2].subcategoryId).toBe('old-child');
  });

  it.each([
    ['unknown parent', [suggestion('child', 'missing')], assignment(2)],
    ['duplicate reference', [suggestion('dup'), suggestion('dup')], assignment(2)],
    ['existing ID collision', [suggestion('tools-id')], assignment(2)],
    ['reserved reference', [suggestion('pending')], assignment(2)],
    ['self parent', [suggestion('self', 'self')], assignment(2)],
    ['cyclic parents', [suggestion('a', 'b'), suggestion('b', 'a')], assignment(2)],
    ['nested subgroup', [suggestion('child', 'tools-id'), suggestion('nested', 'child')], assignment(2)],
    ['unknown assignment reference', [], assignment(2, 'missing')],
    ['wrong assignment parent', [suggestion('other'), suggestion('child', 'other')], assignment(2, 'tools-id', 'child')],
    ['subgroup as main', [suggestion('child', 'tools-id')], assignment(2, 'child')],
    ['main as subgroup without main', [], assignment(2, null, 'tools-id')],
    ['empty category name', [suggestion('blank', null, ' ')], assignment(2)],
    ['response category limit', Array.from({ length: 100 }, (_, i) => suggestion(`extra-${i}`)), assignment(2)],
  ])('rejects %s atomically while preserving successful neighboring batches', async (_label, invalidCategories, badAssignment) => {
    const p = incrementalFixture();
    const onUpdate = vi.fn();
    mocks.generate.mockResolvedValueOnce(reply(1)).mockResolvedValueOnce(JSON.stringify({
      newCategories: [suggestion('must-not-leak'), ...invalidCategories],
      assignments: [badAssignment],
    })).mockResolvedValueOnce(reply(3));
    const draft = (await run(p, { retryOnly: true, onUpdate })).organization!;
    expect(mocks.generate).toHaveBeenCalledTimes(3);
    expect(draft.batches.map(b => b.status)).toEqual(['complete', 'failed', 'complete']);
    expect(draft.categories).toEqual(p.organization!.categories);
    expect(draft.entries[1]).toEqual(p.organization!.entries[1]);
    expect(draft.entries.filter(e => e.selected)).toHaveLength(2);
    for (const [published] of onUpdate.mock.calls) expect(published.organization.categories).toEqual(p.organization!.categories);
  });

  it('enforces the cumulative new-subcategory limit across batches and retries only the failed batch', async () => {
    const p = incrementalFixture();
    p.organization!.maxNewSubcategories = 1;
    mocks.generate.mockResolvedValueOnce(JSON.stringify({
      newCategories: [suggestion('first', 'tools-id')],
      assignments: [assignment(1, 'tools-id', 'first')],
    })).mockResolvedValueOnce(JSON.stringify({
      newCategories: [suggestion('second', 'tools-id')],
      assignments: [assignment(2, 'tools-id', 'second')],
    })).mockResolvedValueOnce(reply(3));
    const result = await run(p, { retryOnly: true });
    expect(result.organization!.categories).toHaveLength(2);
    expect(result.organization!.batches[1]).toMatchObject({ status: 'failed', error: 'Too many suggested subcategories' });
    const firstId = result.organization!.entries[0].subcategoryId!;
    mocks.generate.mockClear().mockResolvedValueOnce(reply(2, 'tools-id', firstId));
    const retried = await run(result, { retryOnly: true });
    expect(mocks.generate).toHaveBeenCalledTimes(1);
    expect(retried.organization!.categories).toEqual(result.organization!.categories);
    expect(retried.organization!.batches.every(b => b.status === 'complete')).toBe(true);
  });

  it('rejects exceeding the total draft category limit without partial additions', async () => {
    const p = incrementalFixture();
    p.organization!.categories.push(...Array.from({ length: 1998 }, (_, i) => ({
      id: `existing-${i}`, name: `Existing ${i}`, parentId: null, icon: 'folder', isNew: false,
    })));
    mocks.generate.mockResolvedValueOnce(JSON.stringify({
      newCategories: [suggestion('first'), suggestion('overflow')],
      assignments: [assignment(1, 'first')],
    })).mockResolvedValueOnce(reply(2)).mockResolvedValueOnce(reply(3));
    const draft = (await run(p, { retryOnly: true })).organization!;
    expect(draft.batches[0]).toMatchObject({ status: 'failed', error: 'Too many categories' });
    expect(draft.categories).toEqual(p.organization!.categories);
    expect(draft.entries[0]).toEqual(p.organization!.entries[0]);
  });

  it('rolls back new categories and earlier assignments when a later assignment in the same batch is invalid', async () => {
    const p = incrementalFixture();
    p.organization!.batches = [{ repositoryIds: [1, 2], status: 'pending' }, { repositoryIds: [3], status: 'pending' }];
    mocks.generate.mockResolvedValueOnce(JSON.stringify({
      newCategories: [suggestion('science')],
      assignments: [assignment(1, 'science'), assignment(2, 'unknown')],
    })).mockResolvedValueOnce(reply(3));
    const draft = (await run(p, { retryOnly: true })).organization!;
    expect(draft.batches.map(b => b.status)).toEqual(['failed', 'complete']);
    expect(draft.categories).toEqual(p.organization!.categories);
    expect(draft.entries.slice(0, 2)).toEqual(p.organization!.entries.slice(0, 2));
  });

  it.each(['unchanged', 'insufficient'])('retains original membership for %s even with valid new refs', async disposition => {
    const p = incrementalFixture();
    p.organization!.entries.forEach(e => { e.before.categoryId = 'tools-id'; e.categoryId = 'tools-id'; });
    mocks.generate.mockImplementation(({ user }: { user: string }) => JSON.stringify({
      newCategories: [suggestion('science')],
      assignments: [{ ...assignment(JSON.parse(user).repositories[0].id, 'science'), disposition }],
    }));
    const draft = (await run(p, { retryOnly: true })).organization!;
    expect(draft.batches.every(b => b.status === 'complete')).toBe(true);
    expect(draft.entries.every(e => e.categoryId === 'tools-id' && e.subcategoryId === null && !e.selected)).toBe(true);
  });

  it('preserves manual edits and category locks when assignments reference new categories', async () => {
    const p = incrementalFixture();
    Object.assign(p.organization!.entries[0], { manual: true, reason: 'My edit', categoryId: 'tools-id', disposition: 'move', selected: true });
    p.organization!.entries[1].before.locked = true;
    mocks.generate.mockImplementation(({ user }: { user: string }) => {
      const prompt = JSON.parse(user);
      return JSON.stringify({
        newCategories: [suggestion('science', null, 'Science')],
        assignments: [assignment(prompt.repositories[0].id, 'science')],
      });
    });
    const draft = (await run(p, { retryOnly: true })).organization!;
    expect(draft.entries[0]).toEqual(p.organization!.entries[0]);
    expect(draft.entries[1]).toMatchObject({ disposition: 'move', selected: false, overrideLocked: false, before: { locked: true } });
    expect(draft.entries[2]).toMatchObject({ disposition: 'move', selected: true });
    expect(draft.categories).toHaveLength(2);
    const replaced = (await run(p, { retryOnly: true, replaceManual: true })).organization!;
    expect(replaced.entries[0]).toMatchObject({ manual: false, disposition: 'move', selected: true });
    expect(replaced.entries[0].categoryId).not.toBe('tools-id');
  });
});
