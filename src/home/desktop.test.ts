import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import type { AppState } from '../types';

const mocks = vi.hoisted(() => ({ state: {} as AppState, exportWorkbench: vi.fn() }));
vi.mock('../store/useAppStore', () => ({ useAppStore: { getState: () => mocks.state, setState: vi.fn(), subscribe: vi.fn(() => () => {}) } }));
vi.mock('../services/backendAdapter', () => ({ backend: { isAvailable: false } }));
vi.mock('../services/repositoryChatStorage', () => ({ repositoryChatStorage: { exportWorkbench: mocks.exportWorkbench } }));
import { desktopSeed, desktopStoreRecords } from './desktop';

const fixture = () => ({ user: { id: 42 }, repositories: [{ id: 1, name: 'repo', full_name: 'owner/repo', custom_tags: ['tag'] }], releases: [{ id: 2, tag_name: 'v1' }],
  releaseSubscriptions: new Set([1]), readReleases: new Set([2]), customCategories: [{ id: 'custom', name: 'Mine' }], hiddenDefaultCategoryIds: [], categoryOrder: ['custom'], subcategories: [], subcategoryOrder: [], repositoryOrder: [1], defaultCategoryOverrides: {}, categoryListIdMap: { custom: 'list-id' }, releaseSourceSettings: {}, githubToken: 'do-not-export', backendApiSecret: 'also-private', proxyConfig: { password: 'private' },
} as unknown as AppState);

describe('desktop home bootstrap mapping', () => {
  it('exports stable IDs, one organization and affirmative read/subscription markers without credentials', () => {
    const state = fixture(); const records = desktopStoreRecords(state);
    expect(records.map(row => `${row.collection}:${row.id}`)).toEqual(['repositories:1', 'releases:2', 'organization:default', 'subscriptions:1', 'release_reads:2']);
    expect(records.find(row => row.collection === 'subscriptions')?.data).toEqual({ repoId: 1, subscribed: true });
    expect(records.find(row => row.collection === 'release_reads')?.data).toEqual({ releaseId: 2, isRead: true });
    expect(records.find(row => row.collection === 'organization')?.data.categoryListIdMap).toEqual({ custom: 'list-id' });
    expect(JSON.stringify(records)).not.toContain('private'); expect(JSON.stringify(records)).not.toContain('do-not-export');
    state.repositories[0].custom_tags!.push('later');
    expect(records[0].data.custom_tags).toEqual(['tag']);
  });
  it('preserves chat IDs and account-scoped relationships during desktop import', async () => {
    mocks.state = fixture();
    mocks.exportWorkbench.mockResolvedValue({ sessions: [{ id: 'session', ownerId: '42' }], messages: [{ id: 'message', sessionId: 'session', evidenceIds: ['evidence'] }], evidence: [{ id: 'evidence', path: 'README.md' }], projects: [{ id: 'project' }], proposals: [{ id: 'proposal', sessionId: 'session' }] });
    const records = await desktopSeed();
    expect(mocks.exportWorkbench).toHaveBeenCalledWith('42');
    expect(records.find(row => row.id === 'message')?.data.sessionId).toBe('session');
    expect(records.find(row => row.id === 'proposal')?.data.sessionId).toBe('session');
    expect(new Set(records.map(row => `${row.collection}:${row.id}`)).size).toBe(records.length);
  });
});
