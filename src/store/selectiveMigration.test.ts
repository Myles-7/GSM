import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DiscoveryRepo, GitHubUser, Repository } from '../types';
import type { ExternalDiscoveryChannel, ExternalFeedKind } from '../types/externalFeed';
import { emptyAccountWorkspace } from './helpers/accountWorkspace';
import { flushAppStorePersistence } from './persistence/storage';
import { remapRepositoryList } from '../utils/repositoryIdentity';

// Keep the real Store, migration, JSON serialization and hydration; fake only disk I/O.
const memory = vi.hoisted(() => {
  const records = new Map<string, string>();
  return {
    records,
    storage: {
      getItem: vi.fn(async (key: string) => records.get(key) ?? null),
      setItem: vi.fn(async (key: string, value: string) => { records.set(key, value); }),
      removeItem: vi.fn(async (key: string) => { records.delete(key); }),
    },
  };
});
vi.mock('../services/indexedDbStorage', () => ({ indexedDBStorage: memory.storage }));

type ActualStoreModule = typeof import('./useAppStore');
type Store = ActualStoreModule['useAppStore'];
type State = ReturnType<Store['getState']>;
let store: Store;

const persistKey = 'github-stars-manager';
const oldId = 1_700_000_000_001;
const alice: GitHubUser = { id: 41, login: 'alice', name: 'Alice', avatar_url: '', email: null };
const bob: GitHubUser = { id: 42, login: 'bob', name: 'Bob', avatar_url: '', email: null };
const repository = (id: number, patch: Partial<Repository> = {}): Repository => ({
  id, name: 'sample', full_name: 'owner/sample', description: null,
  html_url: 'https://github.com/owner/sample', stargazers_count: 0, forks_count: 0, forks: 0,
  language: null, topics: [], owner: { login: 'owner', avatar_url: '' },
  created_at: '2026-01-01', updated_at: '2026-01-02', pushed_at: '2026-01-02',
  ...patch,
});
const external = (id: ExternalDiscoveryChannel['id'], enabled = true): ExternalDiscoveryChannel => ({
  id, name: id, nameEn: id, icon: 'search', description: '', enabled,
  sourceUrl: `https://example.com/${id.slice('external:'.length)}/feed`, sourceKind: 'rss',
});
const externalChannels = () => store.getState().discoveryChannels.filter(
  (channel): channel is ExternalDiscoveryChannel => channel.id.startsWith('external:'),
);
const runtimeKeys = [
  'discoveryRepos', 'discoveryLastRefresh', 'discoveryIsLoading', 'discoveryIsLoadingMore',
  'discoveryLoadMoreError', 'discoveryHasMore', 'discoveryNextPage', 'discoveryTotalCount',
  'discoveryScrollPositions',
] as const;

function addFeed(name: string, url: string, kind: ExternalFeedKind = 'rss'): ExternalDiscoveryChannel {
  expect(store.getState().addExternalDiscoveryChannel(name, url, kind, store.getState().user!.id)).toBe(true);
  const channel = externalChannels().find(item => item.sourceUrl === url);
  expect(channel).toBeDefined();
  return channel!;
}

function seedRuntime(id: ExternalDiscoveryChannel['id']): State {
  const cached: DiscoveryRepo = { ...repository(421), channel: id, platform: 'All', rank: 1 };
  const actions = store.getState();
  actions.setDiscoveryRepos(id, [cached]);
  actions.setDiscoveryLastRefresh(id, '2026-01-03');
  actions.setDiscoveryLoading(id, true);
  actions.setDiscoveryLoadingMore(id, true);
  actions.setDiscoveryLoadMoreError(id, 'stale error');
  actions.setDiscoveryHasMore(id, true);
  actions.setDiscoveryNextPage(id, 9);
  actions.setDiscoveryTotalCount(id, 17);
  actions.setDiscoveryScrollPosition(id, 123);
  return store.getState();
}

function expectRuntimeRemoved(ids: ExternalDiscoveryChannel['id'][], before: State) {
  const state = store.getState();
  for (const key of runtimeKeys) {
    for (const id of ids) expect(state[key], `${key}: ${id}`).not.toHaveProperty(id);
    expect(state[key].trending, `${key}: built-in survives`).toEqual(before[key].trending);
  }
}

function persistenceOptions() {
  const options = store.persist.getOptions();
  if (!options.partialize || !options.migrate || !options.merge) throw new Error('Missing real persistence API');
  return { ...options, partialize: options.partialize, migrate: options.migrate, merge: options.merge };
}

async function hydrateEnvelope(state: unknown, version: number) {
  memory.records.set(persistKey, JSON.stringify({ state, version }));
  await store.persist.rehydrate();
  await flushAppStorePersistence();
}

