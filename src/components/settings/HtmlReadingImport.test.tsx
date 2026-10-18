import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { HtmlReadingImport } from './HtmlReadingImport';
import type { useHtmlReading } from '../../features/settings/hooks/useHtmlReading';

it('shows a separate position preview and permits positions-only import',()=>{
  const apply=vi.fn();const controller={data:null,busy:false,incoming:{version:2},importRows:[],positionRows:[{id:'position',kind:'position',viewId:'trending',name:'acme/tool',viewName:'今日趋势',status:'ready'},{id:'old',kind:'active',viewId:'repositories',name:'下次打开的页面',viewName:'仓库',status:'stale'}],choices:{},apply} as unknown as ReturnType<typeof useHtmlReading>;
  render(<HtmlReadingImport controller={controller}/>);
  expect(screen.getByRole('region',{name:'继续阅读位置预览'})).toBeInTheDocument();expect(screen.getByText('今日趋势 · acme/tool')).toBeInTheDocument();
  expect(screen.getByText('已有更新的位置，将跳过这项')).toBeInTheDocument();const button=screen.getByRole('button',{name:'确认导入'});expect(button).toBeEnabled();fireEvent.click(button);expect(apply).toHaveBeenCalledOnce();
  expect(screen.getByText('已有更新的位置，将跳过这项').closest('details')).not.toHaveAttribute('open');
});

it('does not offer import for an empty return',()=>{
  const controller={data:null,busy:false,incoming:{version:2},importRows:[],positionRows:[],choices:{},apply:vi.fn()} as unknown as ReturnType<typeof useHtmlReading>;
  render(<HtmlReadingImport controller={controller}/>);expect(screen.getByRole('button',{name:'确认导入'})).toBeDisabled();expect(screen.getByText('回传中没有修改或阅读位置。')).toBeInTheDocument();
});

function batchController() {
  return {data:null,busy:false,incoming:null,importRows:[],positionRows:[],choices:{},batch:null,batchChoices:{},fileErrors:[],inspectFiles:vi.fn(async()=>true),applyBatch:vi.fn(),setBatchChoices:vi.fn()} as unknown as ReturnType<typeof useHtmlReading>;
}

it('offers two guided input choices without exposing JSON until paste is chosen',()=>{
  const c=batchController();
  render(<HtmlReadingImport controller={c} guided/>);
  expect(screen.getByRole('button',{name:'选择文件'})).toBeVisible();
  expect(screen.getByRole('button',{name:'粘贴记录'})).toBeVisible();
  expect(screen.queryByRole('textbox',{name:'手机回传文本'})).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:'粘贴记录'}));
  expect(screen.getByRole('textbox',{name:'手机回传文本'})).toBeVisible();
  expect(screen.queryByRole('tab',{name:'阅读记录'})).toBeNull();
});

it('groups ordinary edits behind a summary and prevents a changed paste from applying the old preview',()=>{
  const c=batchController();c.inspect=vi.fn();c.apply=vi.fn();
  const {rerender}=render(<HtmlReadingImport controller={c} guided/>);
  fireEvent.click(screen.getByRole('button',{name:'粘贴记录'}));
  const input=screen.getByRole('textbox',{name:'手机回传文本'});
  fireEvent.change(input,{target:{value:'first'}});
  fireEvent.click(screen.getByRole('button',{name:'预览回传修改'}));
  c.incoming={version:1} as never;
  c.importRows=[{op:{id:'note',repoId:1,field:'note',base:'',value:'note value'},name:'acme/tool',current:'',status:'ready'}];
  rerender(<HtmlReadingImport controller={c} guided/>);
  expect(screen.getByText('查看 1 个项目的普通修改')).toBeVisible();
  expect(screen.queryByText('手机：note value')).toBeNull();
  expect(screen.getByRole('button',{name:'确认导入'})).toBeEnabled();
  fireEvent.change(input,{target:{value:'changed'}});
  expect(screen.queryByRole('button',{name:'确认导入'})).toBeNull();
  expect(c.apply).not.toHaveBeenCalled();
});

