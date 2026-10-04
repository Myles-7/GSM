import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { defaultSettings, snapshotViews } from '../lib/html-reading/model';
const mocks=vi.hoisted(()=>({state:{} as Record<string,unknown>,custom:{channels:[],editions:[],analyses:{}} as unknown,analyses:new Map(),refresh:vi.fn(),hotRefresh:vi.fn()}));
vi.mock('../store/useAppStore',()=>({useAppStore:{getState:()=>mocks.state},getAllCategories:()=>[{id:'tools',name:'工具'}]}));
vi.mock('../features/discovery/custom/storage',()=>({loadData:async()=>mocks.custom}));
vi.mock('./discoveryAnalysisStorage',()=>({discoveryAnalysisStorage:{loadAllAnalyses:async()=>mocks.analyses}}));
vi.mock('./githubApiFactory',()=>({createGitHubApiService:()=>({getMostPopular:mocks.refresh,getHotReleaseRepositories:mocks.hotRefresh})}));
import { generateReadingSnapshot, refreshReadingDiscovery, prepareReadingSend } from './htmlReading';
import { safeSourceUrl } from '../lib/html-reading/render';
import { discoveryAnalysisIdentity } from '../features/discovery/custom/analysisIdentity';
import { editionKey } from '../features/discovery/custom/model';
import { deleteRepositoryAnalysisAssets, initializeRepositoryAnalysisAssets, saveRepositoryAnalysisAsset, applyRepositoryAnalysisAsset } from './repositoryAnalysisAssets';
import { loadReadingData, readingTransaction } from '../lib/html-reading/storage';
import type { Repository } from '../types';
import type { RepositoryDetailsAnalysis } from '../types/repositoryDetails';
const details: RepositoryDetailsAnalysis = { version: 1, generated_at: '2026-10-02T00:00:00Z', repository_pushed_at: '2026-09-29T00:00:00Z', model: 'test', summary: '资产摘要：用一个命令部署离线资料阅读与搜索服务。', tags: ['离线', '搜索'], platforms: ['Windows'], software_forms: ['cli'], deployment_modes: ['local'], problem: '降低管理成本', features: ['快速搜索', '导出 HTML'], scenarios: ['整理项目资料'], architecture: 'TypeScript 与 SQLite', quickstart: [{ description: '安装并启动', command: 'npm install\nnpm run start' }], deployment: '本机运行', cost: '无需服务器', maintenance: '持续维护', sources: [{ label: 'README', url: 'https://github.com/acme/tool#readme', retrieved_at: '2026-10-02T00:00:00Z' }] };
const repo={id:1,name:'tool',full_name:'acme/tool',html_url:'https://github.com/acme/tool',owner:{login:'acme',avatar_url:'SECRET'},category_id:'tools',stargazers_count:50,pushed_at:'2026-09-29',topics:['cli'],description:'description',ai_summary:'中文摘要',custom_description:'PRIVATE',apiKey:'API_SECRET',ai_details:{summary:'detail',features:['useful'],sources:[{label:'README',url:'https://github.com/acme/tool#readme'},{label:'local',url:'file:///C:/secret'}],generated_at:'2026-09-30'}};
beforeEach(()=>{vi.stubGlobal('indexedDB',new IDBFactory());mocks.custom={channels:[],editions:[],analyses:{}};mocks.state={user:{id:42},isAuthenticated:true,repositories:[repo],discoveryRepos:{'most-popular':[repo]},discoveryLastRefresh:{'most-popular':'2026-09-29'},customCategories:[],releases:[],language:'zh',lastSync:'2026-09-29',githubToken:'TOKEN',setDiscoveryRepos:vi.fn(),setDiscoveryLastRefresh:vi.fn()};mocks.refresh.mockReset();mocks.hotRefresh.mockReset();});
describe('reading snapshots use real desktop data',()=>{
  it('hashes source analysis before projection and compares only the provided Gmail accepted baseline',async()=>{
    await saveRepositoryAnalysisAsset('42',repo as unknown as Repository,'zh',undefined,details);
    const first=await generateReadingSnapshot({...defaultSettings,discovery:false},[],undefined,{registerSnapshot:false});
    expect(first.snapshot.comparisonAvailable).toBe(false);
    const baseline=first.snapshot.comparisonIndex!;
    const second=await generateReadingSnapshot({...defaultSettings,discovery:false,fontSize:'20',fields:{...defaultSettings.fields,summary:false},analysis:{...defaultSettings.analysis,features:false}},[],undefined,{baseline,registerSnapshot:false});
    expect(second.snapshot.comparisonIndex).toEqual(baseline);expect(second.snapshot.items!['1'].dailyChange).toBeUndefined();expect(second.snapshot.items!['1'].summary).toBe('');expect(second.snapshot.items!['1'].hasSourceAnalysis).toBe(true);
    await saveRepositoryAnalysisAsset('42',repo as unknown as Repository,'zh',undefined,{...details,generated_at:new Date().toISOString(),summary:'已更新的来源摘要'});
    const changed=await generateReadingSnapshot({...defaultSettings,discovery:false},[],undefined,{baseline,registerSnapshot:false});
    expect(changed.snapshot.items!['1'].dailyChange).toBe('analysis-updated');expect(baseline).toEqual(first.snapshot.comparisonIndex);
    const added=await generateReadingSnapshot({...defaultSettings,discovery:false},[],undefined,{baseline:{},registerSnapshot:false});expect(added.snapshot.items!['1'].dailyChange).toBe('new');
    expect((await loadReadingData('42')).snapshots).toEqual({});
  });
  it('reports section and field contributions on oversized output',async()=>{
    mocks.state.repositories=[{...repo,ai_summary:'摘要'.repeat(800000)}];
    await expect(generateReadingSnapshot({...defaultSettings,maxFileMb:1})).rejects.toMatchObject({code:'size',retryable:false,diagnostic:{sections:{repositories:expect.any(Number)},fields:{summary:expect.any(Number)}}});
  });
  it('includes selected fields once and excludes credentials, paths, unused descriptions and keys',async()=>{const output=await generateReadingSnapshot(defaultSettings);expect(output.snapshot.version).toBe(2);expect(output.html).toContain('中文摘要');expect(output.html).toContain('useful');for(const secret of ['API_SECRET','TOKEN','PRIVATE','C:/secret','avatar_url'])expect(output.html).not.toContain(secret);expect(output.snapshot.sections.find(s=>s.id==='repositories')?.entries).toEqual([{repoId:1}]);expect(output.snapshot.sections.every(section=>section.items.length===0)).toBe(true);expect(Object.keys(output.snapshot.items!)).toEqual(['1']);});
  it('keeps complete summaries and applies per-view field unions without restoring globally excluded data',async()=>{
    mocks.state.repositories=[{...repo,ai_summary:'完整摘要。'.repeat(1000)}];
    const output=await generateReadingSnapshot({...defaultSettings,summaryChars:100,repositoryProfile:{cardFields:['summary'],detailModes:{features:'omit'}},channelProfiles:{'most-popular':{cardFields:['tags'],detailModes:{features:'expanded'},perChannel:1}}});
    expect(output.snapshot.items!['1'].summary).toBe('完整摘要。'.repeat(1000));
    expect(output.snapshot.items!['1'].analysis.some(b=>b.key==='features')).toBe(true);
    expect(output.snapshot.sections[0].presentation?.detailModes.features).toBe('omit');
    expect(output.snapshot.sections.find(section=>section.id==='most-popular')?.targetCount).toBe(1);
  });
  it('records size failures and does not register an unusable oversized snapshot',async()=>{
    mocks.state.repositories=[{...repo,ai_summary:'摘要'.repeat(800000)}];
    await expect(generateReadingSnapshot({...defaultSettings,maxFileMb:1})).rejects.toThrow('本次未发送');
    const data=await loadReadingData('42');expect(data.generationFailures).toHaveLength(1);expect(data.snapshots).toEqual({});
  });
  it('paginates with fixed page size, deduplicates stable IDs and stops at the target',async()=>{
    const first=Array.from({length:100},(_,i)=>({...repo,id:i+1}));
    mocks.refresh.mockResolvedValueOnce({repos:first,hasMore:true,nextPageIndex:2}).mockResolvedValueOnce({repos:[first[99],...Array.from({length:60},(_,i)=>({...repo,id:i+101}))],hasMore:true,nextPageIndex:3});
    expect(await refreshReadingDiscovery({...defaultSettings,channelIds:['most-popular'],channelProfiles:{'most-popular':{perChannel:150}}})).toEqual([]);
    expect(mocks.refresh).toHaveBeenNthCalledWith(2,undefined,2,100,expect.any(AbortSignal));
    const published=(mocks.state.setDiscoveryRepos as ReturnType<typeof vi.fn>).mock.calls[0][1];expect(published).toHaveLength(150);expect(new Set(published.map((r:Repository)=>r.id)).size).toBe(150);
  });
  it('retains previously cached tail projects and their timestamp when paging fails',async()=>{
    const old={...repo,id:2};mocks.state.discoveryRepos={'most-popular':[repo,old]};
    mocks.refresh.mockResolvedValueOnce({repos:[repo],hasMore:true,nextPageIndex:2}).mockRejectedValueOnce(Error('network'));
    const warnings=await refreshReadingDiscovery({...defaultSettings,channelIds:['most-popular']});expect(warnings[0]).toContain('此前缓存');expect(mocks.state.setDiscoveryRepos).toHaveBeenCalledWith('most-popular',[repo,old]);expect(mocks.state.setDiscoveryLastRefresh).not.toHaveBeenCalled();
  });
  it('keeps successful first pages after a later upstream failure and reports unmet counts',async()=>{
    mocks.refresh.mockResolvedValueOnce({repos:[repo],hasMore:true,nextPageIndex:2}).mockRejectedValueOnce(Error('rate limit'));
    const warnings=await refreshReadingDiscovery({...defaultSettings,channelIds:['most-popular']});
    expect(warnings[0]).toContain('本次取得 1');expect(warnings[0]).toContain('失败');expect(mocks.state.setDiscoveryRepos).toHaveBeenCalledWith('most-popular',[repo]);
  });
  it('removes disabled content from the payload itself',async()=>{const settings=structuredClone(defaultSettings);settings.fields.summary=false;settings.fields.description=false;settings.analysis.features=false;settings.fields.sources=false;const output=await generateReadingSnapshot(settings);expect(output.html).not.toContain('中文摘要');expect(output.html).not.toContain('useful');expect(output.snapshot.items!['1']).toMatchObject({summary:'',description:'',sources:[],generatedAt:''});});
  it('uses selected categories and pages without altering desktop data',async()=>{const output=await generateReadingSnapshot({...defaultSettings,discovery:false,categoryIds:['other']});expect(output.snapshot.sections).toHaveLength(1);expect(output.snapshot.sections[0].entries).toHaveLength(0);expect(mocks.state.repositories).toHaveLength(1);});
  it('rejects no pages and excessive file size',async()=>{await expect(generateReadingSnapshot({...defaultSettings,repositories:false,discovery:false})).rejects.toThrow('至少');mocks.state.repositories=[{...repo,ai_details:{features:['x'.repeat(2000000)]}}];await expect(generateReadingSnapshot({...defaultSettings,maxFileMb:1})).rejects.toThrow('超过');});
  it.each([{channelIds:[]},{channelIds:['custom:removed']}])('rejects a discovery page without an available selected channel: %j',async ({channelIds})=>{
    await expect(generateReadingSnapshot({...defaultSettings,repositories:false,channelIds})).rejects.toThrow('可用发现频道');
    expect((await loadReadingData('42')).snapshots).toEqual({});
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
  it('keeps cached discovery on failure and clears it after confirmed empty success',async()=>{mocks.refresh.mockRejectedValueOnce(Error('network'));const s={...defaultSettings,channelIds:['most-popular']};expect(await refreshReadingDiscovery(s)).toHaveLength(1);expect(mocks.state.setDiscoveryRepos).not.toHaveBeenCalled();mocks.refresh.mockResolvedValueOnce({repos:[]});await refreshReadingDiscovery(s);expect(mocks.state.setDiscoveryRepos).toHaveBeenCalledWith('most-popular',[]);expect(mocks.state.setDiscoveryLastRefresh).toHaveBeenCalled();});
  it('does not invoke AI to update custom channels',async()=>{expect(await refreshReadingDiscovery({...defaultSettings,channelIds:['custom:test']})).toEqual([expect.stringContaining('不会额外调用 AI')]);expect(mocks.refresh).not.toHaveBeenCalled();});
  it('escapes executable project content and rejects unsafe source URLs',async()=>{mocks.state.repositories=[{...repo,ai_summary:'</script><img src=x onerror=alert(1)>'}];const {html}=await generateReadingSnapshot(defaultSettings);const payload=html.match(/<script id="gsm-data" type="application\/json">(.*?)<\/script>/s)![1];expect(payload).not.toContain('</script>');expect(html).not.toContain('<img src=x');expect(JSON.parse(payload).items['1'].summary).toBe('</script><img src=x onerror=alert(1)>');expect(safeSourceUrl('javascript:alert(1)')).toBe('');expect(safeSourceUrl('https://user:pass@example.com')).toBe('');});
  it('exports existing custom editions and identity-matched analyses without generating AI',async()=>{const candidate={...repo,id:2,full_name:'acme/second',ai_summary:'',ai_details:undefined};mocks.custom={channels:[{id:'custom:tools',name:'专题'}],editions:[{channelId:'custom:tools',date:'2026-10-03',revision:1,generatedAt:new Date().toISOString(),complete:true,entries:[{repo:candidate,reason:'适合离线研究'}]}],analyses:{[discoveryAnalysisIdentity(candidate as unknown as Repository,'zh')]:{status:'done',updatedAt:1,details:{summary:'已生成的专题摘要',features:['已生成的功能'],sources:[]}}}};const output=await generateReadingSnapshot({...defaultSettings,channelIds:['custom:tools']});expect(output.snapshot.items!['2'].summary).toBe('已生成的专题摘要');expect(output.html).toContain('已生成的功能');expect(output.snapshot.sections[1].editions![0].entries[0]).toEqual({repoId:2,reason:'适合离线研究'});expect(mocks.refresh).not.toHaveBeenCalled();});
  it('does not export unscoped, stale list or unmatched old-format discovery analysis',async()=>{const candidate={...repo,id:2,full_name:'acme/second',ai_summary:'stale list summary',ai_details:undefined};mocks.analyses.set(2,{ai_summary:'legacy account summary'});mocks.custom={channels:[{id:'custom:tools',name:'专题'}],editions:[{channelId:'custom:tools',date:'2026-10-03',revision:1,generatedAt:new Date().toISOString(),complete:true,entries:[{repo:candidate}]}],analyses:{'[2,"custom:tools",1]':{details:{summary:'legacy details'}},[discoveryAnalysisIdentity(candidate as unknown as Repository,'en')]:{details:{summary:'wrong language'}}}};const output=await generateReadingSnapshot({...defaultSettings,channelIds:['custom:tools']});expect(output.snapshot.items!['2'].summary).toBe('');for(const text of ['stale list summary','legacy account summary','legacy details','wrong language'])expect(output.html).not.toContain(text);});
  it('removes empty modification panels when all phone operations are disabled',async()=>{const output=await generateReadingSnapshot({...defaultSettings,operations:{read:false,interest:false,note:false,candidate:false}});expect(output.html).not.toContain('<summary>阅读标记与笔记</summary>');});
  it('does not request discovery when its page is excluded',async()=>{expect(await refreshReadingDiscovery({...defaultSettings,discovery:false})).toEqual([]);expect(mocks.refresh).not.toHaveBeenCalled();});
  it('reads the current asset after model and repository timestamp changes, retaining lists and commands',async()=>{
    await saveRepositoryAnalysisAsset('42',repo as unknown as Repository,'zh',undefined,details);
    mocks.state.activeAIConfig='other';mocks.state.aiConfigs=[{id:'other',model:'other',apiKey:'FORBIDDEN_MODEL_KEY'}];
    mocks.state.repositories=[{...repo,pushed_at:'2026-10-03T00:00:00Z',ai_summary:'stale summary'}];
    const output=await generateReadingSnapshot(defaultSettings);const item=output.snapshot.items!['1'];
    expect(item.summary).toBe(details.summary);expect(item.analysis.find(block=>block.key==='features')).toEqual({key:'features',title:'主要功能',kind:'list',text:'',values:['快速搜索','导出 HTML']});
    expect(item.analysis.find(block=>block.key==='quickstart')).toMatchObject({kind:'steps',text:'',steps:details.quickstart});
    expect(output.html).not.toContain('stale summary');expect(output.html).not.toContain('FORBIDDEN_MODEL_KEY');
  });
  it('migrates valid custom analyses across old configurations and prefers current language',async()=>{
    const candidate={...repo,id:2,full_name:'acme/second',ai_details:undefined} as unknown as Repository;
    mocks.custom={channels:[{id:'custom:tools',name:'专题'}],editions:[{channelId:'custom:tools',date:'2026-10-03',revision:1,generatedAt:new Date().toISOString(),complete:true,entries:[{repo:candidate}]}],analyses:{[discoveryAnalysisIdentity(candidate,'zh',{id:'retired',model:'old'} as never)]:{details,status:'failed',updatedAt:1},[discoveryAnalysisIdentity(candidate,'en')]:{details:{...details,summary:'Newer English',generated_at:'2026-10-03T00:00:00Z'},status:'done',updatedAt:2}}};
    const settings={...defaultSettings,channelIds:['custom:tools']};expect((await generateReadingSnapshot(settings)).snapshot.items!['2'].summary).toBe(details.summary);
    mocks.state.language='ja';expect((await generateReadingSnapshot(settings)).snapshot.items!['2'].summary).toBe('Newer English');
  });
  it('does not resurrect deleted assets from desktop or custom caches',async()=>{
    await saveRepositoryAnalysisAsset('42',repo as unknown as Repository,'zh',undefined,details);await deleteRepositoryAnalysisAssets('42',[repo.id]);
    mocks.custom={channels:[{id:'custom:tools',name:'专题'}],editions:[{channelId:'custom:tools',date:'2026-10-03',revision:1,generatedAt:new Date().toISOString(),complete:true,entries:[{repo}]}],analyses:{[discoveryAnalysisIdentity(repo as unknown as Repository,'zh')]:{details,status:'done'}}};
    const output=await generateReadingSnapshot({...defaultSettings,channelIds:['custom:tools']});expect(output.snapshot.items!['1']).toMatchObject({summary:'',analysis:[],sources:[],generatedAt:''});expect(output.html).not.toContain('中文摘要');expect(output.html).not.toContain(details.summary!);
  });
  it('preserves wrong-account provenance across cloning and excludes its projected results',async()=>{
    await saveRepositoryAnalysisAsset('99',repo as unknown as Repository,'zh',undefined,details);await initializeRepositoryAnalysisAssets('99',[]);
    mocks.state.repositories=[applyRepositoryAnalysisAsset('99',repo as unknown as Repository,'zh')];
    const output=await generateReadingSnapshot(defaultSettings);expect(output.snapshot.items!['1']).toMatchObject({summary:'',analysis:[]});expect(output.html).not.toContain(details.summary!);
  });
  it('limits each edition independently and retains stable keys, dates and recommendation context',async()=>{
    const candidate={...repo,id:2,full_name:'acme/second',ai_details:undefined};
    const editions=[{channelId:'custom:tools',date:'2026-10-03',revision:1,generatedAt:new Date().toISOString(),complete:false,entries:[{repo,reason:'今天用途'},{repo:candidate}]},{channelId:'custom:tools',date:'2026-10-02',revision:2,generatedAt:new Date(Date.now()-86400000).toISOString(),complete:true,entries:[{repo:candidate,reason:'昨天用途'},{repo}]}];
    mocks.custom={channels:[{id:'custom:tools',name:'专题'}],editions,analyses:{}};
    const output=await generateReadingSnapshot({...defaultSettings,perChannel:1,channelIds:['custom:tools']});const section=output.snapshot.sections[1];
    expect(section.editions?.map(e=>e.id)).toEqual(editions.map(e=>editionKey(e as never)));expect(section.editions?.map(e=>e.entries)).toEqual([[{repoId:1,reason:'今天用途'}],[{repoId:2,reason:'昨天用途'}]]);
    expect(section.editions![0]).toMatchObject({complete:false,warning:expect.stringContaining('未完全更新')});expect(Object.keys(output.snapshot.items!)).toEqual(['1','2']);expect(Object.keys(snapshotViews(output.snapshot))).toContain(`custom:tools::${encodeURIComponent(editionKey(editions[1] as never))}`);
  });
  it('keeps true release details in entry context and obeys the release and reason switches',async()=>{
    mocks.state.releases=[{repository:{id:1},prerelease:false,tag_name:'v2.1',published_at:'2026-10-02T00:00:00Z',body:'真实发布说明',html_url:'https://github.com/acme/tool/releases/tag/v2.1'}];
    mocks.custom={channels:[{id:'custom:tools',name:'专题'}],editions:[{channelId:'custom:tools',date:'2026-10-03',revision:1,generatedAt:new Date().toISOString(),complete:true,entries:[{repo,reason:'频道理由'}]}],analyses:{}};
    const settings={...defaultSettings,channelIds:['custom:tools']};const first=await generateReadingSnapshot(settings);expect(first.snapshot.items!['1'].release).toBeUndefined();expect(first.snapshot.sections[1].editions![0].entries[0]).toMatchObject({release:{tag:'v2.1',text:'真实发布说明'},reason:'频道理由'});
    const disabled=await generateReadingSnapshot({...settings,fields:{...settings.fields,reason:false,release:false}});expect(disabled.snapshot.sections[1].editions![0].entries[0]).toEqual({repoId:1});expect(disabled.html).not.toContain('真实发布说明');expect(disabled.html).not.toContain('频道理由');
  });
  it('exports the verified discovery release context before the separate saved release list',async()=>{
    const publishedAt=new Date(Date.now()-3600000).toISOString();
    const recentRelease={tag_name:'v3.0',name:'新版本',published_at:publishedAt,html_url:'https://github.com/acme/tool/releases/tag/v3.0',prerelease:false,body:'发现中已核验的发布说明',apiKey:'RELEASE_SECRET'};
    mocks.state.discoveryRepos={'hot-release':[{...repo,recentRelease}]};mocks.state.releases=[{repository:{id:1},tag_name:'v2.1',published_at:'2026-10-02T00:00:00Z',html_url:'https://github.com/acme/tool/releases/tag/v2.1',prerelease:false,body:'较旧缓存'}];
    const settings={...defaultSettings,channelIds:['hot-release']};const output=await generateReadingSnapshot(settings);const channel=output.snapshot.sections[1];
    expect(channel.title).toBe('热门发布');expect(channel.entries![0].release).toEqual({tag:'v3.0',date:publishedAt,text:'发现中已核验的发布说明',url:recentRelease.html_url});expect(channel.warning ?? '').not.toContain('旧缓存');expect(output.html).not.toContain('RELEASE_SECRET');
    expect((await generateReadingSnapshot({...settings,fields:{...settings.fields,release:false}})).snapshot.sections[1].entries![0].release).toBeUndefined();
  });
  it.each([
    {published_at:'2026-99-99'}, {published_at:'2099-01-01T00:00:00Z'}, {html_url:'javascript:alert(1)'},
    {html_url:'https://github.com/another/project/releases/tag/v3.0'}, {html_url:'https://github.com/acme/tool/releases/tag/wrong'},
    {html_url:'https://github.com/acme/tool/releases/tag/v3.0?access_token=LEAK'}, {html_url:'https://secret:pass@github.com/acme/tool/releases/tag/v3.0'},
    {draft:true}, {prerelease:true}, {tag_name:''},
  ])('rejects invalid release metadata without substituting pushed_at: %j',async patch=>{
    mocks.state.discoveryRepos={'hot-release':[{...repo,recentRelease:{tag_name:'v3.0',published_at:new Date(Date.now()-3600000).toISOString(),html_url:'https://github.com/acme/tool/releases/tag/v3.0',prerelease:false,...patch}}]};
    const output=await generateReadingSnapshot({...defaultSettings,channelIds:['hot-release']});expect(output.snapshot.sections[1].entries![0].release).toBeUndefined();expect(output.snapshot.sections[1].warning).toContain('旧缓存');expect(output.html).not.toContain('LEAK');
  });
  it('uses desktop prerelease preference and preserves a verified title when body was not cached',async()=>{
    mocks.custom={channels:[],editions:[],analyses:{},builtinPreferences:{'hot-release':{prereleases:true}}};
    const recentRelease={tag_name:'v3.0-beta',name:'Beta release title',published_at:new Date(Date.now()-3600000).toISOString(),html_url:'https://github.com/acme/tool/releases/tag/v3.0-beta',prerelease:true};
    mocks.state.discoveryRepos={'hot-release':[{...repo,recentRelease}]};const output=await generateReadingSnapshot({...defaultSettings,channelIds:['hot-release']});expect(output.snapshot.sections[1].entries![0].release?.text).toBe('Beta release title');
    mocks.hotRefresh.mockResolvedValue({repos:[{...repo,recentRelease}],verification:{partial:true,failed:1,total:2,current:1}});
    const warnings=await refreshReadingDiscovery({...defaultSettings,channelIds:['hot-release']});expect(mocks.hotRefresh).toHaveBeenCalledWith(undefined,1,60,{prereleases:true,signal:expect.any(AbortSignal)});expect(warnings).toEqual(expect.arrayContaining([expect.stringContaining('未全部完成'),expect.stringContaining('目标 60')]));
  });
  it('fills an omitted discovery release body only from the same cached tag and context',async()=>{
    const recentRelease={tag_name:'v3.0',name:'当前发布标题',published_at:new Date(Date.now()-3600000).toISOString(),html_url:'https://github.com/acme/tool/releases/tag/v3.0',prerelease:false};
    mocks.state.discoveryRepos={'hot-release':[{...repo,recentRelease}]};
    mocks.state.releases=[{...recentRelease,repository:{id:1},tag_name:'v2.0',html_url:'https://github.com/acme/tool/releases/tag/v2.0',body:'不同版本说明'}];
    const settings={...defaultSettings,channelIds:['hot-release']};const absent=await generateReadingSnapshot(settings);expect(absent.snapshot.sections[1].entries![0].release?.text).toBe('当前发布标题');
    mocks.state.releases=[{...recentRelease,repository:{id:1},published_at:new Date(Date.now()-7200000).toISOString(),body:'不同发布日期说明'}];
    expect((await generateReadingSnapshot(settings)).snapshot.sections[1].entries![0].release?.text).toBe('当前发布标题');
    mocks.state.releases=[{...recentRelease,repository:{id:1},body:'同版本已保存的发布说明'}];
    const filled=await generateReadingSnapshot(settings);expect(filled.snapshot.sections[1].entries![0].release?.text).toBe('同版本已保存的发布说明');expect(filled.html).not.toContain('不同版本说明');expect(filled.html).not.toContain('不同发布日期说明');
  });
  it('clearly labels an older hot-release cache with no actual release metadata',async()=>{
    mocks.state.discoveryRepos={'hot-release':[repo]};const output=await generateReadingSnapshot({...defaultSettings,channelIds:['hot-release']});expect(output.snapshot.sections[1].title).toBe('热门发布');expect(output.snapshot.sections[1].warning).toContain('未附有效的真实 Release');expect(output.snapshot.sections[1].entries![0]).toEqual({repoId:1});
  });
  it('honours the desktop custom channel blocklist for all exported editions',async()=>{
    mocks.custom={channels:[{id:'custom:tools',name:'专题',blocked:[1]}],editions:[{channelId:'custom:tools',date:'2026-10-03',revision:1,generatedAt:new Date().toISOString(),complete:true,entries:[{repo}]}],analyses:{}};
    const output=await generateReadingSnapshot({...defaultSettings,repositories:false,channelIds:['custom:tools']});expect(output.snapshot.sections[0].editions![0].entries).toEqual([]);expect(output.snapshot.items).toEqual({});
  });
  it('records canonical operation bases before rendering the generated snapshot',async()=>{
    const output=await generateReadingSnapshot({...defaultSettings,fields:{...defaultSettings.fields,notes:true}});const data=await loadReadingData('42');expect(data.snapshots[output.snapshot.id].base[1]).toEqual(output.snapshot.items!['1'].state);expect(output.snapshot.theme).toMatchObject({presetId:'default'});
    expect(output.snapshot.sequence).toBeGreaterThan(0);const payload=output.html.match(/<script id="gsm-data" type="application\/json">(.*?)<\/script>/s)![1];expect(JSON.parse(payload).sequence).toBe(output.snapshot.sequence);
  });
  it('excludes category identity as well as its label when category content is disabled',async()=>{
    const output=await generateReadingSnapshot({...defaultSettings,fields:{...defaultSettings.fields,category:false}});expect(output.snapshot.items!['1']).toMatchObject({categoryId:'',category:''});
  });
  it('uses migrated valid detail assets exactly as the desktop projection does',async()=>{
    const migratedRepo={...repo,ai_summary:'旧列表摘要',ai_details:details};mocks.state.repositories=[migratedRepo];
    const output=await generateReadingSnapshot(defaultSettings);expect(output.snapshot.items!['1'].summary).toBe(applyRepositoryAnalysisAsset('42',migratedRepo as unknown as Repository,'zh').ai_summary);expect(output.snapshot.items!['1'].summary).toBe(details.summary);
  });
  it('distinguishes filtered-out cached content from absent cache and marks old cached results',async()=>{
    await readingTransaction('42',data=>{data.states['1']={read:true,interest:'neutral',candidate:false,note:''};});
    const settings={...defaultSettings,unreadOnly:true,channelIds:['most-popular']};
    const output=await generateReadingSnapshot(settings);const channel=output.snapshot.sections[1];expect(channel.entries).toEqual([]);expect(channel.warning).toContain('当前导出条件');expect(channel.warning).toContain('超过 24 小时');expect(channel.warning).not.toContain('尚无');
    mocks.state.discoveryRepos={'most-popular':[]};const empty=(await generateReadingSnapshot(settings)).snapshot.sections[1];expect(empty.warning).toContain('尚无');expect(empty.warning).not.toContain('超过 24 小时');
  });
  it('waits only for an existing discovery lease, caps waiting and writes the warning in HTML',async()=>{vi.useFakeTimers();try{mocks.custom={channels:[],editions:[],analyses:{},lease:{expires:Date.now()+120000}};const settings={...defaultSettings,refreshBeforeSend:false,channelIds:['custom:tools']};const pending=prepareReadingSend(settings);await vi.advanceTimersByTimeAsync(60000);const warnings=await pending;vi.useRealTimers();expect(warnings).toEqual([expect.stringContaining('60 秒')]);mocks.custom={channels:[{id:'custom:tools',name:'专题'}],editions:[],analyses:{}};const output=await generateReadingSnapshot(settings,warnings);expect(output.html).toContain('桌面发现仍在更新');expect(mocks.refresh).not.toHaveBeenCalled();}finally{vi.useRealTimers();}});
});
