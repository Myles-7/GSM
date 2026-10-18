import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { useReadingProjects } from '../../features/settings/hooks/useReadingProjects';
import { ReadingProjects } from './ReadingProjects';

vi.mock('../MarkdownRenderer', () => ({ default: ({ content }: { content: string }) => <div>{content}</div> }));
type Controller = ReturnType<typeof useReadingProjects>;
let sequence = 0;
function controller(count = 81): Controller {
  return { accountId: `fixture-${sequence + 1}`, accountLabel: `alice-${++sequence} (42)`, busy: false, error: '', message: '', batches: [], lastImportId: 'latest', lastImportIds: Array.from({ length: count }, (_, index) => String(index + 1)), items: Array.from({ length: count }, (_, index) => ({ id: String(index + 1), name: `acme/tool-${index + 1}`, summary: 'Saved summary', analysis: [{ title: 'Architecture', text: 'Saved detail' }], state: { read: false, interest: index === 79 ? 'interested' as const : 'neutral' as const, note: index === 79 ? 'unique note' : '', candidate: index === 79 }, source: { repoId: index + 1, operationId: 'op', fileName: 'phone.json', snapshotId: 's', importId: 'latest', importedAt: '2026-10-06' }, processed: false, starState: 'unknown' as const, fingerprint: `fp-${index + 1}` })), start: vi.fn(async () => {}), resume: vi.fn(async () => {}), stop: vi.fn(), bulk: vi.fn(async () => {}), refresh: vi.fn(async () => {}), refreshStars: vi.fn(async () => {}), retrySync: vi.fn(async () => {}) };
}
beforeEach(() => { sessionStorage.clear(); localStorage.clear(); });
const select = () => fireEvent.click(screen.getByRole('button', { name: '选择' }));
const notes = () => fireEvent.click(screen.getByRole('button', { name: '我的笔记' }));
const closePanel = () => fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '取消' }));
const filters = () => fireEvent.click(screen.getByRole('button', { name: '筛选项目' }));
it('shows a minimal default view and only offers bulk controls in selection mode', () => {
  const c=controller();render(<ReadingProjects controller={c} importRevision={0}/>);
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  expect(screen.queryByRole('textbox',{name:'编辑项目笔记'})).not.toBeInTheDocument();
  expect(screen.queryByRole('button',{name:'Star 已选项目'})).not.toBeInTheDocument();
  select();expect(screen.getAllByRole('checkbox')).toHaveLength(40);
  fireEvent.click(screen.getByRole('checkbox',{name:'选择 acme/tool-1'}));
  fireEvent.click(screen.getByRole('button',{name:'退出并清空选择'}));
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();select();
  expect(screen.getByRole('checkbox',{name:'选择 acme/tool-1'})).not.toBeChecked();
});
it('validates legacy browsing fields and restores delayed scroll and selection focus', () => {
  const c=controller();sessionStorage.setItem(`gsm:reading-projects:browse:${c.accountId}`,JSON.stringify({scope:'pending',query:null,read:'invalid',page:1,scroll:95,focusedId:'45'}));
  const items=c.items;c.items=[];const view=render(<ReadingProjects controller={c} importRevision={0}/>);
  expect(screen.getByRole('textbox',{name:'搜索项目名称与已保存笔记'})).toHaveValue('');
  c.items=items;view.rerender(<ReadingProjects controller={c} importRevision={0}/>);
  expect(screen.getByTitle('第 2 / 3 页')).toBeInTheDocument();
  expect(screen.getByLabelText('阅读项目列表').scrollTop).toBe(95);
  expect(screen.getByRole('button',{name:'阅读 acme/tool-45'})).toHaveAttribute('aria-pressed','true');
});
it('keeps account-keyed note drafts after login rename and drawer close', () => {
  const c=controller(1);const view=render(<ReadingProjects controller={c} importRevision={0}/>);notes();
  fireEvent.change(screen.getByRole('textbox',{name:'编辑项目笔记'}),{target:{value:'private draft'}});
  closePanel();c.accountLabel='renamed-login (42)';view.rerender(<ReadingProjects controller={c} importRevision={0}/>);notes();
  expect(screen.getByRole('textbox',{name:'编辑项目笔记'})).toHaveValue('private draft');
});
it('requires a conflict decision before saving an incoming changed note', async () => {
  const c=controller(1);c.items[0].state.note='old saved note';const view=render(<ReadingProjects controller={c} importRevision={0}/>);notes();
  fireEvent.change(screen.getByRole('textbox',{name:'编辑项目笔记'}),{target:{value:'local draft'}});
  c.items=c.items.map(item=>({...item,state:{...item.state,note:'phone note'},fingerprint:'new-version'}));view.rerender(<ReadingProjects controller={c} importRevision={0}/>);
  expect(screen.getByRole('alert')).toHaveTextContent('笔记在编辑后发生了变化');expect(screen.getByRole('button',{name:'保存笔记'})).toBeDisabled();expect(c.bulk).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button',{name:'保留草稿并确认覆盖'}));fireEvent.click(screen.getByRole('button',{name:'保存笔记'}));
  await waitFor(()=>expect(c.bulk).toHaveBeenCalledWith(['1'],{note:'local draft'},{'1':'new-version'}));
});
it('retains continued typing during save and avoids a conflict with its own saved version', async () => {
  const c=controller(1);let finish!:()=>void;c.bulk=vi.fn(()=>new Promise<void>(resolve=>{finish=resolve;}));const view=render(<ReadingProjects controller={c} importRevision={0}/>);notes();
  fireEvent.change(screen.getByRole('textbox',{name:'编辑项目笔记'}),{target:{value:'first draft'}});fireEvent.click(screen.getByRole('button',{name:'保存笔记'}));
  fireEvent.change(screen.getByRole('textbox',{name:'编辑项目笔记'}),{target:{value:'continued typing'}});
  c.items=c.items.map(item=>({...item,state:{...item.state,note:'first draft'},fingerprint:'saved'}));finish();await waitFor(()=>expect(screen.getByRole('button',{name:'保存笔记'})).toBeEnabled());view.rerender(<ReadingProjects controller={c} importRevision={0}/>);
  expect(screen.getByRole('textbox',{name:'编辑项目笔记'})).toHaveValue('continued typing');expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});
