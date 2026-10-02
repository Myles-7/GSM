import { useAppStore, getAllCategories } from '../store/useAppStore';
import { getDefaultCategory } from '../utils/categoryUtils';
import { loadData } from '../features/discovery/custom/storage';
import { discoveryAnalysisStorage } from './discoveryAnalysisStorage';
import { createGitHubApiService } from './githubApiFactory';
import { analysisFields, emptyReadingState, settingsSchema, type ReadingItem, type ReadingSettings, type ReadingSnapshot, type ReadingSection } from '../lib/html-reading/model';
import { loadReadingData, rememberSnapshot } from '../lib/html-reading/storage';
import { renderReadingHtml, safeSourceUrl } from '../lib/html-reading/render';
import type { Repository, DiscoveryRepo } from '../types';
import { withDeadline, waitForRequest } from '../utils/requestDeadline';

export const HTML_CHANNELS = [{ id: 'trending', name: '趋势' }, { id: 'most-popular', name: '最受欢迎' }, { id: 'hot-release', name: '近期更新项目' }, { id: 'topic', name: '主题探索' }, { id: 'search', name: '仓库搜索结果' }] as const;
export function readingAccount() { const state = useAppStore.getState(); if (!state.user || !state.isAuthenticated) throw new Error('请先登录 GitHub 账户。'); return String(state.user.id); }
export async function readingCatalog() {
  const account = readingAccount(); const state = useAppStore.getState(); const custom = await loadData(account);
  const categories = getAllCategories(state.customCategories, state.language, state.hiddenDefaultCategoryIds, state.defaultCategoryOverrides);
  return { account, categories: categories.filter(c=>c.id!=='all'), channels: [...HTML_CHANNELS, ...custom.channels.map(c=>({id:c.id,name:c.name}))] };
}
export async function generateReadingSnapshot(settings: ReadingSettings, warnings: string[] = []): Promise<{ snapshot: ReadingSnapshot; html: string; bytes: number }> {
  settings = settingsSchema.parse(settings);
  if (!settings.repositories && !settings.discovery) throw new Error('至少开启仓库或发现一个页面。');
  const account = readingAccount();
  // Freeze desktop data before asynchronous cache reads; never serialize the whole Store.
  const state = useAppStore.getState(); const repositories = structuredClone(state.repositories);
  const discovery = structuredClone(state.discoveryRepos); const refreshes = { ...state.discoveryLastRefresh };
  const categories = getAllCategories(state.customCategories, state.language, state.hiddenDefaultCategoryIds, state.defaultCategoryOverrides);
  const [custom, reading, cachedAnalyses] = await Promise.all([loadData(account), loadReadingData(account), discoveryAnalysisStorage.loadAllAnalyses()]);
  if (readingAccount() !== account) throw new Error('账户已变更，请重新生成。');
  const canonical = new Map(repositories.map(repo=>[repo.id,repo]));
  const details = new Map(Object.entries(custom.analyses ?? {}).filter(([,a])=>a.status==='done'&&a.details).sort((a,b)=>a[1].updatedAt-b[1].updatedAt).flatMap(([key,a])=>{try{return [[Number(JSON.parse(key)[0]),a.details] as const];}catch{return [];}}));
  const readable = (repo: Repository) => Number.isSafeInteger(repo.id)&&repo.id>0&&/^[\w.-]+\/[\w.-]+$/.test(repo.full_name)&& !(settings.hideIgnored && reading.states[repo.id]?.interest==='ignored') && !(settings.unreadOnly && reading.states[repo.id]?.read);
  const present = (raw: Repository, reason = ''): ReadingItem => {
    const repo = { ...raw, ...cachedAnalyses.get(raw.id), ...canonical.get(raw.id) };
    const category = getDefaultCategory(repo,categories); const categoryId = categories.find(c=>c.name===category)?.id ?? 'none';
    const analysis = repo.ai_details ?? details.get(repo.id);
    const summary = settings.fields.summary ? repo.ai_summary || analysis?.summary || '' : '';
    const texts = (v: unknown): string => Array.isArray(v) ? v.filter(x=>typeof x==='string').join('\n• ') : typeof v==='string' ? v.trim() : '';
    const blocks = Object.entries(analysisFields).filter(([key])=>settings.analysis[key as keyof typeof analysisFields]).map(([key,title])=>({ title, text: key==='quickstart' ? (analysis?.quickstart??[]).map(x=>[x.description,x.command].filter(Boolean).join('\n')).join('\n\n') : texts(analysis?.[key as keyof typeof analysisFields]) })).filter(x=>x.text && !/^(未知|暂无|unknown|n\/a)$/i.test(x.text));
    return { id: repo.id, name: repo.full_name, url: `https://github.com/${repo.full_name}`, categoryId, category: settings.fields.category?category:'',
      summary: summary.length>settings.summaryChars?summary.slice(0,settings.summaryChars)+'…':summary,
      description: settings.fields.description && (!summary || repo.description!==summary)?repo.description??'':'',
      tags: settings.fields.tags?(repo.custom_tags?.length?repo.custom_tags:repo.ai_tags?.length?repo.ai_tags:repo.topics??[]).slice(0,5):[], language:settings.fields.language?repo.language??'':'', stars:settings.fields.stars?repo.stargazers_count:0, updated:settings.fields.updated?repo.pushed_at:'',
      analysis: blocks, sources:settings.fields.sources?(analysis?.sources??[]).filter(x=>safeSourceUrl(x.url)).map(x=>({label:x.label,url:safeSourceUrl(x.url)})):[], generatedAt:settings.fields.sources?analysis?.generated_at??repo.analyzed_at??'':'', reason:settings.fields.reason?reason:'',
      state: { ...(reading.states[repo.id]??emptyReadingState()), ...(!settings.fields.notes?{note:''}:{}) },
    };
  };
  const sections: ReadingSection[] = [];
  if (settings.repositories) {
    const repos = repositories.filter(readable).filter(repo=>!settings.categoryIds.length||settings.categoryIds.includes(categories.find(c=>c.name===getDefaultCategory(repo,categories))?.id??'none'));
    repos.sort((a,b)=>settings.repositorySort==='name'?a.full_name.localeCompare(b.full_name):settings.repositorySort==='updated'?b.pushed_at.localeCompare(a.pushed_at):b.stargazers_count-a.stargazers_count);
    sections.push({id:'repositories',title:'收藏仓库',updatedAt:state.lastSync?new Date(state.lastSync).toISOString():'',items:repos.slice(0,settings.repositoryLimit).map(repo=>present(repo)),...(repos.length>settings.repositoryLimit?{warning:`共 ${repos.length} 个匹配仓库，按数量上限导出 ${settings.repositoryLimit} 个。`}:{})});
  }
  if (settings.discovery) for (const id of settings.channelIds) {
    const builtin = HTML_CHANNELS.find(c=>c.id===id); const channel = custom.channels.find(c=>c.id===id);
    if (builtin) {
      const raw = discovery[id as keyof typeof discovery]??[];
      const repos = [...new Map(raw.filter(readable).map(repo=>[repo.id,repo])).values()];
      const section: ReadingSection = {id,title:builtin.name,updatedAt:String(refreshes[id as keyof typeof refreshes]??''),items:repos.slice(0,settings.perChannel).map(repo=>present(repo)),warning:!repos.length?'桌面尚无此频道的缓存，请先更新。':undefined};
      if (id==='hot-release' && settings.fields.release) section.warning='这是桌面近期更新的项目列表；只有已获取的真实版本记录才展示发布说明。';
      if (settings.fields.release) for (const item of section.items) { const release=state.releases.filter(r=>r.repository.id===item.id&&!r.prerelease).sort((a,b)=>b.published_at.localeCompare(a.published_at))[0]; if(release)item.release={tag:release.tag_name,date:release.published_at,text:release.body??'',url:release.html_url}; }
      sections.push(section);
    } else if (channel) {
      const cutoff = Date.now()-settings.historyDays*86400000;
      const editions = custom.editions.filter(e=>e.channelId===id&&Date.parse(e.generatedAt)>=cutoff).sort((a,b)=>b.generatedAt.localeCompare(a.generatedAt));
      const seen = new Set<number>(); const items:ReadingItem[]=[];
      for (const edition of editions) for (const entry of edition.entries) if(!seen.has(entry.repo.id)&&readable(entry.repo)&&items.length<settings.perChannel) {
        seen.add(entry.repo.id);items.push(present(entry.repo,entry.reason));
      }
      sections.push({id,title:channel.name,updatedAt:editions[0]?.generatedAt??'',items,warning:!editions.length?'所选天数内没有已生成期刊；导出不调用 AI。':editions[0].complete?undefined:'最近一期未完全更新，展示已保存的可用项目。'});
    }
  }
  const snapshot: ReadingSnapshot = {version:1,id:crypto.randomUUID(),accountId:account,generatedAt:new Date().toISOString(),title:settings.title,settings:{...settings,initialPage:settings.initialPage==='repositories'&&!settings.repositories?'discovery':settings.initialPage==='discovery'&&!settings.discovery?'repositories':settings.initialPage},sections,warnings:warnings.slice(0,20)};
  const html=renderReadingHtml(snapshot);const bytes=new Blob([html]).size;
  if(bytes>settings.maxFileMb*1024*1024)throw new Error(`HTML 为 ${(bytes/1024/1024).toFixed(1)} MB，超过 ${settings.maxFileMb} MB 上限。请减少数量、历史天数或分析栏目后再导出。`);
  await rememberSnapshot(account,snapshot);return{snapshot,html,bytes};
}
export async function refreshReadingDiscovery(settings: ReadingSettings): Promise<string[]> {
  if(!settings.discovery)return [];
  const account=readingAccount();const state=useAppStore.getState();if(!state.githubToken)throw new Error('请先配置 GitHub 凭据。');
  const api=createGitHubApiService(state.githubToken);const warnings:string[]=[];
  const deadline=Date.now()+90000;
  for(const id of settings.channelIds.filter(id=>!id.startsWith('custom:'))) {
    if(Date.now()>=deadline){warnings.push('内置发现更新已达到总等待上限，其余频道沿用缓存。');break;}
    try {
      const result=await withDeadline(async signal=>{
        const platform=state.discoveryPlatform;
        if(id==='trending')return api.getTrendingRepositories(platform,1,settings.perChannel,state.trendingTimeRange,signal);
        if(id==='most-popular')return api.getMostPopular(platform,1,Math.min(settings.perChannel,100));
        if(id==='hot-release')return api.getHotReleaseRepositories(platform,1,Math.min(settings.perChannel,100));
        if(id==='topic')return state.discoverySelectedTopic?api.getTopicRepositories(state.discoverySelectedTopic,platform,1,Math.min(settings.perChannel,100)):null;
        if(id==='search')return state.discoverySearchQuery.trim()?api.searchRepositories(state.discoverySearchQuery,platform,state.discoveryLanguage,state.discoverySortBy,state.discoverySortOrder,1):null;
        return null;
      },Math.min(30000,deadline-Date.now()));
      if(readingAccount()!==account)throw new Error('账户已变更');
      if(result?.repos.length){state.setDiscoveryRepos(id as DiscoveryRepo['channel'],result.repos);state.setDiscoveryLastRefresh(id as DiscoveryRepo['channel'],new Date().toISOString());}else warnings.push(`${HTML_CHANNELS.find(c=>c.id===id)?.name??id} 暂无可用新结果，保留原有缓存与更新时间。`);
    }catch{if(readingAccount()!==account)throw new Error('账户已变更');warnings.push(`${HTML_CHANNELS.find(c=>c.id===id)?.name??id} 更新失败，沿用已有缓存。`);}
  }
  // Custom channels may require AI. Respect the explicit no-new-AI rule here.
  if(settings.channelIds.some(id=>id.startsWith('custom:')))warnings.push('自定义频道沿用桌面已生成期刊，日报不会额外调用 AI。');
  return warnings;
}
export async function prepareReadingSend(settings: ReadingSettings): Promise<string[]> {
  const warnings=settings.refreshBeforeSend?await refreshReadingDiscovery(settings):[];
  if(!settings.discovery||!settings.waitForDiscovery||!settings.channelIds.some(id=>id.startsWith('custom:')))return warnings;
  const account=readingAccount();const deadline=Date.now()+60000;
  // Observe an existing desktop run; the report never starts a new AI task.
  while(((await loadData(account)).lease?.expires??0)>Date.now()) {
    if(readingAccount()!==account)throw new Error('账户已变更');
    if(Date.now()>=deadline){warnings.push('桌面发现仍在更新，等待已达 60 秒；使用已保存期刊并保留实际更新时间。');break;}
    await waitForRequest(Math.min(1000,deadline-Date.now()));
  }
  return warnings;
}
export function downloadReadingHtml(html:string) {const url=URL.createObjectURL(new Blob([html],{type:'text/html;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=`GSM-每日阅读-${new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'})}.html`;a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);}
