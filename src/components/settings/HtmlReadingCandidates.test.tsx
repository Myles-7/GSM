import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { HtmlReadingCandidates, type CandidateController } from './HtmlReadingCandidates';

function controller(count = 121): CandidateController {
  return { accountLabel: 'alice (42)', busy: false, error: '', batches: [], items: Array.from({ length: count }, (_, index) => ({ id: String(index + 1), name: `acme/tool-${index + 1}`, summary: 'Saved summary', analysis: [{ title: 'Architecture', text: 'Saved detail' }], state: { read: false, interest: index === 119 ? 'interested' : 'neutral', note: index === 119 ? 'find unique note' : '', candidate: true }, source: { fileName: 'phone.json', snapshotId: 's', importId: index === 119 ? 'this' : 'old', importedAt: '2026-10-06' } })), start: vi.fn(async () => {}), resume: vi.fn(async () => {}), dismiss: vi.fn(async () => {}), stop: vi.fn(), refresh: vi.fn(async () => {}) };
}
it('pages every candidate beyond 100 and retains manual selection across pages and filters', () => {
  render(<HtmlReadingCandidates controller={controller()} lastImportId="this" />);
  expect(screen.getAllByRole('checkbox')).toHaveLength(40);
  expect(screen.getByRole('button', { name: 'Star 已选项目' })).toBeDisabled();
  fireEvent.click(screen.getByRole('checkbox', { name: '选择 acme/tool-1' }));
  fireEvent.click(screen.getByRole('button', { name: '下一页' }));
  fireEvent.click(screen.getByRole('checkbox', { name: '选择 acme/tool-41' }));
  fireEvent.click(screen.getByRole('button', { name: '下一页' }));
  fireEvent.click(screen.getByRole('button', { name: '下一页' }));
  expect(screen.getByRole('checkbox', { name: '选择 acme/tool-121' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '本次导入' }));
  expect(screen.getByRole('checkbox', { name: '选择 acme/tool-120' })).not.toBeChecked();
  expect(screen.getByText('跨页已选 2 个')).toBeInTheDocument();
  expect(screen.getByText('其中 2 个已选项目不在本页')).toBeInTheDocument();
  fireEvent.change(screen.getByRole('textbox', { name: '搜索 Star 候选' }), { target: { value: 'unique note' } });
  expect(screen.getAllByRole('checkbox')).toHaveLength(1);
});
it('confirms all matching selections with account and complete list before Star', async () => {
  const c = controller(); render(<HtmlReadingCandidates controller={c} lastImportId="this" />);
  fireEvent.click(screen.getByRole('button', { name: '选择全部 121 个匹配项目' }));
  fireEvent.click(screen.getByRole('button', { name: 'Star 已选项目' }));
  const modal = screen.getByRole('dialog');
  expect(within(modal).getByText(/alice \(42\).*121/)).toBeInTheDocument();
  expect(within(modal).getAllByRole('listitem')).toHaveLength(40);
  for(let page=0;page<3;page++)fireEvent.click(within(modal).getByRole('button',{name:'下一页'}));
  expect(within(modal).getAllByRole('listitem')).toHaveLength(1);
  expect(within(modal).getByText('acme/tool-121')).toBeInTheDocument();
  expect(c.start).not.toHaveBeenCalled();
  fireEvent.click(within(modal).getByRole('button', { name: '确认 GitHub Star' }));
  await waitFor(() => expect(c.start).toHaveBeenCalledWith(c.items.map(item => item.id)));
});
it('reopens saved progress and confirms remaining rows before manual resume', async () => {
  const c = controller(3); c.batches = [{ id: 'saved', status: 'paused', syncError: 'Disk failed', rows: [{ repoId: 1, name: 'acme/tool-1', status: 'starred' }, { repoId: 2, name: 'acme/tool-2', status: 'failed', error: 'Rate limited' }, { repoId: 3, name: 'acme/tool-3', status: 'uncertain' }] }]; c.retrySync = vi.fn(async () => {});
  render(<HtmlReadingCandidates controller={c} lastImportId="this" />);
  expect(screen.getByRole('alert')).toHaveTextContent('本地同步失败：Disk failed');
  fireEvent.click(screen.getByRole('button', { name: '检查剩余项目并重试' }));
  const modal = screen.getByRole('dialog'); expect(within(modal).getAllByRole('listitem')).toHaveLength(2);
  expect(within(modal).queryByText('acme/tool-1')).not.toBeInTheDocument();
  expect(c.resume).not.toHaveBeenCalled();
  fireEvent.click(within(modal).getByRole('button', { name: '确认 GitHub Star' }));
  await waitFor(() => expect(c.resume).toHaveBeenCalledWith('saved'));
});
it('locks candidate mutations during a run and supports stopping', () => {
  const c = controller(1); c.busy = true; c.batches = [{ id: 'running', status: 'running', rows: [{ repoId: 1, name: 'acme/tool-1', status: 'sending' }] }];
  render(<HtmlReadingCandidates controller={c} lastImportId="this" />);
  expect(screen.getByRole('checkbox')).toBeDisabled();
  expect(screen.getByRole('button', { name: '选择全部 1 个匹配项目' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: '当前项目结束后停止' })); expect(c.stop).toHaveBeenCalledOnce();
});

