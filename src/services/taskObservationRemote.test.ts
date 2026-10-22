import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { HomeSync } from '../home/sync';
import type { HomeTask } from '../home/types';
import { taskObservability } from './taskObservability';
import { createRemoteTaskObserver } from './taskObservationRemote';
const base:HomeTask={id:'remote',requestId:'submitted',kind:'chat',status:'running',input:{prompt:'secret user input'},createdAt:'2026-10-22T00:00:00Z',updatedAt:'2026-10-22T00:00:00Z',lastSeq:0};
const frame=(seq:number,type:string,data:unknown)=>`id: ${seq}\nevent: ${type}\ndata: ${JSON.stringify({seq,type,data,createdAt:'2026-10-22T00:00:01Z'})}\n\n`;
let stop:(()=>void)|undefined;
beforeEach(()=>vi.useFakeTimers({toFake:['setTimeout','clearTimeout','setInterval','clearInterval','Date']}));afterEach(async()=>{stop?.();stop=undefined;vi.useRealTimers();});
function fixture(owner:string,remote=base){const api={request:vi.fn().mockResolvedValue(remote),response:vi.fn()};const sync={identity:{workspaceId:'workspace',githubUserId:Number(owner)},api} as unknown as HomeSync;let live:HomeSync|null=sync;const project=vi.fn();const observer=createRemoteTaskObserver(()=>live,owner,project);stop=observer.stop;return {api,sync,project,observer,switchOwner:()=>{live=null;}};}
async function settle(){await vi.advanceTimersByTimeAsync(0);for(let i=0;i<15;i++)await new Promise<void>(r=>setImmediate(r));await vi.advanceTimersByTimeAsync(0);}
it('deduplicates SSE replay, isolates reasoning, and replaces final content without doubling counts',async()=>{
 const f=fixture('701');f.api.response.mockResolvedValue(new Response(frame(1,'provider_request',{providerRequestId:'p',body:'RAW_INPUT',model:'m'})+frame(2,'reasoning',{providerRequestId:'p',text:'exposed'})+frame(3,'content',{providerRequestId:'p',text:'answer'})+frame(3,'content',{providerRequestId:'p',text:'answer'})+frame(4,'provider_result',{providerRequestId:'p',content:'answer',outcome:'succeeded'})+frame(5,'result',{content:'answer',data:{content:'answer'}})+frame(6,'state',{status:'completed'})));
 f.observer.observe(base);await settle();await settle();
 const view=taskObservability.snapshot('701','server:workspace:remote');expect(view.requests).toHaveLength(1);expect(view.requests[0]).toMatchObject({answer:'answer',reasoning:'exposed',receivedChars:13,outcome:'succeeded'});
 expect(JSON.stringify(view.requests)).not.toContain('RAW_INPUT');expect(view.results.some(r=>r.commitStatus==='saved')).toBe(true);expect(f.api.response).toHaveBeenCalledOnce();
});
it('loads terminal history only on detail demand and marks resync gaps unavailable while retaining saved results',async()=>{
 const remote={...base,status:'completed',lastSeq:8,result:{content:'saved',data:{summary:'saved'}}};const f=fixture('702',remote);
 f.api.response.mockResolvedValue(new Response(frame(8,'resync',{reason:'DIAGNOSTIC_GAP',task:remote})));
 f.observer.observe(remote);await settle();expect(f.api.response).not.toHaveBeenCalled();
 await taskObservability.load('702','server:workspace:remote');await settle();
 const view=taskObservability.snapshot('702','server:workspace:remote');expect(view.events.some(e=>e.type==='unavailable')).toBe(true);expect(view.results.some(r=>JSON.stringify(r.data).includes('saved'))).toBe(true);expect(view.requests).toHaveLength(0);
});
it('aborts active readers on watcher disposal and ignores late output after owner switch',async()=>{
 const f=fixture('703');let producer!:ReadableStreamDefaultController<Uint8Array>;let signal:AbortSignal|undefined;
 f.api.response.mockImplementation(async(_url:unknown,_body:unknown,s:AbortSignal)=>{signal=s;return new Response(new ReadableStream({start(c){producer=c;}}));});
 f.observer.observe(base);await settle();f.switchOwner();producer.enqueue(new TextEncoder().encode(frame(1,'content',{providerRequestId:'p',text:'LATE'})));await settle();f.observer.stop();
 expect(signal?.aborted).toBe(true);expect(taskObservability.snapshot('703','server:workspace:remote').requests).toHaveLength(0);
});
it('checks current status before a bounded reconnect and resumes from the persisted sequence',async()=>{
 const f=fixture('704');f.api.request.mockResolvedValue({...base,lastSeq:5});
 f.api.response.mockResolvedValueOnce(new Response(frame(1,'provider_request',{providerRequestId:'p'})+frame(2,'content',{providerRequestId:'p',text:'foo'})))
  .mockResolvedValueOnce(new Response(frame(2,'content',{providerRequestId:'p',text:'foo'})+frame(3,'content',{providerRequestId:'p',text:'bar'})+frame(4,'provider_result',{providerRequestId:'p',content:'foobar',outcome:'succeeded'})+frame(5,'state',{status:'completed'})));
 f.observer.observe(base);f.observer.observe(base);await settle();await vi.advanceTimersByTimeAsync(500);await settle();
 expect(f.api.response).toHaveBeenCalledTimes(2);expect(f.api.request).toHaveBeenCalledOnce();expect(f.api.request.mock.calls[0][0]).toMatch(/^\/tasks\/remote\?/);
 expect(f.api.response.mock.calls[1][0]).toContain('after=2');expect(taskObservability.snapshot('704','server:workspace:remote').requests[0]).toMatchObject({answer:'foobar',receivedChars:6});
});

