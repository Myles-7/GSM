import type { Repository } from '../../../types';
import type { CompiledSubscriptionPlan, CustomDiscoveryChannel, CandidateAssessment, ChannelDailyEdition } from './model';

export const makePlan = (): CompiledSubscriptionPlan => ({
  version: 1,
  required: [{ text: 'Runs locally', source: 'local' }],
  excluded: [{ text: 'Tutorial', source: 'no tutorials' }],
  preferred: [{ text: 'Windows support', source: 'Windows preferred' }],
  branches: [{ terms: ['local AI'], readme: false }, { terms: ['offline assistant'], readme: true }],
  filters: { language: null, minStars: null, maxStars: null, createdWithinDays: null },
  filterSources: { language: null, minStars: null, maxStars: null, createdWithinDays: null },
  conflicts: [],
});
export const makeChannel = (): CustomDiscoveryChannel => ({
  id: 'custom:test', name: 'Local AI', instruction: 'local; no tutorials; Windows preferred',
  revision: 1, plan: makePlan(), enabled: true, paused: false, ai: true, limit: 10, hour: 9,
  cursors: [], blocked: [], read: [], recommended: {},
});
export const makeRepo = (id = 1, changes: Partial<Repository> = {}): Repository => ({
  id, name: `tool${id}`, full_name: `owner/tool${id}`, description: 'Local AI assistant',
  html_url: `https://github.com/owner/tool${id}`, stargazers_count: 2, forks_count: 0, forks: 0,
  language: 'Python', created_at: '2020-01-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z',
  pushed_at: '2026-09-01T00:00:00Z', owner: { login: 'owner', avatar_url: '' }, topics: ['local-ai'],
  ...changes,
});
export const makeAssessment = (id = 1): CandidateAssessment => ({
  repo: makeRepo(id), verdict: 'match', reason: 'Runs locally', evidence: ['Runs locally without a server'],
  method: 'ai', relevance: 3, preference: 0,
});
export const makeEdition = (): ChannelDailyEdition => ({
  channelId: 'custom:test', date: '2026-09-28', revision: 1, instruction: makeChannel().instruction,
  entries: [makeAssessment()], pending: [], errors: [], complete: true, searched: 4, filtered: 2,
  generatedAt: '2026-09-28T09:00:00Z',
});
