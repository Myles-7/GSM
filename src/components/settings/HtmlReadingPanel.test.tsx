import { beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { IDBFactory } from 'fake-indexeddb';
const mocks=vi.hoisted(()=>({generate:vi.fn(),state:{isAuthenticated:true,user:{id:42},language:'zh'},configure:vi.fn(async()=>({})),preview:vi.fn(async()=>({success:true})),status:vi.fn(async()=>({}))}));
vi.mock('../../store/useAppStore',()=>({useAppStore:Object.assign((selector:(state:typeof mocks.state)=>unknown)=>selector(mocks.state),{getState:()=>mocks.state})}));
vi.mock('../../services/htmlReading',()=>({ReadingSizeError:class extends Error {},readingAccount:()=> '42',readingCatalog:async()=>({account:'42',categories:[{id:'tools',name:'工具'}],channels:[{id:'trending',name:'趋势'}]}),generatePreparedReadingSnapshot:mocks.generate,downloadReadingHtml:vi.fn(),prepareReadingSend:vi.fn(async()=>[])}));
import { HtmlReadingPanel } from './HtmlReadingPanel';
import { loadReadingData, readingTransaction } from '../../lib/html-reading/storage';
beforeEach(()=>{vi.stubGlobal('indexedDB',new IDBFactory());window.electronAPI={htmlReading:{configure:mocks.configure,status:mocks.status,preview:mocks.preview}} as unknown as Window['electronAPI'];mocks.generate.mockReset();mocks.preview.mockClear();mocks.generate.mockResolvedValue({html:'<!doctype html><p>preview</p>',bytes:100,snapshot:{id:'s',sections:[]}});});
it('saves actual content selections and uses them for the real preview',async()=>{render(<HtmlReadingPanel/>);await screen.findByRole('tab',{name:'内容范围'});fireEvent.click(screen.getByRole('tab',{name:'内容范围'}));fireEvent.click(screen.getByRole('tab',{name:'阅读样式'}));fireEvent.click(screen.getByRole('checkbox',{name:'完整摘要／描述'}));fireEvent.change(screen.getByRole('combobox',{name:'AI 摘要'}),{target:{value:'omit'}});fireEvent.click(screen.getByRole('tab',{name:'内容范围'}));fireEvent.click(screen.getByRole('checkbox',{name:'工具'}));fireEvent.click(screen.getByRole('button',{name:'保存设置'}));await waitFor(()=>expect(screen.getByText('设置已保存；定时邮件将使用已保存配置。')).toBeInTheDocument());const saved=await loadReadingData('42');expect(saved.settings.defaultProfile.detailModes?.summary).toBe('omit');expect(saved.settings.categoryIds).toEqual(['tools']);fireEvent.click(screen.getByRole('button',{name:'预览 HTML'}));await waitFor(()=>expect(mocks.generate).toHaveBeenCalledWith(expect.objectContaining({categoryIds:['tools'],defaultProfile:expect.objectContaining({detailModes:expect.objectContaining({summary:'omit'})})}),'preview',expect.any(Function),false,expect.objectContaining({signal:expect.any(AbortSignal)})));await waitFor(()=>expect(mocks.preview).toHaveBeenCalledWith('<!doctype html><p>preview</p>'));expect(screen.queryByTitle('每日 HTML 预览')).not.toBeInTheDocument();expect(screen.queryByRole('dialog')).not.toBeInTheDocument();});
it('keeps mail disabled until credentials exist and starts at 08:00 Beijing by default',async()=>{render(<HtmlReadingPanel/>);await screen.findByRole('tab',{name:'内容范围'});fireEvent.click(screen.getByRole('tab',{name:'内容范围'}));fireEvent.click(screen.getByRole('tab',{name:'邮件发送'}));expect(screen.getByRole('button',{name:'立即生成并发送'})).toBeDisabled();expect(screen.getByLabelText('每日生成并发送时间（北京时间）')).toHaveValue('08:00');expect(screen.getByRole('checkbox',{name:'启用每日邮件'})).not.toBeChecked();});
it('exports without opening a blocking preview dialog',async()=>{render(<HtmlReadingPanel/>);await screen.findByRole('tab',{name:'内容范围'});fireEvent.click(screen.getByRole('tab',{name:'内容范围'}));fireEvent.click(screen.getByRole('button',{name:'导出 HTML'}));await waitFor(()=>expect(screen.getByText('已请求下载 HTML，请确认文件保存成功。')).toBeInTheDocument());expect(screen.queryByRole('dialog')).not.toBeInTheDocument();});
it('keeps the actual preview outside settings and exposes reopen and download',async()=>{
  render(<HtmlReadingPanel/>);await screen.findByRole('tab',{name:'概览'});
  expect(screen.getByRole('tab',{name:'概览'})).toHaveAttribute('aria-selected','true');
  fireEvent.click(screen.getByRole('button',{name:'预览 HTML'}));
  await waitFor(()=>expect(mocks.preview).toHaveBeenCalledWith('<!doctype html><p>preview</p>'));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();expect(document.querySelector('iframe')).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:'重新打开独立预览'}));expect(mocks.preview).toHaveBeenCalledTimes(2);
  expect(screen.getByRole('button',{name:'下载当前预览 HTML'})).toBeInTheDocument();
});
it('provides an explicit browser preview button after generation and marks stale checks',async()=>{
  window.electronAPI=undefined;
  render(<HtmlReadingPanel/>);await screen.findByRole('tab',{name:'概览'});
  fireEvent.click(screen.getByRole('button',{name:'预览 HTML'}));
  await screen.findByRole('button',{name:'打开独立浏览器预览'});
  fireEvent.click(screen.getByRole('tab',{name:'内容范围'}));fireEvent.change(screen.getByLabelText('HTML 标题'),{target:{value:'另一份日报'}});
  expect(screen.getByText(/本次内容检查.*配置已变更/)).toBeInTheDocument();
  expect(document.querySelector('iframe')).toBeNull();
});
it('exposes bounded cache freshness and managed artifact retention',async()=>{
  render(<HtmlReadingPanel/>);await screen.findByRole('tab',{name:'概览'});
  fireEvent.click(screen.getByRole('tab',{name:'频道配置'}));
  expect(screen.getByLabelText('可沿用内置频道缓存的最长天数')).toHaveAttribute('max','7');
  expect(screen.getByLabelText('可沿用内置频道缓存的最长天数')).toHaveValue(7);
  fireEvent.click(screen.getByRole('tab',{name:'存储与清理'}));
  expect(screen.getByLabelText('受管理附件保留天数')).toHaveValue(90);
  expect(screen.getByLabelText('受管理附件保留天数')).toHaveAttribute('min','7');
  expect(screen.getByRole('button',{name:'清理已过期附件'})).toBeDisabled();
});