it('marks out-of-order missing fragments and still reconciles the complete final answer',async()=>{
 const f=fixture('705');f.api.response.mockResolvedValue(new Response(frame(1,'provider_request',{providerRequestId:'p'})+frame(3,'content',{providerRequestId:'p',text:'second'})+frame(2,'content',{providerRequestId:'p',text:'first'})+frame(4,'provider_result',{providerRequestId:'p',content:'firstsecond',outcome:'succeeded'})+frame(5,'state',{status:'completed'})));
 f.observer.observe(base);await settle();await settle();const view=taskObservability.snapshot('705','server:workspace:remote');
 expect(view.requests[0].answer).toBe('firstsecond');expect(view.events.some(e=>e.type==='unavailable'&&e.message?.includes('乱序'))).toBe(true);
});

it('pins server history through its authenticated owner before marking the local cache retained',async()=>{
 const remote={...base,status:'completed'},f=fixture('706',remote);f.api.request.mockResolvedValue({...remote,pinned:true});f.observer.observe(remote);
 expect(await taskObservability.pin('706','server:workspace:remote',true)).toBe(true);
 expect(f.api.request).toHaveBeenCalledWith('/tasks/remote/retain',{workspaceId:'workspace',githubUserId:706,pinned:true});
 expect(taskObservability.snapshot('706','server:workspace:remote').pinned).toBe(true);
});

it.each([false,true])('restores a received batch result before reconnecting to its later save confirmation (truncated=%s)',async(truncated)=>{
 const batch={repository:'owner/repo'},content=JSON.stringify({summary:'validated before reconnect'});
 const owner=truncated?'708':'707';
 const first=fixture(owner);first.api.response.mockResolvedValue(new Response(frame(1,'provider_request',{providerRequestId:'p',batch})+frame(2,'provider_result',{providerRequestId:'p',batch,content,outcome:'succeeded',truncated})));
 first.observer.observe(base);await settle();first.observer.stop();await taskObservability.flush(owner,'server:workspace:remote');
 const next=fixture(owner);next.api.response.mockResolvedValue(new Response(frame(3,'progress',{repository:'owner/repo',repositoryWrite:'applied'})+frame(4,'state',{status:'completed'})));
 next.observer.observe({...base,lastSeq:4});await settle();await settle();
 expect(next.api.response.mock.calls[0][0]).toContain('after=2');
 expect(taskObservability.snapshot(owner,'server:workspace:remote').results).toContainEqual(expect.objectContaining({itemId:'owner/repo',commitStatus:'saved',data:truncated?{preview:content,truncated:true}:{summary:'validated before reconnect'}}));
 expect(taskObservability.snapshot(owner,'server:workspace:remote').requests[0].truncated).toBe(truncated);
});
