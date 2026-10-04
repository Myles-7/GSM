const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {createHtmlReadingService}=require('./htmlReading');
function fixture(t) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'gsm-reading-loop-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  let clock=new Date('2026-10-04T00:00:00Z'),verifyError=null,sendError=null,sends=0;
  const options={fs,path,userData:root,now:()=>clock,safeStorage:{isEncryptionAvailable:()=>true,encryptString:x=>Buffer.from(x),decryptString:x=>x.toString()},createTransport:()=>({verify:async()=>{if(typeof verifyError==='function')return verifyError();if(verifyError)throw verifyError;},sendMail:async()=>{sends++;if(sendError)throw sendError;return{accepted:['reader@gmail.com']};},close:()=>{}})};
  const service=createHtmlReadingService(options);service.saveCredential({accountId:'42',from:'sender@gmail.com',to:'reader@gmail.com',password:'abcdefghijklmnop'});service.configure({accountId:'42',enabled:true,time:'08:00',retryMode:'safe',artifactRetentionDays:90});
  return{root,service,options,time:x=>clock=new Date(x),verify:x=>verifyError=x,send:x=>sendError=x,sends:()=>sends};
}
const payload={accountId:'42',html:'<!doctype html><p>project</p>',snapshotId:'snapshot',comparisonIndex:{'1':'a'.repeat(64)}};
test('only Gmail acceptance commits comparison baseline',async t=>{
  const f=fixture(t);assert.deepEqual(f.service.baseline('42'),{index:{}});f.send(Object.assign(Error('timeout'),{code:'ETIMEDOUT'}));
  await f.service.send(payload);assert.deepEqual(f.service.baseline('42'),{index:{}});f.send(null);await f.service.send({...payload,snapshotId:'accepted'});
  assert.equal(f.service.baseline('42').snapshotId,'accepted');assert.equal(createHtmlReadingService(f.options).baseline('42').index['1'],'a'.repeat(64));assert.deepEqual(f.service.baseline('43'),{index:{}});
});
test('a complete 10000 repository scope plus discovery projects can commit its baseline',async t=>{
  const f=fixture(t),comparisonIndex=Object.fromEntries(Array.from({length:10001},(_,i)=>[String(i+1),'b'.repeat(64)]));assert.equal((await f.service.send({...payload,comparisonIndex})).success,true);assert.equal(Object.keys(f.service.baseline('42').index).length,10001);
});
test('temporary generation retries at five and fifteen minutes then stops, survives restart',t=>{
  const f=fixture(t);const first=f.service.due();f.service.generationFailed(first.requestId,'temporary',{retryable:true,code:'timeout'});
  f.time('2026-10-04T00:04:59Z');assert.equal(f.service.due(),null);f.time('2026-10-04T00:05:00Z');let service=createHtmlReadingService(f.options);const retry=service.due();assert.equal(retry.requestId,first.requestId);
  service.generationFailed(retry.requestId,'temporary',{retryable:true});f.time('2026-10-04T00:14:59Z');assert.equal(service.due(),null);f.time('2026-10-04T00:15:00Z');const second=service.due();service.generationFailed(second.requestId,'temporary',{retryable:true});assert.equal(service.due(),null);assert.equal(service.status().runs[0].retryCount,2);
});
test('no content, authentication, size and cancelled generation never retry',t=>{
  for(const code of ['noContent','authentication','size','cancelled']){const f=fixture(t),due=f.service.due();f.service.generationFailed(due.requestId,code,{code,retryable:false});f.time('2026-10-04T01:00:00Z');assert.equal(f.service.due(),null);}
});
test('missed morning catches up only today, old retry never catches up tomorrow',t=>{
  const f=fixture(t);f.time('2026-10-04T12:00:00Z');const due=f.service.due();assert.equal(due.accountId,'42');f.service.generationFailed(due.requestId,'temporary',{retryable:true});
  f.time('2026-10-05T00:00:00Z');const next=f.service.due();assert.notEqual(next.requestId,due.requestId);assert.equal(f.service.status().runs.filter(r=>r.date==='2026-10-04')[0].status,'failed');
});
test('pre-submission network failure retries saved attachment without submitting twice',async t=>{
  const f=fixture(t);f.verify(Object.assign(Error('network'),{code:'ETIMEDOUT'}));const due=f.service.due();const result=await f.service.send({...payload,requestId:due.requestId});assert.equal(result.status,'retry_waiting');assert.equal(f.sends(),0);
  f.time('2026-10-04T00:05:00Z');f.verify(null);const retry=f.service.due();assert.equal(retry.saved,true);assert.equal((await f.service.sendSavedDue(retry.requestId)).success,true);assert.equal(f.sends(),1);assert.equal(f.service.due(),null);
});
test('submission timeout and restart remain unconfirmed, never retry',async t=>{
  const f=fixture(t);f.send(Object.assign(Error('timeout'),{code:'ETIMEDOUT'}));const due=f.service.due();await f.service.send({...payload,requestId:due.requestId});f.time('2026-10-04T06:00:00Z');const service=createHtmlReadingService(f.options);assert.equal(service.due(),null);assert.equal(service.status().runs[0].status,'unconfirmed');await assert.rejects(service.resend('42',due.requestId,false));
});
test('manual acceptance suppresses a second automatic delivery for the same day',async t=>{
  const f=fixture(t);await f.service.send(payload);assert.equal(f.service.due(),null);
});
test('generation-only policy will not automatically repeat mail-stage failures',async t=>{
  const f=fixture(t);f.service.configure({accountId:'42',enabled:true,time:'08:00',retryMode:'generation'});f.verify(Object.assign(Error('network'),{code:'ETIMEDOUT'}));const due=f.service.due();assert.equal((await f.service.send({...payload,requestId:due.requestId})).status,'failed');f.time('2026-10-04T02:00:00Z');assert.equal(f.service.due(),null);
});
test('retention deletes only owned old files, protects latest acceptance and unconfirmed files',async t=>{
  const f=fixture(t);await f.service.send(payload);const first=f.service.status().runs[0];
  f.send(Object.assign(Error('timeout'),{code:'ETIMEDOUT'}));await f.service.send({...payload,snapshotId:'uncertain'});const uncertain=f.service.status().runs[0];f.send(null);
  f.time('2026-10-05T00:00:00Z');await f.service.send({...payload,snapshotId:'latest'});const last=f.service.status().runs[0];
  fs.writeFileSync(path.join(f.root,'html-reading','unrelated.html'),'unrelated');f.time('2027-02-10T00:00:00Z');f.service.cleanup();
  const runs=f.service.status().runs;assert.equal(runs.find(r=>r.id===first.id).hasAttachment,false);assert.equal(runs.find(r=>r.id===uncertain.id).hasAttachment,true);assert.equal(runs.find(r=>r.id===last.id).hasAttachment,true);assert.ok(fs.existsSync(path.join(f.root,'html-reading','unrelated.html')));
  const retained=JSON.parse(fs.readFileSync(path.join(f.root,'html-reading','delivery.json')));assert.equal(retained.runs.find(run=>run.id===first.id).comparisonIndex,undefined);assert.equal(retained.baselines['42'].snapshotId,'latest');
});
test('restart during verification is safely resumable and no secrets appear in status',t=>{
  const f=fixture(t),due=f.service.due();const stateFile=path.join(f.root,'html-reading','delivery.json'),data=JSON.parse(fs.readFileSync(stateFile));data.runs[0].status='verifying';fs.writeFileSync(stateFile,JSON.stringify(data));const service=createHtmlReadingService(f.options);assert.equal(service.status().runs[0].status,'retry_waiting');assert.ok(!JSON.stringify(service.status()).includes('abcdefghijklmnop'));assert.equal(service.due(),null);assert.ok(due.requestId);
});
test('disabling schedule invalidates an active scheduled preparation without SMTP submission',async t=>{
  const f=fixture(t),due=f.service.due();f.service.configure({accountId:'42',enabled:false,time:'08:00'});await assert.rejects(f.service.send({...payload,requestId:due.requestId}));assert.equal(f.sends(),0);assert.equal(f.service.status().busy,false);
});
test('changing to manual recovery invalidates an already queued retry',t=>{
  const f=fixture(t),due=f.service.due();f.service.generationFailed(due.requestId,'temporary',{retryable:true});f.service.configure({accountId:'42',enabled:true,time:'08:00',retryMode:'manual'});f.time('2026-10-04T00:05:00Z');assert.equal(f.service.due(),null);assert.equal(f.service.status().runs[0].status,'failed');
});
test('changing to generation-only rejects a queued verification retry',async t=>{
  const f=fixture(t),due=f.service.due();f.verify(Object.assign(Error('network'),{code:'ETIMEDOUT'}));await f.service.send({...payload,requestId:due.requestId});f.service.configure({accountId:'42',enabled:true,time:'08:00',retryMode:'generation'});f.time('2026-10-04T00:05:00Z');assert.equal(f.service.due(),null);assert.equal(f.sends(),0);
});
test('scheduled preparation finishing the following day never submits old mail',async t=>{
  const f=fixture(t);f.time('2026-10-04T15:59:00Z');const due=f.service.due();f.time('2026-10-04T16:00:01Z');await assert.rejects(f.service.send({...payload,requestId:due.requestId}));assert.equal(f.sends(),0);assert.equal(f.service.status().busy,false);assert.equal(f.service.status().runs[0].status,'failed');
});
test('retry verification crossing midnight stops before SMTP submission',async t=>{
  const f=fixture(t);f.time('2026-10-04T15:54:50Z');f.verify(Object.assign(Error('network'),{code:'ETIMEDOUT'}));const due=f.service.due();await f.service.send({...payload,requestId:due.requestId});
  f.time('2026-10-04T15:59:50Z');const retry=f.service.due();f.verify(()=>f.time('2026-10-04T16:00:10Z'));assert.equal((await f.service.sendSavedDue(retry.requestId)).status,'failed');assert.equal(f.sends(),0);assert.equal(f.service.status().runs.find(run=>run.id===retry.requestId).status,'failed');assert.deepEqual(f.service.baseline('42'),{index:{}});
});
test('legacy delivery migration backs up prior state and corrupted state is never reset',t=>{
  const f=fixture(t),stateFile=path.join(f.root,'html-reading','delivery.json'),prior=JSON.parse(fs.readFileSync(stateFile));delete prior.formatVersion;fs.writeFileSync(stateFile,JSON.stringify(prior));
  createHtmlReadingService(f.options);assert.deepEqual(JSON.parse(fs.readFileSync(path.join(f.root,'html-reading','delivery-before-loop.json'))),prior);
  fs.writeFileSync(stateFile,'broken-state');assert.throws(()=>createHtmlReadingService(f.options),/原文件已保留/);assert.equal(fs.readFileSync(stateFile,'utf8'),'broken-state');
});
test('scheduled channel progress is isolated by request and original generated time survives resend',async t=>{
  const f=fixture(t),due=f.service.due();f.service.generationProgress('unrelated','ignored');assert.equal(f.service.status().runs[0].progress,undefined);f.service.generationProgress(due.requestId,'正在准备趋势');assert.equal(f.service.status().runs[0].progress,'正在准备趋势');
  await f.service.send({...payload,requestId:due.requestId,generatedAt:'2026-10-03T23:59:59Z'});const first=f.service.status().runs[0];f.time('2026-10-05T00:00:00Z');await f.service.resend('42',first.id,true);assert.equal(f.service.status().runs[0].generatedAt,first.generatedAt);
});