it('keeps channel overrides during preset changes unless reset is explicitly selected',async()=>{
  await readingTransaction('42',data=>{data.settings.channelProfiles={trending:{perChannel:120,detailModes:{features:'omit'}}};});
  render(<HtmlReadingPanel/>);await screen.findByRole('tab',{name:'内容范围'});fireEvent.click(screen.getByRole('tab',{name:'内容范围'}));
  fireEvent.change(screen.getByLabelText('阅读预设'),{target:{value:'browse'}});
  expect(screen.getByRole('button',{name:'保留高级调整'})).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'保留高级调整'}));fireEvent.click(screen.getByRole('button',{name:'保存设置'}));
  await waitFor(()=>expect(screen.getByText('设置已保存；定时邮件将使用已保存配置。')).toBeInTheDocument());
  const saved=await loadReadingData('42');expect(saved.settings.preset).toBe('browse');expect(saved.settings.channelProfiles.trending).toMatchObject({perChannel:120,detailModes:{features:'omit'}});
});
it('never sends when actual generation fails due to size and shows the corrective error',async()=>{
  const send=vi.fn();window.electronAPI={htmlReading:{configure:mocks.configure,status:async()=>({credential:{accountId:'42',from:'fixture@example.test',to:'fixture@example.test'}}),send}} as unknown as Window['electronAPI'];
  mocks.generate.mockRejectedValueOnce(Error('HTML 超过上限，本次未发送。请减少历史期数后重新生成。'));
  render(<HtmlReadingPanel/>);await screen.findByRole('tab',{name:'内容范围'});fireEvent.click(screen.getByRole('tab',{name:'内容范围'}));fireEvent.click(screen.getByRole('tab',{name:'邮件发送'}));
  fireEvent.click(screen.getByRole('button',{name:'立即生成并发送'}));await waitFor(()=>expect(screen.getByRole('alert')).toHaveTextContent('本次未发送'));expect(send).not.toHaveBeenCalled();
});