function savedEnvelope(): { version: number; state: Record<string, unknown> } {
  const text = memory.records.get(persistKey);
  expect(text).toBeDefined();
  return JSON.parse(text!);
}

beforeAll(async () => {
  // setup.ts mocks the root Store; bypass that mock explicitly.
  ({ useAppStore: store } = await vi.importActual<ActualStoreModule>('./useAppStore'));
  await store.persist.rehydrate();
});

beforeEach(async () => {
  await flushAppStorePersistence();
  memory.records.clear();
  localStorage.clear();
  sessionStorage.clear();
  vi.clearAllMocks();
  store.setState(store.getInitialState(), true);
  await flushAppStorePersistence();
});

afterEach(async () => {
  await flushAppStorePersistence();
  vi.restoreAllMocks();
});

describe('selective migration real Store repository writes', () => {
  it('uses the actual Store, not the setup selector mock', () => {
    expect(vi.isMockFunction(store)).toBe(false);
    expect(store.getState().addRepository).toBeTypeOf('function');
    expect(persistenceOptions().version).toBe(17);
  });

  it('adds the supplied real GitHub ID without rewriting a same-name unconfirmed synthetic record', () => {
    store.getState().setRepositories([repository(oldId, { custom_description: '', category_locked: true })]);
    store.getState().addRepository(repository(421));
    const rows = store.getState().repositories;
    expect(rows.map(repo => repo.id)).toEqual([oldId, 421]);
    expect(rows.find(repo => repo.id === oldId)).toMatchObject({ custom_description: '', category_locked: true });
    expect(rows.find(repo => repo.id === 421)).not.toHaveProperty('custom_description');
    expect(store.getState().repositoryOrder).toEqual([oldId, 421]);
  });

  it.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid new ID %s without mutating live state', id => {
      store.getState().addRepository(repository(421));
      const before = store.getState();
      expect(() => store.getState().addRepository(repository(id))).toThrow('INVALID_GITHUB_REPOSITORY_ID');
      expect(store.getState()).toBe(before);
    },
  );

  it('updates a renamed real ID while keeping manual clears and locks', () => {
    store.getState().addRepository(repository(421, {
      custom_description: '', custom_tags: [], custom_category: '',
      category_id: null, category_locked: true, last_edited: '2026-01-03',
    }));
    store.getState().addRepository(repository(421, {
      name: 'renamed', full_name: 'another/renamed',
      custom_description: 'stale suggestion', custom_tags: ['stale'], category_locked: false,
    }));
    expect(store.getState().repositories).toHaveLength(1);
    expect(store.getState().repositories[0]).toMatchObject({
      id: 421, full_name: 'another/renamed', custom_description: '', custom_tags: [],
      custom_category: '', category_id: null, category_locked: true, last_edited: '2026-01-03',
    });
  });

  it('keeps a reused name separate from another real ID and its personal metadata', () => {
    store.getState().addRepository(repository(421, { custom_description: 'original only', custom_tags: ['mine'] }));
    store.getState().addRepository(repository(422));
    expect(store.getState().repositories.map(repo => repo.id)).toEqual([421, 422]);
    expect(store.getState().repositories.find(repo => repo.id === 422)).not.toHaveProperty('custom_description');
    expect(store.getState().repositories.find(repo => repo.id === 421)?.custom_tags).toEqual(['mine']);
  });

  it('keeps a manually cleared locked category pending after late analysis and hydration', async () => {
    store.setState({ customCategories: [{ id: 'personal', name: 'Personal', icon: 'folder', keywords: ['alpha'], isCustom: true }] });
    store.getState().addRepository(repository(421, {
      custom_description: '', custom_category: '', category_id: null, category_locked: true,
    }));
    store.getState().updateRepository({
      ...store.getState().repositories[0], analyzed_at: '2026-01-04', ai_tags: ['alpha'],
      custom_category: 'Personal', category_id: 'personal', category_locked: false,
    });
    expect(store.getState().repositories[0]).toMatchObject({
      custom_description: '', custom_category: '', category_id: null, category_locked: true,
      category_candidates: ['personal'],
    });
    await flushAppStorePersistence();
    await store.persist.rehydrate();
    expect(store.getState().repositories[0]).toMatchObject({
      custom_description: '', custom_category: '', category_id: null, category_locked: true,
    });
  });

  it('does not recreate a locally deleted source while replaying an identity mapping', () => {
    store.getState().addRepository(repository(oldId));
    store.getState().deleteRepository(oldId);
    const result = remapRepositoryList(store.getState().repositories, [{
      oldId, newId: 421, fullName: 'owner/sample', evidence: 'Previously confirmed mapping',
    }]);
    store.getState().setRepositories(result, { allowEmpty: true });
    expect(store.getState().repositories).toEqual([]);
    expect(store.getState().searchResults).toEqual([]);
    expect(store.getState().repositoryOrder).toEqual([]);
  });
});

