import { useAppStore, getAllCategories } from '../store/useAppStore';
import { getDefaultCategory } from '../utils/categoryUtils';
import { loadData } from '../features/discovery/custom/storage';
import { discoveryAnalysisIdentity } from '../features/discovery/custom/analysisIdentity';
import { editionKey, visibleEditionItems } from '../features/discovery/custom/model';
import { createGitHubApiService } from './githubApiFactory';
import { analysisFields, emptyReadingState, settingsSchema, type ReadingAnalysisBlock, type ReadingEntry, type ReadingItem, type ReadingSettings, type ReadingSnapshot, type ReadingSection, resolveReadingProfile, profileIncludes, type ReadingProfile } from '../lib/html-reading/model';
import { loadReadingData, rememberSnapshot, restoreReadingSnapshotResume, readingTransaction } from '../lib/html-reading/storage';
import { renderReadingHtml, safeSourceUrl } from '../lib/html-reading/render';
import { createReadingTheme } from '../lib/html-reading/theme';
import { isRepeatedRepositoryProblem } from '../lib/repositoryReadingPresentation';
import { applyRepositoryAnalysisAsset, canUseLegacyRepositoryAnalysisAssets, hasRepositoryAnalysisAsset, initializeRepositoryAnalysisAssets, type RepositoryWithAnalysisAsset } from './repositoryAnalysisAssets';
import type { Repository, DiscoveryRepo } from '../types';
import { withDeadline, waitForRequest } from '../utils/requestDeadline';
import { z } from 'zod';
import { discoverySourceSignature } from '../features/discovery/workspace/source';
import { workspaceSessionKey } from '../features/discovery/workspace/model';
import { loadBrowseSession } from '../features/discovery/workspace/storage';
import { loadReadingDiscoveryCache, saveReadingDiscoveryCache, type ReadingDiscoverySource } from '../lib/html-reading/cache';
import { readingSourceDigest } from '../lib/html-reading/comparison';

