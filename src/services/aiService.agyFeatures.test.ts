import { beforeEach, expect, it, vi } from 'vitest';
import type { AIConfig, Gist, Repository } from '../types';
import { AIService } from './aiService';
import { generateAgyText } from './agyClient';

vi.mock('./agyClient', () => ({ generateAgyText: vi.fn() }));
vi.mock('./backendAdapter', () => ({ backend: { isAvailable: false } }));
const config: AIConfig = { id: 'agy-cli-local', name: 'AGY', provider: 'agy-cli', model: 'global', agyEffort: 'high',
  agyMode: 'model', deviceBound: true, isActive: true, agyRevision: 9 };
const repo = { id: 1, name: 'notes', full_name: 'test/notes', description: 'Markdown notes', language: 'TypeScript', topics: ['notes'], stargazers_count: 1 } as Repository;
const gist = { id: 'g', description: 'Example', files: {} } as Gist;
beforeEach(() => vi.mocked(generateAgyText).mockReset());

it.each([
  ['repository-summary', '{"summary":"Markdown notes","tags":["notes"],"platforms":[]}', (ai: AIService) => ai.analyzeRepository(repo, '# Notes')],
  ['gist-summary', 'Example summary', (ai: AIService) => ai.analyzeGist(gist, 'Example')],
  ['release-summary', '- Fix', (ai: AIService) => ai.analyzeReleaseSummary('Fix', { repoName: 'test/notes', tagName: 'v1' })],
  ['query-expansion', 'Markdown notes', (ai: AIService) => ai.generateHyDEQuery('notes')],
  ['repository-rerank', '[1]', (ai: AIService) => ai.searchRepositoriesWithSemanticReranking([repo], 'notes')],
  ['gist-rerank', '["g"]', (ai: AIService) => ai.searchGistsWithReranking([gist], 'example')],
  ['discovery', '{}', (ai: AIService) => ai.compileDiscoverySubscription('notes')],
  ['discovery', '[]', (ai: AIService) => ai.assessDiscoverySubscription({}, [{ id: 1, text: 'notes' }])],
] as const)('routes %s with an explicit feature and the original configuration version', async (feature, output, run) => {
  vi.mocked(generateAgyText).mockResolvedValue(output);
  await run(new AIService(config, 'en'));
  expect(generateAgyText).toHaveBeenCalledWith(expect.objectContaining({ agyRevision: 9 }), expect.objectContaining({ feature }));
});