describe('account-owned external configuration and runtime', () => {
  it('isolates external feeds by GitHub account ID, clears runtime and preserves built-in preferences', () => {
    store.getState().setUser(alice);
    store.getState().toggleDiscoveryChannel('trending');
    const feedA = addFeed('Alice RSS', 'https://example.com/alice/feed');
    store.getState().setSelectedDiscoveryChannel(feedA.id);
    const beforeA = seedRuntime(feedA.id);
    store.getState().setUser(bob);

    expect(externalChannels()).toEqual([]);
    expect(store.getState().accountWorkspaces[String(alice.id)].externalDiscoveryChannels).toEqual([feedA]);
    expect(store.getState().discoveryChannels.find(channel => channel.id === 'trending')?.enabled).toBe(false);
    expect(store.getState().discoveryChannels.some(channel => channel.enabled && channel.id === store.getState().selectedDiscoveryChannel)).toBe(true);
    expectRuntimeRemoved([feedA.id], beforeA);

    const feedB = addFeed('Bob RSS', 'https://example.com/bob/feed');
    store.getState().setSelectedDiscoveryChannel(feedB.id);
    const beforeB = seedRuntime(feedB.id);
    store.getState().setUser(alice);
    expect(externalChannels()).toEqual([feedA]);
    expect(store.getState().accountWorkspaces[String(bob.id)].externalDiscoveryChannels).toEqual([feedB]);
    expectRuntimeRemoved([feedA.id, feedB.id], beforeB);
    expect(store.getState().selectedDiscoveryChannel).not.toBe(feedB.id);
  });

  it('does not recapture or clear feeds/runtime when the same account changes login name', () => {
    store.getState().setUser(alice);
    const feed = addFeed('RSS', 'https://example.com/feed');
    store.getState().setSelectedDiscoveryChannel(feed.id);
    const before = seedRuntime(feed.id);
    store.getState().setUser({ ...alice, login: 'renamed-alice' });
    expect(externalChannels()).toEqual([feed]);
    expect(store.getState().selectedDiscoveryChannel).toBe(feed.id);
    for (const key of runtimeKeys) expect(store.getState()[key]).toEqual(before[key]);
  });

  it('rejects a stale account-bound add and any logged-out external add', () => {
    store.getState().setUser(alice);
    store.getState().setUser(bob);
    const before = store.getState();
    expect(store.getState().addExternalDiscoveryChannel('Stale', 'https://example.com/feed', 'rss', alice.id)).toBe(false);
    expect(store.getState()).toBe(before);
    store.getState().logout();
    expect(store.getState().addExternalDiscoveryChannel('No account', 'https://example.com/feed', 'rss')).toBe(false);
    expect(externalChannels()).toEqual([]);
  });

  it('removes only the selected feed, clears every runtime map, and does not delete another account feed', () => {
    store.getState().setUser(alice);
    const feedA = addFeed('Alice', 'https://example.com/alice/feed');
    store.getState().setUser(bob);
    const feedB = addFeed('Bob', 'https://example.com/bob/feed');
    const survivor = addFeed('Keep', 'https://example.com/keep/feed');
    seedRuntime(survivor.id);
    store.getState().setSelectedDiscoveryChannel(feedB.id);
    const before = seedRuntime(feedB.id);

    store.getState().removeExternalDiscoveryChannel(feedA.id);
    expect(store.getState().accountWorkspaces[String(alice.id)].externalDiscoveryChannels).toEqual([feedA]);
    store.getState().removeExternalDiscoveryChannel(feedB.id);
    expect(externalChannels()).toEqual([survivor]);
    expectRuntimeRemoved([feedB.id], before);
    for (const key of runtimeKeys) expect(store.getState()[key][survivor.id]).toEqual(before[key][survivor.id]);
    expect(store.getState().selectedDiscoveryChannel).not.toBe(feedB.id);

    store.getState().setUser(alice);
    expect(externalChannels()).toEqual([feedA]);
    store.getState().setUser(bob);
    expect(externalChannels()).toEqual([survivor]);
  });

  it('does not remove built-in channels through the external removal API', () => {
    const before = store.getState();
    store.getState().removeExternalDiscoveryChannel('trending');
    expect(store.getState()).toBe(before);
  });

  it('parks external configuration on logout, clears runtime, and restores only that account configuration', () => {
    store.getState().setUser(alice);
    const feed = addFeed('Alice', 'https://example.com/alice/feed');
    store.getState().setSelectedDiscoveryChannel(feed.id);
    const before = seedRuntime(feed.id);
    store.getState().logout();
    expect(store.getState().user).toBeNull();
    expect(externalChannels()).toEqual([]);
    expect(store.getState().accountWorkspaces[String(alice.id)].externalDiscoveryChannels).toEqual([feed]);
    expectRuntimeRemoved([feed.id], before);
    expect(store.getState().selectedDiscoveryChannel).not.toBe(feed.id);
    store.getState().setUser(bob);
    expect(externalChannels()).toEqual([]);
    store.getState().setUser(alice);
    expect(externalChannels()).toEqual([feed]);
    expectRuntimeRemoved([feed.id], before);
  });
});