it('lazily mounts paginated results and hides past success for a newly imported candidate revision', async () => {
  const c=controller();c.items[0].candidateFingerprint='new-source';
  c.batches=[{id:'past',status:'completed',rows:c.items.map(item=>({repoId:Number(item.id),name:item.name,status:'starred',sourceFingerprint:'past-source'}))}];
  render(<HtmlReadingCandidates controller={c} lastImportId="this"/>);
  const card=screen.getByRole('checkbox',{name:'选择 acme/tool-1'}).closest('article')!;
  expect(within(card).getByText(/未标记 · 待处理/)).toBeInTheDocument();
  expect(screen.queryAllByRole('listitem')).toHaveLength(0);
  const summary=screen.getByText('121 个项目的结果');fireEvent.click(summary);
  await waitFor(()=>expect(screen.getAllByRole('listitem')).toHaveLength(40));
  const details=summary.closest('details')!;fireEvent.click(within(details).getByRole('button',{name:'下一页'}));
  expect(within(details).getByText('acme/tool-41 · 已 Star')).toBeInTheDocument();
});

it('keeps a 5000 candidate selection and large batch history bounded while every confirmation page remains reviewable',async()=>{
  const c=controller(5000);c.batches=[{id:'latest',status:'completed',rows:c.items.map(item=>({repoId:Number(item.id),name:item.name,status:'starred'}))},...Array.from({length:5000},(_,index)=>({id:`history-${index}`,status:'completed' as const,rows:[{repoId:1,name:'acme/tool-1',status:'starred'}]}))];
  const {container}=render(<HtmlReadingCandidates controller={c} lastImportId="this"/>);
  expect(screen.getAllByRole('checkbox')).toHaveLength(40);
  expect(screen.getAllByRole('region',{name:'Star 进度'})).toHaveLength(1);
  fireEvent.click(screen.getByRole('button',{name:'下一页'}));
  expect(screen.getByRole('checkbox',{name:'选择 acme/tool-41'})).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'选择全部 5000 个匹配项目'}));
  expect(screen.getByText('跨页已选 5000 个')).toBeInTheDocument();
  expect(screen.getByText('其中 4960 个已选项目不在本页')).toBeInTheDocument();
  expect(container.querySelectorAll('article')).toHaveLength(40);
  fireEvent.click(screen.getByRole('button',{name:'Star 已选项目'}));
  const modal=screen.getByRole('dialog');expect(within(modal).getAllByRole('listitem')).toHaveLength(40);
  fireEvent.click(within(modal).getByRole('button',{name:'下一页'}));
  expect(within(modal).getByText('acme/tool-41')).toBeInTheDocument();
  expect(within(modal).getByText('第 2 / 125 页')).toBeInTheDocument();
  expect(c.start).not.toHaveBeenCalled();fireEvent.click(within(modal).getAllByRole('button',{name:'取消'})[0]);
  const historySummary=screen.getByText('历史 Star 批次（5000）');fireEvent.click(historySummary);
  await waitFor(()=>expect(screen.getAllByRole('region',{name:'Star 进度'})).toHaveLength(41));
  const history=historySummary.closest('details')!;fireEvent.click(within(history).getByRole('button',{name:'下一页'}));
  expect(within(history).getByText('history-40')).toBeInTheDocument();
  expect(screen.getAllByRole('region',{name:'Star 进度'})).toHaveLength(41);
});

