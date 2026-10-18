import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createInitialState } from '../store/initialState';
import type { AppStoreState } from '../store/types';
import type { Repository } from '../types';
import type { WorkbenchProposal } from '../types/aiWorkbench';
const mocks = vi.hoisted(() => ({ state: {} as AppStoreState, generate: vi.fn(), readme: vi.fn() }));
vi.mock('../store/useAppStore', () => ({ useAppStore: { getState: () => mocks.state } }));
vi.mock('./aiService', async original => ({ ...await original<typeof import('./aiService')>(), AIService: class { generateChatText = mocks.generate; } }));
vi.mock('./repositoryDetailReadme', () => ({ getRepositoryDetailReadme: mocks.readme }));
vi.mock('./aiOrganizationEvidence', async original => ({ ...await original<typeof import('./aiOrganizationEvidence')>(), readOrganizationDocumentation: vi.fn().mockResolvedValue([]) }));
import { createDualOrganizationDraft, generateDualOrganizationDraft, organizationBatches } from './aiOrganizationDual';
import { organizationDraftSchema } from './aiOrganizationSchema';
import { AIRequestError } from './aiService';
const date = '2026-10-06T00:00:00Z';
const repositories: Repository[] = Array.from({ length: 23 }, (_, i) => ({ id: i + 1, name: `tool-${i}`, full_name: `fixture/tool-${i}`, description: 'Scientific command-line computation tool', html_url: `https://github.com/fixture/tool-${i}`, stargazers_count: 1, forks_count: 0, forks: 0, topics: ['science'], language: 'Python', created_at: date, updated_at: date, pushed_at: date, owner: { login: 'fixture', avatar_url: '' }, category_id: null, subcategory_id: null }));
function reply({ user }: { user: string }) {
  const prompt = JSON.parse(user);
  if (prompt.task.startsWith('Understand')) return JSON.stringify({ results: prompt.repositories.map((r: { repositoryId: number }) => ({ repositoryId: r.repositoryId, status: 'understood', purpose: ['Scientific computation'], technology: ['Python CLI'] })) });
  if (prompt.task.startsWith('Summarize')) return JSON.stringify({ purpose: 'Scientific computation', technology: 'Python command-line tools' });
  if (prompt.task.startsWith('Design')) return JSON.stringify({ categories: [{ ref: 'main', name: prompt.schemeId === 'purpose' ? 'Computation' : 'Scientific software', parentRef: null }, { ref: 'child', name: 'CLI', parentRef: 'main' }] });
  return JSON.stringify({ results: prompt.repositories.map((r: { repositoryId: number }) => ({ repositoryId: r.repositoryId, categoryId: prompt.categories.find((c: { isNew: boolean; parentId: string | null }) => c.isNew && !c.parentId).id, subcategoryId: prompt.categories.find((c: { isNew: boolean; parentId: string | null }) => c.isNew && c.parentId).id, disposition: 'move', reason: 'Supported by project facts' })) });
}
function proposal(repos = repositories): WorkbenchProposal {
  const organization = createDualOrganizationDraft({ repositories: repos, instruction: 'Organize', scopeName: 'all', configId: 'model' });
  delete organization.analysisDepth;
  return { id: 'p', ownerId: '7', sessionId: 's', createdAt: date, updatedAt: date, operations: [], organization };
}
const run = (p = proposal(), overrides = {}) => generateDualOrganizationDraft({ proposal: p, repositories, signal: new AbortController().signal, onUpdate: async p => { organizationDraftSchema.parse(p.organization); }, ...overrides });
beforeEach(() => {
  mocks.state = { ...createInitialState(), user: { id: 7 } as never, aiConfigs: [{ id: 'model', name: 'Fixture', model: 'fixture', apiKey: 'secret', baseUrl: 'https://fixture.invalid', isActive: true }], repositories } as unknown as AppStoreState;
  mocks.generate.mockReset().mockImplementation(reply); mocks.readme.mockReset().mockResolvedValue({ content: '# CLI\nScientific computation', retrievedAt: date });
});
describe('full-library dual classification generation', () => {
  it('blocks disabled AGY before evidence or model requests, without marking every repository failed', async () => {
    mocks.state.aiConfigs = [{ id: 'model', name: 'AGY', model: 'fixture', provider: 'agy-cli', agyEffort: 'medium', agyMode: 'model', deviceBound: true, isActive: false }];
    let last: WorkbenchProposal | undefined;
    await expect(run(proposal(), { onUpdate: async (p: WorkbenchProposal) => { last = p; } })).rejects.toThrow('AGY_DISABLED');
    expect(mocks.generate).not.toHaveBeenCalled(); expect(mocks.readme).not.toHaveBeenCalled();
    expect(last?.organization?.status).toBe('interrupted');
    expect(last?.organization?.dual?.understanding.every(row => row.status === 'pending')).toBe(true);
  });
  it('halts the whole task for a runtime AGY configuration error instead of repeating it in every batch', async () => {
    mocks.generate.mockRejectedValue(new Error('AGY_MODEL_EFFORT_CONFLICT'));
    let last: WorkbenchProposal | undefined;
    await expect(run(proposal(), { onUpdate: async (p: WorkbenchProposal) => { last = p; } })).rejects.toThrow('AGY_MODEL_EFFORT_CONFLICT');
    expect(mocks.generate).toHaveBeenCalledTimes(1);
    expect(last?.organization?.dual?.understanding.every(row => row.status === 'pending')).toBe(true);
  });
  it('covers every repository in both schemes with batches <=10, not a sample', async () => {
    const result = await run();
    expect(result.organization?.dual?.outcome).toBe('complete');
    expect(result.organization?.batches.map(batch => batch.repositoryIds.length)).toEqual([10, 10, 3]);
    for (const scheme of Object.values(result.organization!.dual!.schemes)) expect(scheme.entries.every(entry => entry.selected)).toBe(true);
    expect(result.organization?.dual?.understanding.map(row => row.repositoryId)).toEqual(repositories.map(repo => repo.id));
    expect(mocks.readme).toHaveBeenCalledTimes(repositories.length);
    expect(result.organization?.dual?.schemes.purpose.categories.find(c => c.isNew)?.id).not.toBe(result.organization?.dual?.schemes.technology.categories[0].id);
  });
  it('does not silently report a legal empty tree as a successful result', async () => {
    mocks.generate.mockImplementation(input => JSON.parse(input.user).task.startsWith('Design') ? '{"categories":[]}' : reply(input));
    const result = await run(proposal(repositories.slice(0, 2)));
    expect(result.organization?.dual?.outcome).toBe('empty');
    expect(result.organization?.dual?.errors).toHaveLength(2);
    expect(result.organization?.dual?.schemes.technology.entries.every(e => !e.selected)).toBe(true);
  });
  it('repairs omissions without dropping independent valid rows', async () => {
    let first = true;
    mocks.generate.mockImplementation(input => { const prompt = JSON.parse(input.user); const content = reply(input); if (prompt.task.startsWith('Understand') && first) { first = false; const parsed = JSON.parse(content); parsed.results = parsed.results.slice(0, 1); return JSON.stringify(parsed); } return content; });
    const result = await run(proposal(repositories.slice(0, 3)));
    expect(result.organization?.dual?.understanding.every(row => row.status === 'understood')).toBe(true);
    const requests = mocks.generate.mock.calls.map(([input]) => JSON.parse(input.user)).filter(p => p.task.startsWith('Understand'));
    expect(requests[1].repositories.map((r: { repositoryId: number }) => r.repositoryId)).toEqual([2, 3]);
  });
  it('reads README automatically for insufficient evidence, preserving explicit read failures', async () => {
    mocks.generate.mockImplementation(input => { const p = JSON.parse(input.user); if (!p.task.startsWith('Understand')) return reply(input); return JSON.stringify({ results: p.repositories.map((r: { repositoryId: number; readme?: string }) => ({ repositoryId: r.repositoryId, status: r.readme ? 'understood' : 'insufficient', purpose: r.readme ? ['CLI'] : [], technology: [] })) }); });
    mocks.readme.mockRejectedValue(Object.assign(new Error('README not found'), { status: 404 }));
    const result = await run(proposal(repositories.slice(0, 2)));
    expect(result.organization?.dual?.understanding.every(row => row.status === 'read-failed')).toBe(true);
    expect(result.organization?.dual?.outcome).toBe('empty');
  });
  it('auth failures pause immediately, preserve checkpoints and do not retry', async () => {
    mocks.generate.mockRejectedValue(new AIRequestError('Invalid credentials', 401));
    let last: WorkbenchProposal | undefined;
    await expect(run(proposal(repositories.slice(0, 2)), { onUpdate: async (p: WorkbenchProposal) => { last = p; } })).rejects.toThrow('credentials');
    expect(mocks.generate).toHaveBeenCalledTimes(1); expect(last?.organization?.status).toBe('interrupted');
  });
  it('stopped late responses never enter a checkpoint or a new task', async () => {
    const controller = new AbortController(); let release!: (value: string) => void;
    mocks.generate.mockImplementation(() => new Promise<string>(resolve => { release = resolve; }));
    const update = vi.fn(); const running = run(proposal(repositories.slice(0, 1)), { signal: controller.signal, onUpdate: update });
    await vi.waitFor(() => expect(mocks.generate).toHaveBeenCalledTimes(1)); controller.abort();
    await expect(running).rejects.toMatchObject({ name: 'AbortError' }); const calls = update.mock.calls.length;
    release('{"results":[]}'); await Promise.resolve(); expect(update).toHaveBeenCalledTimes(calls);
  });
  it('respects a whole-task request cap for a real-model smoke run', async () => {
    await expect(run(proposal(repositories.slice(0, 5)), { requestLimit: 3 })).rejects.toThrow('Task model request limit reached');
    expect(mocks.generate).toHaveBeenCalledTimes(3);
  });
  it('shrinks oversized inputs instead of sampling them', () => {
    const oversized = repositories.map(repo => ({ ...repo, ai_summary: 'x'.repeat(3000), custom_description: 'x'.repeat(3000), ai_details: { content: 'x'.repeat(8000) } as never }));
    const batches = organizationBatches(oversized); expect(batches.every(batch => batch.length <= 2)).toBe(true); expect(batches.flat()).toHaveLength(23);
  });
  it('shows per-repository understanding errors and does not waste calls designing from failed facts', async () => {
    mocks.generate.mockRejectedValue(new Error('Provider returned no text'));
    const result = await run(proposal(repositories.slice(0, 5)));
    expect(mocks.generate).toHaveBeenCalledTimes(1);
    expect(result.organization!.dual!.outcome).toBe('empty');
    for (const scheme of Object.values(result.organization!.dual!.schemes)) {
      expect(scheme.ready).toBe(false);
      expect(scheme.entries.every(entry => entry.reason === 'Provider returned no text' && !entry.selected)).toBe(true);
    }
  });
  it('clears stale selected suggestions when refreshed assignments fail', async () => {
    const previous = await run(proposal(repositories.slice(0, 2)));
    mocks.generate.mockImplementation(input => JSON.parse(input.user).task.startsWith('Assign') ? '{"results":[]}' : reply(input));
    const result = await run(previous, { retryOnly: true, enrichRepositoryIds: [1] });
    expect(result.organization!.dual!.outcome).toBe('empty');
    for (const scheme of Object.values(result.organization!.dual!.schemes)) {
      expect(scheme.entries.every(entry => !entry.selected && entry.disposition === 'insufficient' && entry.error)).toBe(true);
    }
  });
});
