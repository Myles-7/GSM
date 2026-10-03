import { z } from 'zod';
import { codeItemKey, mergeStableItems, workspaceSessionKey } from '../features/discovery/workspace/model';
import { exportDiscoveryWorkspace, loadBrowseSession, saveBrowsePage } from '../features/discovery/workspace/storage';
import { searchGrepApp, type GrepCodeHit, type GrepSearchResult } from './grepAppService';

const facetSchema = z.object({ val: z.string(), count: z.number().nonnegative() });
const facetsSchema = z.object({
  repoFacets: z.array(facetSchema).default([]),
  pathFacets: z.array(facetSchema).default([]),
  langFacets: z.array(facetSchema).default([]),
});
const querySchema = z.object({
  query: z.string().default(''), mode: z.enum(['fuzzy', 'words', 'regexp']).default('fuzzy'),
  caseSensitive: z.boolean().default(false), langs: z.array(z.string()).default([]),
  repos: z.array(z.string()).default([]), paths: z.array(z.string()).default([]),
});
const sourceSchema = querySchema.extend({
  version: z.literal(1).default(1), starredOnly: z.boolean().default(false),
  resultSignature: z.string().nullable().default(null), facets: facetsSchema.default({ repoFacets: [], pathFacets: [], langFacets: [] }),
});
const hitSchema = z.object({
  repo: z.string().min(1), branch: z.string().min(1), path: z.string().min(1),
  language: z.string().default(''), totalMatches: z.string().default(''), snippetHtml: z.string().default(''),
});

export type CodeSearchSourceState = z.infer<typeof sourceSchema>;
export interface CodeSearchSnapshot {
  key: string;
  signature: string;
  result: GrepSearchResult;
  buffer: GrepCodeHit[];
  nextPage: number;
  hasMore: boolean;
}
export const codeSearchSourceMetadataKey = workspaceSessionKey('code-search', 'source-state:v1');
export const defaultCodeSearchSourceState = (): CodeSearchSourceState => sourceSchema.parse({});

export function codeSearchSignature(source: CodeSearchSourceState): string {
  const sorted = (values: string[]) => [...new Set(values)].sort();
  return JSON.stringify({ version: 1, query: source.query.trim(), mode: source.mode,
    caseSensitive: source.caseSensitive, langs: sorted(source.langs), repos: sorted(source.repos), paths: sorted(source.paths) });
}

const sourceWrites = new Map<string, Promise<unknown>>();

/** A metadata-only workspace session keeps source state portable with the existing backup. */
export async function saveCodeSearchSourceState(account: string, source: CodeSearchSourceState): Promise<void> {
  const signature = JSON.stringify(sourceSchema.parse(source));
  const previous = sourceWrites.get(account);
  const write = (previous ? previous.catch(() => undefined) : Promise.resolve()).then(() => saveBrowsePage(account, {
    key: codeSearchSourceMetadataKey, channelId: 'code-search', signature,
    items: [], itemKeys: [], nextPage: 1, hasMore: false, totalCount: 0, mode: 'replace',
  }));
  sourceWrites.set(account, write);
  try { await write; } finally { if (sourceWrites.get(account) === write) sourceWrites.delete(account); }
}

export async function loadCodeSearchWorkspace(account: string): Promise<{ source: CodeSearchSourceState; snapshot: CodeSearchSnapshot | null }> {
  const metadata = await loadBrowseSession(account, codeSearchSourceMetadataKey);
  let source = metadata ? sourceSchema.parse(JSON.parse(metadata.session.signature)) : defaultCodeSearchSourceState();
  if (!metadata) {
    const backup = await exportDiscoveryWorkspace(account);
    const last = backup.sessions.filter(session => session.channelId === 'code-search' && session.key !== codeSearchSourceMetadataKey)
      .sort((a, b) => b.updatedAt - a.updatedAt)[0];
    if (last) source = sourceSchema.parse({ ...JSON.parse(last.signature), resultSignature: last.signature });
  }
  if (!source.resultSignature) return { source, snapshot: null };
  const key = workspaceSessionKey('code-search', source.resultSignature);
  const cached = await loadBrowseSession(account, key);
  if (!cached) return { source, snapshot: null };
  const hits = mergeStableItems([], cached.items.map(item => hitSchema.parse(item)), codeItemKey);
  const visibleKeys = new Set(hits.map(codeItemKey));
  const buffer = mergeStableItems([], cached.buffer.map(item => hitSchema.parse(item)), codeItemKey)
    .filter(hit => !visibleKeys.has(codeItemKey(hit)));
  return { source, snapshot: { key, signature: source.resultSignature, result: { ...source.facets, hits, total: cached.session.totalCount },
    buffer, nextPage: cached.session.nextPage, hasMore: cached.session.hasMore } };
}

