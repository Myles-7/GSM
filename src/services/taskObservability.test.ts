import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import { taskObservability } from './taskObservability';

async function storedMeta(owner:string,taskId:string,bytes:number,options:{protected?:boolean;pinned?:boolean;endedAt?:string}={}){
  await new Promise<void>(resolve=>{const req=indexedDB.open('gsm-task-observations-v1');req.onsuccess=()=>{const db=req.result,tx=db.transaction('meta','readwrite');tx.objectStore('meta').put({owner,taskId,bytes,protected:false,pinned:false,truncated:false,...options});tx.oncomplete=()=>{db.close();resolve();};};});
}
describe('task observation capture', () => {
  it('isolates parallel requests and reconciles final snapshots without duplicating answers', async () => {
    const owner='obs-parallel',taskId='task';
    for(const requestId of ['a','b']) taskObservability.begin({owner,taskId,requestId,label:requestId,source:'agy',mode:'stream'});
    taskObservability.phase(owner,taskId,'a','generating');taskObservability.phase(owner,taskId,'b','initializing');
    taskObservability.append(owner,taskId,'a','answer','hello ');taskObservability.append(owner,taskId,'a','answer','world');
    taskObservability.append(owner,taskId,'a','reasoning','public summary');
    taskObservability.complete(owner,taskId,'a',{outcome:'succeeded',answer:'hello world',usage:{total_tokens:10}});
    await taskObservability.flush(owner,taskId);
    const data=taskObservability.snapshot(owner,taskId);
    expect(data.requests[0]).toMatchObject({answer:'hello world',reasoning:'public summary',outcome:'succeeded',usage:{total_tokens:10}});
    expect(data.requests[1]).toMatchObject({phase:'initializing',answer:''});
    expect(data.events.some(event=>event.requestId==='a'&&event.phase==='generating')).toBe(true);
    expect(taskObservability.snapshot('different-account',taskId).requests).toEqual([]);
  });
  it('bounds previews, preserves UTF-8, redacts credentials and rejects late output after completion',async()=>{
    const owner='obs-limits',taskId='task',requestId='a';
    taskObservability.begin({owner,taskId,requestId,label:'sample',source:'http',mode:'stream'});
    taskObservability.append(owner,taskId,requestId,'answer','token=PRIVATE\n');
    taskObservability.append(owner,taskId,requestId,'answer','中文'.repeat(200000));
    taskObservability.complete(owner,taskId,requestId,{outcome:'canceled'});
    taskObservability.append(owner,taskId,requestId,'answer','LATE');
    await taskObservability.flush(owner,taskId);
    const row=taskObservability.snapshot(owner,taskId).requests[0];
    expect(new TextEncoder().encode(row.answer+row.reasoning).length).toBeLessThanOrEqual(1024*1024);
    expect(row.truncated).toBe(true);expect(row.answer).not.toContain('PRIVATE');expect(row.answer).not.toContain('LATE');
    expect(row.answer).not.toContain('\uFFFD');
  });
  it('deduplicates remote events and retains saved results with their item identity',async()=>{
    const owner='obs-remote',taskId='server:task';
    const event={source:'server' as const,type:'state',phase:'generating',remoteSeq:5};
    taskObservability.event(owner,taskId,event);taskObservability.event(owner,taskId,event);
    taskObservability.result(owner,taskId,{id:'repo1',itemId:'batch1',repositoryId:1,label:'org/repo',data:{summary:'Useful',topics:['editing']},commitStatus:'saved'});
    await taskObservability.flush(owner,taskId);
    expect(taskObservability.snapshot(owner,taskId).events).toHaveLength(1);
    expect(taskObservability.snapshot(owner,taskId).results[0]).toMatchObject({itemId:'batch1',commitStatus:'saved'});
  });
  it('hydrates historical content before an early pin write and preserves truncation metadata',async()=>{
    const owner='obs-restart',taskId='history';
    taskObservability.begin({owner,taskId,requestId:'a',label:'repo',source:'agy',mode:'stream'});
    taskObservability.complete(owner,taskId,'a',{outcome:'succeeded',answer:'saved answer'});
    for(let i=0;i<5010;i++)taskObservability.event(owner,taskId,{source:'gsm',type:'sample',id:`event-${i}`});
    taskObservability.markTask(owner,taskId,{state:'complete',endedAt:new Date().toISOString(),protected:false});
    await taskObservability.flush(owner,taskId);
    vi.resetModules();const restored=(await import('./taskObservability')).taskObservability;
    restored.pin(owner,taskId,true);await restored.flush(owner,taskId);
    expect(restored.snapshot(owner,taskId)).toMatchObject({pinned:true,truncated:true,requests:[expect.objectContaining({answer:'saved answer'})]});
    const meta=await new Promise<{bytes:number;protected:boolean}>(resolve=>{const req=indexedDB.open('gsm-task-observations-v1');req.onsuccess=()=>{const db=req.result,tx=db.transaction('meta','readonly'),read=tx.objectStore('meta').get([owner,taskId]);tx.oncomplete=()=>{resolve(read.result);db.close();};};});
    expect(meta.bytes).toBeGreaterThan(100);expect(meta.protected).toBe(false);
  });
  it('cleans expired unprotected content without counting its bytes against the account budget',async()=>{
    const owner='obs-expiry',taskId='new';
    taskObservability.begin({owner,taskId,requestId:'a',label:'repo',source:'http',mode:'final'});
    await taskObservability.flush(owner,taskId);
    await storedMeta(owner,'expired',256*1024*1024,{endedAt:new Date(Date.now()-31*86400000).toISOString()});
    taskObservability.complete(owner,taskId,'a',{outcome:'succeeded',answer:'kept'});
    await taskObservability.flush(owner,taskId);
    expect(taskObservability.snapshot(owner,taskId).storageError).toBeUndefined();
  });
  it('reports a full protected cache without throwing or discarding business output',async()=>{
    const owner='obs-capacity',taskId='new';
    taskObservability.begin({owner,taskId,requestId:'a',label:'repo',source:'http',mode:'final'});
    await taskObservability.flush(owner,taskId);
    await storedMeta(owner,'protected',256*1024*1024,{protected:true});
    taskObservability.complete(owner,taskId,'a',{outcome:'succeeded',answer:'current answer'});
    await taskObservability.flush(owner,taskId);
    expect(taskObservability.snapshot(owner,taskId)).toMatchObject({storageError:'TASK_CONTENT_CACHE_FULL',requests:[expect.objectContaining({answer:'current answer'})]});
  });

  it('keeps a pin changed during an in-flight metadata write in memory and after restart',async()=>{
    const owner='obs-pin-race',taskId='task';
    taskObservability.begin({owner,taskId,requestId:'a',label:'repo',source:'http',mode:'final'});
    const original=IDBObjectStore.prototype.put;
    let changed=false;
    const spy=vi.spyOn(IDBObjectStore.prototype,'put').mockImplementation(function(this:IDBObjectStore,value:unknown,key?:IDBValidKey){
      if(this.name==='meta'&&(value as {taskId?:string}).taskId===taskId&&!changed){changed=true;void taskObservability.pin(owner,taskId,true);}
      return original.call(this,value,key);
    });
    try{
      await taskObservability.flush(owner,taskId);
      expect(changed).toBe(true);
      expect(taskObservability.snapshot(owner,taskId).pinned).toBe(true);
      vi.resetModules();const restored=(await import('./taskObservability')).taskObservability;
      await restored.load(owner,taskId);
      expect(restored.snapshot(owner,taskId).pinned).toBe(true);
    }finally{spy.mockRestore();}
  });

});
