import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { profileFixture, repositoryFixture } from '../features/repositories/exploration/testFixtures';
import { conceptId } from '../features/repositories/exploration/model';
import type { AIConfig } from '../types';
const mocks = vi.hoisted(() => ({ generate: vi.fn(), readme: vi.fn(), documentation: vi.fn() }));
vi.mock('./aiService', () => ({ AIService: class { generateChatText = mocks.generate; } }));
vi.mock('./githubApiFactory', () => ({ createGitHubApiService: () => ({ getRepositoryReadme: mocks.readme }) }));
vi.mock('./aiOrganizationReadiness', () => ({ assertOrganizationModelReady: vi.fn() }));
vi.mock('./aiOrganizationEvidence', () => ({ readOrganizationDocumentation: mocks.documentation, throwSharedEvidenceError: (reason: unknown) => { throw reason; } }));
import { analyzeExplorationBatch, consolidateExplorationTopics, readExplorationEvidence, repositoryExplorationSources } from './explorationAI';
const config: AIConfig = { id: 'configured-model', name: 'Configured model', model: 'model', baseUrl: 'https://provider.invalid', apiKey: 'not-for-prompts', isActive: true };
beforeEach(() => {
  vi.clearAllMocks(); mocks.readme.mockResolvedValue('This plugin supports Codex workflows.'); mocks.documentation.mockResolvedValue([]);
  mocks.generate.mockImplementation(async ({ user, system }: { user: string; system: string }) => {
    const request = JSON.parse(user);
    if (system.includes('compact JSON')) return JSON.stringify({ assignments: request.projects.map((repo: { repositoryId: number; sources: { id: string }[] }) => [repo.repositoryId, [['编程智能体', repo.sources[0].id]]]) });
    return JSON.stringify({ projects: request.projects.map((repo: { repositoryId: number; sources: { id: string; text: string }[] }) => {
      const source = repo.sources.find(row => row.id === 'readme') ?? repo.sources[0];
      const quote = source.id === 'readme' ? 'This plugin supports Codex workflows.' : source.text.slice(0, 120);
      const citations = [{ sourceId: source.id, quote }];
      return { repositoryId: repo.repositoryId, summary: '开发工作流', topics: [{ label: '编程智能体', citations }], entities: [{ label: 'OpenAI Codex', aliases: ['Codex'], description: '工具生态' }], relations: [{ targetType: 'entity', target: 'OpenAI Codex', kind: 'interoperable', branch: '工作流集成', reason: '提供工作流集成', citations }] };
    }) });
  });
});
describe('exploration AI and evidence integration', () => {
  const options = () => ({ ownerId: crypto.randomUUID(), repositories: [repositoryFixture(1)], allRepositories: [repositoryFixture(1)], config, language: 'zh', token: '', signal: new AbortController().signal, guard: vi.fn(), knownTopics: [] });
  it('bounds deep evidence while retaining literal target mentions beyond long introductions', async () => {
    const input = options();
    const readme = 'Introduction '.repeat(2000) + '\nThis plugin supports Codex workflows.\n' + 'Unrelated background '.repeat(2000);
    mocks.readme.mockResolvedValue(readme);
    await analyzeExplorationBatch({ ...input, query: 'Codex' });
    const payload = JSON.parse(mocks.generate.mock.calls[0][0].user);
    const docs = payload.projects[0].sources.filter((s: { kind: string }) => s.kind === 'readme');
    expect(docs.reduce((n: number, s: { text: string }) => n + s.text.length, 0)).toBeLessThanOrEqual(8000);
    expect(docs.some((s: { text: string }) => s.text.includes('This plugin supports Codex workflows.'))).toBe(true);
    expect(docs.every((s: { text: string }) => s.text.length > 0 && readme.includes(s.text))).toBe(true);
  });
  it('validates a saved provider result without fetching documentation or starting a new model request',async()=>{
    const input=options();const onResponse=vi.fn();
    const result=await analyzeExplorationBatch({...input,recovered:{text:JSON.stringify({assignments:[[1,[['编程智能体','analysis']]]]}),sources:[[1,repositoryExplorationSources(input.repositories[0])]]},onResponse});
    expect(result[0].topics[0].label).toBe('编程智能体');expect(mocks.generate).not.toHaveBeenCalled();expect(mocks.readme).not.toHaveBeenCalled();expect(onResponse).toHaveBeenCalledOnce();
  });
  it('does no work at import, and verifies candidate documentation only after explicit analysis', async () => {
    expect(mocks.generate).not.toHaveBeenCalled(); expect(mocks.readme).not.toHaveBeenCalled();
    const result = await analyzeExplorationBatch({ ...options(), query: 'Codex' });
    expect(result[0].relations[0]).toMatchObject({ kind: 'interoperable', verified: true });
    expect(mocks.readme).toHaveBeenCalledOnce(); expect(mocks.generate.mock.calls[0][0].user).not.toContain('not-for-prompts');
  });
  it('reuses source cache, while full manual refresh can explicitly re-read evidence', async () => {
    const input = { ...options(), query: 'Codex' };
    await analyzeExplorationBatch(input); await analyzeExplorationBatch(input);
    expect(mocks.readme).toHaveBeenCalledTimes(1);
    await analyzeExplorationBatch({ ...input, refreshDocuments: true }); expect(mocks.readme).toHaveBeenCalledTimes(2);
  });
  it('bounds an unresponsive documentation request and propagates cancellation to GitHub', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    mocks.readme.mockImplementation((_owner: string, _name: string, signal: AbortSignal) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })));
    try {
      const input = options(); const promise = readExplorationEvidence(input.ownerId, input.repositories[0], '', input.signal, input.guard);
      const rejected = expect(promise).rejects.toThrow('EXPLORATION_DOCUMENT_TIMEOUT');
      await vi.waitFor(() => expect(mocks.readme).toHaveBeenCalledOnce());
      await vi.advanceTimersByTimeAsync(15000); await rejected;
      expect(mocks.readme.mock.calls[0][2].aborted).toBe(true);
    } finally { vi.useRealTimers(); }
  });
  it('builds a compact first-pass map in one call without hidden documentation or verification calls', async () => {
    const result = await analyzeExplorationBatch(options());
    expect(mocks.generate).toHaveBeenCalledTimes(1); expect(mocks.readme).not.toHaveBeenCalled();
    expect(result[0].relations).toHaveLength(0); expect(result[0].topics[0].label).toBe('编程智能体'); expect(result[0].evidence[0].verified).toBe(false);
    expect(mocks.generate.mock.calls[0][0].maxTokens).toBe(900);
  });
  it('bounds oversized saved analysis and reports request and validation phases', async () => {
    const input = options(); input.repositories[0].ai_summary = 'A'.repeat(20000);
    const onProgress = vi.fn(); await analyzeExplorationBatch({ ...input, onProgress });
    const request = mocks.generate.mock.calls[0][0];
    expect(JSON.parse(request.user).projects[0].sources.every((source: { text: string }) => source.text.length <= 5000)).toBe(true);
    expect(onProgress).toHaveBeenCalledWith('提交当前批次给模型'); expect(onProgress).toHaveBeenCalledWith('校验项目身份与引用依据');
    request.onLifecycle('initializing'); request.onSent();
    expect(onProgress).toHaveBeenCalledWith('初始化独立模型进程'); expect(onProgress).toHaveBeenCalledWith('请求已发送，等待模型生成');
  });
  it('does not block a local first-pass map on missing analysis or unavailable GitHub', async () => {
    const input = options(); input.repositories[0].ai_summary = undefined;
    mocks.readme.mockRejectedValue(new Error('network offline'));
    await analyzeExplorationBatch(input); expect(mocks.readme).not.toHaveBeenCalled(); expect(mocks.generate).toHaveBeenCalledOnce();
  });
  it('invalidates source cache when the repository semantic input changes', async () => {
    const input = { ...options(), query: 'Codex' }; await analyzeExplorationBatch(input);
    await analyzeExplorationBatch({ ...input, repositories: [{ ...input.repositories[0], pushed_at: '2026-10-19' }] });
    expect(mocks.readme).toHaveBeenCalledTimes(2);
  });
  it('consolidates equivalent topic IDs while retaining project identities and evidence', async () => {
    const profiles = Object.fromEntries(Array.from({ length: 12 }, (_, index) => {
      const profile = profileFixture(repositoryFixture(index + 1)); profile.topics = [{ id: conceptId('topic', `topic ${index}`), label: `topic ${index}` }]; return [String(index + 1), profile];
    }));
    const source = profiles['2'].topics[0].id, target = profiles['1'].topics[0].id;
    mocks.generate.mockResolvedValueOnce(JSON.stringify({ groups: [{ sourceIds: [source], targetId: target }] }));
    const result = await consolidateExplorationTopics(profiles, config, 'zh', new Set([target]), new AbortController().signal, () => {});
    expect(result['2'].topics[0].id).toBe(target); expect(profiles['2'].topics[0].id).toBe(source); expect(result['2'].fingerprint).toBe(profiles['2'].fingerprint);
    mocks.generate.mockResolvedValueOnce(JSON.stringify({ groups: [{ sourceIds: [target], targetId: source }] }));
    await expect(consolidateExplorationTopics(profiles, config, 'zh', new Set([target]), new AbortController().signal, () => {})).rejects.toThrow('主题身份');
  });
});