export interface CodeSearchBatchOutcome {
  snapshot: CodeSearchSnapshot | null;
  error?: unknown;
  persistenceError?: unknown;
  fetchedPages: number;
}

/** Source pages keep their own cursor; display batches consume the durable overflow buffer. */
export async function fetchCodeSearchBatch(
  account: string,
  source: CodeSearchSourceState,
  previous: CodeSearchSnapshot | null,
  batchSize: 20 | 50 | 100,
  mode: 'replace' | 'append' | 'stable',
  options: { signal: AbortSignal; isCurrent: () => boolean },
): Promise<CodeSearchBatchOutcome> {
  const check = () => { if (options.signal.aborted || !options.isCurrent()) throw new DOMException('Code search cancelled', 'AbortError'); };
  check();
  const signature = codeSearchSignature(source);
  const prior = previous?.signature === signature && mode !== 'replace' ? previous : null;
  const visible = prior?.result.hits ?? [];
  const visibleKeys = new Set(visible.map(codeItemKey));
  let incoming = mode === 'append' ? [...(prior?.buffer ?? [])] : [];
  let nextPage = mode === 'append' ? prior?.nextPage ?? 1 : 1;
  let hasMore = mode === 'append' ? prior?.hasMore ?? true : true;
  let total = prior?.result.total ?? 0;
  let facets = prior?.result ?? source.facets;
  let fetchedPages = 0;
  let error: unknown;
  while ((mode === 'append' ? incoming.filter(hit => !visibleKeys.has(codeItemKey(hit))).length : incoming.length) < batchSize && hasMore) {
    check();
    try {
      const data = await searchGrepApp({ q: source.query.trim(), mode: source.mode, caseSensitive: source.caseSensitive,
        langs: source.langs, repos: source.repos, paths: source.paths, page: nextPage }, { signal: options.signal });
      check();
      fetchedPages++;
      nextPage++;
      total = data.total;
      facets = data;
      const before = incoming.length;
      incoming = mergeStableItems(incoming, data.hits, codeItemKey);
      const knownCount = mode === 'append' ? mergeStableItems(visible, incoming, codeItemKey).length : incoming.length;
      hasMore = data.hits.length > 0 && knownCount < total;
      if (incoming.length === before) break;
    } catch (cause) {
      check();
      error = cause;
      break;
    }
  }
  check();
  if (!fetchedPages && mode !== 'append') return { snapshot: prior, error, fetchedPages };
  const fresh = mergeStableItems(mode === 'stable' ? prior?.buffer ?? [] : [], incoming, codeItemKey)
    .filter(hit => !visibleKeys.has(codeItemKey(hit)));
  const refreshed = new Map(incoming.map(hit => [codeItemKey(hit), hit]));
  const hits = [...visible.map(hit => refreshed.get(codeItemKey(hit)) ?? hit), ...fresh.slice(0, batchSize)];
  const buffer = fresh.slice(batchSize);
  if (mode === 'stable' && prior && prior.nextPage > nextPage) { nextPage = prior.nextPage; hasMore = prior.hasMore; }
  const snapshot: CodeSearchSnapshot = { key: workspaceSessionKey('code-search', signature), signature,
    result: { hits, total, repoFacets: facets.repoFacets, pathFacets: facets.pathFacets, langFacets: facets.langFacets }, buffer, nextPage, hasMore };
  let persistenceError: unknown;
  try {
    check();
    await saveBrowsePage(account, { key: snapshot.key, channelId: 'code-search', signature,
      items: [...hits, ...buffer].map(hit => ({ ...hit })), itemKeys: [...hits, ...buffer].map(codeItemKey),
      nextPage, hasMore, totalCount: total, mode: prior ? mode : 'replace', exposeCount: batchSize });
    check();
  } catch (cause) { check(); persistenceError = cause; }
  return { snapshot, error, persistenceError, fetchedPages };
}
