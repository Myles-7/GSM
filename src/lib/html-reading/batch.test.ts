import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { defaultSettings, emptyReadingState, type ReadingSnapshot, type ReadingReturn } from './model';
import { rememberSnapshot, loadReadingData, readingTransaction } from './storage';
import { previewReadingReturnBatch, applyReadingReturnBatch } from './batch';
const uuid=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const snapshot=(id='first'):ReadingSnapshot=>({version:2,id,accountId:'42',generatedAt:new Date().toISOString(),title:'test',settings:structuredClone(defaultSettings),items:{'1':{id:1,name:'acme/tool',url:'',categoryId:'',category:'',summary:'',description:'',tags:[],language:'',stars:1,updated:'',analysis:[],sources:[],generatedAt:'',reason:'',state:emptyReadingState()},'2':{id:2,name:'acme/tool2',url:'',categoryId:'',category:'',summary:'',description:'',tags:[],language:'',stars:1,updated:'',analysis:[],sources:[],generatedAt:'',reason:'',state:emptyReadingState()}},sections:[{id:'repositories',title:'收藏',updatedAt:'',items:[],entries:[{repoId:1},{repoId:2}]}]});
const file=(id:number,value='phone',snapshotId='first')=>({name:`${id}.json`,input:{format:'gsm-reading-changes',version:2,accountId:'42',snapshotId,operations:[{id:uuid(id),repoId:1,field:'note',base:'',value}],positions:[],activeView:null} as Extract<ReadingReturn,{version:2}>});
beforeEach(async()=>{vi.stubGlobal('indexedDB',new IDBFactory());await rememberSnapshot('42',snapshot());});
describe('atomic batch return import',()=>{
  it('deduplicates equal field modifications while receipting each source',async()=>{
    const preview=await previewReadingReturnBatch('42',[file(1),file(2)]);expect(preview.rows).toHaveLength(1);expect(preview.rows[0].status).toBe('ready');
    expect(await applyReadingReturnBatch('42',preview)).toMatchObject({applied:1,duplicate:1});expect((await loadReadingData('42')).states['1'].note).toBe('phone');
    const again=await previewReadingReturnBatch('42',[file(1),file(2)]);expect(again.rows[0].status).toBe('duplicate');
  });
  it('requires explicit source selection for different values and receipts unselected decisions',async()=>{
    const preview=await previewReadingReturnBatch('42',[file(1,'left'),file(2,'right')]);expect(preview.rows[0].status).toBe('conflict');
    await expect(applyReadingReturnBatch('42',preview)).rejects.toThrow('冲突');expect((await loadReadingData('42')).applied).toEqual({});
    await applyReadingReturnBatch('42',preview,{'1:note':uuid(2)});expect((await loadReadingData('42')).states['1'].note).toBe('right');expect(Object.keys((await loadReadingData('42')).applied)).toHaveLength(2);
  });
  it('keeps manual desktop changes only by explicit desktop selection',async()=>{
    await readingTransaction('42',data=>{data.states['1']={...emptyReadingState(),note:'desktop'};});
    const preview=await previewReadingReturnBatch('42',[file(1)]);expect(preview.rows[0].status).toBe('conflict');await applyReadingReturnBatch('42',preview,{'1:note':'desktop'});
    expect((await loadReadingData('42')).states['1'].note).toBe('desktop');expect((await loadReadingData('42')).applied[uuid(1)]).toBeTruthy();
  });
  it('atomically rejects desktop changes made after preview',async()=>{
    const preview=await previewReadingReturnBatch('42',[file(1)]);await readingTransaction('42',data=>{data.states['1']={...emptyReadingState(),note:'later'};});
    await expect(applyReadingReturnBatch('42',preview)).rejects.toThrow('预览后');expect((await loadReadingData('42')).applied).toEqual({});
  });
  it('selects positions by snapshot sequence before revision regardless of file order',async()=>{
    await rememberSnapshot('42',snapshot('second'));
    const old=file(1),latest=file(2,'phone','second');old.input.operations=[];latest.input.operations=[];
    old.input.positions=[{id:uuid(3),viewId:'repositories',repoId:1,revision:999}];latest.input.positions=[{id:uuid(4),viewId:'repositories',repoId:2,revision:1}];
    const preview=await previewReadingReturnBatch('42',[old,latest]);await applyReadingReturnBatch('42',preview);
    expect((await loadReadingData('42')).positions?.repositories).toMatchObject({repoId:2,sequence:2,revision:1});expect(Object.keys((await loadReadingData('42')).positionReceipts!)).toHaveLength(2);
  });
  it('requires explicit selection for different position values tied at the same sequence and revision',async()=>{
    const left=file(1),right=file(2);left.input.operations=[];right.input.operations=[];
    left.input.positions=[{id:uuid(3),viewId:'repositories',repoId:1,revision:1}];right.input.positions=[{id:uuid(4),viewId:'repositories',repoId:2,revision:1}];
    const preview=await previewReadingReturnBatch('42',[left,right]);expect(preview.positions[0].status).toBe('conflict');await expect(applyReadingReturnBatch('42',preview)).rejects.toThrow('明确选择');
    await applyReadingReturnBatch('42',preview,{'position:repositories':uuid(4)});expect((await loadReadingData('42')).positions?.repositories.repoId).toBe(2);
  });
  it('never lets tied older positions replace a newer desktop position even with an explicit stale choice',async()=>{
    await readingTransaction('42',data=>{data.positions!.repositories={id:uuid(9),viewId:'repositories',repoId:1,revision:100,snapshotId:'first',sequence:1};});
    const left=file(1),right=file(2);left.input.operations=[];right.input.operations=[];
    left.input.positions=[{id:uuid(3),viewId:'repositories',repoId:1,revision:1}];right.input.positions=[{id:uuid(4),viewId:'repositories',repoId:2,revision:1}];
    const preview=await previewReadingReturnBatch('42',[left,right]);expect(preview.positions[0].status).toBe('stale');
    expect(await applyReadingReturnBatch('42',preview,{'position:repositories':uuid(4)})).toMatchObject({positionApplied:0,positionStale:2});
    expect((await loadReadingData('42')).positions?.repositories).toMatchObject({repoId:1,revision:100});
  });
  it('rejects explicitly chosen stale sources in a group that also contains a newer ready source',async()=>{
    await readingTransaction('42',data=>{data.positions!.repositories={id:uuid(9),viewId:'repositories',repoId:1,revision:50,snapshotId:'first',sequence:1};});
    const old=file(1),recent=file(2);old.input.operations=[];recent.input.operations=[];
    old.input.positions=[{id:uuid(3),viewId:'repositories',repoId:2,revision:1}];recent.input.positions=[{id:uuid(4),viewId:'repositories',repoId:2,revision:100}];
    const preview=await previewReadingReturnBatch('42',[old,recent]);expect(preview.positions[0].status).toBe('ready');await expect(applyReadingReturnBatch('42',preview,{'position:repositories':uuid(3)})).rejects.toThrow('最新');
    expect((await loadReadingData('42')).positions?.repositories).toMatchObject({repoId:1,revision:50});
    expect((await loadReadingData('42')).positionReceipts).toEqual({});
  });
  it('permits conflict selection only among highest-ranked tied position candidates',async()=>{
    const left=file(1),right=file(2),old=file(3);for(const f of [left,right,old])f.input.operations=[];
    left.input.positions=[{id:uuid(4),viewId:'repositories',repoId:1,revision:100}];right.input.positions=[{id:uuid(5),viewId:'repositories',repoId:2,revision:100}];old.input.positions=[{id:uuid(6),viewId:'repositories',repoId:1,revision:1}];
    const preview=await previewReadingReturnBatch('42',[left,right,old]);expect(preview.positions[0].status).toBe('conflict');
    await expect(applyReadingReturnBatch('42',preview,{'position:repositories':uuid(6)})).rejects.toThrow('最新');expect((await loadReadingData('42')).positionReceipts).toEqual({});
    await applyReadingReturnBatch('42',preview,{'position:repositories':uuid(5)});expect((await loadReadingData('42')).positions?.repositories).toMatchObject({repoId:2,revision:100});
  });
  it('rejects reused operation IDs with different content across files',async()=>{await expect(previewReadingReturnBatch('42',[file(1,'left'),file(1,'right')])).rejects.toThrow('ID');});
  it('enforces the per-file four megabyte UTF-8 limit even for object inputs',async()=>{await expect(previewReadingReturnBatch('42',[file(1,'字'.repeat(1400000))])).rejects.toThrow('4 MB');});
  it('validates every file before mutating and caps the file count',async()=>{const bad=file(2);bad.input.accountId='43';await expect(previewReadingReturnBatch('42',[file(1),bad])).rejects.toThrow('其他');await expect(previewReadingReturnBatch('42',Array.from({length:21},(_,i)=>file(i+1)))).rejects.toThrow('20');expect((await loadReadingData('42')).states).toEqual({});});
});