it('opens unified project processing after guided import completion',()=>{
  const c=batchController();
  c.lastImportSummary={applied:2,duplicate:0,kept:0,positionApplied:0,positionStale:0,positionDuplicate:0,candidates:1,projects:2};
  const open=vi.fn();render(<HtmlReadingImport controller={c} guided onProjects={open}/>);
  fireEvent.click(screen.getByRole('button',{name:'浏览并处理本次项目'}));
  expect(open).toHaveBeenCalledOnce();
});
it('checks file count and bytes before reading any file, then allows removal and repreview',async()=>{
  const c=batchController();const read=vi.fn(async()=> '{}');
  const valid=Object.assign(new File(['{}'],'valid.json'),{text:read});
  const oversized=Object.assign(new File(['{}'],'large.json'),{text:read});Object.defineProperty(oversized,'size',{value:4_000_001});
  render(<HtmlReadingImport controller={c}/>);
  fireEvent.change(screen.getByLabelText('选择回传文件'),{target:{files:[valid,oversized]}});
  expect(read).not.toHaveBeenCalled();expect(c.inspectFiles).not.toHaveBeenCalled();expect(screen.getByRole('alert')).toHaveTextContent('large.json');
  fireEvent.click(screen.getByRole('button',{name:'移除 large.json'}));fireEvent.click(screen.getByRole('button',{name:'重新预览所选文件'}));
  await waitFor(()=>expect(c.inspectFiles).toHaveBeenCalledWith([{name:'valid.json',text:'{}'}]));
  expect(read).toHaveBeenCalledOnce();
});
it('blocks a selection of more than twenty files without reading',()=>{
  const c=batchController();const read=vi.fn();const files=Array.from({length:21},(_,index)=>Object.assign(new File(['{}'],`${index}.json`),{text:read}));
  render(<HtmlReadingImport controller={c}/>);fireEvent.change(screen.getByLabelText('选择回传文件'),{target:{files}});
  expect(screen.getByRole('alert')).toHaveTextContent('最多选择 20');expect(read).not.toHaveBeenCalled();
});
it('rejects total bytes before reading even when each file fits the per-file limit',()=>{
  const c=batchController();const read=vi.fn();const files=Array.from({length:6},(_,index)=>{const file=Object.assign(new File(['{}'],`${index}.json`),{text:read});Object.defineProperty(file,'size',{value:4_000_000});return file;});
  render(<HtmlReadingImport controller={c}/>);fireEvent.change(screen.getByLabelText('选择回传文件'),{target:{files}});
  expect(screen.getByRole('alert')).toHaveTextContent('总计超过 20 MiB');expect(read).not.toHaveBeenCalled();
});
it('shows field values and source filenames, requiring all conflict choices',()=>{
  const c=batchController();c.batch={files:[{name:'phone.json',input:{format:'gsm-reading-changes',version:1,accountId:'42',snapshotId:'s',operations:[]}}],positions:[],rows:[{key:'1:read',name:'acme/tool',repoId:1,field:'read',current:false,status:'conflict',sources:[{fileName:'phone.json',snapshotId:'s',status:'ready',op:{id:'op',repoId:1,field:'read',base:false,value:true}}]}]} as NonNullable<typeof c.batch>;
  const {rerender}=render(<HtmlReadingImport controller={c}/>);
  expect(screen.getByText('电脑：否')).toBeInTheDocument();expect(screen.getByText('phone.json：是 · 可应用')).toBeInTheDocument();expect(screen.getByRole('button',{name:'确认批量导入'})).toBeDisabled();
  fireEvent.change(screen.getByLabelText('批量冲突处理 acme/tool 已读标记'),{target:{value:'op'}});expect(c.setBatchChoices).toHaveBeenCalledOnce();
  c.batchChoices={'1:read':'op'};rerender(<HtmlReadingImport controller={c}/>);fireEvent.click(screen.getByRole('button',{name:'确认批量导入'}));expect(c.applyBatch).toHaveBeenCalledOnce();
});
it('offers only the highest sequence and revision for conflicting reading positions',()=>{
  const c=batchController();const source=(id:string,sequence:number,revision:number)=>({fileName:`${id}.json`,snapshotId:id,sequence,row:{id,kind:'position' as const,viewId:'trending',name:`acme/${id}`,viewName:'趋势',status:'ready' as const,current:null,revision},value:{id,viewId:'trending',repoId:1,revision}});
  c.batch={files:[{name:'phone.json',input:{format:'gsm-reading-changes',version:1,accountId:'42',snapshotId:'s',operations:[]}}],rows:[],positions:[{key:'position:trending',kind:'position',viewId:'trending',name:'acme/tool',viewName:'趋势',current:null,status:'conflict',sources:[source('old',1,99),source('lower',2,1),source('new',2,2),source('tied',2,2)]}]} as NonNullable<typeof c.batch>;
  render(<HtmlReadingImport controller={c}/>);const select=screen.getByLabelText('阅读位置冲突处理 趋势');
  expect(within(select).queryByRole('option',{name:/old.json/})).not.toBeInTheDocument();expect(within(select).queryByRole('option',{name:/lower.json/})).not.toBeInTheDocument();
  expect(within(select).getByRole('option',{name:/new.json/})).toBeInTheDocument();expect(within(select).getByRole('option',{name:/tied.json/})).toBeInTheDocument();
});
it('blocks commit when any file has failed validation',()=>{
  const c=batchController();c.fileErrors=[{name:'invalid.json',error:'账户不匹配'}];c.batch={files:[{name:'phone.json',input:{format:'gsm-reading-changes',version:1,accountId:'42',snapshotId:'s',operations:[]}}],rows:[],positions:[{key:'p',kind:'position',viewId:'trending',name:'x',viewName:'趋势',current:null,status:'ready',sources:[]}]} as NonNullable<typeof c.batch>;
  render(<HtmlReadingImport controller={c}/>);expect(screen.getByRole('alert')).toHaveTextContent('invalid.json：账户不匹配');expect(screen.getByRole('button',{name:'确认批量导入'})).toBeDisabled();
});
it('shows the current desktop position beside a tied conflicting phone location',()=>{
  const c=batchController();c.data={names:{'7':'acme/desktop'},snapshots:{s:{viewNames:{trending:'今日趋势'}}}} as unknown as typeof c.data;
  c.batch={files:[{name:'phone.json',input:{format:'gsm-reading-changes',version:1,accountId:'42',snapshotId:'s',operations:[]}}],rows:[],positions:[{key:'position:trending',kind:'position',viewId:'trending',name:'acme/phone',viewName:'今日趋势',current:JSON.stringify({viewId:'trending',repoId:7,sequence:2,revision:3}),status:'conflict',sources:[{fileName:'phone.json',snapshotId:'s',sequence:2,row:{id:'phone',kind:'position',viewId:'trending',name:'acme/phone',viewName:'今日趋势',status:'stale',current:null,revision:3},value:{id:'phone',viewId:'trending',repoId:8,revision:3}}]}]};
  render(<HtmlReadingImport controller={c}/>);
  expect(screen.getByText('电脑：今日趋势 · acme/desktop · 快照序号 2 / 修订 3')).toBeInTheDocument();
  expect(screen.getByText(/phone.json · 今日趋势 · acme\/phone · 快照序号 2 \/ 修订 3/)).toBeInTheDocument();
});
it('does not expose an old batch as newly validated when inspection returns false',async()=>{
  const c=batchController();c.batch={files:[{name:'old.json',input:{format:'gsm-reading-changes',version:1,accountId:'42',snapshotId:'s',operations:[]}}],rows:[],positions:[]};
  c.inspectFiles=vi.fn(async()=>false);
  let finishRead!:(value:string)=>void;const file=Object.assign(new File(['{}'],'new.json'),{text:()=>new Promise<string>(resolve=>{finishRead=resolve;})});
  const {rerender}=render(<HtmlReadingImport controller={c}/>);fireEvent.change(screen.getByLabelText('选择回传文件'),{target:{files:[file]}});
  c.busy=true;rerender(<HtmlReadingImport controller={c}/>);finishRead('{}');
  await waitFor(()=>expect(c.inspectFiles).toHaveBeenCalledOnce());await waitFor(()=>expect(screen.queryByText('正在读取并校验回传文件…')).not.toBeInTheDocument());
  expect(screen.queryByRole('button',{name:'确认批量导入'})).not.toBeInTheDocument();expect(screen.queryByText(/new.json.*校验通过/)).not.toBeInTheDocument();
});
it('keeps new per-file errors visible after inspection fails instead of accepting a batch',async()=>{
  const c=batchController();c.inspectFiles=vi.fn(async()=>{c.fileErrors=[{name:'bad.json',error:'账户不匹配'}];return false;});
  const file=Object.assign(new File(['{}'],'bad.json'),{text:vi.fn(async()=> '{}')});render(<HtmlReadingImport controller={c}/>);
  fireEvent.change(screen.getByLabelText('选择回传文件'),{target:{files:[file]}});
  expect(await screen.findByRole('alert')).toHaveTextContent('bad.json：账户不匹配');
  expect(screen.getByText(/bad.json.*无效/)).toBeInTheDocument();expect(screen.queryByRole('button',{name:'确认批量导入'})).not.toBeInTheDocument();
});