export class ReadingGenerationError extends Error {
  constructor(message: string, public code: 'noContent' | 'size' | 'accountChanged' | 'cancelled', public retryable = false) { super(message); this.name = 'ReadingGenerationError'; }
}
export class ReadingSizeError extends ReadingGenerationError {
  constructor(message: string, public diagnostic?: { sections: Record<string, number>; fields: Record<string, number> }) { super(message, 'size'); }
}
export interface ReadingGenerationOptions { signal?: AbortSignal; baseline?: Record<string, string>; registerSnapshot?: boolean; mode?: 'preview' | 'export' | 'send'; onProgress?: (progress: { phase: 'source' | 'waiting' | 'rendering'; message: string; channelId?: string; fetched?: number; target?: number }) => void }
function ensureReadingCurrent(account: string, signal?: AbortSignal) {
  if (signal?.aborted) throw new ReadingGenerationError('已取消生成。', 'cancelled');
  if (readingAccount() !== account) throw new ReadingGenerationError('账户已变更，请重新生成。', 'accountChanged');
}
export const HTML_CHANNELS = [{ id: 'trending', name: '趋势' }, { id: 'most-popular', name: '最受欢迎' }, { id: 'hot-release', name: '热门发布' }, { id: 'topic', name: '主题探索' }, { id: 'search', name: '仓库搜索结果' }] as const;
export interface PreparedReadingDiscovery { accountId: string; channels: Record<string, ReadingDiscoverySource> }
type ReadingPreparationProgress = (message: string) => void;
const cachedReleaseSchema = z.object({
  tag_name: z.string().trim().min(1).max(240), name: z.string().trim().max(500).nullable().optional(),
  published_at: z.iso.datetime(), html_url: z.url(), prerelease: z.boolean(),
  body: z.string().max(1_000_000).nullable().optional(), draft: z.boolean().optional(),
});
function cachedReadingRelease(raw: unknown, fullName: string, prereleases: boolean, stored: unknown[] = []) {
  const parsed = cachedReleaseSchema.safeParse(raw);
  if (!parsed.success || parsed.data.draft === true || parsed.data.prerelease && !prereleases || Date.parse(parsed.data.published_at) > Date.now()) return undefined;
  const release = parsed.data;
  try {
    const url = new URL(release.html_url), prefix = `/${fullName}/releases/tag/`;
    if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.username || url.password || url.search || url.hash || !url.pathname.toLowerCase().startsWith(prefix.toLowerCase()) || decodeURIComponent(url.pathname.slice(prefix.length)) !== release.tag_name) return undefined;
    // A channel's verified tag/date/link are authoritative. Fill an omitted body
    // only from the same cached release, never from another version's notes.
    const matching = stored.map(value => cachedReleaseSchema.safeParse(value)).find(candidate => candidate.success
      && candidate.data.draft !== true && candidate.data.prerelease === release.prerelease
      && candidate.data.tag_name === release.tag_name && candidate.data.html_url === release.html_url
      && Date.parse(candidate.data.published_at) === Date.parse(release.published_at));
    const body = release.body?.trim() || (matching?.success ? matching.data.body?.trim() : '');
    return { tag: release.tag_name, date: release.published_at, text: body || (release.name !== release.tag_name ? release.name ?? '' : ''), url: url.href };
  } catch { return undefined; }
}
export function readingAccount() { const state = useAppStore.getState(); if (!state.user || !state.isAuthenticated) throw new Error('请先登录 GitHub 账户。'); return String(state.user.id); }
export async function readingCatalog() {
  const account = readingAccount(); const state = useAppStore.getState(); const custom = await loadData(account);
  const categories = getAllCategories(state.customCategories, state.language, state.hiddenDefaultCategoryIds, state.defaultCategoryOverrides);
  return { account, categories: categories.filter(c=>c.id!=='all'), channels: [...HTML_CHANNELS, ...custom.channels.map(c=>({id:c.id,name:c.name}))] };
}
export async function generateReadingSnapshot(settings: ReadingSettings, warnings: string[] = [], prepared?: PreparedReadingDiscovery, options: ReadingGenerationOptions = {}): Promise<{ snapshot: ReadingSnapshot; html: string; bytes: number }> {
  settings = settingsSchema.parse(settings);
  if (!settings.repositories && !settings.discovery) throw new Error('至少开启仓库或发现一个页面。');
  const account = readingAccount();
  const validate = () => ensureReadingCurrent(account, options.signal); validate();
  if (prepared && prepared.accountId !== account) throw new Error('账户已变更，请重新生成。');
  // Freeze desktop data before asynchronous cache reads; never serialize the whole Store.
  const state = useAppStore.getState(); const repositories = state.repositories.map(repo => {
    const copy: RepositoryWithAnalysisAsset = structuredClone(repo);
    const provenance = (repo as RepositoryWithAnalysisAsset).analysisAssetProvenance;
    if (provenance) Object.defineProperty(copy, 'analysisAssetProvenance', { value: provenance, enumerable: false });
    return copy;
  });
  const discovery = structuredClone(state.discoveryRepos); const refreshes = { ...state.discoveryLastRefresh }; const releases = structuredClone(state.releases);
  for (const [id, source] of Object.entries(prepared?.channels ?? {})) {
    discovery[id as keyof typeof discovery] = structuredClone(source.repos);
    refreshes[id as keyof typeof refreshes] = source.updatedAt;
  }
  const theme = createReadingTheme({ theme: state.theme, themePreset: state.themePreset, themeTokens: structuredClone(state.themeTokens) }, settings.theme);
  const categories = getAllCategories(state.customCategories, state.language, state.hiddenDefaultCategoryIds, state.defaultCategoryOverrides);
  const [custom, reading] = await Promise.all([loadData(account), loadReadingData(account, { includeSnapshots: false, validate, signal: options.signal })]);
  validate();
  if (readingAccount() !== account) throw new Error('账户已变更，请重新生成。');
  if (settings.discovery && !settings.channelIds.some(id => HTML_CHANNELS.some(channel => channel.id === id) || custom.channels.some(channel => channel.id === id))) {
    throw new Error('请在每日 HTML 设置中选择至少一个可用发现频道；只阅读仓库时可关闭“包含发现”。');
  }
  // Use the same account-scoped assets and deletion barriers as the desktop detail view.
  // This is a migration/read of existing successes, never a model request.
  await initializeRepositoryAnalysisAssets(account, repositories, custom);
  validate();
  if (readingAccount() !== account) throw new Error('账户已变更，请重新生成。');
  const canonical = new Map(repositories.map(repo=>[repo.id,repo]));
  const config = state.aiConfigs?.find(c => c.id === state.activeAIConfig);
  const readable = (repo: Repository) => Number.isSafeInteger(repo.id)&&repo.id>0&&/^[\w.-]+\/[\w.-]+$/.test(repo.full_name)&& !(settings.hideIgnored && reading.states[repo.id]?.interest==='ignored') && !(settings.unreadOnly && reading.states[repo.id]?.read);
  const text = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
  const useful = (value: unknown): string => {
    const clean = text(value);
    return /^(未知|暂无|暂无信息|无|未提供|unknown|n\/a)$/i.test(clean) ? '' : clean;
  };
  const sourceDigests = new Map<number, Promise<string>>();
  const present = (raw: Repository, profile: ReadingProfile): ReadingItem => {
    const includes = (key: Parameters<typeof profileIncludes>[1]) => profileIncludes(profile, key);
    const saved = canonical.get(raw.id);
    const savedProvenance = (saved as RepositoryWithAnalysisAsset | undefined)?.analysisAssetProvenance;
    const base = saved ? { ...raw, ...saved } : { ...raw, ai_details: undefined, ai_summary: undefined, ai_tags: undefined, ai_platforms: undefined, analyzed_at: undefined };
    if (savedProvenance) Object.defineProperty(base, 'analysisAssetProvenance', { value: savedProvenance, enumerable: false });
    let repo = applyRepositoryAnalysisAsset(account, base, state.language);
    // Old, account-scoped detail records may predate the current asset schema.
    // Only the exact repository/language/config key can enter this fallback;
    // deletion markers prevent it from resurrecting a removed analysis.
    if (!hasRepositoryAnalysisAsset(account, base, state.language) && canUseLegacyRepositoryAnalysisAssets(account, raw.id)) {
      const cached = custom.analyses?.[discoveryAnalysisIdentity(raw, state.language, config)]?.details;
      if (!saved && cached) repo = { ...base, ai_details: cached, ai_summary: useful(cached.summary) || useful(cached.problem), ai_tags: cached.tags, analyzed_at: cached.generated_at };
    }
    const category = getDefaultCategory(repo,categories); const categoryId = categories.find(c=>c.name===category)?.id ?? 'none';
    const analysis = repo.ai_details;
    const hasSourceAnalysis = !!(useful(repo.ai_summary) || useful(analysis?.summary)) || Object.keys(analysisFields).some(key => {
      const value = analysis?.[key as keyof typeof analysisFields];
      return Array.isArray(value) ? value.some(part => typeof part === 'string' ? !!useful(part) : !!(useful(part?.description) || useful(part?.command))) : !!useful(value);
    });
    if (!sourceDigests.has(repo.id)) sourceDigests.set(repo.id, readingSourceDigest(useful(repo.ai_summary) || useful(analysis?.summary) || text(repo.description), Object.fromEntries(Object.keys(analysisFields).map(key => [key, analysis?.[key as keyof typeof analysisFields]]))));
    const summary = includes('summary') ? useful(repo.ai_summary) || useful(analysis?.summary) : '';
    const blocks: ReadingAnalysisBlock[] = [];
    for (const [key, title] of Object.entries(analysisFields)) {
      const field = key as keyof typeof analysisFields;
      if (!includes(field)) continue;
      if (field === 'features' || field === 'scenarios') {
        const values = Array.isArray(analysis?.[field]) ? [...new Set(analysis[field].map(useful).filter(Boolean))] : [];
        if (values.length) blocks.push({ key: field, title, kind: 'list', text: '', values });
      } else if (field === 'quickstart') {
        const steps = Array.isArray(analysis?.quickstart) ? analysis.quickstart.flatMap(step => {
          const description = useful(step?.description), command = useful(step?.command);
          return description || command ? [{ description, command: command || null }] : [];
        }) : [];
        if (steps.length) blocks.push({ key: field, title, kind: 'steps', text: '', steps });
      } else {
        const value = useful(analysis?.[field]);
        if (value && (field === 'problem' ? !isRepeatedRepositoryProblem(value,summary) : value !== summary)) blocks.push({ key: field, title, kind: 'text', text: value });
      }
    }
    return { id: repo.id, name: repo.full_name, url: `https://github.com/${repo.full_name}`, categoryId:includes('category')?categoryId:'', category: includes('category')?category:'',
      summary, hasSourceAnalysis,
      description: (includes('description') || includes('summary') && !summary) && text(repo.description)!==summary?text(repo.description):'',
      tags: includes('tags')?[...new Set((repo.custom_tags?.length?repo.custom_tags:repo.ai_tags?.length?repo.ai_tags:repo.topics??[]).map(text).filter(Boolean))].slice(0,10):[], language:includes('language')?text(repo.language):'', stars:includes('stars')?repo.stargazers_count:0, updated:includes('updated')?text(repo.pushed_at):'',
      analysis: blocks, sources:includes('sources')&&Array.isArray(analysis?.sources)?analysis.sources.filter(x=>x&&safeSourceUrl(x.url)).map(x=>({label:text(x.label),url:safeSourceUrl(x.url)})):[], generatedAt:includes('sources')?text(analysis?.generated_at)||text(repo.analyzed_at):'', reason:'',
      state: { ...(reading.states[repo.id]??emptyReadingState()), ...(!includes('notes')?{note:''}:{}) },
    };
  };
  const items: Record<string, ReadingItem> = {};
  const prereleases = custom.builtinPreferences?.['hot-release']?.prereleases === true;
  const entry = (raw: Repository, profile: ReadingProfile, reason = ''): ReadingEntry => {
    const next = present(raw, profile), previous = items[raw.id];
    // Canonical union only contains fields included by at least one exported view.
    items[raw.id] = previous ? { ...previous, ...Object.fromEntries(Object.entries(next).filter(([, value]) => Array.isArray(value) ? value.length > 0 : typeof value === 'string' ? value.length > 0 : typeof value === 'number' ? value > 0 : true)), analysis: [...new Map([...previous.analysis, ...next.analysis].map(block => [block.key || block.title, block])).values()], state: { ...previous.state, note: next.state.note || previous.state.note } } as ReadingItem : next;
    const result: ReadingEntry = { repoId: raw.id };
    if (profileIncludes(profile, 'reason') && useful(reason)) result.reason = useful(reason);
    if (profileIncludes(profile, 'release')) {
      const sameRepository = releases.filter(r => r.repository.id === raw.id);
      const recent = cachedReadingRelease((raw as DiscoveryRepo).recentRelease,raw.full_name,prereleases,sameRepository);
      const saved = sameRepository.sort((a,b) => b.published_at.localeCompare(a.published_at))
        .map(release=>cachedReadingRelease(release,raw.full_name,prereleases)).find(Boolean);
      if (recent || saved) result.release = recent || saved;
    }
    return result;
  };
  const sections: ReadingSection[] = [];
  if (settings.repositories) {
    const profile = resolveReadingProfile(settings, 'repositories');
    const repos = repositories.filter(readable).filter(repo=>!settings.categoryIds.length||settings.categoryIds.includes(categories.find(c=>c.name===getDefaultCategory(repo,categories))?.id??'none'));
    repos.sort((a,b)=>settings.repositorySort==='name'?a.full_name.localeCompare(b.full_name):settings.repositorySort==='updated'?b.pushed_at.localeCompare(a.pushed_at):b.stargazers_count-a.stargazers_count);
    sections.push({id:'repositories',kind:'repositories',title:'收藏仓库',updatedAt:state.lastSync?new Date(state.lastSync).toISOString():'',items:[],presentation:profile,targetCount:settings.repositoryLimit,availableCount:repos.length,entries:repos.slice(0,settings.repositoryLimit).map(repo=>entry(repo,profile)),...(repos.length>settings.repositoryLimit?{warning:`共 ${repos.length} 个匹配仓库，按数量上限导出 ${settings.repositoryLimit} 个。`}:{})});
  }
  if (settings.discovery) for (const id of settings.channelIds) {
    const profile = resolveReadingProfile(settings, id);
    const builtin = HTML_CHANNELS.find(c=>c.id===id); const channel = custom.channels.find(c=>c.id===id);
    if (builtin) {
      const raw = discovery[id as keyof typeof discovery]??[];
      const repos = [...new Map(raw.filter(readable).map(repo=>[repo.id,repo])).values()];
      const updatedAt = String(refreshes[id as keyof typeof refreshes]??'');
      const source = prepared?.channels[id];
      const messages = [source?.warning ?? '', !raw.length ? source?.status === 'empty' ? '已查询上游，本次没有可用项目。' : source?.warning ? '' : '桌面尚无此频道的缓存，请先更新。' : !repos.length?'当前导出条件下没有匹配项目，桌面缓存仍然保留。':'',
        raw.length && Number.isFinite(Date.parse(updatedAt)) && Date.now()-Date.parse(updatedAt)>86400000?'本频道缓存距今已超过 24 小时，当前展示桌面已有历史内容。':'',
        id==='hot-release'&&repos.some(repo=>!cachedReadingRelease((repo as DiscoveryRepo).recentRelease,repo.full_name,prereleases))?'部分项目来自旧缓存，未附有效的真实 Release 记录；仓库更新时间不会作为发布时间，请在桌面刷新热门发布。':''].filter(Boolean);
      const section: ReadingSection = {id,kind:'builtin',title:builtin.name,updatedAt,items:[],presentation:profile,targetCount:profile.perChannel,availableCount:repos.length,sourceStatus:source?.status,fetchedCount:source?.fetchedCount,entries:repos.slice(0,profile.perChannel).map(repo=>entry(repo,profile)),...(messages.length?{warning:[...new Set(messages)].join(' ')}:{})};
      sections.push(section);
    } else if (channel) {
      const cutoff = Date.now()-settings.historyDays*86400000;
      const editions = custom.editions.filter(e=>e.channelId===id&&Date.parse(e.generatedAt)>=cutoff).sort((a,b)=>b.generatedAt.localeCompare(a.generatedAt)).slice(0,profile.historyCount);
      const exportedEditions = editions.map(edition => {
        const visible = visibleEditionItems({ date:edition.date,entries:edition.entries,pending:[] },channel).entries;
        const repos = [...new Map(visible.filter(e=>readable(e.repo)).map(e=>[e.repo.id,e])).values()];
        const warnings = [!edition.complete?'本期未完全更新，展示已保存的可用项目。':'',
          !repos.length ? visible.length ? '当前导出条件下没有匹配项目，请检查“只导出未读”与“隐藏已忽略”。' : edition.entries.length ? '本期项目被桌面频道的展示规则隐藏，请检查该频道配置。' : '本期已保存，但没有找到可用项目。' : '',
          repos.length>profile.perChannel?`本期共 ${repos.length} 个匹配项目，按数量上限导出 ${profile.perChannel} 个。`:''].filter(Boolean);
        return { id: editionKey(edition), date: edition.date, generatedAt: edition.generatedAt, complete: edition.complete, availableCount: repos.length,
          entries: repos.slice(0,profile.perChannel).map(e=>entry(e.repo,profile,e.reason)), ...(warnings.length?{warning:warnings.join(' ')}:{}) };
      });
      sections.push({id,kind:'custom',title:channel.name,updatedAt:editions[0]?.generatedAt??'',items:[],presentation:profile,targetCount:profile.perChannel,availableCount:exportedEditions.reduce((n,e)=>n+e.entries.length,0),editions:exportedEditions,warning:!editions.length?(custom.editions.some(e=>e.channelId===id)?'桌面已有期刊，但不在所选回看天数内；请增加回看天数。导出不调用 AI。':'所选天数内没有已生成期刊；导出不调用 AI。'):undefined});
    }
  }
  const snapshot: ReadingSnapshot = {version:2,id:crypto.randomUUID(),accountId:account,generatedAt:new Date().toISOString(),title:settings.title,settings:{...settings,initialPage:settings.initialPage==='repositories'&&!settings.repositories?'discovery':settings.initialPage==='discovery'&&!settings.discovery?'repositories':settings.initialPage},sections,items,theme,warnings:warnings.slice(0,20)};
  snapshot.comparisonIndex = Object.fromEntries(await Promise.all([...sourceDigests].map(async ([id, digest]) => [String(id), await digest])));
  snapshot.comparisonAvailable = options.baseline !== undefined;
  if (options.baseline === undefined) snapshot.warnings = [...(snapshot.warnings ?? []), '尚无 Gmail 已接受的日报基线，本次无法判断每日变化。'];
  else for (const item of Object.values(items)) {
    const previous = options.baseline[item.id];
    if (previous === undefined) item.dailyChange = 'new';
    else if (previous !== snapshot.comparisonIndex![item.id]) item.dailyChange = 'analysis-updated';
  }
  for (const source of Object.values(prepared?.channels ?? {})) for (const [id, provenance] of Object.entries(source.provenance ?? {})) if (items[id] && !items[id].sourceProvenance) items[id].sourceProvenance = provenance;
  validate();
  if (options.mode === 'send' && !Object.keys(items).length) throw new ReadingGenerationError('本次日报没有可阅读项目，未发送；请检查来源、筛选条件和频道选择。', 'noContent');
  const validateSize = async (bytes: number) => {
    if (bytes <= settings.maxFileMb * 1024 * 1024) return;
    validate();
    await readingTransaction(account, data => { data.generationFailures = [{ at: new Date().toISOString(), bytes, limitMb: settings.maxFileMb }, ...(data.generationFailures ?? [])].slice(0, 10); }, { includeSnapshots: false, validate, signal: options.signal });
    const sections = Object.fromEntries(snapshot.sections.map(section => [section.id, new Blob([JSON.stringify(section)]).size + [...new Set([...(section.entries ?? []).map(e => e.repoId), ...(section.editions ?? []).flatMap(e => e.entries.map(x => x.repoId))])].reduce((n,id) => n + new Blob([JSON.stringify(items[id])]).size, 0)]));
    const fields: Record<string, number> = {};
    for (const item of Object.values(items)) for (const [field, value] of Object.entries(item)) fields[field] = (fields[field] ?? 0) + new Blob([JSON.stringify(value)]).size;
    const largest = Object.entries(fields).sort((a,b) => b[1] - a[1]).slice(0, 4).map(([field,size]) => `${field} ${(size/1024/1024).toFixed(2)} MB`).join('、');
    throw new ReadingSizeError(`HTML 为 ${(bytes/1024/1024).toFixed(2)} MB，超过 ${settings.maxFileMb} MB 上限，本次未发送。主要栏目占用：${largest}。已保留失败记录；请减少数量、历史期数或将部分栏目设为“不导出”，再重新生成。摘要与项目未被自动删减。`, { sections, fields });
  };
  await validateSize(new Blob([renderReadingHtml(snapshot)]).size);
  if (options.registerSnapshot !== false) await rememberSnapshot(account,snapshot, validate, options.signal);
  else await restoreReadingSnapshotResume(account, snapshot, validate, options.signal);
  validate();
  if (readingAccount() !== account) throw new Error('账户已变更，请重新生成。');
  const html=renderReadingHtml(snapshot);const bytes=new Blob([html]).size;
  await validateSize(bytes);
  return{snapshot,html,bytes};
}
export async function refreshReadingDiscovery(settings: ReadingSettings, options?: { prepared: PreparedReadingDiscovery; onlyMissing: boolean; progress?: ReadingPreparationProgress; signal?: AbortSignal; onProgress?: ReadingGenerationOptions['onProgress'] }): Promise<string[]> {
  if(!settings.discovery)return [];
  const account=readingAccount();const state=useAppStore.getState();
  const validate = () => ensureReadingCurrent(account, options?.signal); validate();
  if (options && options.prepared.accountId !== account) throw new Error('账户已变更');
  const prereleases=settings.channelIds.includes('hot-release')?(await loadData(account)).builtinPreferences?.['hot-release']?.prereleases===true:false;
  if(readingAccount()!==account)throw new Error('账户已变更');
  const api=state.githubToken ? createGitHubApiService(state.githubToken) : null;const warnings:string[]=[];
  const deadline=Date.now()+90000;
  let requests = 0;
  for (const id of settings.channelIds.filter(id => HTML_CHANNELS.some(channel => channel.id === id))) {
    const title = HTML_CHANNELS.find(channel => channel.id === id)!.name;
    const target = resolveReadingProfile(settings, id).perChannel;
    const channel = id as DiscoveryRepo['channel'];
    let cache = structuredClone(state.discoveryRepos[channel] ?? []);
    let updatedAt = state.discoveryLastRefresh[channel] ?? '';
    const signature = discoverySourceSignature(state, channel, prereleases);
    const durable = await loadReadingDiscoveryCache(account, id, signature, settings.maxCacheAgeDays, validate, options?.signal); validate();
    let provenance = durable?.source.provenance ?? {};
    const now = Date.now();
    if (durable) { cache = structuredClone(durable.source.repos); updatedAt = durable.source.updatedAt; }
    if (options) {
      options.progress?.(`正在准备${title}…`);
      options.onProgress?.({ phase: 'source', message: `正在准备${title}…`, channelId: id, target });
      // The in-memory list has no immutable source identity. Only the exact
      // account/source workspace can prove the query/topic/platform that produced it.
      if (!durable) {
        const saved = await loadBrowseSession(account, workspaceSessionKey(channel, signature)).catch(() => null);
        if (readingAccount() !== account) throw new Error('账户已变更');
        cache = saved ? [...saved.items, ...saved.buffer] as unknown as DiscoveryRepo[] : [];
        updatedAt = saved?.session.refreshedAt ?? '';
      }
      const desktopValid = Number.isFinite(Date.parse(updatedAt)) && now - Date.parse(updatedAt) <= settings.maxCacheAgeDays * 86400000 && now >= Date.parse(updatedAt);
      if (!durable) provenance = Object.fromEntries(cache.map(repo => [String(repo.id), { channelId: id, sourceSignature: signature, fetchedAt: updatedAt, retained: false }]));
      // A failed refresh may only display projects whose actual source success is still within the configured age.
      cache = cache.filter(repo => { const age = now - Date.parse(provenance[repo.id]?.fetchedAt ?? updatedAt); return Number.isFinite(age) && age >= 0 && age <= settings.maxCacheAgeDays * 86400000; });
      const validDesktop = !durable && desktopValid;
      const enoughCached = durable?.valid && (durable.source.exhausted || durable.source.status === 'empty' || (durable.source.fetchedTarget ?? durable.source.repos.length) >= target);
      if (options.onlyMissing && (enoughCached || validDesktop && cache.length >= target)) {
        const source = durable?.valid ? structuredClone(durable.source) : { repos: cache, updatedAt, status: 'cached' as const };
        options.prepared.channels[id] = source;
        if (!durable && desktopValid) {
          provenance = Object.fromEntries(cache.map(repo => [String(repo.id), { channelId: id, sourceSignature: signature, fetchedAt: updatedAt, retained: false }]));
          source.provenance = provenance;
          await saveReadingDiscoveryCache(account, id, signature, source, validate, options.signal); validate();
        }
        continue;
      }
    }
    const publish = async (source: ReadingDiscoverySource) => {
      validate();
      source.provenance ??= Object.fromEntries(Object.entries(provenance).map(([id, value]) => [id, { ...value, retained: true }]));
      if (options) options.prepared.channels[id] = source;
      else if (source.status !== 'unavailable') {
        state.setDiscoveryRepos(channel, source.repos);
        if (source.status === 'updated' || source.status === 'empty') state.setDiscoveryLastRefresh(channel, source.updatedAt);
      }
      if (!(source.status === 'unavailable' && !source.repos.length && durable?.source.repos.length)) await saveReadingDiscoveryCache(account, id, signature, source, validate, options?.signal);
      validate();
    };
    if (!api) {
      const warning = `${title} 未更新：缺少 GitHub 凭据，请重新登录；${cache.length ? '保留已有内容。' : '没有可用缓存。'}`;
      await publish({ repos: cache, updatedAt, status: 'unavailable', warning }); warnings.push(warning); continue;
    }
    const perPage = Math.min(target, 100), channelDeadline = Math.min(deadline, Date.now() + 30000);
    const collected = new Map<number, DiscoveryRepo>();
    let pageIndex = 1, reason = '', partial = false, exhausted = false;
    if (requests >= 20 || Date.now() >= deadline) {
      const warning = `${title} 未更新：达到总时间或 20 次分页请求预算，沿用缓存。`;
      await publish({ repos: cache, updatedAt, status: 'unavailable', warning }); warnings.push(warning); continue;
    }
    if (id === 'search' && !state.discoverySearchQuery.trim()) {
      const warning = '仓库搜索结果未更新：请先在桌面发现设置搜索词；导出不会自行猜测搜索内容。';
      await publish({ repos: cache, updatedAt, status: 'unavailable', warning }); warnings.push(warning); continue;
    }
    while (collected.size < target) {
      if (requests >= 20 || pageIndex > 10 || Date.now() >= channelDeadline) { reason = '达到时间或分页请求预算'; partial = true; break; }
      try {
        requests++;
        const result = await withDeadline(async signal => {
          const platform = state.discoveryPlatform;
          if (id === 'trending') return api.getTrendingRepositories(platform, pageIndex, perPage, state.trendingTimeRange, signal);
          if (id === 'most-popular') return api.getMostPopular(platform, pageIndex, perPage, signal);
          if (id === 'hot-release') return api.getHotReleaseRepositories(platform, pageIndex, perPage, { prereleases, signal });
          if (id === 'topic') return state.discoverySelectedTopic ? api.getTopicRepositories(state.discoverySelectedTopic, platform, pageIndex, perPage, signal) : api.getTrendingRepositories(platform, pageIndex, perPage, 'weekly', signal);
          if (id === 'search') return state.discoverySearchQuery.trim() ? api.searchRepositories(state.discoverySearchQuery, platform, state.discoveryLanguage, state.discoverySortBy, state.discoverySortOrder, pageIndex, perPage, signal) : null;
          return null;
        }, Math.max(1, channelDeadline - Date.now()), options?.signal);
        validate();
        if (readingAccount() !== account) throw new Error('账户已变更');
        if (!result) { reason = '缺少桌面主题或搜索条件'; break; }
        if (id === 'hot-release' && result.verification?.partial) { partial = true; warnings.push(`热门发布的真实版本核验未全部完成（${result.verification.failed}／${result.verification.total} 项未确认），仅使用可用结果。`); }
        result.repos.forEach(repo => { if (!collected.has(repo.id)) collected.set(repo.id, repo); });
        exhausted = !result.hasMore;
        options?.onProgress?.({ phase: 'source', message: `${title}：已取得 ${collected.size} 项`, channelId: id, fetched: collected.size, target });
        options?.progress?.(`${title}：已取得 ${Math.min(target, collected.size)}／${target} 项，正在处理第 ${pageIndex} 页…`);
        if (collected.size >= target) break;
        if (!result.hasMore) { reason = '上游可用结果不足'; break; }
        const next = result.nextPageIndex;
        if (!Number.isSafeInteger(next) || next <= pageIndex) { reason = '上游未提供可继续的分页游标'; partial = true; break; }
        pageIndex = next;
      } catch {
        validate();
        if (readingAccount() !== account) throw new Error('账户已变更');
        reason = '更新失败、上游限流或请求超时'; partial = true; break;
      }
    }
    const merged = new Map(collected);
    if (partial) cache.forEach(repo => { if (!merged.has(repo.id)) merged.set(repo.id, repo); });
    const fetchedAt = new Date().toISOString();
    const freshProvenance = Object.fromEntries([...merged.keys()].map(repoId => [String(repoId), collected.has(repoId) ? { channelId: id, sourceSignature: signature, fetchedAt, retained: false } : { ...(provenance[repoId] ?? { channelId: id, sourceSignature: signature, fetchedAt: updatedAt }), retained: true }]));
    const warning = collected.size < target || partial ? `${title}：目标 ${target}，本次取得 ${collected.size}；${reason || (partial ? '部分来源未完成核验' : '上游可用结果不足')}。${collected.size ? partial ? '保留已取得项目及此前缓存，沿用原更新时间。' : '保留已取得项目。' : partial ? '保留原有缓存与更新时间。' : '上游已确认没有可用项目；旧结果已清空。'}` : '';
    await publish({ repos: collected.size && !partial ? [...merged.values()].slice(0, target) : [...merged.values()], updatedAt: !partial ? fetchedAt : updatedAt, provenance: freshProvenance,
      status: partial ? collected.size ? 'partial' : 'unavailable' : collected.size ? 'updated' : 'empty', fetchedCount: collected.size, fetchedTarget: target, exhausted, warning: warning || undefined });
    if (warning) warnings.push(warning);
  }
  // Custom channels may require AI. Respect the explicit no-new-AI rule here.
  if(settings.channelIds.some(id=>id.startsWith('custom:')))warnings.push('自定义频道沿用桌面已生成期刊，日报不会额外调用 AI。');
  return warnings;
}
export async function prepareReadingSend(settings: ReadingSettings, options: ReadingGenerationOptions = {}): Promise<string[]> {
  const warnings=settings.refreshBeforeSend?await refreshReadingDiscovery(settings):[];
  if(!settings.discovery||!settings.waitForDiscovery||!settings.channelIds.some(id=>id.startsWith('custom:')))return warnings;
  const account=readingAccount();const deadline=Date.now()+60000;
  const validate = () => ensureReadingCurrent(account, options.signal); validate();
  // Observe an existing desktop run; the report never starts a new AI task.
  while(((await loadData(account)).lease?.expires??0)>Date.now()) {
    validate();
    if(readingAccount()!==account)throw new Error('账户已变更');
    if(Date.now()>=deadline){warnings.push('桌面发现仍在更新，等待已达 60 秒；使用已保存期刊并保留实际更新时间。');break;}
    try { await waitForRequest(Math.min(1000,deadline-Date.now()), options.signal); } catch (error) { validate(); throw error; }
    validate();
  }
  validate();
  return warnings;
}
/** Every user-facing generation path prepares its sources before freezing data. */
export async function generatePreparedReadingSnapshot(settings: ReadingSettings, mode: 'preview' | 'export' | 'send', progress?: ReadingPreparationProgress, forceRefresh = false, options: ReadingGenerationOptions = {}) {
  settings = settingsSchema.parse(settings);
  if (!settings.repositories && !settings.discovery) throw new Error('至少开启仓库或发现一个页面。');
  const prepared: PreparedReadingDiscovery = { accountId: readingAccount(), channels: {} };
  const validate = () => ensureReadingCurrent(prepared.accountId, options.signal); validate();
  if (settings.discovery) {
    const custom = await loadData(prepared.accountId);
    if (readingAccount() !== prepared.accountId) throw new Error('账户已变更');
    if (!settings.channelIds.some(id => HTML_CHANNELS.some(c => c.id === id) || custom.channels.some(c => c.id === id))) {
      throw new Error('请在每日 HTML 设置中选择至少一个可用发现频道；只阅读仓库时可关闭“包含发现”。');
    }
  }
  const warnings = await refreshReadingDiscovery(settings, { prepared, onlyMissing: !forceRefresh && !(mode === 'send' && settings.refreshBeforeSend), progress, signal: options.signal, onProgress: options.onProgress });
  validate();
  if (settings.discovery && settings.waitForDiscovery && settings.channelIds.some(id => id.startsWith('custom:'))) {
    progress?.('正在等候桌面已有期刊更新完成（最多 60 秒）…');
    options.onProgress?.({ phase: 'waiting', message: '正在等候桌面已有期刊更新完成（最多 60 秒）…' });
    warnings.push(...await prepareReadingSend({ ...settings, refreshBeforeSend: false }, options));
  }
  if (readingAccount() !== prepared.accountId) throw new Error('账户已变更，请重新生成。');
  progress?.('正在生成 HTML 并检查文件大小…');
  options.onProgress?.({ phase: 'rendering', message: '正在生成 HTML 并检查文件大小…' });
  validate();
  return generateReadingSnapshot(settings, warnings, prepared, { ...options, mode, registerSnapshot: options.registerSnapshot ?? mode !== 'preview' });
}
export function downloadReadingHtml(html:string) {const url=URL.createObjectURL(new Blob([html],{type:'text/html;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=`GSM-每日阅读-${new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'})}.html`;a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);}
