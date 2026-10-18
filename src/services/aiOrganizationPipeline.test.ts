import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createInitialState } from '../store/initialState';
import type { AppStoreState } from '../store/types';
import type { Repository } from '../types';
import type { WorkbenchProposal } from '../types/aiWorkbench';
const mocks = vi.hoisted(() => ({ state: {} as AppStoreState, pool: undefined as import('../types/agy').AgyDeviceState['pool'], generate: vi.fn(), readme: vi.fn(), cacheGet: vi.fn(), cachePut: vi.fn(), docs: vi.fn() }));
vi.mock('./agyClient', () => ({ agySchedulerStatus: { snapshot: () => mocks.pool }, listAgyRecovery: async () => [] }));
vi.mock('../store/useAppStore', () => ({ useAppStore: { getState: () => mocks.state } }));
vi.mock('./aiService', async original => ({ ...await original<typeof import('./aiService')>(), AIService: class { generateChatText = mocks.generate; } }));
vi.mock('./repositoryDetailReadme', () => ({ getRepositoryDetailReadme: mocks.readme }));
vi.mock('./aiOrganizationUnderstandingCache', () => ({ OrganizationUnderstandingCache: class { load = vi.fn(); touch = vi.fn(); get = mocks.cacheGet; put = mocks.cachePut; } }));
vi.mock('./aiOrganizationEvidence', async original => ({ ...await original<typeof import('./aiOrganizationEvidence')>(), readOrganizationDocumentation: mocks.docs }));
import { createDualOrganizationDraft, generateDualOrganizationDraft } from './aiOrganizationDual';
import { selectOrganizationReadme } from './aiOrganizationPipeline';
import { organizationDraftSchema } from './aiOrganizationSchema';
import { OrganizationBlockedError } from './aiOrganizationReadiness';
const date = '2026-10-06T00:00:00.000Z';
const repos: Repository[] = Array.from({ length: 30 }, (_, i) => ({ id: i + 1, name: `tool-${i}`, full_name: `fixture/tool-${i}`, description: 'Scientific computation CLI', html_url: `https://github.com/fixture/tool-${i}`, topics: ['science'], language: 'Python', stargazers_count: 1, forks: 0, forks_count: 0, created_at: date, updated_at: date, pushed_at: date, owner: { login: 'fixture', avatar_url: '' }, category_id: null, subcategory_id: null }));
function proposal(depth: 'quick' | 'deep' = 'quick', repositories = repos.slice(0, 3)): WorkbenchProposal {
  return { id: 'p', ownerId: '7', sessionId: 's', createdAt: date, updatedAt: date, operations: [], organization: createDualOrganizationDraft({ repositories, analysisDepth: depth, configId: 'model', scopeName: 'all', instruction: 'Group actual uses' }) };
}
function reply({ user }: { user: string }): string {
  const p = JSON.parse(user);
  if (p.task.startsWith('Understand')) return JSON.stringify({ results: p.repositories.map((r: { repositoryId: number }) => ({ repositoryId: r.repositoryId, status: 'understood', purpose: ['Computation'], technology: ['Python CLI'] })) });
  if (p.task.startsWith('Design')) return JSON.stringify({ categories: [{ ref: 'main', name: p.schemeId === 'purpose' ? 'Computation' : 'Scientific tools', parentRef: null }] });
  if (p.task.startsWith('Summarize')) return JSON.stringify({ purpose: 'Scientific computing', technology: 'Python CLI' });
  return JSON.stringify({ results: p.repositories.flatMap((r: { repositoryId: number; needsUnderstanding?: boolean; targets: { schemeId: string }[] }) => r.targets.map(target => ({ repositoryId: r.repositoryId, schemeId: target.schemeId, categoryId: p.schemes[target.schemeId].proposedCategoryIds[0], subcategoryId: null, disposition: 'move', reason: 'Explicit supplied project facts', ...(r.needsUnderstanding ? { understanding: { status: 'understood', purpose: ['Computation'], technology: ['Python CLI'] } } : {}) }))) });
}
const run = (p = proposal(), extra = {}) => generateDualOrganizationDraft({ proposal: p, repositories: repos, signal: new AbortController().signal, onUpdate: async next => { organizationDraftSchema.parse(next.organization); }, ...extra });
beforeEach(() => {
  vi.unstubAllGlobals();
  mocks.pool = undefined;
  mocks.state = { ...createInitialState(), user: { id: 7 } as never, language: 'en', aiConfigs: [{ id: 'model', name: 'Fixture', model: 'fixture', apiKey: 'fixture-secret', baseUrl: 'https://fixture.invalid', isActive: true, concurrency: 3 }], repositories: repos } as unknown as AppStoreState;
  mocks.generate.mockReset().mockImplementation(reply); mocks.readme.mockReset().mockResolvedValue({ content: '# Tool\nScientific computation', retrievedAt: date });
  mocks.cacheGet.mockReset(); mocks.cachePut.mockReset().mockResolvedValue(undefined); mocks.docs.mockReset().mockResolvedValue([]);
});
describe('organization depth and concurrent pipeline', () => {
  it('honors a smaller assignment batch while resuming without resending accepted rows', async () => {
    const previous = await run(proposal('quick', repos.slice(0, 5)));
    for (const scheme of Object.values(previous.organization!.dual!.schemes)) {
      for (const entry of scheme.entries.slice(1)) entry.verification = 'pending';
    }
    mocks.generate.mockClear();
    const result = await run(previous, { retryOnly: true, preserveStructure: true, assignmentBatchSize: 2 });
    const assignments = mocks.generate.mock.calls.map(([args]) => JSON.parse(args.user));
    expect(assignments.every(p => p.task.startsWith('Assign') && p.repositories.length <= 2)).toBe(true);
    expect(assignments.flatMap(p => p.repositories.map((r: { repositoryId: number }) => r.repositoryId)).sort()).toEqual([2, 3, 4, 5]);
    expect(result.organization!.dual!.schemes.purpose.entries.every(e => e.verification === 'verified')).toBe(true);
  });
  it('retries failed README evidence before a combined assignment without a separate understanding request', async () => {
    const previous = await run(); const row=previous.organization!.dual!.understanding[0];
    row.status='read-failed';row.error='Failed to fetch';
    for(const scheme of Object.values(previous.organization!.dual!.schemes))scheme.entries[0].verification='pending';
    mocks.generate.mockClear();mocks.readme.mockClear();
    const result=await run(previous,{retryOnly:true,preserveStructure:true});
    expect(mocks.readme).toHaveBeenCalledOnce();
    expect(mocks.generate).toHaveBeenCalledOnce();
    const payload=JSON.parse(mocks.generate.mock.calls[0][0].user);
    expect(payload.task).toMatch(/^Assign/);expect(payload.repositories[0].evidence).toContain('Scientific computation');
    expect(result.organization!.dual!.schemes.purpose.entries[0].verification).toBe('verified');
    expect(result.organization!.dual!.understanding[0].sources.some(source=>source.kind==='readme')).toBe(true);
  });
  it('retains a single cleanup failure without quarantining healthy work and retries only on explicit resume', async () => {
    vi.stubGlobal('electronAPI', { agy: {} });
    const previous = await run(); const technology = structuredClone(previous.organization!.dual!.schemes.technology);
    previous.organization!.dual!.schemes.purpose.ready = false;
    mocks.state.aiConfigs = [{ id: 'model', name: 'AGY', provider: 'agy-cli', model: 'fixture-low', agyEffort: 'low', agyMode: 'model', deviceBound: true, isActive: true, concurrency: 3 }];
    mocks.pool = { running: 0, queued: 0, effective: 3, limit: 3, cooldownUntil: 0, features: {}, quarantined: false };
    let checkpoint = previous;
    mocks.generate.mockClear().mockImplementationOnce(() => {
      mocks.pool = { ...mocks.pool!, effective: 2, quarantined: false };
      throw Object.assign(new Error('AGY_CLEANUP_TIMEOUT'), { details: { originalCode: 'TIMEOUT' } });
    });
    await run(previous, { retryOnly: true, onUpdate: async (next: WorkbenchProposal) => {
      organizationDraftSchema.parse(next.organization); checkpoint = structuredClone(next);
    } });
    expect(checkpoint.organization!.dual!.errors.some(error=>error.message.includes('AGY_CLEANUP_TIMEOUT'))).toBe(true);
    expect(checkpoint.organization!.dual!.progress).toMatchObject({effectiveConcurrency:2,running:0,queued:0});
    expect(mocks.generate).toHaveBeenCalledOnce();
    expect(checkpoint.organization!.dual!.schemes.technology).toEqual(technology);
    expect(checkpoint.organization!.dual!.understanding.every(row => row.status === 'understood')).toBe(true);
    mocks.pool = { ...mocks.pool!, effective: 3, quarantined: false }; mocks.generate.mockClear().mockImplementation(reply);
    const resumed = await run(checkpoint, { retryOnly: true });
    expect(resumed.organization!.structureReady).toBe(true);
    expect(mocks.generate.mock.calls.map(([args]) => JSON.parse(args.user)).filter(row => row.task.startsWith('Design')).map(row => row.schemeId)).toEqual(['purpose']);
  });
  it('does not turn a completed insufficient assessment back into a blocking pending request on resume', async () => {
    const previous = await run();
    const row = previous.organization!.dual!.understanding[0];
    Object.assign(row, { status: 'insufficient', purpose: [], technology: [] });
    Object.values(previous.organization!.dual!.schemes).forEach(s => { s.ready = false; });
    mocks.generate.mockClear();
    const result = await run(previous, { retryOnly: true });
    expect(mocks.generate.mock.calls.some(([args]) => JSON.parse(args.user).task.startsWith('Understand'))).toBe(false);
    expect(result.organization!.structureReady).toBe(true);
    expect(result.organization!.dual!.understanding[0].status).toBe('insufficient');
    expect(result.organization!.dual!.schemes.purpose.entries[0].selected).toBe(false);
  });
  it('continues other repositories after an isolated understanding timeout without mislabeling it as GitHub failure', async () => {
    const previous = await run();
    Object.assign(previous.organization!.dual!.understanding[0], { status: 'pending', purpose: [], technology: [] });
    mocks.generate.mockClear().mockImplementation(args => {
      if (JSON.parse(args.user).task.startsWith('Understand')) throw new OrganizationBlockedError('MODEL_TIMEOUT', 'AGY_TIMEOUT');
      return reply(args);
    });
    const result = await run(previous, { retryOnly: true, analysisDepth: 'deep', enrichRepositoryIds: [1] });
    expect(result.organization!.dual!.understanding[0]).toMatchObject({ status: 'failed', error: 'AGY_TIMEOUT' });
    expect(result.organization!.dual!.understanding[0].activity).toBeUndefined();
    expect(result.organization!.structureReady).toBe(true);
    expect(result.organization!.dual!.outcome).toBe('partial');
    expect(result.organization!.dual!.blocked).toBeUndefined();
    expect(result.organization!.dual!.schemes.purpose.entries[1].selected).toBe(true);
  });
  it('explicitly defers pending repositories without another request or a fabricated assignment', async () => {
    const previous = await run();
    Object.assign(previous.organization!.dual!.understanding[0], { status: 'pending', purpose: [], technology: [] });
    Object.values(previous.organization!.dual!.schemes).forEach(s => { s.ready = false; });
    mocks.generate.mockClear();
    const result = await run(previous, { retryOnly: true, deferUnderstandingIds: [1] });
    expect(mocks.generate.mock.calls.some(([args]) => JSON.parse(args.user).task.startsWith('Understand'))).toBe(false);
    expect(result.organization!.dual!.understanding[0]).toMatchObject({ status: 'insufficient', deferred: true });
    expect(result.organization!.dual!.schemes.purpose.entries[0]).toMatchObject({ categoryId: null, selected: false });
    expect(result.organization!.structureReady).toBe(true);
    expect(result.organization!.dual!.progress?.reused).toBe(2);
  });
  it('resumes missing taxonomies when all understanding is reused', async () => {
    const previous = await run();
    for (const scheme of Object.values(previous.organization!.dual!.schemes)) {
      scheme.ready = false; scheme.entries.forEach(e => { e.disposition = 'insufficient'; e.selected = false; });
    }
    previous.organization!.status = 'interrupted'; mocks.generate.mockClear();
    const result = await run(previous, { retryOnly: true });
    expect(mocks.generate.mock.calls.filter(([args]) => JSON.parse(args.user).task.startsWith('Design'))).toHaveLength(2);
    expect(mocks.generate.mock.calls.some(([args]) => JSON.parse(args.user).task.startsWith('Understand'))).toBe(false);
    expect(result.organization!.structureReady).toBe(true);
  });
  it('does not regenerate the successful half when retrying a missing taxonomy', async () => {
    const previous = await run(); const purpose = structuredClone(previous.organization!.dual!.schemes.purpose);
    previous.organization!.dual!.schemes.technology.ready = false;
    previous.organization!.dual!.schemes.technology.entries.forEach(e => { e.disposition = 'insufficient'; e.selected = false; });
    mocks.generate.mockClear();
    const result = await run(previous, { retryOnly: true });
    const designs = mocks.generate.mock.calls.map(([args]) => JSON.parse(args.user)).filter(p => p.task.startsWith('Design'));
    expect(designs.map(p => p.schemeId)).toEqual(['technology']);
    expect(result.organization!.dual!.schemes.purpose).toEqual(purpose);
  });
  it('persists successful summaries and resumes only missing chunks after timeout', async () => {
    const previous = await run(proposal('quick', repos));
    previous.organization!.dual!.understanding.forEach(row => { row.purpose = Array(3).fill('Documented scientific computing '.repeat(20)); row.technology = Array(3).fill('Python command line research '.repeat(20)); });
    Object.values(previous.organization!.dual!.schemes).forEach(s => { s.ready = false; });
    let checkpoint = previous; let summaryCalls = 0;
    mocks.generate.mockClear().mockImplementation(args => {
      if (JSON.parse(args.user).task.startsWith('Summarize') && ++summaryCalls === 2) throw new OrganizationBlockedError('MODEL_TIMEOUT', 'AGY_TIMEOUT');
      return reply(args);
    });
    await run(previous, { retryOnly: true, concurrency: 1, onUpdate: async (p: WorkbenchProposal) => { organizationDraftSchema.parse(p.organization); checkpoint = structuredClone(p); } });
    expect(checkpoint.organization!.dual!.summaries.length).toBeGreaterThanOrEqual(1);
    expect(checkpoint.organization!.dual!.errors.some(error => error.stage === 'summary')).toBe(true);
    expect(checkpoint.organization!.dual!.progress!.summaryFallback).toBe(1);
    expect(checkpoint.organization!.dual!.progress!.summaryCompleted! + checkpoint.organization!.dual!.progress!.summaryFallback!).toBe(checkpoint.organization!.dual!.progress!.summaryTotal);
    Object.values(checkpoint.organization!.dual!.schemes).forEach(s => { s.ready = false; });
    const firstChunk = JSON.parse(mocks.generate.mock.calls.find(([args]) => JSON.parse(args.user).task.startsWith('Summarize'))![0].user).records;
    mocks.generate.mockClear().mockImplementation(reply);
    const resumed = await run(checkpoint, { retryOnly: true, concurrency: 1 });
    const chunks = mocks.generate.mock.calls.map(([args]) => JSON.parse(args.user)).filter(p => p.task.startsWith('Summarize'));
    expect(chunks.every(p => JSON.stringify(p.records) !== JSON.stringify(firstChunk))).toBe(true);
    expect(chunks.every(p => JSON.stringify(p.records).length < 12500)).toBe(true);
    expect(resumed.organization!.structureReady).toBe(true);
    expect(resumed.organization!.dual!.progress?.summaryCompleted).toBe(resumed.organization!.dual!.progress?.summaryTotal);
    // An changed evidence record must invalidate its cached summary, including after backup roundtrip.
    const edited = JSON.parse(JSON.stringify(resumed)) as WorkbenchProposal;
    edited.organization!.dual!.understanding[0].purpose = ['Different documented domain'];
    Object.values(edited.organization!.dual!.schemes).forEach(s => { s.ready = false; });
    mocks.generate.mockClear(); await run(edited, { retryOnly: true, concurrency: 1 });
    expect(mocks.generate.mock.calls.some(([args]) => JSON.parse(args.user).task.startsWith('Summarize'))).toBe(true);
  });
  it('quick mode does not read GitHub and avoids unnecessary summary calls', async () => {
    const result = await run(); expect(mocks.readme).not.toHaveBeenCalled(); expect(mocks.docs).not.toHaveBeenCalled();
    expect(result.organization!.dual!.outcome).toBe('complete');
    expect(mocks.generate).toHaveBeenCalledTimes(3);
    expect(Object.values(result.organization!.dual!.schemes).every(s => s.entries.every(e => e.selected))).toBe(true);
  });
  it('deep mode reads each README once for both schemes', async () => {
    const result = await run(proposal('deep')); expect(mocks.readme).toHaveBeenCalledTimes(3);
    expect(result.organization!.dual!.understanding.every(row => row.depth === 'deep' && row.sources.some(s => s.kind === 'readme'))).toBe(true);
  });
  it('uses several workers without exceeding the model limit and saves ordered checkpoints', async () => {
    let active = 0; let max = 0; const checkpoints: number[] = [];
    mocks.generate.mockImplementation(async args => { active++; max = Math.max(max, active); await new Promise(resolve => setTimeout(resolve, JSON.parse(args.user).repositories?.[0]?.repositoryId === 1 ? 25 : 5)); active--; return reply(args); });
    const result = await run(proposal('quick', repos), { concurrency: 2, onUpdate: async (p: WorkbenchProposal) => { const count = p.organization!.dual!.understanding.filter(r => r.status === 'understood').length; checkpoints.push(count); await new Promise(resolve => setTimeout(resolve, 1)); organizationDraftSchema.parse(p.organization); } });
    expect(max).toBe(2); expect(checkpoints.every((count, i) => !i || count >= checkpoints[i - 1])).toBe(true);
    expect(result.organization!.dual!.schemes.purpose.entries).toHaveLength(30); expect(mocks.generate).toHaveBeenCalledTimes(8);
  });
  it('keeps request totals unchanged between serial and concurrent execution', async () => {
    const measurements: { concurrency: number; max: number; requests: number }[] = [];
    for (const concurrency of [1, 3]) {
      let active = 0; let max = 0;
      mocks.generate.mockClear().mockImplementation(async args => {
        active++; max = Math.max(max, active);
        await new Promise(resolve => setTimeout(resolve, 5));
        active--; return reply(args);
      });
      const result = await run(proposal('quick', repos), { concurrency });
      measurements.push({ concurrency, max, requests: mocks.generate.mock.calls.length });
      expect(result.organization!.dual!.outcome).toBe('complete');
    }
    expect(measurements).toEqual([{ concurrency: 1, max: 1, requests: 8 }, { concurrency: 3, max: 3, requests: 8 }]);
    expect(mocks.readme).not.toHaveBeenCalled(); expect(mocks.docs).not.toHaveBeenCalled();
  });
  it('quick mode preserves unknown evidence without automatically supplementing it', async () => {
    mocks.generate.mockImplementation(args => {
      const result = JSON.parse(reply(args));
      if (JSON.parse(args.user).task.startsWith('Assign')) for (const row of result.results) Object.assign(row, { disposition: 'insufficient', categoryId: null, subcategoryId: null, understanding: { status: 'insufficient', purpose: [], technology: [] } });
      return JSON.stringify(result);
    });
    const result = await run(proposal('quick', repos.slice(0, 1))); expect(result.organization!.dual!.outcome).toBe('empty');
    expect(result.organization).toMatchObject({ status: 'interrupted', dual: { blocked: { code: 'NO_VALID_ASSIGNMENTS' } } });
    expect(mocks.docs).not.toHaveBeenCalled(); expect(result.organization!.dual!.schemes.purpose.entries[0].selected).toBe(false);
  });
  it('retains a valid purpose result when the technology half has an invalid target', async () => {
    mocks.generate.mockImplementation(args => { const content = JSON.parse(reply(args)); if (JSON.parse(args.user).schemes) for (const row of content.results) if (row.schemeId === 'technology') row.categoryId = 'invented'; return JSON.stringify(content); });
    const result = await run(proposal('quick', repos.slice(0, 1)));
    expect(result.organization!.dual!.schemes.purpose.entries[0].selected).toBe(true);
    expect(result.organization!.dual!.schemes.technology.entries[0].selected).toBe(false); expect(result.organization!.dual!.outcome).toBe('partial');
  });
  it('ignores late model results after stop and retains only the interruption checkpoint', async () => {
    const controller = new AbortController(); const publish = vi.fn(); let release!: (text: string) => void;
    mocks.generate.mockImplementation(() => new Promise<string>(resolve => { release = resolve; }));
    const pending = run(proposal(), { signal: controller.signal, onUpdate: publish });
    await vi.waitFor(() => expect(mocks.generate).toHaveBeenCalled()); controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' }); const count = publish.mock.calls.length;
    release('{"results":[]}'); await Promise.resolve(); expect(publish).toHaveBeenCalledTimes(count);
    expect(publish.mock.calls[publish.mock.calls.length - 1][0].organization.status).toBe('interrupted');
  });
  it('deep refresh keeps other facts, taxonomy and manually selected targets unchanged', async () => {
    const previous = await run(); previous.organization!.dual!.schemes.purpose.entries[0].manual = true;
    const categories = structuredClone(previous.organization!.dual!.schemes.purpose.categories);
    mocks.generate.mockClear(); mocks.readme.mockClear();
    const result = await run(previous, { retryOnly: true, enrichRepositoryIds: [1], analysisDepth: 'deep', preserveStructure: true });
    expect(mocks.readme).toHaveBeenCalledTimes(1); expect(result.organization!.dual!.schemes.purpose.categories).toEqual(categories);
    expect(result.organization!.dual!.schemes.purpose.entries[0]).toEqual(previous.organization!.dual!.schemes.purpose.entries[0]);
    expect(result.organization!.dual!.understanding[1]).toMatchObject({ status: 'understood', depth: 'quick' });
    expect(mocks.generate.mock.calls.every(([args]) => !JSON.parse(args.user).task.startsWith('Design'))).toBe(true);
  });
  it('does not reuse metadata-only quick facts as deep verification', async () => {
    const previous = await run(); mocks.readme.mockClear();
    await run(previous, { analysisDepth: 'deep' }); expect(mocks.readme).toHaveBeenCalledTimes(3);
  });
  it('marks outdated detailed analysis without deselecting an otherwise clear quick suggestion', async () => {
    const detailed = { ...repos[0], ai_details: { version: 1, generated_at: date, repository_pushed_at: '2026-09-01T00:00:00Z', model: 'fixture', problem: 'Compute equations', features: ['CLI solver'], scenarios: ['Research'], architecture: null, quickstart: [], deployment: null, cost: null, maintenance: null, sources: [{ label: 'README', url: `https://github.com/${repos[0].full_name}#readme`, retrieved_at: date }] } } as Repository;
    const result = await run(proposal('quick', [detailed]), { repositories: [detailed] });
    expect(result.organization!.dual!.understanding[0]).toMatchObject({ staleAnalysis: true, analysisGeneratedAt: date });
    expect(result.organization!.dual!.schemes.purpose.entries[0].selected).toBe(true); expect(mocks.readme).not.toHaveBeenCalled();
  });
  it('account switches prevent outstanding rows from being saved', async () => {
    let release!: (text: string) => void; const publish = vi.fn();
    mocks.generate.mockImplementation(() => new Promise<string>(resolve => { release = resolve; }));
    const pending = run(proposal('quick', repos.slice(0, 1)), { onUpdate: publish });
    await vi.waitFor(() => expect(mocks.generate).toHaveBeenCalled()); const count = publish.mock.calls.length;
    mocks.state.user = { id: 8 } as never; release('{"results":[]}');
    await expect(pending).rejects.toThrow('Account changed'); expect(publish).toHaveBeenCalledTimes(count);
  });
  it('selects relevant README sections instead of spending the budget on a long introduction', () => {
    const source = `# Title\n${'banner '.repeat(4000)}\n## Features\nUseful documented feature\n## Installation\npip install tool`;
    const result = selectOrganizationReadme(source); expect(result).toContain('Useful documented feature'); expect(result).toContain('pip install tool'); expect(result.length).toBeLessThanOrEqual(16000);
  });
  it('isolates actual AGY IO failures, keeps other batches and preserves request history on single-batch retry', async () => {
    const input = proposal('quick', repos); let fail = true;
    mocks.generate.mockImplementation(args => {
      const body = JSON.parse(args.user);
      if (fail && body.task.startsWith('Assign') && body.repositories.some((row: { repositoryId: number }) => row.repositoryId === 1)) throw new Error('AGY_IO_FAILED');
      return reply(args);
    });
    const result = await run(input, { concurrency: 3 });
    expect(result.organization!.dual!.blocked).toBeUndefined();
    expect(result.organization!.dual!.outcome).toBe('partial');
    expect(result.organization!.dual!.schemes.purpose.entries.filter(entry => entry.verification === 'verified')).toHaveLength(25);
    const previousAttempts = result.organization!.dual!.requests['assignments:both:0'];
    fail = false; mocks.generate.mockClear();
    const resumed = await run(result, { retryOnly: true, preserveStructure: true, retryRepositoryIds: repos.slice(0, 10).map(repo => repo.id) });
    expect(mocks.generate).toHaveBeenCalledOnce();
    expect(resumed.organization!.dual!.requests['assignments:both:0']).toBe(previousAttempts + 1);
    expect(resumed.organization!.dual!.outcome).toBe('complete');
  });
  it('covers 369 repositories with bounded batches and no separate quick understanding calls', async () => {
    const library = Array.from({ length: 369 }, (_, index) => ({ ...repos[0], id: index + 1, full_name: `fixture/project-${index}` }));
    mocks.state.repositories = library;
    const result = await run(proposal('quick', library), { repositories: library, concurrency: 5 });
    expect(result.organization!.dual!.schemes.purpose.entries.filter(entry => entry.verification === 'verified')).toHaveLength(369);
    expect(mocks.generate.mock.calls.every(([args]) => !JSON.parse(args.user).task.startsWith('Understand'))).toBe(true);
    expect(mocks.generate.mock.calls.every(([args]) => !JSON.parse(args.user).task.startsWith('Assign') || JSON.parse(args.user).repositories.length <= 10)).toBe(true);
  });
});
