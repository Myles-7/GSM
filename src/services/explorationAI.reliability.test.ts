import { afterEach, describe, expect, it, vi } from 'vitest';
import { AIService } from './aiService';
import { analyzeExplorationBatch, ExplorationValidationError, parseExplorationBatchResult } from './explorationAI';
import { repositoryFixture } from '../features/repositories/exploration/testFixtures';
import type { AIConfig } from '../types';
import { parseAIJson } from '../utils/aiJson';

const repos = [repositoryFixture(1), repositoryFixture(2)];
const row = (id: number) => ({ repositoryId: id, summary: 'A tool', topics: [], entities: [], relations: [] });
const source = new Map(repos.map(repo => [repo.id, []]));
const parse = (projects: unknown[]) => parseExplorationBatchResult(JSON.stringify({ projects }), repos, source, new Set([1, 2]));
const config: AIConfig = { id: 'test', name: 'test', model: 'test', baseUrl: 'https://example.com', apiKey: 'test', isActive: true };
const options = () => ({ ownerId: '1', repositories: repos, allRepositories: repos, config, language: 'zh', token: '', signal: new AbortController().signal, guard: () => {}, knownTopics: [], query: 'Codex', recovered: { text: JSON.stringify({ projects: [row(1), { repositoryId: 2 }] }), sources: [...source] } });
afterEach(() => vi.restoreAllMocks());

describe('bounded structured exploration recovery', () => {
  it('extracts complete fenced JSON and respects escaped quotation boundaries', () => {
    expect(parseAIJson('\uFEFF```json\n{"value":"a } \\" b"}\n```')).toEqual({ value: 'a } " b' });
    expect(parseAIJson('Result:\n{"ok":true}\nDone.')).toEqual({ ok: true });
    expect(() => parseAIJson('{"projects":[{"repositoryId":1}')).toThrow(SyntaxError);
    expect(() => parseAIJson('{"a":1} {"a":2}')).toThrow(SyntaxError);
  });
  it('isolates invalid, missing, duplicate and unknown identities without losing valid siblings', () => {
    expect(parse([row(1), { repositoryId: 2 }]).profiles.map(value => value.repositoryId)).toEqual([1]);
    expect(parse([row(1)]).issues[0]).toMatchObject({ repositoryId: 2, code: 'missing_project' });
    expect(parse([row(1), row(1), row(2)]).profiles.map(value => value.repositoryId)).toEqual([2]);
    expect(parse([row(999), row(2)]).profiles.map(value => value.repositoryId)).toEqual([2]);
  });
  it('saves valid siblings before one targeted repair and never includes them in the repair request', async () => {
    const events: string[] = [];
    const request = vi.spyOn(AIService.prototype, 'generateChatText').mockResolvedValue(JSON.stringify({ projects: [row(2)] }));
    const result = await analyzeExplorationBatch({ ...options(), onPartial: async values => { events.push(`saved:${values.map(value => value.repositoryId)}`); }, prepareRepair: async ids => { events.push(`repair:${ids}`); return {}; } });
    expect(events).toEqual(['saved:1', 'repair:2', 'saved:2']);
    expect(result.map(value => value.repositoryId)).toEqual([1, 2]);
    expect(JSON.parse(request.mock.calls[0][0].user).projects.map((value: { repositoryId: number }) => value.repositoryId)).toEqual([2]);
    expect(request).toHaveBeenCalledOnce();
    expect(request.mock.calls[0][0].responseContract).toBe('exploration-profiles-v3');
  });
  it('keeps valid results after the single repair is invalid, with no recursive calls', async () => {
    const request = vi.spyOn(AIService.prototype, 'generateChatText').mockResolvedValue('{"projects":');
    const saved = vi.fn(async () => {});
    await expect(analyzeExplorationBatch({ ...options(), onPartial: saved, prepareRepair: async () => ({}) })).rejects.toBeInstanceOf(ExplorationValidationError);
    expect(saved).toHaveBeenCalledOnce(); expect(request).toHaveBeenCalledOnce();
  });
  it('reuses an existing repair result without calling the model or preparing another repair', async () => {
    const request = vi.spyOn(AIService.prototype, 'generateChatText'); const prepare = vi.fn();
    const profiles = await analyzeExplorationBatch({ ...options(), prepareRepair: prepare, recoveredRepair: { text: JSON.stringify({ projects: [row(2)] }), sources: [...source], repositoryIds: [2] } });
    expect(profiles).toHaveLength(2); expect(request).not.toHaveBeenCalled(); expect(prepare).not.toHaveBeenCalled();
  });
  it('does not turn a provider outage into another format repair request', async () => {
    const request = vi.spyOn(AIService.prototype, 'generateChatText').mockRejectedValue(new Error('AGY_SERVICE_UNAVAILABLE'));
    const prepare = vi.fn(async () => ({}));
    await expect(analyzeExplorationBatch({ ...options(), prepareRepair: prepare })).rejects.toThrow('AGY_SERVICE_UNAVAILABLE');
    expect(request).toHaveBeenCalledOnce(); expect(prepare).toHaveBeenCalledOnce();
  });
});
