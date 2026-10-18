// Run only on a stopped, hash-verified profile COPY. Never connects to a server.
const { app, BrowserWindow, session, ipcMain } = require('electron');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../..');
const workspace = path.resolve(process.env.GSM_FAILURE_FIX_ROOT || '');
if (!path.basename(workspace).startsWith('gsm-failure-fix-')) throw Error('Explicit failure-fix scratch directory required');
const serverURL = process.env.GSM_FAILURE_SERVER_URL;
const suffix = process.env.GSM_FAILURE_FIX_SUFFIX || '';
if (!/^(?:-r\d+)?$/.test(suffix)) throw Error('Invalid fixture suffix');
if (serverURL && !/^http:\/\/127\.0\.0\.1:\d+$/.test(serverURL)) throw Error('Only the contained fixture server is allowed');
const profile = path.join(workspace, (serverURL ? 'server-profile' : 'desktop-profile') + suffix);
if (!fs.existsSync(path.join(profile, 'IndexedDB'))) throw Error('Verified stopped profile copy required');
app.setPath('userData', profile); app.setPath('sessionData', profile);
process.env.DATA_DIR = path.join(workspace, 'validation-server-config');
process.env.ENCRYPTION_KEY = 'f'.repeat(64);
const originalFetch = global.fetch;
global.fetch = async () => { throw Error('FIXTURE_NETWORK_FORBIDDEN'); };
const { validateData } = require('../../server/dist/services/syncV2.js');
const watchdog = setTimeout(() => app.exit(1), 30000);
app.whenReady().then(async () => {
  let window;
  try {
    session.defaultSession.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !['file:', 'data:'].includes(new URL(details.url).protocol) }));
    const bundle = await require('esbuild').build({ stdin: { contents: `export {HomeSync} from './src/home/sync'; export {HomeApiError} from './src/home/api'; export {aiTaskJournal} from './src/services/aiTaskJournal';`, resolveDir: root },
      bundle: true, write: false, format: 'iife', globalName: 'gsmFailureFix', platform: 'browser', target: 'es2022' });
    const host = path.join(workspace, 'home-profile.html'); fs.writeFileSync(host, '<!doctype html><title>Isolated Home repair fixture</title>');
    const preload = path.join(workspace, 'profile-preload.cjs');
    fs.writeFileSync(preload, `const {contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('fixtureSync',{request:(path,body)=>ipcRenderer.invoke('fixture-sync',path,body)});`);
    ipcMain.handle('fixture-sync', async (event, requestPath, body) => {
      if (!serverURL || event.sender !== window.webContents || !requestPath.startsWith('/sync/v2/')) throw Error('Fixture request rejected');
      const response = await originalFetch(serverURL + '/api' + requestPath, { method: body ? 'POST' : 'GET', headers: { Authorization: 'Bearer isolated-fixture', 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
      return { status: response.status, ok: response.ok, data: await response.json() };
    });
    window = new BrowserWindow({ show: false, webPreferences: { preload, nodeIntegration: false, contextIsolation: true, sandbox: true } });
    await window.loadFile(host); await window.webContents.executeJavaScript(bundle.outputFiles[0].text);
    const report = await window.webContents.executeJavaScript(`(async () => {
      const realServer=${!!serverURL};
      const {HomeSync,HomeApiError,aiTaskJournal}=gsmFailureFix;
      const req=r=>new Promise((resolve,reject)=>{r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
      const appDb=await req(indexedDB.open('github-stars-manager-db'));
      const saved=await req(appDb.transaction('app_state').objectStore('app_state').getAll()); appDb.close();
      const owner=saved.map(value=>{try{return JSON.parse(value)?.state?.user?.id;}catch{return undefined;}}).find(Number.isSafeInteger);
      if(!owner)throw Error('Profile owner missing');
      const databases=(await indexedDB.databases()).filter(row=>row.name?.startsWith('gsm-home-v2-'));
      const reports=[];
      for(const row of databases){
        const namespace=decodeURIComponent(row.name.slice('gsm-home-v2-'.length)),separator=namespace.lastIndexOf('|');
        if(separator<0)continue;
        const api={url:namespace.slice(0,separator)};
        const sync=new HomeSync(api,{protocolVersion:2,workspace:{id:namespace.slice(separator+1),githubUserId:owner},github:{configured:true}});
        const pending=await sync.db.pending(); if(!pending.length){sync.stop();continue;}
        const before=await sync.db.list('repositories'),frozen=await sync.db.nextBatch();
        const digest=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value))))).join(',');
        const analysisBefore=await digest(before.map(row=>[row.id,row.data?.ai_details,row.data?.custom_description]));
        let calls=0,rejected=0,accepted=0,hasTokens=0;
        const prohibited=value=>value&&typeof value==='object'&&Object.entries(value).some(([key,nested])=>key==='temp_clone_token'||prohibited(nested));
        hasTokens=pending.filter(op=>prohibited(op.data)).length;
        api.request=async(path,body)=>{
          if(realServer){const response=await fixtureSync.request(path,body);if(!response.ok){rejected++;throw new HomeApiError(response.status,response.data.code,response.data.code);}if(body){calls++;accepted+=response.data.results.filter(item=>item.status==='applied').length;}return response.data;}
          if(path.startsWith('/sync/v2/changes'))return {records:[],cursor:await sync.db.metadata('cursor')||0,hasMore:false};
          if(!path.startsWith('/sync/v2/operations'))throw Error('Unexpected fixture request');
          calls++;
          // Same strict privacy rule as the server; the production validator is
          // also run in main below on the final persisted projections.
          if(body.operations.some(op=>prohibited(op.data))){rejected++;throw new HomeApiError(400,'PRIVATE_DATA_NOT_SYNCABLE','PRIVATE_DATA_NOT_SYNCABLE');}
          accepted+=body.operations.length;
          return {results:body.operations.map(op=>({opId:op.opId,status:'applied',record:{collection:op.collection,id:op.id,version:op.baseVersion+1,data:op.kind==='delete'?null:op.data,deleted:op.kind==='delete'}}))};
        };
        await sync.sync();
        const after=await sync.db.list('repositories');
        if(analysisBefore!==await digest(after.map(row=>[row.id,row.data?.ai_details,row.data?.custom_description])))throw Error('Business analysis/personal fields changed');
        const unresolved=(await sync.db.pending()).length;
        if(unresolved||sync.view.status!=='synced')throw Error('Copied profile did not drain safely');
        const lineage=await sync.db.metadata('repositoryProjectionRepair');
        const count=aiTaskJournal.snapshot().length;
        for(let i=0;i<20;i++)await sync.sync();
        if(aiTaskJournal.snapshot().length!==count)throw Error('No-op polls created tasks');
        reports.push({pendingBefore:pending.length,legacyRepositories:hasTokens,inFlightBefore:frozen.operations.length,rejected,accepted,calls,noOpPolls:20,noOpTasks:0,remaining:unresolved,businessFieldsPreserved:true,lineageEntries:lineage?.lineage.length||0,
          projections:after.map(row=>row.data)});
        sync.stop();
      }
      await aiTaskJournal.flush(String(owner));
      return reports;
    })()`);
    for (const row of report) { for (const data of row.projections) validateData(data); delete row.projections; }
    assert.ok(report.length > 0); assert.ok(report.some(row => row.legacyRepositories > 0 && row.rejected === 1 && row.lineageEntries > 0));
    const evidence = { copiedProfile: true, network: serverURL ? 'contained-loopback-only' : 'blocked', productionHomeSync: true, actualSyncRouterAndSQLite: !!serverURL, serverPrivacyValidator: true, reports: report };
    fs.writeFileSync(path.join(workspace, serverURL ? 'home-server-result.json' : 'home-profile-result.json'), JSON.stringify(evidence, null, 2));
    console.log(JSON.stringify(evidence)); window.destroy(); clearTimeout(watchdog); app.exit(0);
  } catch (error) { console.error(error.message); window?.destroy(); clearTimeout(watchdog); app.exit(1); }
});
