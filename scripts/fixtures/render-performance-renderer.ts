// Imported only by the diagnostic Vite plugin; never by the application entry.
import { useAppStore } from '../../src/store/useAppStore';
import { createInitialState } from '../../src/store/initialState';
import { useCustomDiscovery, selectCustomChannel } from '../../src/features/discovery/custom/store';
import { transact } from '../../src/features/discovery/custom/storage';
import { analysisKey, useCustomAnalysis } from '../../src/features/discovery/custom/analysis';
import { discoverySourceSignature } from '../../src/features/discovery/workspace/source';
import { discoveryItemKey, workspaceSessionKey, defaultReadingPreferences } from '../../src/features/discovery/workspace/model';
import { saveBrowsePage, saveReadingPreferences, saveReadingAnchor } from '../../src/features/discovery/workspace/storage';
import { backend } from '../../src/services/backendAdapter';
import { HomeDatabase } from '../../src/home/database';
import { activateDesktopHome, stopDesktopHome, desktopStoreRecords, flushDesktopHome, getDesktopHomeSync } from '../../src/home/desktop';
import type { Capabilities, HomeRecord, HomeOperation } from '../../src/home/types';
import { ACCOUNT, WORKSPACE, makeFixture, type Fixture } from './render-performance-data';

const account = String(ACCOUNT);
let fixture: Fixture;
const records = new Map<string, HomeRecord>();
const requests: Array<{ path: string; method: string; ms: number }> = [];
const forbidden: string[] = [];
const caps: Capabilities = { protocolVersion: 2, workspace: { id: WORKSPACE, githubUserId: ACCOUNT }, github: { configured: false }, ai: { configured: false } };
const originalFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, location.href);
  if (url.origin !== 'http://127.0.0.1:39999') return originalFetch(input, init);
  const started = performance.now();
  const method = (init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
  const allowedMethod = url.pathname === '/api/sync/v2/operations' ? 'POST' : 'GET';
  if (method !== allowedMethod) { forbidden.push(`${method} ${url.pathname}`); throw new Error('Diagnostic endpoint method refused'); }
  let result: unknown;
  if (url.pathname === '/api/health') result = { status: 'ok' };
  else if (url.pathname === '/api/capabilities') result = caps;
  else if (url.pathname === '/api/tasks') {
    // The unchanged task journal polls after Home activation. Never submit or run tasks.
    if (url.searchParams.get('workspaceId') !== caps.workspace?.id || url.searchParams.get('githubUserId') !== account) throw new Error('Fixture task identity mismatch');
    result = { tasks: [] };
  }
  else if (url.pathname === '/api/sync/v2/snapshot') {
    const offset = Number(url.searchParams.get('offset') || 0);
    const rows = [...records.values()];
    result = { records: rows.slice(offset, offset + 200), cursor: 0, snapshotId: 'fixture', nextOffset: offset + 200, hasMore: offset + 200 < rows.length };
  } else if (url.pathname === '/api/sync/v2/changes') result = { records: [], cursor: 0, hasMore: false };
  else if (url.pathname === '/api/sync/v2/operations') {
    const body = JSON.parse(String(init?.body)) as { workspaceId: string; githubUserId: number; operations: HomeOperation[] };
    if (body.workspaceId !== caps.workspace?.id || body.githubUserId !== ACCOUNT) throw new Error('Fixture identity mismatch');
    result = { results: body.operations.map(op => {
      const key = `${op.collection}:${op.id}`;
      const row: HomeRecord = { collection: op.collection, id: op.id, data: op.data ?? null, deleted: op.kind === 'delete', version: (records.get(key)?.version ?? 0) + 1 };
      records.set(key, row); return { opId: op.opId, status: 'applied', record: row };
    }) };
  } else { forbidden.push(url.pathname); throw new Error('Unimplemented diagnostic endpoint'); }
  requests.push({ path: url.pathname, method: init?.method || 'GET', ms: performance.now() - started });
  return new Response(JSON.stringify(result), { status: 200, headers: { 'Content-Type': 'application/json' } });
};

const frames = () => new Promise<void>((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('Diagnostic rAF stalled: foreground/occlusion must be checked')), 5000);
  requestAnimationFrame(() => requestAnimationFrame(() => { clearTimeout(timer); resolve(); }));
});
const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
const longTasks: Array<{ start: number; duration: number }> = [];
new PerformanceObserver(list => list.getEntries().forEach(entry => longTasks.push({ start: entry.startTime, duration: entry.duration }))).observe({ type: 'longtask', buffered: true });
let started = 0;
let geometryReads = 0;
let instrumentGeometry = false;
const originalGeometry = Element.prototype.getBoundingClientRect;
// Disabled in the ordinary baseline. This count is an attribution aid, not layout duration.
function enableGeometry() {
  if (instrumentGeometry) return;
  instrumentGeometry = true;
  Element.prototype.getBoundingClientRect = function () { geometryReads++; return originalGeometry.call(this); };
  const edit = HomeDatabase.prototype.edit;
  HomeDatabase.prototype.edit = async function (...args) {
    const start = performance.now();
    try { return await edit.apply(this, args); }
    finally { functions.push({ name: 'Home.IDB.edit', start, duration: performance.now() - start }); }
  };
}
const cardCount = () => ({
  repository: document.querySelectorAll('[data-selection-mode]').length,
  discovery: document.querySelectorAll('[data-testid="builtin-results-layout"] [data-reading-key], [data-testid="custom-results-layout"] [data-reading-key]').length,
  nodes: document.getElementsByTagName('*').length,
});
const commits: Array<{ id: string; phase: string; actualDuration: number; baseDuration: number; startTime: number; commitTime: number }> = [];
const functions: Array<{ name: string; start: number; duration: number }> = [];
Object.assign(window, { gsmDiagnosticCommits: commits, gsmDiagnosticFunctions: functions });

