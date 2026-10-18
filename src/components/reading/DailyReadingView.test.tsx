import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { defaultSettings } from '../../lib/html-reading/model';
import { blockReadingNavigation } from './readingNavigation';
import { DailyReadingView } from './DailyReadingView';

const mocks = vi.hoisted(() => ({ mounts: 0, saveWorks: true, generate: vi.fn(), nextView: vi.fn(), settings: {} as typeof defaultSettings, mail: {} as Record<string, unknown>, state: { language: 'zh', currentView: 'reading' } }));
vi.mock('../../store/useAppStore', () => ({ useAppStore: Object.assign((select: (state: unknown) => unknown) => select(mocks.state), { getState: () => ({ ...mocks.state, setCurrentView: mocks.nextView }) }) }));
vi.mock('../../features/settings/hooks/useHtmlReading', async () => {
  const { useState, useEffect } = await import('react');
  return { useHtmlReading: () => {
    const [settings, setSettings] = useState(() => structuredClone(mocks.settings));
    const [saved, setSaved] = useState(() => structuredClone(mocks.settings));
    useEffect(() => { mocks.mounts++; }, []);
    return { account: '42', ready: true, settings, setSettings, saved, busy: false, error: '', message: '', mail: mocks.mail, catalog: { channels: [], categories: [] }, save: async () => { if (mocks.saveWorks) setSaved(structuredClone(settings)); return mocks.saveWorks; }, generate: mocks.generate, data: null, projects: {}, reload: vi.fn() };
  } };
});
vi.mock('./ReadingProjects', () => ({ ReadingProjects: ({ onImport }: { onImport: () => void }) => <button onClick={onImport}>fixture-import</button> }));
vi.mock('../settings/HtmlReadingImport', () => ({ HtmlReadingImport: ({ onProjects }: { onProjects: () => void }) => <button onClick={onProjects}>fixture-finish</button> }));
beforeEach(() => { mocks.mounts = 0; mocks.saveWorks = true; mocks.settings = structuredClone(defaultSettings); mocks.mail = {}; mocks.generate.mockReset(); mocks.nextView.mockReset(); sessionStorage.clear(); window.electronAPI = undefined; });
const configure = () => fireEvent.click(screen.getByRole('button', { name: '配置' }));
const editContent = () => fireEvent.click(screen.getByRole('button', { name: /内容与频道/ }));
const changeTitle = () => fireEvent.change(screen.getByRole('textbox', { name: 'HTML 标题' }), { target: { value: 'Changed draft' } });
it('has three compact sections, one controller and group-only configuration entry points', () => {
  render(<DailyReadingView/>);expect(screen.getByRole('heading',{name:'HTML'})).toBeInTheDocument();
  expect(screen.getByRole('navigation')).toHaveTextContent('项目日报配置');expect(screen.queryByRole('button',{name:'导入手机记录'})).not.toBeInTheDocument();
  configure();expect(screen.getByRole('button',{name:/内容与频道/})).toBeInTheDocument();expect(screen.queryByRole('combobox',{name:'阅读预设'})).not.toBeInTheDocument();
  editContent();expect(screen.getByRole('combobox',{name:'阅读预设'})).toBeInTheDocument();expect(mocks.mounts).toBe(1);
});
it('keeps draft settings across groups and uses one save bar that appears only when dirty', async () => {
  render(<DailyReadingView/>);configure();expect(screen.queryByRole('button',{name:'保存修改'})).not.toBeInTheDocument();editContent();changeTitle();
  fireEvent.click(screen.getByRole('button',{name:'返回配置'}));fireEvent.click(screen.getByRole('button',{name:/阅读与手机操作/}));fireEvent.click(screen.getByRole('button',{name:'返回配置'}));editContent();
  expect(screen.getByRole('textbox',{name:'HTML 标题'})).toHaveValue('Changed draft');fireEvent.click(screen.getByRole('button',{name:'保存修改'}));await waitFor(()=>expect(screen.queryByRole('button',{name:'保存修改'})).not.toBeInTheDocument());
});
it('keeps unsaved drafts when saving before departure fails and navigates only after success', async () => {
  render(<DailyReadingView/>);configure();editContent();changeTitle();mocks.saveWorks=false;
  act(()=>expect(blockReadingNavigation('reading','repositories')).toBe(true));const dialog=screen.getByRole('dialog');fireEvent.click(within(dialog).getByRole('button',{name:'保存并离开'}));
  await waitFor(()=>expect(screen.getByRole('dialog')).toBeVisible());expect(mocks.nextView).not.toHaveBeenCalled();mocks.saveWorks=true;fireEvent.click(within(dialog).getByRole('button',{name:'保存并离开'}));await waitFor(()=>expect(mocks.nextView).toHaveBeenCalledWith('repositories'));
});
it('offers explicit discard and leave without saving or changing project records', () => {
  render(<DailyReadingView/>);configure();editContent();changeTitle();act(()=>blockReadingNavigation('reading','settings'));fireEvent.click(screen.getByRole('button',{name:'放弃并离开'}));expect(mocks.nextView).toHaveBeenCalledWith('settings');
});
it('previews current drafts and asks which configuration to use before manual sending', async () => {
  mocks.mail={credential:{accountId:'42',from:'fixture@example.test',to:'fixture@example.test',configured:true}};window.electronAPI={htmlReading:{}} as Window['electronAPI'];
  render(<DailyReadingView/>);configure();editContent();changeTitle();fireEvent.click(screen.getByRole('button',{name:'日报'}));fireEvent.click(screen.getByRole('button',{name:'生成预览'}));expect(mocks.generate).toHaveBeenCalledWith('preview',false,'current');fireEvent.click(screen.getByRole('button',{name:'发送日报'}));expect(mocks.generate).not.toHaveBeenCalledWith('send',expect.anything(),expect.anything());fireEvent.click(screen.getByRole('button',{name:'使用已保存配置发送'}));expect(mocks.generate).toHaveBeenCalledWith('send',false,'saved');
});
it('requires inbox verification before generating another unconfirmed delivery', () => {
  mocks.mail={credential:{accountId:'42',from:'fixture@example.test',to:'fixture@example.test',configured:true},runs:[{id:'old',accountId:'42',date:'2026-10-06',status:'unconfirmed',startedAt:'2026-10-06T00:00:00Z'}]};window.electronAPI={htmlReading:{}} as Window['electronAPI'];
  render(<DailyReadingView/>);fireEvent.click(screen.getByRole('button',{name:'日报'}));fireEvent.click(screen.getByRole('button',{name:'发送日报'}));expect(screen.getByRole('dialog')).toHaveTextContent('先检查收件箱');expect(mocks.generate).not.toHaveBeenCalled();
});
it('opens import in a modal and keeps the single controller after returning to projects', () => {
  render(<DailyReadingView/>);fireEvent.click(screen.getByRole('button',{name:'fixture-import'}));expect(screen.getByRole('dialog')).toBeInTheDocument();fireEvent.click(screen.getByRole('button',{name:'fixture-finish'}));expect(screen.queryByRole('dialog')).not.toBeInTheDocument();expect(mocks.mounts).toBe(1);
});
it('consumes old settings navigation and opens the new configuration group overview', () => {
  sessionStorage.setItem('gsm:pending-reading-page','settings');render(<DailyReadingView/>);expect(screen.getByRole('button',{name:'配置'})).toHaveAttribute('aria-pressed','true');expect(sessionStorage.getItem('gsm:pending-reading-page')).toBeNull();
});