it('preserves selection when candidate removal fails',async()=>{
  const c=controller(1);c.dismiss=vi.fn(async()=>{throw Error('Save failed');});
  render(<HtmlReadingCandidates controller={c} lastImportId="this"/>);
  fireEvent.click(screen.getByRole('checkbox',{name:'选择 acme/tool-1'}));
  fireEvent.click(screen.getByRole('button',{name:'移除已选候选'}));
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button',{name:'确认移除候选'}));
  await waitFor(()=>expect(c.dismiss).toHaveBeenCalledWith(['1']));
  expect(screen.getByRole('checkbox',{name:'选择 acme/tool-1'})).toBeChecked();
});

it('keeps an older resumed batch and its updated row status visible outside collapsed history',()=>{
  const c=controller(1);c.busy=true;c.items[0].candidateFingerprint='source';
  c.batches=[{id:'newer',status:'completed',updatedAt:'2026-10-06T10:00:00Z',rows:[{repoId:1,name:'acme/tool-1',status:'failed',sourceFingerprint:'source'}]},{id:'older-resumed',status:'running',updatedAt:'2026-10-06T11:00:00Z',rows:[{repoId:1,name:'acme/tool-1',status:'sending',sourceFingerprint:'source'}]}];
  render(<HtmlReadingCandidates controller={c} lastImportId="this"/>);
  expect(screen.getByText('older-resumed')).toBeInTheDocument();
  const article=screen.getByRole('checkbox').closest('article')!;
  expect(within(article).getByText(/未标记 · 正在 Star/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'当前项目结束后停止'}));expect(c.stop).toHaveBeenCalledOnce();
});

it.each(['missing','name','fingerprint'])('invalidates an open confirmation when the selected candidate changes: %s',async(change)=>{
  const c=controller(1);c.items[0].candidateFingerprint='approved-source';
  const {rerender}=render(<HtmlReadingCandidates controller={c} lastImportId="this"/>);
  fireEvent.click(screen.getByRole('checkbox'));fireEvent.click(screen.getByRole('button',{name:'Star 已选项目'}));expect(screen.getByRole('dialog')).toBeInTheDocument();
  c.items=change==='missing'?[]:[{...c.items[0],...(change==='name'?{name:'acme/renamed'}:{candidateFingerprint:'new-source'})}];
  rerender(<HtmlReadingCandidates controller={c} lastImportId="this"/>);
  await waitFor(()=>expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(c.start).not.toHaveBeenCalled();expect(c.dismiss).not.toHaveBeenCalled();
});

it('passes captured optional candidate fingerprints to both Star and removal actions',async()=>{
  const c=controller(1);c.items[0].candidateFingerprint='approved-source';
  render(<HtmlReadingCandidates controller={c} lastImportId="this"/>);
  fireEvent.click(screen.getByRole('checkbox'));fireEvent.click(screen.getByRole('button',{name:'Star 已选项目'}));
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button',{name:'确认 GitHub Star'}));
  await waitFor(()=>expect(c.start).toHaveBeenCalledWith(['1'],{'1':'approved-source'}));
  await waitFor(()=>expect(screen.getByRole('checkbox')).not.toBeChecked());
  fireEvent.click(screen.getByRole('checkbox'));fireEvent.click(screen.getByRole('button',{name:'移除已选候选'}));
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button',{name:'确认移除候选'}));
  await waitFor(()=>expect(c.dismiss).toHaveBeenCalledWith(['1'],{'1':'approved-source'}));
});
