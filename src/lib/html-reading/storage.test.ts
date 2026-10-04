import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { defaultSettings, emptyReadingState, parseReadingReturn, readingViewId, type ReadingReturn, type ReadingSnapshot } from './model';
import { applyReadingReturn, inspectReadingReturn, inspectReadingPositions, loadReadingData, loadReadingMigrationBackup, readingTransaction, rememberSnapshot, saveReadingSettings } from './storage';
beforeEach(()=>{vi.stubGlobal('indexedDB',new IDBFactory());});
const snapshot=():ReadingSnapshot=>({version:1,id:'snapshot',accountId:'42',generatedAt:'2026-09-30T00:00:00Z',title:'GSM',settings:structuredClone(defaultSettings),sections:[{id:'repositories',title:'仓库',updatedAt:'',items:[{id:1,name:'acme/tool',url:'https://github.com/acme/tool',categoryId:'none',category:'',summary:'',description:'',tags:[],language:'',stars:1,updated:'',analysis:[],sources:[],generatedAt:'',reason:'',state:emptyReadingState()}]}]});
const incoming=(field:ReadingReturn['operations'][number]['field']='read',value:string|boolean=true):ReadingReturn=>({format:'gsm-reading-changes',version:1,accountId:'42',snapshotId:'snapshot',operations:[{id:'18ee370a-f449-4c76-b7dc-1b6903dc681b',repoId:1,field,base:field==='note'?'':field==='interest'?'neutral':false,value}]});
describe('HTML reading round trip',()=>{
  it('persists preferences by account and does not include credentials',async()=>{await saveReadingSettings('42',{...defaultSettings,fontSize:'20'});expect((await loadReadingData('42')).settings.fontSize).toBe('20');expect((await loadReadingData('43')).settings.fontSize).toBe('16');expect(JSON.stringify(await loadReadingData('42'))).not.toContain('password');});
  it('imports operations once and preserves unrelated notes',async()=>{await rememberSnapshot('42',snapshot());await readingTransaction('42',d=>{d.states['2']={...emptyReadingState(),note:'keep'};});expect(await applyReadingReturn('42',incoming(),{})).toEqual({applied:1,duplicate:0,kept:0});expect(await applyReadingReturn('42',incoming(),{})).toEqual({applied:0,duplicate:1,kept:0});expect((await loadReadingData('42')).states['2'].note).toBe('keep');});
  it('preserves both note versions until the user resolves conflict',async()=>{await rememberSnapshot('42',snapshot());await readingTransaction('42',d=>{d.states['1']={...emptyReadingState(),note:'desktop'};});const input=incoming('note','phone');const rows=inspectReadingReturn(await loadReadingData('42'),'42',input);expect(rows[0].status).toBe('conflict');await expect(applyReadingReturn('42',input,{})).rejects.toThrow('冲突');expect((await loadReadingData('42')).states['1'].note).toBe('desktop');await applyReadingReturn('42',input,{[input.operations[0].id]:'phone'});expect((await loadReadingData('42')).states['1'].note).toBe('phone');});
  it('rejects changes made on desktop after import preview',async()=>{await rememberSnapshot('42',snapshot());const input=incoming('note','phone');const rows=inspectReadingReturn(await loadReadingData('42'),'42',input);await readingTransaction('42',d=>{d.states['1']={...emptyReadingState(),note:'later'};});await expect(applyReadingReturn('42',input,{},rows)).rejects.toThrow('预览后');});
  it('keeps desktop version and receipts that decision',async()=>{await rememberSnapshot('42',snapshot());await readingTransaction('42',d=>{d.states['1']={...emptyReadingState(),interest:'ignored'};});const input=incoming('interest','interested');await applyReadingReturn('42',input,{[input.operations[0].id]:'desktop'});expect((await loadReadingData('42')).states['1'].interest).toBe('ignored');expect((await applyReadingReturn('42',input,{})).duplicate).toBe(1);});
  it.each(['wrong-account','unknown-snapshot','unknown-repo','wrong-base','invalid-field-value','disabled-operation','changed-receipt','duplicate-target'])('rejects %s without modifying state',async kind=>{const s=snapshot();if(kind==='disabled-operation')s.settings.operations.read=false;await rememberSnapshot('42',s);const input=incoming();if(kind==='wrong-account')input.accountId='43';if(kind==='unknown-snapshot')input.snapshotId='missing';if(kind==='unknown-repo')input.operations[0].repoId=9;if(kind==='wrong-base')input.operations[0].base=true;if(kind==='invalid-field-value')input.operations[0].value='true';if(kind==='changed-receipt'){await applyReadingReturn('42',input,{});input.operations[0].value=false;}if(kind==='duplicate-target')input.operations.push({...input.operations[0],id:'584a5f7b-39cb-44d9-b651-0e29cce5e8ae'});await expect(applyReadingReturn('42',input,{})).rejects.toThrow();});
  it('rejects oversized or unsupported return formats',()=>{expect(()=>parseReadingReturn(' '.repeat(4000001))).toThrow('4 MB');expect(()=>parseReadingReturn('{"format":"backup"}')).toThrow();});
  it('measures pasted return content in UTF-8 bytes instead of characters',()=>{expect(()=>parseReadingReturn('字'.repeat(1400000))).toThrow('4 MB');});
});