async function seedBrowse(channel: 'trending' | 'most-popular', size: number) {
  const signature = discoverySourceSignature(useAppStore.getState(), channel, false);
  const key = workspaceSessionKey(channel, signature);
  const items = fixture.discovery.slice(0, size).map(repo => ({ ...repo, channel }));
  await saveBrowsePage(account, { key, channelId: channel, signature, items, itemKeys: items.map(discoveryItemKey), nextPage: 1, hasMore: false, totalCount: items.length, mode: 'replace' });
  await saveReadingPreferences(account, channel, { ...defaultReadingPreferences(), batchSize: 50, autoAnalyze: false });
  useAppStore.setState(state => ({ discoveryRepos: { ...state.discoveryRepos, [channel]: items }, discoveryLastRefresh: { ...state.discoveryLastRefresh, [channel]: new Date().toISOString() },
    discoveryTotalCount: { ...state.discoveryTotalCount, [channel]: items.length }, discoveryHasMore: { ...state.discoveryHasMore, [channel]: false } }));
  return key;
}
async function configure(count: number, releaseCount = count * 2, taskCount = count, historyCount = 2) {
  stopDesktopHome(); fixture = makeFixture(count); commits.length = 0; requests.length = 0;
  fixture.data.editions = fixture.data.editions.slice(0, historyCount);
  const defaults = createInitialState();
  useAppStore.setState({ ...defaults, hasHydrated: true, user: { id: ACCOUNT, login: 'anonymous-fixture', name: 'Anonymous', email: null, avatar_url: fixture.repositories[0].owner.avatar_url }, githubToken: 'diagnostic-not-a-token',
    isAuthenticated: true, syncModeConfigured: true, language: 'zh', theme: 'light', currentView: 'repositories',
    repositories: fixture.repositories, releases: fixture.releases.slice(0, releaseCount), customCategories: fixture.categories,
    subcategories: fixture.groups, categoryOrder: fixture.categories.map(c => c.id), subcategoryOrder: fixture.groups.map(g => g.id), repositoryOrder: fixture.repositories.map(r => r.id).reverse(),
    releaseSubscriptions: new Set<number>(), readReleases: new Set<number>(), backendApiSecret: null });
  await sleep(150); // Allow the account lifecycle to load its initially empty disposable workspace.
  await transact(account, data => Object.assign(data, fixture.data));
  useCustomDiscovery.setState({ account, data: fixture.data, selected: null, busy: false });
  useCustomAnalysis.setState({ account, running: false, paused: false, pausedChannels: {}, issuesByChannel: {}, issue: null,
    items: fixture.repositories.slice(0, taskCount).map(repo => ({ repo, channelId: 'builtin:trending', revision: 1, key: analysisKey(repo, 'zh'), status: 'done' })) });
  await seedBrowse('trending', count); await seedBrowse('most-popular', count);
  await saveReadingPreferences(account, 'custom:diagnostic', { ...defaultReadingPreferences(), batchSize: 50, autoAnalyze: false });
  await frames(); await sleep(3500);
  const descriptionLengths = fixture.repositories.map(repo => repo.description?.length ?? 0);
  return { count, releases: releaseCount, tasks: taskCount, historyEditions: historyCount, historyEntries: historyCount * count,
    descriptionLengths: { min: Math.min(...descriptionLengths), max: Math.max(...descriptionLengths) } };
}
function start() { started = performance.now(); geometryReads = 0; commits.length = 0; functions.length = 0; performance.mark('gsm:diag-operation-start'); }
async function finish(contentReadyMs: number | null = null) {
  await frames(); const paintOpportunityMs = performance.now() - started;
  await sleep(350); // Include the existing 250ms reading-anchor debounce separately.
  const end = performance.now();
  const sample = { paintOpportunityMs, contentReadyMs, observationMs: end - started, longTasks: longTasks.filter(t => t.start >= started && t.start < end),
    geometryReads: instrumentGeometry ? geometryReads : null, cards: cardCount(), visibility: document.visibilityState, focused: document.hasFocus(),
    scrollY,
    commits: commits.filter(c => c.commitTime >= started && c.commitTime < end), functions: functions.filter(c => c.start >= started && c.start < end),
    repositoryCount: useAppStore.getState().repositories.length, releaseCount: useAppStore.getState().releases.length, start: started, end };
  performance.mark('gsm:diag-operation-end'); return sample;
}
async function resetCustom() {
  const edition = fixture.data.editions[1];
  const key = workspaceSessionKey('custom:diagnostic', `${edition.date}:1:recommended`);
  await saveBrowsePage(account, { key, channelId: 'custom:diagnostic', signature: key, items: [{ visibleCount: 50 }], itemKeys: ['depth'], nextPage: 1, hasMore: false, totalCount: 1, mode: 'replace' });
  await saveBrowsePage(account, { key: workspaceSessionKey('custom:diagnostic', 'last-view'), channelId: 'custom:diagnostic', signature: 'last-view',
    items: [{ edition, pending: false, visibleCount: 50 }], itemKeys: ['view'], nextPage: 1, hasMore: false, totalCount: 1, mode: 'replace' });
}
async function action(name: string) {
  const state = useAppStore.getState();
  switch (name) {
    case 'repo-show': useAppStore.setState({ currentView: 'repositories', repositories: fixture.repositories, selectedCategory: 'all' }); break;
    case 'repo-empty': useAppStore.setState({ repositories: [], selectedCategory: 'all' }); break;
    case 'category': state.setSelectedCategory('diag:a'); break;
    case 'all': state.setSelectedCategory('all'); break;
    case 'builtin': selectCustomChannel(null); useAppStore.setState({ currentView: 'subscription', selectedDiscoveryChannel: 'trending' }); break;
    case 'channel': selectCustomChannel(null); state.setSelectedDiscoveryChannel(state.selectedDiscoveryChannel === 'trending' ? 'most-popular' : 'trending'); break;
    case 'custom': selectCustomChannel('custom:diagnostic'); state.setCurrentView('subscription'); break;
    case 'task-unrelated': useCustomAnalysis.setState(s => ({ issuesByChannel: { ...s.issuesByChannel, 'builtin:other': { kind: 'cancelled' } } })); break;
    case 'repo-update': state.updateRepository({ ...state.repositories[0], description: `${fixture.repositories[0].description} fixture update ${performance.now()}` }); break;
    case 'release-update': useAppStore.setState({ releases: state.releases.map((r, i) => i ? r : { ...r, name: `fixture ${performance.now()}` }) }); break;
    case 'append': await seedBrowse(state.selectedDiscoveryChannel === 'most-popular' ? 'most-popular' : 'trending', fixture.count); break;
    default: throw new Error(`Unknown action ${name}`);
  }
}
async function home(enabled: boolean) {
  stopDesktopHome();
  if (!enabled) return;
  caps.workspace = { id: `${WORKSPACE}-${fixture.count}`, githubUserId: ACCOUNT };
  records.clear();
  desktopStoreRecords(useAppStore.getState()).forEach(row => records.set(`${row.collection}:${row.id}`, { ...row, version: 1 }));
  useAppStore.setState({ backendApiSecret: 'synthetic-home-secret' });
  await backend.init('http://127.0.0.1:39999/api');
  if (!await activateDesktopHome(caps)) throw new Error('Mock Home failed to activate');
  await sleep(3500);
}
async function homeFlush() {
  const before = performance.now(); await flushDesktopHome();
  return { ms: performance.now() - before, pending: (await getDesktopHomeSync()?.db.pending())?.length, requests: [...requests],
    functions: functions.filter(f => f.name.startsWith('Home.') || f.name === 'desktopStoreRecords') };
}
async function anchor() {
  const state = useAppStore.getState(); const channel = state.selectedDiscoveryChannel;
  const key = workspaceSessionKey(channel, discoverySourceSignature(state, channel, false));
  await saveReadingAnchor(account, { sessionKey: key, itemKey: discoveryItemKey(fixture.discovery[Math.floor(fixture.count / 2)]), offset: 100, previousKeys: [], updatedAt: Date.now() });
}
async function customAnchor() {
  const edition = fixture.data.editions[1];
  await saveReadingAnchor(account, { sessionKey: workspaceSessionKey('custom:diagnostic', `${edition.date}:1:recommended`),
    itemKey: discoveryItemKey(fixture.discovery[25]), offset: 100, previousKeys: [], updatedAt: Date.now() });
}
export function install() {
  Object.assign(window, { gsmDiagnostic: { configure, action, start, finish, seedBrowse, home, homeFlush, anchor, customAnchor, enableGeometry, resetCustom,
    elapsed: () => performance.now() - started,
    info: () => ({ cards: cardCount(), user: useAppStore.getState().user?.id, home: getDesktopHomeSync()?.identity, requests, forbidden,
      hydration: performance.getEntriesByType('mark').filter(e => e.name.startsWith('gsm:')).map(e => ({ name: e.name, start: e.startTime })),
      viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio }, language: useAppStore.getState().language, theme: useAppStore.getState().theme,
      browserLanguage: navigator.language, visibility: document.visibilityState }),
    mode: (mode: 'grid' | 'list', custom = false) => useAppStore.setState(s => ({ repositoryViewMode: mode, searchFilters: { ...s.searchFilters, sortBy: custom ? 'custom' : 'stars' } })) } });
}
