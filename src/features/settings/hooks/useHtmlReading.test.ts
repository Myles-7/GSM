import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { readingTransaction, loadReadingData } from '../../../lib/html-reading/storage';
import { rememberSnapshot } from '../../../lib/html-reading/storage';
import { defaultSettings, emptyReadingState, type ReadingSnapshot } from '../../../lib/html-reading/model';
const mocks=vi.hoisted(()=>({state:{isAuthenticated:true,user:{id:42},githubToken:'synthetic',repositories:[{id:1,ai_summary:'existing'}],discoveryRepos:{},addRepository:vi.fn()},api:{getRepository:vi.fn(),starRepository:vi.fn()}}));
vi.mock('../../../store/useAppStore',()=>({useAppStore:Object.assign((selector:(s:typeof mocks.state)=>unknown)=>selector(mocks.state),{getState:()=>mocks.state})}));
vi.mock('../../../services/htmlReading',()=>({readingAccount:()=>String(mocks.state.user.id),readingCatalog:async()=>({categories:[],channels:[]}),generatePreparedReadingSnapshot:vi.fn(),prepareReadingSend:vi.fn(),downloadReadingHtml:vi.fn(),ReadingSizeError:class extends Error {diagnostic=undefined;}}));
vi.mock('../../../services/githubApiFactory',()=>({createGitHubApiService:()=>mocks.api}));
import { useHtmlReading } from './useHtmlReading';
beforeEach(async()=>{vi.stubGlobal('indexedDB',new IDBFactory());window.electronAPI=undefined;mocks.state.user={id:42};mocks.state.addRepository.mockReset();mocks.api.getRepository.mockReset();mocks.api.getRepository.mockResolvedValue({id:1,full_name:'acme/tool'});mocks.api.starRepository.mockReset();mocks.api.starRepository.mockResolvedValue(undefined);vi.spyOn(window,'confirm').mockReturnValue(true);await readingTransaction('42',data=>{data.names['1']='acme/tool';data.states['1']={read:false,note:'keep',interest:'interested',candidate:true};});});
async function controller(){const hook=renderHook(()=>useHtmlReading());await waitFor(()=>expect(hook.result.current.ready).toBe(true));return hook;}
it('does not contact GitHub when explicit Star confirmation is declined',async()=>{vi.mocked(window.confirm).mockReturnValue(false);const c=await controller();await act(()=>c.result.current.star('1'));expect(mocks.api.getRepository).not.toHaveBeenCalled();expect(mocks.api.starRepository).not.toHaveBeenCalled();expect((await loadReadingData('42')).states['1'].candidate).toBe(true);});
it('rejects a repository name whose GitHub numeric identity changed',async()=>{mocks.api.getRepository.mockResolvedValue({id:2});const c=await controller();await act(()=>c.result.current.star('1'));expect(mocks.api.starRepository).not.toHaveBeenCalled();expect(c.result.current.error).toContain('项目标识已变化');expect((await loadReadingData('42')).states['1'].candidate).toBe(true);});
it('does not Star after the active account changed during lookup',async()=>{mocks.api.getRepository.mockImplementation(async()=>{mocks.state.user={id:43};return{id:1};});const c=await controller();await act(()=>c.result.current.star('1'));expect(mocks.api.starRepository).not.toHaveBeenCalled();expect((await loadReadingData('42')).states['1'].candidate).toBe(true);});
it('confirms Star without replacing an existing repository analysis or reading note',async()=>{const c=await controller();await act(()=>c.result.current.star('1'));expect(mocks.api.starRepository).toHaveBeenCalledWith('acme','tool');expect(mocks.state.addRepository).not.toHaveBeenCalled();expect(mocks.state.repositories[0].ai_summary).toBe('existing');expect((await loadReadingData('42')).states['1']).toMatchObject({candidate:false,note:'keep'});});
it('does not modify the new account if account changes while GitHub accepts Star',async()=>{mocks.api.starRepository.mockImplementation(async()=>{mocks.state.user={id:43};});const c=await controller();await act(()=>c.result.current.star('1'));expect(mocks.state.addRepository).not.toHaveBeenCalled();expect((await loadReadingData('42')).states['1'].candidate).toBe(true);expect((await loadReadingData('43')).states).toEqual({});});