const uuid=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
function modernSnapshot(id='snapshot',ids=[1,2,3,4]):ReadingSnapshot {
  const sample=snapshot().sections[0].items[0];
  return {...snapshot(),version:2,id,items:Object.fromEntries(ids.map(repoId=>[String(repoId),{...sample,id:repoId,name:`acme/tool-${repoId}`}])),sections:[{id:'repositories',title:'仓库',updatedAt:'',kind:'repositories',items:[],entries:ids.map(repoId=>({repoId}))}]};
}
function positionReturn(snapshotId='snapshot',repoId=2,revision=1,id=uuid(1)):Extract<ReadingReturn,{version:2}> {
  return {format:'gsm-reading-changes',version:2,accountId:'42',snapshotId,operations:[],positions:[{id,viewId:'repositories',repoId,revision}],activeView:{id:uuid(2),viewId:'repositories',revision}};
}
async function putLegacy(data:unknown) {
  const db=await new Promise<IDBDatabase>((resolve,reject)=>{const r=indexedDB.open('gsm-html-reading',1);r.onupgradeneeded=()=>r.result.createObjectStore('accounts');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
  await new Promise<void>((resolve,reject)=>{const tx=db.transaction('accounts','readwrite');tx.objectStore('accounts').put(data,'42');tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);});db.close();
}
describe('HTML reading v2 positions and migration',()=>{
  it('moves snapshot manifests into their own store and leaves light account reads small',async()=>{
    await rememberSnapshot('42',modernSnapshot());
    expect((await loadReadingData('42',{includeSnapshots:false})).snapshots).toEqual({});
    expect(Object.keys((await loadReadingData('42',{snapshotIds:['snapshot']})).snapshots)).toEqual(['snapshot']);
    const db=await new Promise<IDBDatabase>((resolve,reject)=>{const request=indexedDB.open('gsm-html-reading');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
    const raw=await new Promise<Record<string,unknown>>((resolve,reject)=>{const request=db.transaction('accounts','readonly').objectStore('accounts').get('42');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});db.close();
    expect(raw).not.toHaveProperty('snapshots');expect(raw.artifactVersion).toBe(3);
  });
  it('preserves an untouched v2 backup while migrating manifests atomically',async()=>{
    const old={storageVersion:2,settings:defaultSettings,states:{},names:{},applied:{},snapshots:{legacy:{base:{'1':emptyReadingState()},allowed:defaultSettings.operations}},sequence:1};
    await putLegacy(old);await expect(readingTransaction('42',()=>{throw Error('abort');})).rejects.toThrow('abort');
    expect(await loadReadingMigrationBackup('42','artifacts-v3')).toBeNull();await loadReadingData('42');expect((await loadReadingMigrationBackup('42','artifacts-v3'))?.data).toEqual(old);
  });
  it('backs up the untouched old account before defaults and upgrade, once only',async()=>{
    const old={settings:{...defaultSettings,fontSize:'20',summaryLines:undefined},states:{'1':{...emptyReadingState(),note:'original'}},names:{'1':'acme/tool'},applied:{},snapshots:{}};
    const raw=JSON.parse(JSON.stringify(old));await putLegacy(raw);
    const migrated=await loadReadingData('42');expect(migrated.settings).toMatchObject({fontSize:'20',summaryLines:6});
    expect(migrated.storageVersion).toBe(2);expect((await loadReadingMigrationBackup('42'))?.data).toEqual(raw);
    await saveReadingSettings('42',{...migrated.settings,fontSize:'18'});expect((await loadReadingMigrationBackup('42'))?.data).toEqual(raw);
    expect(await loadReadingMigrationBackup('43')).toBeNull();
  });
  it('rolls back backup and format changes when first migration transaction fails',async()=>{
    const old={settings:defaultSettings,states:{},names:{},applied:{},snapshots:{}};await putLegacy(old);
    await expect(readingTransaction('42',()=>{throw Error('abort');})).rejects.toThrow('abort');
    expect(await loadReadingMigrationBackup('42')).toBeNull();
    expect((await loadReadingData('42')).migrationBackupAt).toBeTruthy();expect((await loadReadingMigrationBackup('42'))?.data).toEqual(old);
  });
  it('accepts positions-only returns and atomically receipts each position and active view',async()=>{
    const s=modernSnapshot();await rememberSnapshot('42',s);expect(s.sequence).toBe(1);
    const input=positionReturn();const preview=inspectReadingPositions(await loadReadingData('42'),'42',input);
    expect(preview.map(row=>row.status)).toEqual(['ready','ready']);expect(preview[0]).toMatchObject({viewName:'仓库',name:'acme/tool-2'});
    expect(await applyReadingReturn('42',input,{},[],preview)).toMatchObject({applied:0,positionApplied:2,positionDuplicate:0});
    expect(await applyReadingReturn('42',input,{})).toMatchObject({positionApplied:0,positionDuplicate:2});
    const data=await loadReadingData('42');expect(data.positions?.repositories).toMatchObject({repoId:2,sequence:1,revision:1});expect(data.activeView?.viewId).toBe('repositories');
  });
  it('uses desktop snapshot sequence before phone revision, while still importing an old note',async()=>{
    const older=modernSnapshot('older');const newer=modernSnapshot('newer');newer.generatedAt='1999-01-01T00:00:00Z';newer.sequence=100000;
    await rememberSnapshot('42',older);await rememberSnapshot('42',newer);expect(newer.sequence).toBe(2);
    const recent=positionReturn('newer',3,1);await applyReadingReturn('42',recent,{});
    const late=positionReturn('older',2,999999,uuid(3));late.activeView={...late.activeView!,id:uuid(4)};late.operations=[{...incoming('note','late note').operations[0],id:uuid(5)}];
    expect(await applyReadingReturn('42',late,{})).toMatchObject({applied:1,positionStale:2});
    const data=await loadReadingData('42');expect(data.states['1'].note).toBe('late note');expect(data.positions?.repositories.repoId).toBe(3);expect(data.activeView?.snapshotId).toBe('newer');
  });
  it('accepts larger revisions in one file and receipts an older revision as stale',async()=>{
    await rememberSnapshot('42',modernSnapshot());const later=positionReturn('snapshot',3,3);await applyReadingReturn('42',later,{});
    const old=positionReturn('snapshot',2,2,uuid(3));old.activeView={...old.activeView!,id:uuid(4)};
    expect(await applyReadingReturn('42',old,{})).toMatchObject({positionStale:2});expect(await applyReadingReturn('42',old,{})).toMatchObject({positionDuplicate:2});
    expect((await loadReadingData('42')).positions?.repositories.repoId).toBe(3);
  });
  it('requires a new preview if another import changes a targeted position',async()=>{
    await rememberSnapshot('42',modernSnapshot());const input=positionReturn();const preview=inspectReadingPositions(await loadReadingData('42'),'42',input);
    const competing=positionReturn('snapshot',3,2,uuid(3));competing.activeView={...competing.activeView!,id:uuid(4)};await applyReadingReturn('42',competing,{});
    await expect(applyReadingReturn('42',input,{},[],preview)).rejects.toThrow('预览后');
    expect((await loadReadingData('42')).positionReceipts?.[uuid(1)]).toBeUndefined();
  });
  it.each(['unknown-view','outside-view','duplicate-view','duplicate-id','reuse-op-id','changed-id','cross-snapshot-id','legacy-file','prototype-snapshot'])('rejects %s without applying accompanying business operations',async kind=>{
    await rememberSnapshot('42',modernSnapshot());const input=positionReturn();
    if(kind==='unknown-view')input.positions[0].viewId='missing';
    if(kind==='outside-view')input.positions[0].repoId=999;
    if(kind==='duplicate-view')input.positions.push({...input.positions[0],id:uuid(3)});
    if(kind==='duplicate-id')input.activeView!.id=input.positions[0].id;
    if(kind==='reuse-op-id')input.operations=[{...incoming().operations[0],id:input.positions[0].id}];
    if(kind==='changed-id'){await applyReadingReturn('42',input,{});input.positions[0].repoId=3;}
    if(kind==='cross-snapshot-id'){await applyReadingReturn('42',input,{});await rememberSnapshot('42',modernSnapshot('other'));input.snapshotId='other';}
    if(kind==='legacy-file'){await rememberSnapshot('42',{...snapshot(),id:'legacy'});input.snapshotId='legacy';}
    if(kind==='prototype-snapshot')input.snapshotId='__proto__';
    if(kind!=='reuse-op-id')input.operations=[{...incoming('note','should not apply').operations[0],id:uuid(8)}];
    await expect(applyReadingReturn('42',input,{})).rejects.toThrow();expect((await loadReadingData('42')).states['1']?.note??'').toBe('');
  });
  it('does not receipt positions when a business conflict is unresolved',async()=>{
    await rememberSnapshot('42',modernSnapshot());await readingTransaction('42',data=>{data.states['1']={...emptyReadingState(),note:'desktop'};});
    const input=positionReturn();input.operations=incoming('note','phone').operations;
    await expect(applyReadingReturn('42',input,{})).rejects.toThrow('冲突');const data=await loadReadingData('42');expect(data.positions).toEqual({});expect(data.positionReceipts).toEqual({});
  });
  it('retains stable project anchors across reorder and resolves a removed anchor using original neighbors',async()=>{
    await rememberSnapshot('42',modernSnapshot());await applyReadingReturn('42',positionReturn(),{});
    const next=modernSnapshot('next',[4,1,3]);await rememberSnapshot('42',next);
    expect(next.resume).toEqual([{viewId:'repositories',repoId:3,notice:expect.stringContaining('附近')}]);expect(next.activeViewId).toBe('repositories');
    const newerInput=positionReturn('next',3,1,uuid(3));newerInput.activeView={...newerInput.activeView!,id:uuid(4)};await applyReadingReturn('42',newerInput,{});
    const shuffled=modernSnapshot('shuffled',[1,4,3]);await rememberSnapshot('42',shuffled);expect(shuffled.resume).toEqual([{viewId:'repositories',repoId:3}]);
  });
  it('falls back to the newest exported edition with an explicit notice, then to repositories when channel is omitted',async()=>{
    const first=modernSnapshot();first.sections.push({id:'custom:tools',title:'工具周刊',updatedAt:'',kind:'custom',items:[],editions:[{id:'old',date:'2026-09-30',generatedAt:'',complete:true,entries:[{repoId:2}]}]});await rememberSnapshot('42',first);
    const input=positionReturn();input.positions[0].viewId=readingViewId('custom:tools','old');input.activeView!.viewId=input.positions[0].viewId;await applyReadingReturn('42',input,{});
    const next=modernSnapshot('next');next.sections.push({...first.sections[1],editions:[{id:'new',date:'2026-10-01',generatedAt:'',complete:true,entries:[{repoId:4},{repoId:2}]}]});await rememberSnapshot('42',next);
    expect(next.activeViewId).toBe(readingViewId('custom:tools','new'));expect(next.resume).toContainEqual({viewId:readingViewId('custom:tools','new'),repoId:2,notice:expect.stringContaining('最新一期')});
    const omitted=modernSnapshot('omitted');await rememberSnapshot('42',omitted);expect(omitted.activeViewId).toBe('repositories');expect(omitted.resume?.[0].notice).toContain('原频道');
  });
  it('keeps a fallback notice even when the new view has no projects',async()=>{
    await rememberSnapshot('42',modernSnapshot());await applyReadingReturn('42',positionReturn(),{});const next=modernSnapshot('empty',[]);await rememberSnapshot('42',next);expect(next.resume).toEqual([]);expect(next.warnings?.[0]).toContain('项目未包含');
  });
});
