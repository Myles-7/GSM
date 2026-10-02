import { vi } from 'vitest';
import type { Repository } from '../types';

export const repository: Repository = {
  id: 1, name: 'example-repository', full_name: 'owner/example-repository',
  description: 'Repository description', html_url: 'https://github.com/owner/example-repository',
  stargazers_count: 128, forks_count: 3, forks: 3, language: 'TypeScript',
  created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-02T00:00:00.000Z',
  pushed_at: '2026-01-03T00:00:00.000Z',
  owner: { login: 'owner', avatar_url: 'https://example.com/avatar.png' },
  topics: ['test'], ai_platforms: ['web'],
};

export const repositoryCardActions = {
  analyze: vi.fn(), findSimilar: vi.fn(), unstar: vi.fn(), toggleReleaseSubscription: vi.fn(),
  isSubscribed: false, isAnalyzing: false, isFindingSimilar: false, isUnstarring: false,
  vectorSearchAvailable: false,
};

export const storeState = {
  releaseSubscriptions: new Set<number>(), analyzingRepositoryIds: new Set<number>(),
  toggleReleaseSubscription: vi.fn(), githubToken: null, activeAIConfig: null,
  setAnalyzingRepository: vi.fn(), language: 'en' as const,
  updateRepository: vi.fn(), deleteRepository: vi.fn(),
  vectorSearchConfig: {
    enabled: false, workerUrl: '', authToken: '', embeddingConfigId: '',
    indexMode: 'readme' as const, readmeMaxChars: 6000,
  },
  vectorSearchStatus: null, embeddingConfigs: [], activeEmbeddingConfig: '',
  repositories: [repository], enterSimilarView: vi.fn(), aiConfigs: [],
};