it('batch resolves only state conflicts with a unique phone value and leaves notes manual',()=>{
  const c=batchController();
  const source=(id:string,field:'read'|'candidate'|'note',value:boolean|string)=>({fileName:`${id}.json`,snapshotId:'s',status:'ready' as const,op:{id,repoId:1,field,base:false,value}});
  c.batch={files:[],positions:[],rows:[
    {key:'1:read',repoId:1,name:'acme/tool',field:'read',current:false,status:'conflict',sources:[source('read','read',true)]},
    {key:'1:note',repoId:1,name:'acme/tool',field:'note',current:'desktop note',status:'conflict',sources:[source('note','note','phone note')]},
    {key:'1:candidate',repoId:1,name:'acme/tool',field:'candidate',current:false,status:'conflict',sources:[source('candidate1','candidate',true),source('candidate2','candidate',false)]},
  ]};
  render(<HtmlReadingImport controller={c}/>);
  fireEvent.click(screen.getByRole('button',{name:'状态冲突使用唯一手机值'}));
  const calls=vi.mocked(c.setBatchChoices).mock.calls;
  const choosePhone=calls[0][0] as (current:Record<string,string>)=>Record<string,string>;
  expect(choosePhone({})).toEqual({'1:read':'read'});
  fireEvent.click(screen.getByRole('button',{name:'全部状态冲突保留电脑'}));
  const chooseDesktop=calls[1][0] as (current:Record<string,string>)=>Record<string,string>;
  expect(chooseDesktop({})).toEqual({'1:read':'desktop','1:candidate':'desktop'});
});

it('keeps the completed import summary visible until the user opens candidates',()=>{
  const c=batchController();
  c.lastImportSummary={applied:3,duplicate:1,kept:0,positionApplied:1,positionStale:1,positionDuplicate:0,candidates:1,projects:2};
  c.lastImportId='this';
  c.candidates={items:[],batches:[],busy:false,error:'',accountLabel:'alice (42)',start:vi.fn(),resume:vi.fn(),stop:vi.fn(),dismiss:vi.fn(),refresh:vi.fn()} as unknown as typeof c.candidates;
  render(<HtmlReadingImport controller={c}/>);
  expect(screen.getByText('导入完成，阅读变化已保存；请检查候选并确认 Star。')).toBeVisible();
  expect(screen.getByRole('tab',{name:'导入回传'})).toHaveAttribute('data-state','active');
  fireEvent.click(screen.getByRole('button',{name:'查看 Star 候选'}));
  expect(screen.getByRole('tab',{name:'Star 候选 (0)'})).toHaveAttribute('data-state','active');
  expect(screen.getByText('没有匹配的待处理候选。')).toBeVisible();
});
