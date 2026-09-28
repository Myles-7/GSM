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