it('previews and imports reading positions without any business operations or GitHub request',async()=>{
  const snapshot={version:2,id:'positions',accountId:'42',generatedAt:'2026-10-03',title:'GSM',settings:defaultSettings,sections:[{id:'repositories',title:'仓库',updatedAt:'',items:[],entries:[{repoId:1}]}],items:{'1':{id:1,name:'acme/tool',state:emptyReadingState()}}} as unknown as ReadingSnapshot;
  await rememberSnapshot('42',snapshot);const c=await controller();
  await act(()=>c.result.current.inspect(JSON.stringify({format:'gsm-reading-changes',version:2,accountId:'42',snapshotId:'positions',operations:[],positions:[{id:'00000000-0000-4000-8000-000000000001',viewId:'repositories',repoId:1,revision:1}],activeView:null})));
  expect(c.result.current.importRows).toEqual([]);expect(c.result.current.positionRows).toHaveLength(1);expect(c.result.current.message).toContain('1 项继续阅读位置');
  await act(()=>c.result.current.apply());expect(c.result.current.positionRows).toEqual([]);expect(c.result.current.message).toContain('继续阅读位置已保存 1 项');
  expect((await loadReadingData('42')).positions?.repositories.repoId).toBe(1);expect(mocks.api.starRepository).not.toHaveBeenCalled();
});

it('counts each normalized channel and edition reference in actual preview statistics',async()=>{
  const {generatePreparedReadingSnapshot}=await import('../../../services/htmlReading');
  vi.mocked(generatePreparedReadingSnapshot).mockResolvedValue({html:'synthetic',bytes:123,snapshot:{version:2,sections:[{id:'repositories',title:'仓库',items:[],entries:[{repoId:1},{repoId:2}]},{id:'custom:one',title:'周刊',items:[],editions:[{id:'a',date:'2026-10-03',entries:[{repoId:1}]},{id:'b',date:'2026-10-02',entries:[{repoId:2},{repoId:3}]}]}]} as never});
  const c=await controller();await act(()=>c.result.current.generate('preview'));
  expect(c.result.current.preview).toMatchObject({count:5,sections:[{id:'repositories',title:'仓库',count:2},{id:'custom:one::a',title:'周刊 · 2026-10-03',count:1},{id:'custom:one::b',title:'周刊 · 2026-10-02',count:2}]});
});
it('rejects dirty immediate sending before preparing content or contacting mail',async()=>{
  const {generatePreparedReadingSnapshot}=await import('../../../services/htmlReading');vi.mocked(generatePreparedReadingSnapshot).mockClear();
  const c=await controller();await act(()=>c.result.current.setSettings(current=>({...current,title:'未保存标题'})));await act(()=>c.result.current.generate('send'));
  expect(c.result.current.error).toContain('保存并发送');expect(generatePreparedReadingSnapshot).not.toHaveBeenCalled();expect((await loadReadingData('42')).settings.title).toBe(defaultSettings.title);
});
it('cancels pending preparation through its abort signal without requesting export',async()=>{
  const {generatePreparedReadingSnapshot,downloadReadingHtml}=await import('../../../services/htmlReading');vi.mocked(downloadReadingHtml).mockClear();
  vi.mocked(generatePreparedReadingSnapshot).mockImplementation((_settings,_mode,_progress,_refresh,options)=>new Promise((_resolve,reject)=>options?.signal?.addEventListener('abort',()=>reject(Error('已取消生成')),{once:true})));
  const c=await controller();let pending:Promise<void>;act(()=>{pending=c.result.current.generate('export');});await waitFor(()=>expect(c.result.current.canCancel).toBe(true));
  let inspected:boolean|undefined;await act(async()=>{inspected=await c.result.current.inspectFiles([{name:'new.json',text:'{}'}]);});expect(inspected).toBe(false);
  await act(async()=>{c.result.current.cancelGeneration();await pending!;});expect(c.result.current.error).toContain('取消');expect(downloadReadingHtml).not.toHaveBeenCalled();expect(c.result.current.busy).toBe(false);
});
it('invalid batch files prevent a valid file from being partially imported',async()=>{
  const c=await controller();await act(()=>c.result.current.inspectFiles([{name:'bad.json',text:'{}'}]));expect(c.result.current.fileErrors).toHaveLength(1);expect(c.result.current.batch).toBeNull();expect((await loadReadingData('42')).states['1'].note).toBe('keep');
});