it('keeps notes out of the list and folds analysis using stable keys instead of translated titles', () => {
  const c=controller(1);c.items[0].state.note='private note';c.items[0].analysis=[{key:'architecture',title:'任意翻译标题',text:'Architecture details'},{key:'features',title:'Features',text:'Saved features'}];
  render(<ReadingProjects controller={c} importRevision={0}/>);
  expect(screen.getByLabelText('阅读项目列表')).not.toHaveTextContent('private note');
  expect(screen.getByLabelText('项目详情')).toHaveTextContent('Saved features');expect(screen.queryByText('Architecture details')).not.toBeInTheDocument();
  const disclosure=screen.getByText('任意翻译标题').closest('details')!;disclosure.open=true;fireEvent(disclosure,new Event('toggle'));
  expect(screen.getByText('Architecture details')).toBeInTheDocument();
});
it('preserves crosspage selection and does not select when inspecting or changing filters', () => {
  const c=controller();render(<ReadingProjects controller={c} importRevision={0}/>);select();
  fireEvent.click(screen.getByRole('button',{name:'阅读 acme/tool-2'}));expect(screen.getByRole('button',{name:'Star 已选项目'})).toBeDisabled();
  fireEvent.click(screen.getByRole('checkbox',{name:'选择 acme/tool-1'}));fireEvent.click(screen.getByRole('button',{name:'下一页'}));fireEvent.click(screen.getByRole('checkbox',{name:'选择 acme/tool-41'}));
  fireEvent.change(screen.getByRole('textbox',{name:'搜索项目名称与已保存笔记'}),{target:{value:'unique note'}});
  expect(screen.getByText('跨页已选 2 个')).toBeInTheDocument();expect(screen.getByText('其中 2 个已选项目不在本页')).toBeInTheDocument();expect(screen.getByRole('checkbox',{name:'选择 acme/tool-80'})).not.toBeChecked();
});
it('removes processed projects and retains the nearest focus and list scroll', async () => {
  const c=controller(4);c.items[3].processed=true;const view=render(<ReadingProjects controller={c} importRevision={0}/>);select();
  expect(screen.getByRole('button',{name:'全部待处理 3'})).toBeInTheDocument();fireEvent.click(screen.getByRole('button',{name:'阅读 acme/tool-2'}));
  const list=screen.getByLabelText('阅读项目列表');list.scrollTop=37;fireEvent.scroll(list);fireEvent.click(screen.getByRole('checkbox',{name:'选择 acme/tool-2'}));fireEvent.change(screen.getByRole('combobox',{name:'更新已选项目'}),{target:{value:'ignored'}});
  await waitFor(()=>expect(c.bulk).toHaveBeenCalledWith(['2'],{interest:'ignored'},{'2':'fp-2'}));c.items=c.items.map(item=>item.id==='2'?{...item,processed:true,fingerprint:'changed'}:item);view.rerender(<ReadingProjects controller={c} importRevision={0}/>);
  expect(screen.getByRole('button',{name:'阅读 acme/tool-3'})).toHaveAttribute('aria-pressed','true');expect(list.scrollTop).toBe(37);
  fireEvent.click(screen.getByRole('button',{name:'已处理 2'}));fireEvent.click(screen.getByRole('checkbox',{name:'选择 acme/tool-2'}));fireEvent.change(screen.getByRole('combobox',{name:'更新已选项目'}),{target:{value:'restore'}});await waitFor(()=>expect(c.bulk).toHaveBeenCalledWith(['2'],{processed:false},{'2':'changed'}));
});
it('keeps failed notes and separate drafts through panel close, project changes and remount', async () => {
  const c=controller(2);c.bulk=vi.fn(async()=>{throw Error('Disk write failed');});const view=render(<ReadingProjects controller={c} importRevision={0}/>);notes();
  fireEvent.change(screen.getByRole('textbox',{name:'编辑项目笔记'}),{target:{value:'draft one'}});fireEvent.click(screen.getByRole('button',{name:'保存笔记'}));await waitFor(()=>expect(screen.getByRole('alert')).toHaveTextContent('草稿已保留：Disk write failed'));closePanel();
  fireEvent.click(screen.getByRole('button',{name:'阅读 acme/tool-2'}));notes();fireEvent.change(screen.getByRole('textbox',{name:'编辑项目笔记'}),{target:{value:'draft two'}});closePanel();view.unmount();render(<ReadingProjects controller={c} importRevision={0}/>);notes();expect(screen.getByRole('textbox',{name:'编辑项目笔记'})).toHaveValue('draft two');closePanel();fireEvent.click(screen.getByRole('button',{name:'阅读 acme/tool-1'}));notes();expect(screen.getByRole('textbox',{name:'编辑项目笔记'})).toHaveValue('draft one');
});
it('reviews all 5000 selected names, cancels without writing and invalidates stale confirmation', async () => {
  const c=controller(5000);const view=render(<ReadingProjects controller={c} importRevision={0}/>);select();expect(screen.getAllByRole('checkbox')).toHaveLength(40);
  fireEvent.click(screen.getByRole('button',{name:'选择全部 5000 个匹配项目'}));fireEvent.click(screen.getByRole('button',{name:'Star 已选项目'}));const modal=screen.getByRole('dialog');expect(within(modal).getByText(/alice-.*5000/)).toBeInTheDocument();expect(within(modal).getAllByRole('listitem')).toHaveLength(40);
  fireEvent.click(within(modal).getByRole('button',{name:'下一页'}));expect(within(modal).getByText('acme/tool-41')).toBeInTheDocument();fireEvent.click(within(modal).getAllByRole('button',{name:'取消'})[0]);expect(c.start).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button',{name:'Star 已选项目'}));c.items=c.items.map(item=>item.id==='42'?{...item,fingerprint:'new'}:item);view.rerender(<ReadingProjects controller={c} importRevision={0}/>);await waitFor(()=>expect(screen.queryByRole('dialog')).not.toBeInTheDocument());expect(screen.getByRole('alert')).toHaveTextContent('项目资料已变化');
});
it('retains failed selections and starts Star with exact fingerprints', async () => {
  const c=controller(2);c.bulk=vi.fn(async()=>{throw Error('Save failed');});render(<ReadingProjects controller={c} importRevision={0}/>);select();fireEvent.click(screen.getByRole('checkbox',{name:'选择 acme/tool-2'}));fireEvent.change(screen.getByRole('combobox',{name:'更新已选项目'}),{target:{value:'process'}});await waitFor(()=>expect(screen.getByRole('alert')).toHaveTextContent('Save failed'));expect(screen.getByRole('checkbox',{name:'选择 acme/tool-2'})).toBeChecked();fireEvent.click(screen.getByRole('button',{name:'Star 已选项目'}));fireEvent.click(within(screen.getByRole('dialog')).getByRole('button',{name:'确认 GitHub Star'}));await waitFor(()=>expect(c.start).toHaveBeenCalledWith(['2'],{'2':'fp-2'}));
});
it('restores filtering and scroll, and switches to the arriving import without a third scope tab', async () => {
  const c=controller();const view=render(<ReadingProjects controller={c} importRevision={0}/>);fireEvent.change(screen.getByRole('textbox',{name:'搜索项目名称与已保存笔记'}),{target:{value:'tool-'}});fireEvent.click(screen.getByRole('button',{name:'下一页'}));fireEvent.click(screen.getByRole('button',{name:'阅读 acme/tool-45'}));const list=screen.getByLabelText('阅读项目列表');list.scrollTop=91;fireEvent.scroll(list);view.unmount();const restored=render(<ReadingProjects controller={c} importRevision={0}/>);expect(screen.getByLabelText('阅读项目列表').scrollTop).toBe(91);
  c.lastImportId=undefined;restored.rerender(<ReadingProjects controller={c} importRevision={1}/>);c.lastImportId='new';c.lastImportIds=['81'];restored.rerender(<ReadingProjects controller={c} importRevision={1}/>);await waitFor(()=>expect(screen.getByRole('button',{name:'阅读 acme/tool-81'})).toBeInTheDocument());expect(screen.getByRole('button',{name:'移除：本次导入'})).toBeInTheDocument();expect(screen.getByLabelText('阅读项目列表').querySelectorAll('article')).toHaveLength(1);
});
it('offers candidate filtering on demand and preserves account isolation', () => {
  const c=controller();const view=render(<ReadingProjects controller={c} importRevision={0}/>);filters();fireEvent.click(screen.getByRole('checkbox',{name:'全部候选'}));fireEvent.click(screen.getByRole('button',{name:'返回列表'}));expect(screen.getByRole('button',{name:'阅读 acme/tool-80'})).toBeInTheDocument();notes();fireEvent.change(screen.getByRole('textbox',{name:'编辑项目笔记'}),{target:{value:'Alice private'}});closePanel();const other=controller(2);view.rerender(<ReadingProjects controller={other} importRevision={0}/>);notes();expect(screen.getByRole('textbox',{name:'编辑项目笔记'})).toHaveValue('');
});
it('does not stop running work when the task panel closes and resumes only after confirmation', async () => {
  const c=controller();c.batches=[{id:'saved',accountId:'42',status:'paused',createdAt:'2026-10-06',updatedAt:'',syncError:'Cloud failed',rows:[{repoId:1,name:'acme/tool-1',sourceFingerprint:'',status:'starred'},{repoId:2,name:'acme/tool-2',sourceFingerprint:'',status:'uncertain'}]}];render(<ReadingProjects controller={c} importRevision={0}/>);fireEvent.click(screen.getByRole('button',{name:'查看任务'}));fireEvent.click(screen.getByRole('button',{name:'仅重试同步'}));await waitFor(()=>expect(c.retrySync).toHaveBeenCalledWith('saved'));closePanel();expect(c.stop).not.toHaveBeenCalled();expect(c.resume).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'查看任务'}));fireEvent.click(screen.getByRole('button',{name:'核对剩余项目并继续'}));const modal=screen.getByRole('dialog');expect(within(modal).getAllByRole('listitem')).toHaveLength(1);fireEvent.click(within(modal).getByRole('button',{name:'确认 GitHub Star'}));await waitFor(()=>expect(c.resume).toHaveBeenCalledWith('saved'));
});
