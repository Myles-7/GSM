// Native preload/IPC + production Desktop supervisor + deterministic CLI children.
// No executable discovered from the real profile is ever launched.
const { app, BrowserWindow, ipcMain, session, safeStorage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '../..');
const output = process.env.GSM_AGY_FIXTURE_OUTPUT || path.join(root, 'output/reliability/native-agy');
fs.mkdirSync(output, { recursive: true });
app.setPath('userData', path.join(output, 'profile'));
const runtime = require('../../electron/agyRuntime');
const originalWorker = runtime.createAgyWorker, originalRun = runtime.runAgy;
const roots = new Set(), directories = new Set(), pids = new Set();
let active = 0, peak = 0, workerCount = 0;
const childSource = `
console.log(JSON.stringify({event:'init',init:{tools:[],agent:'gsm-isolated',permission_mode:'request-review'}}));
let input='';process.stdin.on('data',part=>input+=part);process.stdin.on('end',()=>{
 const message=JSON.parse(input).message.content;
 if(message.includes('FIXTURE_HANG')){setInterval(()=>{},1000);return;}
 const answer=message.includes('连接成功')?'{"answer":"连接成功","missing":[]}':message.split('INPUT:\\n').pop();
 setTimeout(()=>console.log(JSON.stringify({event:'result',result:{status:'SUCCESS',num_turns:1,response:answer}})),120);
});`;
const spawnFixture = (_executable, _args, options) => {
  assert.equal(options.shell, false); assert.equal(options.windowsHide, true);
  directories.add(options.cwd); active++; peak = Math.max(peak, active);
  const child = spawn(process.execPath, ['-e', childSource], { ...options, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } });
  pids.add(child.pid); child.once('close', () => active--); return child;
};
runtime.runAgy = options => originalRun({ ...options, spawnProcess: spawnFixture });
runtime.createAgyWorker = options => {
  workerCount++; roots.add(options.cwd);
  return originalWorker({ ...options, spawnProcess: spawnFixture, maxRequests: 5 });
};
const { createAgyDesktop, DEFAULT_PREFS } = require('../../electron/agyDesktop');
const { registerAgyIpc } = require('../../electron/agyIpc');
const { isTrustedMainFrame } = require('../../electron/trustedRenderer');
const watchdog = setTimeout(() => { console.error('Native AGY acceptance timed out'); app.exit(1); }, 45000);
app.whenReady().then(async () => {
  let window, service;
  try {
    session.defaultSession.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !['file:', 'data:'].includes(new URL(details.url).protocol) }));
    const host = path.join(output, 'host.html'); fs.writeFileSync(host, '<!doctype html><title>Reliability acceptance</title>');
    const createService = () => createAgyDesktop({ userDataPath: path.join(output, 'device'), safeStorage, platform: 'win32',
      selectExecutable: async () => process.execPath,
      inspect: async () => ({ path: process.execPath, name: 'agy.exe', fingerprint: 'deterministic-fixture' }) });
    assert.equal(safeStorage.isEncryptionAvailable(), true);
    service = createService();
    window = new BrowserWindow({ show: false, webPreferences: { preload: path.join(root, 'electron/preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
    registerAgyIpc({ ipcMain, isMainFrame: event => isTrustedMainFrame(event, window, pathToFileURL(host).href, false), getService: () => service });
    await window.loadFile(host);
    const result = await window.webContents.executeJavaScript(`(async()=>{
      const api=electronAPI.agy, events=[];const off=api.onEvent(event=>events.push(event));
      await api.setSession('native-owner-a','42');
      const detected=await api.detect('detect');if(!detected.ok)throw Error('detect failed');
      const prefs={...${JSON.stringify(DEFAULT_PREFS)},model:'fixture',concurrency:5,maxQueued:50};
      if(!(await api.save('configure',prefs)).ok)throw Error('configuration failed');
      const probe=await api.probe('probe');if(!probe.ok||probe.value.lastProbe.code!=='SUCCESS')throw Error('probe failed');
      if(!(await api.save('enable',{...prefs,enabled:true})).ok)throw Error('enable failed');
      const request=(id,text,session='native-owner-a')=>api.start(id,session,{system:'Fixture only',user:text,model:'fixture',effort:'medium',feature:'other'});
      const values=[];
      // Leave one unconsumed result for crash recovery; release other completed
      // reservations exactly as a business consumer would, within the 50MiB cap.
      let offset=0;
      for(const count of [6,5,1]){
        const batch=await Promise.all(Array.from({length:count},(_,j)=>request('native-'+(offset+j),'isolated-'+(offset+j))));
        for(let j=0;j<batch.length;j++){
          const value=batch[j];if(!value.ok)throw Error('request '+(offset+j)+' failed: '+value.code);
          values.push(value);
          if(offset+j>0){const ack=await api.recoveryAck('native-owner-a','native-'+(offset+j),value.value.recovery.resultDigest);if(!ack.ok)throw Error('consumer ack failed');}
        }
        offset+=count;
      }
      values.forEach((value,i)=>{if(!value.ok||value.value.text!=='isolated-'+i)throw Error('request isolation failed '+i);});
      const duplicate=await request('native-0','isolated-0');
      if(!duplicate.ok||duplicate.value.text!==values[0].value.text)throw Error('duplicate result lost');
      const read=await api.recoveryRead('native-owner-a','native-0');
      if(!read.ok||read.value.result.text!=='isolated-0')throw Error('durable read failed');
      if(!(await api.recoveryStage('native-owner-a','native-0',read.value.record.resultDigest,{kind:'fixture',saved:true})).ok)throw Error('stage failed');
      const waitSent=id=>new Promise((resolve,reject)=>{const until=Date.now()+5000;const poll=()=>{if(events.some(event=>event.requestId===id&&event.type==='sent'))resolve();else if(Date.now()>until)reject(Error('missing sent'));else setTimeout(poll,10);};poll();});
      const canceled=request('cancel-one','FIXTURE_HANG');const sibling=request('healthy','healthy');
      await waitSent('cancel-one');await api.cancel('cancel-one');
      const canceledResult=await canceled,healthy=await sibling;
      if(canceledResult.ok||!healthy.ok||healthy.value.text!=='healthy')throw Error('cancel affected sibling');
      const obsolete=request('switch-old','FIXTURE_HANG');await waitSent('switch-old');
      await api.setSession('native-owner-b','43');const obsoleteResult=await obsolete;
      if(obsoleteResult.ok)throw Error('old account result accepted');
      const denied=await api.recoveryRead('native-owner-b','native-0');if(denied.ok)throw Error('cross-account read');
      const fresh=await request('fresh','new account','native-owner-b');if(!fresh.ok||fresh.value.text!=='new account')throw Error('new session failed');
      off();return {requests:values.length,isolated:true,cancelSiblingSurvives:true,accountSwitch:true,
        phases:['queued','initializing','sent','cleanup'].filter(type=>events.some(event=>event.type===type)),pool:(await api.getState()).pool};
    })()`);
    await service.shutdown();
    service = createService();
    const recovery = await window.webContents.executeJavaScript(`(async()=>{
      const api=electronAPI.agy;await api.setSession('native-owner-restarted','42');
      const saved=await api.recoveryRead('native-owner-restarted','native-0');
      if(!saved.ok||saved.value.result.text!=='isolated-0'||saved.value.commit.saved!==true)throw Error('restart recovery failed');
      const digest=saved.value.record.resultDigest;
      if(!(await api.recoveryAck('native-owner-restarted','native-0',digest)).ok)throw Error('ack failed');
      if(!(await api.recoveryAck('native-owner-restarted','native-0',digest)).ok)throw Error('idempotent ack failed');
      const consumed=await api.recoveryRead('native-owner-restarted','native-0');
      if(!consumed.ok||consumed.value.result||consumed.value.record.receipt!=='consumed')throw Error('body not cleared');
      const unknown=await api.recoveryRead('native-owner-restarted','switch-old');
      if(!unknown.ok||unknown.value.record.providerOutcome!=='unknown')throw Error('lost call not unknown');
      return {restart:true,stagedCommit:true,receipt:true,unknown:true,duplicateNoCall:true,accountIsolation:true};
    })()`);
    await service.shutdown();
    assert.equal(result.requests, 12); assert.equal(peak, 5); assert.equal(active, 0);
    assert.equal(workerCount, 2); assert.equal(roots.size, 2);
    assert.equal(pids.size, 17); assert.equal(directories.size, 17);
    assert.equal(result.pool.quarantined, false);
    assert.deepEqual(result.phases, ['queued', 'initializing', 'sent', 'cleanup']);
    for (const directory of directories) assert.equal(fs.existsSync(directory), false);
    for (const directory of roots) assert.equal(fs.existsSync(directory), false);
    const evidence = { nativeElectron: process.versions.electron, productionSupervisor: true, actualCliFixtureProcesses: pids.size,
      peakConcurrency: peak, generationWorkers: workerCount, isolatedRequestDirectories: directories.size, safeStorage: true, recovery, ...result };
    fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify(evidence, null, 2)); console.log(JSON.stringify(evidence));
    window.destroy(); clearTimeout(watchdog); app.exit(0);
  } catch (error) {
    console.error(error); await service?.shutdown(); window?.destroy(); clearTimeout(watchdog); app.exit(1);
  }
});
