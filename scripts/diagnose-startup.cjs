const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const assert = require('node:assert/strict');
const { randomUUID, createHash } = require('node:crypto');
const { assertProfile, removeProfile, stats } = require('./fixtures/render-performance-guards.cjs');
const { summarize } = require('./summarize-render-trace.cjs');
const root = path.resolve(__dirname, '..');
function getPlaywright() {
  for (const name of [process.env.GSM_PLAYWRIGHT_PATH, 'playwright', path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')].filter(Boolean)) {
    try { return require(name); } catch (error) { if (error.code !== 'MODULE_NOT_FOUND') throw error; }
  }
  throw new Error('Existing Playwright runtime required; no install is performed');
}
function fixture() {
  const Module = require('node:module');
  const name = path.join(root, 'scripts/fixtures/render-performance-data.ts');
  const compiled = require('esbuild').transformSync(require('node:fs').readFileSync(name, 'utf8'), { loader: 'ts', format: 'cjs' }).code;
  const module = new Module(name); module._compile(compiled, name);
  const data = module.exports.makeFixture(100);
  return { user: { id: 990001, login: 'anonymous-fixture', name: 'Anonymous', email: null, avatar_url: data.repositories[0].owner.avatar_url },
    githubToken: 'diagnostic-not-a-token', isAuthenticated: true, syncModeConfigured: true, language: 'zh', theme: 'light', repositoryViewMode: 'grid',
    repositories: data.repositories, releases: data.releases, customCategories: data.categories, subcategories: data.groups,
    categoryOrder: data.categories.map(row => row.id), subcategoryOrder: data.groups.map(row => row.id), repositoryOrder: data.repositories.map(row => row.id),
    releaseSubscriptions: [], readReleases: [], backendApiSecret: 'synthetic-only-secret' };
}
const observer = `(() => {
  performance.mark('gsm:diag-operation-start');
  window.gsmStartup = {longTasks: [], idb: []};
  new PerformanceObserver(list => list.getEntries().forEach(row => window.gsmStartup.longTasks.push({start:row.startTime,duration:row.duration}))).observe({type:'longtask',buffered:true});
  const get = IDBObjectStore.prototype.get;
  IDBObjectStore.prototype.get = function(...args) {
    const start = performance.now(), store = this.name, db = this.transaction.db.name;
    const request = get.apply(this, args);
    for (const event of ['success','error']) request.addEventListener(event, () => window.gsmStartup.idb.push({start, duration:performance.now()-start, store,db,event}), {once:true});
    return request;
  };
})();`;
async function run() {
  const requested = process.argv.indexOf('--output');
  const output = path.resolve(requested >= 0 ? process.argv[requested + 1] : path.join(root, 'output/stages4-8/startup'));
  assert.ok(output.startsWith(path.join(root, 'output') + path.sep), 'Output must remain in diagnostic output');
  await fs.mkdir(output, { recursive: true });
  const buildArgument = process.argv.indexOf('--build-dir');
  const buildDir = path.resolve(buildArgument >= 0 ? process.argv[buildArgument + 1] : path.join(output, 'build'));
  assert.ok(buildDir.startsWith(path.join(root, 'output') + path.sep), 'Build must remain in diagnostic output');
  if (!process.argv.includes('--reuse-build')) {
    const { build } = await import('vite');
    await build({ root, configFile: path.join(root, 'vite.config.ts'), build: { outDir: buildDir, emptyOutDir: true, sourcemap: true }, logLevel: 'warn' });
  }
  await fs.writeFile(path.join(buildDir, 'seed.html'), '<!doctype html><html><head><meta charset="utf-8"></head><body>Isolated startup seed</body></html>');
  const preload = await fs.readFile(path.join(root, 'electron/preload.js'), 'utf8');
  await fs.writeFile(path.join(buildDir, 'startup-preload.cjs'), `${preload}\nrequire('electron').webFrame.executeJavaScript(${JSON.stringify(observer)});\n`);
  const data = fixture();
  const workspace = 'startup-fixture';
  const records = [
    ...data.repositories.map(row => ({ collection:'repositories',id:String(row.id),data:row,version:1 })),
    ...data.releases.map(row => ({ collection:'releases',id:String(row.id),data:row,version:1 })),
    {collection:'organization',id:'default',version:1,data:Object.fromEntries(['customCategories','subcategories','subcategoryOrder','categoryOrder','repositoryOrder'].map(key=>[key,data[key]]))},
  ];
  const canonical = new Map(records.map(row=>[`${row.collection}:${row.id}`,row]));
  const receipts = new Map();
  const requests = [], forbidden = [];
  const server = http.createServer((request, response) => {
    const start = performance.now(); const url = new URL(request.url, 'http://fixture.invalid');
    const send = value => { response.setHeader('Content-Type','application/json'); response.setHeader('Access-Control-Allow-Origin','*'); response.setHeader('Access-Control-Allow-Headers','*'); response.end(JSON.stringify(value)); requests.push({path:url.pathname,method:request.method,ms:performance.now()-start}); };
    if (request.method === 'OPTIONS') { response.setHeader('Access-Control-Allow-Origin','*'); response.setHeader('Access-Control-Allow-Headers','*'); response.setHeader('Access-Control-Allow-Methods','GET'); response.end(); return; }
    if (request.method === 'POST' && url.pathname === '/api/sync/v2/operations') {
      let body=''; request.on('data',chunk=>body+=chunk); request.on('end',()=>{
        try {
          const input=JSON.parse(body);
          assert.equal(input.workspaceId,workspace); assert.equal(input.githubUserId,990001);
          assert.ok(Array.isArray(input.operations)&&input.operations.length<=100);
          const results=input.operations.map(op=>{
            assert.ok(['repositories','organization','releases','release_reads','subscriptions','discovery_config','discovery_subscriptions','discovery_reads','discovery_history','discovery_editions'].includes(op.collection));
            if(receipts.has(op.opId))return receipts.get(op.opId);
            const key=`${op.collection}:${op.id}`,previous=canonical.get(key);
            const record={collection:op.collection,id:op.id,data:op.data??null,deleted:op.kind==='delete',version:(previous?.version??0)+1};
            canonical.set(key,record);const result={opId:op.opId,status:'applied',record};receipts.set(op.opId,result);return result;
          });send({results});
        } catch (error) { forbidden.push('invalid-mock-operation:'+error.message); response.writeHead(403);response.end(); }
      });return;
    }
    if (request.method !== 'GET') { forbidden.push(request.method+' '+url.pathname); response.writeHead(403); response.end(); return; }
    if (url.pathname === '/api/health') return send({status:'ok'});
    if (url.pathname === '/api/capabilities') return send({protocolVersion:2,workspace:{id:workspace,githubUserId:990001},github:{configured:false},ai:{configured:false}});
    if (url.pathname === '/api/tasks') return send({tasks:[]});
    if (url.pathname.startsWith('/api/sync/v2/') && (url.searchParams.get('workspaceId') !== workspace || url.searchParams.get('githubUserId') !== '990001')) { forbidden.push('scope:'+url.pathname); response.writeHead(403); response.end(); return; }
    if (url.pathname === '/api/sync/v2/snapshot') { const offset=Number(url.searchParams.get('offset')||0); return send({records:records.slice(offset,offset+200),cursor:0,snapshotId:'fixture',nextOffset:offset+200,hasMore:offset+200<records.length}); }
    if (url.pathname === '/api/sync/v2/changes') return send({records:[],cursor:0,hasMore:false});
    forbidden.push('endpoint:'+url.pathname); response.writeHead(403); response.end();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const mockOrigin = `http://127.0.0.1:${server.address().port}`;
  const report = {createdAt:new Date().toISOString(), fixture:{repositories:100,releases:200,categories:2,groups:5}, mode:'ordinary production/file-origin', viewport:[1200,800], samples:[], errors:[], forbidden, requests,
    methodology:'New seeded profile first process versus same profile normal-exit restart; OS cache not controlled. Observer preload overhead is included, trace setup reported separately. Mock Home timing is not real backend latency.',
    machine:{platform:process.platform,arch:process.arch,cpus:os.cpus().map(row=>row.model),memoryBytes:os.totalmem()}, bundleHash:createHash('sha256').update(await fs.readFile(path.join(buildDir,'index.html'))).digest('hex')};
  const profiles = [];
  const launch = async (profile, seedOnly=false) => {
    const env = {...process.env,NODE_ENV:'production',GSM_DESKTOP_LAUNCHER:'1',GSM_DIAG_PROFILE:profile,GSM_DIAG_BUILD:buildDir,GSM_STARTUP_MOCK_ORIGIN:mockOrigin,GSM_STARTUP_SEED_ONLY:seedOnly?'1':'0',GSM_DIAG_DESKTOP:process.argv.includes('--desktop-only')?'1':'0'};
    for (const key of Object.keys(env)) if (/TOKEN|SECRET|API_KEY|PROXY|ELECTRON_RUN_AS_NODE|GSM_DEV_SERVER_URL/.test(key)) delete env[key];
    return getPlaywright()._electron.launch({executablePath:require('electron'),cwd:root,env,args:[path.join(root,'scripts/fixtures/startup-electron.cjs'),`--user-data-dir=${profile}`],timeout:60000});
  };
  const seed = async (profile, value, configured=true) => {
    const app = await launch(profile,true);
    try {
      assert.equal(path.resolve(await app.evaluate(({app})=>app.getPath('userData'))),profile);
      const page = await app.firstWindow();
      await page.evaluate(async ({value,backend})=>{
        if (backend) localStorage.setItem('github-stars-manager-backend-url',backend);
        if (value) await new Promise((resolve,reject)=>{
          const open=indexedDB.open('github-stars-manager-db',1);
          open.onupgradeneeded=()=>open.result.createObjectStore('app_state');
          open.onerror=()=>reject(open.error); open.onsuccess=()=>{const tx=open.result.transaction('app_state','readwrite');tx.objectStore('app_state').put(JSON.stringify({version:17,state:value}),'github-stars-manager');tx.oncomplete=()=>{open.result.close();resolve();};tx.onerror=()=>reject(tx.error);};
        });
      },{value,backend:configured?mockOrigin+'/api':null});
    } finally { await app.close(); }
  };
  const measure = async (profile, pair, kind, expected=100) => {
    const launchedAt = performance.now(); const requestStart=requests.length;
    const app = await launch(profile);
    try {
      const page=await app.firstWindow(); page.on('pageerror',error=>report.errors.push(error.message));
      await app.evaluate(({BrowserWindow})=>{const win=BrowserWindow.getAllWindows()[0];win.show();win.focus();win.webContents.closeDevTools();});
      await page.waitForFunction(()=>performance.getEntriesByName('gsm:first-hydrated-frame').length>0,undefined,{timeout:30000});
      if(expected) await page.waitForFunction(()=>performance.getEntriesByName('gsm:home-initialized').length>0,undefined,{timeout:30000});
      await page.evaluate(()=>document.fonts.ready);
      const sample=await page.evaluate(()=>{
        performance.mark('gsm:diag-operation-end');
        return {marks:performance.getEntriesByType('mark').map(row=>({name:row.name,start:row.startTime})),navigation:performance.getEntriesByType('navigation').map(row=>row.toJSON()),resources:performance.getEntriesByType('resource').map(row=>({name:row.name.split('/').at(-1),start:row.startTime,duration:row.duration,initiator:row.initiatorType,bytes:row.encodedBodySize})),...window.gsmStartup,
          cards:document.querySelectorAll('[data-selection-mode]').length,viewport:[innerWidth,innerHeight],dpr:devicePixelRatio,lang:document.documentElement.lang,theme:document.documentElement.className,fontStatus:document.fonts.status,visible:document.visibilityState,focused:document.hasFocus()};
      });
      const runtime=await app.evaluate(({BrowserWindow})=>({versions:process.versions,window:BrowserWindow.getAllWindows()[0].getBounds(),zoom:BrowserWindow.getAllWindows()[0].webContents.getZoomFactor(),startup:global.gsmStartup,guards:global.gsmDiagnosticMain}));
      const traceFile=path.join(output,`${pair}-${kind}.trace.json`);
      await app.evaluate(async ({contentTracing},target)=>{await contentTracing.stopRecording(target);},traceFile);
      assert.deepEqual(sample.viewport,[1200,800]); assert.equal(sample.visible,'visible'); assert.equal(sample.focused,true);
      assert.equal(runtime.guards.profile,profile); assert.deepEqual(runtime.guards.forbidden,[]);
      const mark=name=>sample.marks.find(row=>row.name===name)?.start;
      const row={pair,kind,processToCollectedMs:performance.now()-launchedAt,firstHydratedFrameMs:mark('gsm:first-hydrated-frame'),hydrationMs:mark('gsm:store-hydrated')-mark('gsm:store-hydration-start'),backendMs:mark('gsm:backend-initialize-finished')-mark('gsm:backend-initialize-start'),homeInitializedMs:mark('gsm:home-initialized')??null,...sample,runtime:{...runtime,guards:{blocked:runtime.guards.blocked}},requests:requests.slice(requestStart),trace:path.basename(traceFile)};
      row.cpu=summarize(traceFile,buildDir); report.samples.push(row); await fs.writeFile(path.join(output,'baseline.json'),JSON.stringify(report,null,2));
      console.log(JSON.stringify({pair,kind,firstFrame:row.firstHydratedFrameMs,hydration:row.hydrationMs,home:row.homeInitializedMs,cards:row.cards}));
    } finally { await app.close(); }
  };
  try {
    if (process.argv.includes('--desktop-only')) {
      assert.equal(process.platform,'win32','Windows contract validation only');
      const profile=assertProfile(path.join(os.tmpdir(),`gsm-render-diag-desktop-${randomUUID()}`));profiles.push(profile);
      const value=fixture();value.backendApiSecret=null;await seed(profile,value,false);
      const app=await launch(profile);
      try {
        const page=await app.firstWindow();await page.waitForSelector('[data-selection-mode]');
        const states=[];
        const record=async name=>{states.push({name,...await app.evaluate(()=>global.gsmDesktopDiagnostic.state())});await fs.writeFile(path.join(output,'desktop.json'),JSON.stringify({states,complete:false},null,2));};
        await app.evaluate(({BrowserWindow})=>{const win=BrowserWindow.getAllWindows()[0];win.show();win.focus();});
        await page.waitForFunction(()=>document.hasFocus()); await record('visible-focused');
        await app.evaluate(()=>global.gsmDesktopDiagnostic.clickTray());await record('focused-click-hidden');
        assert.equal(states.at(-1).visible,false);
        await app.evaluate(()=>global.gsmDesktopDiagnostic.clickTray());await page.waitForFunction(()=>document.hasFocus());await record('hidden-click-restored');
        assert.equal(states.at(-1).visible,true);
        await app.evaluate(async ({BrowserWindow},file)=>{global.gsmFocusHelper=new BrowserWindow({width:300,height:200,show:true});await global.gsmFocusHelper.loadFile(file);global.gsmFocusHelper.focus();},path.join(buildDir,'seed.html'));
        await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(win=>win!==global.gsmFocusHelper).blur());
        await record('unfocused-attempt');
        if(!states.at(-1).focused){
          await app.evaluate(()=>global.gsmDesktopDiagnostic.clickTray());await record('unfocused-click-request');
          await record('unfocused-click-focused');
          assert.equal(states.at(-1).visible,true);assert.equal(states.at(-1).focused,true);
        }else{states.push({name:'unfocused-case',status:'not-verified',reason:'Native helper focus/blur did not reliably remove main window focus in this desktop session.'});}
        await app.evaluate(()=>global.gsmFocusHelper.destroy());
        await app.evaluate(({BrowserWindow})=>{global.gsmDesktopDiagnostic.preference('minimizeToTray',false);BrowserWindow.getAllWindows()[0].minimize();});
        await app.evaluate(async ({BrowserWindow})=>{const win=BrowserWindow.getAllWindows()[0];for(let i=0;i<50&&!win.isMinimized();i++)await new Promise(resolve=>setTimeout(resolve,20));});
        await record('minimized');assert.equal(states.at(-1).minimized,true);
        await app.evaluate(()=>global.gsmDesktopDiagnostic.clickTray());await page.waitForFunction(()=>document.hasFocus());await record('minimized-click-restored');
        assert.equal(states.at(-1).minimized,false);assert.equal(states.at(-1).visible,true);
        const query=await app.evaluate(()=>global.gsmDesktopDiagnostic.session('query-session-end'));
        assert.deepEqual(query,{prevented:false,quitting:false});
        const end=await app.evaluate(()=>global.gsmDesktopDiagnostic.session('session-end'));
        assert.deepEqual(end,{prevented:false,quitting:true});
        const guards=await app.evaluate(()=>global.gsmDiagnosticMain);assert.deepEqual(guards.forbidden,[]);
        await fs.writeFile(path.join(output,'desktop.json'),JSON.stringify({complete:true,states,query,end,versions:await app.evaluate(()=>process.versions),guards,methodology:'Real Windows isolated Electron window state; JS-emitted tray/session events, not actual Shell clicks or OS shutdown.'},null,2));
      } finally {await app.close();}
      return;
    }
    if (process.argv.includes('--visual-only')) {
      const profile=assertProfile(path.join(os.tmpdir(),`gsm-render-diag-visual-${randomUUID()}`));profiles.push(profile);
      const visualData=fixture(); visualData.backendApiSecret=null;
      visualData.repositories[0].language='JavaScript'; visualData.repositories[1].language='Shell';
      await seed(profile,visualData,false);
      const app=await launch(profile);
      try {
        const page=await app.firstWindow(); page.on('pageerror',error=>report.errors.push(error.message));
        await app.evaluate(({BrowserWindow})=>{const win=BrowserWindow.getAllWindows()[0];win.show();win.focus();win.webContents.closeDevTools();});
        await page.waitForSelector('[data-selection-mode]'); await page.evaluate(()=>document.fonts.ready);
        const capture=async name=>{
          await page.screenshot({path:path.join(output,`${name}.png`)});
          report.samples.push(await page.evaluate(name=>({name,theme:document.documentElement.className,cards:document.querySelectorAll('[data-selection-mode]').length,
            languages:[...document.querySelectorAll('[data-selection-mode]')].slice(0,2).map(card=>{const label=[...card.querySelectorAll('span')].find(el=>['JavaScript','Shell'].includes(el.textContent)&&el.children.length===0);const dot=label?.previousElementSibling;return {language:label?.textContent,dot:dot?{background:getComputedStyle(dot).backgroundColor,outline:getComputedStyle(dot).outline,rect:dot.getBoundingClientRect().toJSON()}:null,cardBackground:getComputedStyle(card).backgroundColor};}),
            focus:document.activeElement?.getAttribute('aria-label'),transition:getComputedStyle(document.querySelector('[data-selection-mode]')).transitionDuration,buttons:[...document.querySelectorAll('button')].map(el=>el.getAttribute('aria-label')||el.textContent).filter(Boolean),viewport:[innerWidth,innerHeight]}),name));
        };
        await capture('light');
        await page.getByRole('button',{name:/切换主题|Toggle theme/i}).click(); await capture('dark');
        const card=page.locator('[data-selection-mode]').first(); await card.focus(); await capture('keyboard-focus');
        assert.equal(await card.evaluate(el=>el===document.activeElement),true);
        await card.press('Enter'); await page.getByRole('dialog',{name:'仓库详情'}).waitFor();
        await page.keyboard.press('Escape');await page.getByRole('dialog',{name:'仓库详情'}).waitFor({state:'hidden'});
        await card.getByRole('button',{name:'选择',exact:true}).click();
        await card.getByRole('button',{name:'取消选择',exact:true}).waitFor();
        await card.getByRole('button',{name:'取消选择',exact:true}).click();
        await card.getByRole('button',{name:'选择',exact:true}).waitFor();
        assert.ok(await card.locator('[draggable="true"]').count());
        report.interactions={keyboardDetailsAndEscape:true,selectionRoundtrip:true,dragHandlePresent:true};
        await page.emulateMedia({reducedMotion:'reduce'}); await capture('os-reduced-motion');
        assert.ok(parseFloat(report.samples.at(-1).transition)<0.01);
        report.runtime=await app.evaluate(()=>({versions:process.versions,guards:global.gsmDiagnosticMain}));
        assert.deepEqual(report.runtime.guards.forbidden,[]); assert.deepEqual(forbidden,[]);
      } finally {await app.close();}
      const reducedProfile=assertProfile(path.join(os.tmpdir(),`gsm-render-diag-visual-${randomUUID()}`));profiles.push(reducedProfile);
      await seed(reducedProfile,{...visualData,themeTokens:{animation:'reduced'}},false);
      const reducedApp=await launch(reducedProfile);
      try {
        const page=await reducedApp.firstWindow();await page.waitForSelector('[data-selection-mode]');await page.emulateMedia({reducedMotion:'no-preference'});
        const token=await page.evaluate(()=>({animation:document.documentElement.dataset.animation,transition:getComputedStyle(document.querySelector('[data-selection-mode]')).transitionDuration}));
        assert.equal(token.animation,'reduced');assert.ok(parseFloat(token.transition)<0.01);report.tokenReducedMotion=token;
        await page.screenshot({path:path.join(output,'token-reduced-motion.png')});
        assert.deepEqual((await reducedApp.evaluate(()=>global.gsmDiagnosticMain)).forbidden,[]);
      } finally {await reducedApp.close();}
      await fs.writeFile(path.join(output,'visual.json'),JSON.stringify(report,null,2));
      return;
    }
    for(let pair=0;pair<3;pair++){
      const profile=assertProfile(path.join(os.tmpdir(),`gsm-render-diag-startup-${randomUUID()}`));profiles.push(profile);await seed(profile,data);
      await measure(profile,pair,'first');await measure(profile,pair,'restart');
    }
    const empty=assertProfile(path.join(os.tmpdir(),`gsm-render-diag-startup-${randomUUID()}`));profiles.push(empty);await seed(empty,null,false);await measure(empty,'empty','first-use',0);
    report.summary=Object.fromEntries(['first','restart'].map(kind=>[kind,Object.fromEntries(['firstHydratedFrameMs','hydrationMs','homeInitializedMs'].map(key=>[key,stats(report.samples.filter(row=>row.kind===kind).map(row=>row[key]))]))]));
    assert.deepEqual(forbidden,[]); await fs.writeFile(path.join(output,'baseline.json'),JSON.stringify(report,null,2));
  } finally { await new Promise(resolve=>server.close(resolve)); await Promise.all(profiles.map(removeProfile)); }
}
if (require.main===module) run().catch(error=>{console.error(error);process.exitCode=1;});
module.exports={fixture};