describe('v16 to v17 external persistence round trip', () => {
  it.each(['rss', undefined] as const)('retains external configuration, parked accounts and manual clears with source kind %s', async kind => {
    const feedA = { ...external('external:alice'), sourceKind: kind };
    const feedB = external('external:bob', false);
    const initial = store.getInitialState();
    const snapshot = persistenceOptions().partialize({
      ...initial, user: alice, githubToken: 'fixture-only-token', isAuthenticated: true,
      repositories: [repository(oldId, {
        custom_description: '__EMPTY__', custom_category: '', category_locked: true,
      })],
      discoveryChannels: [
        ...initial.discoveryChannels.map(channel => ({ ...channel, enabled: channel.id !== 'trending' })),
        feedA,
      ],
      selectedDiscoveryChannel: feedA.id,
      accountWorkspaces: { [String(bob.id)]: { ...emptyAccountWorkspace(), externalDiscoveryChannels: [feedB] } },
      theme: 'light', pageTranslationEnabled: true,
    });
    await hydrateEnvelope(snapshot, 16);
    expect(externalChannels()[0]).toMatchObject({ id: feedA.id, sourceUrl: feedA.sourceUrl, enabled: true });
    expect(externalChannels()[0].sourceKind).toBe(kind);
    expect(store.getState().selectedDiscoveryChannel).toBe(feedA.id);
    expect(store.getState().accountWorkspaces[String(bob.id)].externalDiscoveryChannels).toEqual([feedB]);
    expect(store.getState().repositories[0]).toMatchObject({
      id: oldId, custom_description: '', custom_category: '', category_locked: true, category_id: null,
    });
    expect(store.getState()).toMatchObject({ theme: 'light', pageTranslationEnabled: true });
    const saved = savedEnvelope();
    expect(saved.version).toBe(17);
    expect(saved.state.discoveryChannels).toEqual(store.getState().discoveryChannels);
    for (const key of runtimeKeys) expect(saved.state).not.toHaveProperty(key);

    await hydrateEnvelope(saved.state, saved.version);
    expect(savedEnvelope().state).toEqual(saved.state);
    expect(store.getState().repositories[0].custom_description).toBe('');
    store.getState().setUser(bob);
    expect(externalChannels()).toEqual([feedB]);
    expect(store.getState().selectedDiscoveryChannel).not.toBe(feedB.id);
    store.getState().setUser(alice);
    expect(externalChannels()[0]).toMatchObject({ id: feedA.id, sourceUrl: feedA.sourceUrl, sourceKind: kind });
  });

  it('does not revive stale external caches, loading flags, errors or scroll positions from a v16 snapshot', async () => {
    store.getState().setUser(alice);
    const feed = addFeed('Alice', 'https://example.com/alice/feed');
    const runtime = seedRuntime(feed.id);
    const stale = Object.fromEntries(runtimeKeys.map(key => [key, runtime[key]]));
    await hydrateEnvelope({ ...persistenceOptions().partialize(runtime), ...stale }, 16);
    expect(externalChannels()).toEqual([feed]);
    for (const key of runtimeKeys) expect(store.getState()[key]).not.toHaveProperty(feed.id);
    expect(store.getState().discoveryIsLoading.trending).toBe(false);
    expect(store.getState().discoveryScrollPositions.trending).toBe(0);
    for (const key of runtimeKeys) expect(savedEnvelope().state).not.toHaveProperty(key);
  });

  it('hydrates old parked workspaces without external fields as empty rather than borrowing the active account feeds', async () => {
    const oldWorkspace = { ...emptyAccountWorkspace() };
    delete oldWorkspace.externalDiscoveryChannels;
    const initial = store.getInitialState();
    await hydrateEnvelope(persistenceOptions().partialize({
      ...initial, user: alice, discoveryChannels: [...initial.discoveryChannels, external('external:alice')],
      accountWorkspaces: { [String(bob.id)]: oldWorkspace },
    }), 16);
    expect(store.getState().accountWorkspaces[String(bob.id)].externalDiscoveryChannels).toEqual([]);
    store.getState().setUser(bob);
    expect(externalChannels()).toEqual([]);
    store.getState().setUser(alice);
    expect(externalChannels()[0].id).toBe('external:alice');
  });
});
