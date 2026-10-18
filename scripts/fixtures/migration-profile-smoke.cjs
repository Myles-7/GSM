const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../..');
const reliability=process.env.GSM_SMOKE_SUITE==='reliability';
const output=path.join(root,reliability?'output/reliability/profile-smoke':'output/v086-continuation/app-profile-smoke');
const before=process.argv.includes('--before');
const source=before?'D:/桌面/GSM-recovery/v0.8.6-before-source-00a054a5':root;
const label=before?'before':'after';
const profile=path.join(output,label+'-profile-'+Date.now()),build=path.join(output,label+'-build');
const backup=reliability?process.env.GSM_SMOKE_BACKUP:path.join(fs.readFileSync(path.join(root,'output/v086-continuation/backup-path.txt'),'utf8').trim(),'userData');
if(!backup||!path.isAbsolute(backup)||!fs.existsSync(path.join(backup,'IndexedDB')))throw Error('A verified stopped-profile copy is required');
fs.mkdirSync(output,{recursive:true});
if(fs.existsSync(profile))throw Error('Smoke profile must be a fresh copy: '+label);
function copyDirectory(from,to){fs.mkdirSync(to,{recursive:true});for(const entry of fs.readdirSync(from,{withFileTypes:true})){const sourcePath=path.join(from,entry.name),targetPath=path.join(to,entry.name);if(entry.isDirectory())copyDirectory(sourcePath,targetPath);else if(entry.isFile())fs.copyFileSync(sourcePath,targetPath);else throw Error('Unexpected link in stopped profile');}}
copyDirectory(backup,profile);
const renderer=`
import React from 'react'; import {createRoot} from 'react-dom/client';
import {useAppStore as store} from '/src/store/useAppStore';
import {flushAppStorePersistence as flush} from '/src/store/persistence/storage';
import {captureAccountWorkspace as capture} from '/src/store/helpers/accountWorkspace';
import {Modal} from '/src/components/Modal';import {SettingsPanel} from '/src/components/SettingsPanel';
import {DialogProvider} from '/src/hooks/useDialog';
import {generateReadingSnapshot} from '/src/services/htmlReading';
import {defaultSettings,parseReadingReturn} from '/src/lib/html-reading/model';
import {applyReadingReturn,loadReadingData} from '/src/lib/html-reading/storage';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const canonical=v=>v instanceof Set?[...v].sort():Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b)).map(([k,x])=>[k,canonical(x)])):v;
const digest=async v=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(canonical(v))))),b=>b.toString(16).padStart(2,'0')).join('');
const frames=()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
const host=document.createElement('div');document.body.append(host);const view=createRoot(host);
const records=[];const put=IDBObjectStore.prototype.put;const stringify=JSON.stringify;
let measuring=null;
IDBObjectStore.prototype.put=function(value,key){if(measuring&&this.name==='app_state')measuring.writes.push({bytes:new TextEncoder().encode(typeof value==='string'?value:stringify(value)).length,repositoryShard:String(key).includes('repositories')});return put.call(this,value,key);};
JSON.stringify=function(value,...args){const start=performance.now();const result=stringify.call(this,value,...args);if(measuring&&(Array.isArray(value?.state?.repositories)||Array.isArray(value?.repositories))){measuring.fullStoreSerializations++;measuring.stringifyMs+=performance.now()-start;}return result;};
async function measure(name,operation){await flush();await sleep(80);const row={name,writes:[],fullStoreSerializations:0,stringifyMs:0};measuring=row;const started=performance.now();await operation();await frames();row.paintOpportunityMs=performance.now()-started;await flush();row.flushMs=performance.now()-started;measuring=null;records.push(row);}
window.migrationSmoke={store,ready:()=>store.persist.hasHydrated(),digest,frames,
 async performance(){await flush();const mode=store.getState().repositoryViewMode;
  for(let i=0;i<3;i++){
   await measure('modal-open-close',async()=>{store.getState().setReadmeModalOpen(true);view.render(<Modal isOpen title="Migration smoke" onClose={()=>{}}><p>Local verification</p></Modal>);await frames();view.render(null);store.getState().setReadmeModalOpen(false);});
   await measure('repository-grid-list',async()=>store.getState().setRepositoryViewMode(store.getState().repositoryViewMode==='grid'?'list':'grid'));
   view.render(<DialogProvider><SettingsPanel isOpen isModal onClose={()=>{}}/></DialogProvider>);await frames();
   await measure('settings-tab',async()=>{const tabs=[...document.querySelectorAll('[role=tab]')];(tabs.find(t=>/appearance|外观/i.test(t.textContent))||tabs[1])?.click();await frames();});view.render(null);await frames();
  }store.getState().setRepositoryViewMode(mode);await flush();return records;},
 async business(){const original=store.getState(),account=String(original.user?.id||'');if(!account)throw Error('Profile account unavailable');
  const before=await digest(capture(original));
  original.setUser({id:987654321,login:'migration-smoke-local'});if(store.getState().repositories.length)throw Error('Foreign account inherited repositories');
  store.getState().setUser(original.user);if(await digest(capture(store.getState()))!==before)throw Error('Account A-B-A business mismatch');
  const repo=store.getState().repositories[0];const repoHash=await digest(repo);store.getState().updateRepository({...repo,custom_description:'Local copied-profile edit'});if(store.getState().repositories[0].custom_description!=='Local copied-profile edit')throw Error('Edit failed');store.getState().updateRepository(repo);
  if(await digest(store.getState().repositories[0])!==repoHash)throw Error('Edit roundtrip mismatch');
  const reading=await generateReadingSnapshot({...defaultSettings,repositories:true,discovery:false,categoryIds:[],channelIds:[]});
  const first=Object.values(reading.snapshot.items||{})[0];if(!first)throw Error('Reading export empty');
  const operation={id:crypto.randomUUID(),repoId:first.id,field:'note',base:first.state.note,value:'Copied profile reading return'};
  const returned=parseReadingReturn(JSON.stringify({format:'gsm-reading-changes',version:1,accountId:account,snapshotId:reading.snapshot.id,operations:[operation]}));
  await applyReadingReturn(account,returned,{});const data=await loadReadingData(account,{includeSnapshots:false});if(data.states[first.id]?.note!==operation.value)throw Error('Reading return failed');
  await flush();return {accountRoundtrip:true,editRoundtrip:true,readingReturn:true,readingHtml:reading.html};},
 async privacy(){const state=store.getState(),needles=[];function collect(v,k=''){if(typeof v==='string'&&v.length>=8&&/token|password|apiKey|secret/i.test(k))needles.push(v);else if(v&&typeof v==='object')for(const [key,value]of Object.entries(v))collect(value,key);}collect(state);
  for(const repo of state.repositories){if(repo.private)for(const key of ['description','custom_description','ai_summary'])if(repo[key]?.length>=24)needles.push(repo[key]);}
  const bundle=await electronAPI.diagnostics.exportBundle({limit:5000});const text=JSON.stringify(bundle);if(needles.some(secret=>text.includes(secret)))throw Error('Diagnostics contains private value');return {checkedSensitiveValues:needles.length,entries:bundle.entries?.length??bundle.logs?.length??0,clean:true};},
 count:()=>store.getState().repositories.length,
};
`;
async function main(){
 const vite=await import('vite'),react=(await import('@vitejs/plugin-react')).default;
 const fingerprint=require('node:crypto').createHash('sha256').update(renderer);function scan(directory){for(const entry of fs.readdirSync(directory,{withFileTypes:true})){const file=path.join(directory,entry.name);if(entry.isDirectory())scan(file);else if(/\.(tsx?|css|json)$/.test(file)&&!file.includes('.test.'))fingerprint.update(fs.readFileSync(file));}}scan(path.join(source,'src'));fingerprint.update(fs.readFileSync(path.join(root,'package-lock.json')));const hash=fingerprint.digest('hex'),stamp=path.join(build,'smoke-source.sha256');
 if(!fs.existsSync(stamp)||fs.readFileSync(stamp,'utf8')!==hash){await vite.build({root:source,configFile:false,base:'./',plugins:[react(),{name:'migration-instrument',enforce:'pre',transform(code,id){if(id.replaceAll('\\','/').endsWith('/src/main.tsx'))return code+'\nimport("virtual:migration-smoke");';},resolveId(id){if(id==='virtual:migration-smoke')return '\0migration-smoke';},async load(id){if(id==='\0migration-smoke')return (await vite.transformWithEsbuild(renderer,'migration-smoke.tsx',{loader:'tsx',jsx:'automatic'})).code;}}],
  build:{outDir:build,emptyOutDir:true,minify:false,target:'chrome140',rollupOptions:{output:{manualChunks(id){if(id.includes('node_modules/react-dom')||id.includes('node_modules/react/'))return 'react-vendor';}}}},logLevel:'error'});fs.writeFileSync(stamp,hash);}
 let playwright;for(const candidate of ['playwright',path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')]){try{playwright=require(candidate);break;}catch{}}
 if(!playwright)throw Error('Bundled Playwright unavailable');
 const env={...process.env,NODE_ENV:'production',GSM_MIGRATION_PROFILE:profile,GSM_MIGRATION_BUILD:build,GSM_DESKTOP_LAUNCHER:'1'};
 for(const key of Object.keys(env))if(/TOKEN|SECRET|API_KEY|PROXY|ELECTRON_RUN_AS_NODE|GSM_DEV_SERVER_URL/.test(key))delete env[key];
 const app=await playwright._electron.launch({executablePath:require('electron'),cwd:root,env,args:[path.join(__dirname,'migration-profile-electron.cjs')],timeout:60000});
 try{
  const page=await app.firstWindow();page.on('pageerror',error=>console.error('Renderer error:',error.message));
  page.on('console',message=>{if(message.type()==='error')console.error('Renderer console:',message.text().slice(0,500));});
  await app.evaluate(({BrowserWindow})=>{const win=BrowserWindow.getAllWindows()[0];win.setContentSize(1400,950);win.showInactive();win.webContents.setBackgroundThrottling(false);});
  await page.waitForFunction(()=>window.migrationSmoke?.ready(),undefined,{timeout:60000});
  const report={label,realApp:true,realMain:true,copiedProfile:true,repositories:await page.evaluate(()=>migrationSmoke.count()),performance:await page.evaluate(()=>migrationSmoke.performance())};
  fs.writeFileSync(path.join(output,label+'-result.json'),JSON.stringify(report,null,2));
  if(reliability)assert.ok(report.repositories>0);else assert.equal(report.repositories,369);
  assert.equal(report.performance.length,9);
  if(!before)for(const row of report.performance){assert.equal(row.fullStoreSerializations,0);assert.equal(row.writes.some(write=>write.repositoryShard),false);}
  if(!before){
   const business=await page.evaluate(()=>migrationSmoke.business());if(!reliability)fs.writeFileSync(path.join(output,'private-reading.html'),business.readingHtml);delete business.readingHtml;report.business=business;
   report.mcp=await page.evaluate(async()=>({reachable:!!await electronAPI.mcp.getStatus()}));
   report.webdav=await page.evaluate(()=>({configured:migrationSmoke.store.getState().webdavConfigs.length>0,scope:'Saved configuration inspected; transport covered by separate read-only native fixture'}));
   report.marketplace=await page.evaluate(async()=>{const response=await electronAPI.plugins.marketplace.addSource({url:'https://github.com/AmintaCCCP/GithubStarsManager/tree/6a69d60a7486eaea580e0b0e40260f43773b73de/examples/plugins'});if(!response.success)throw Error('Marketplace fixture source failed');const plugins=response.state.entries.flatMap(entry=>entry.plugins);if(plugins.length!==2)throw Error('Marketplace fixture catalog incomplete');return {reachable:true,plugins:plugins.length,fixture:true};});
   report.plugins=[];
   for(const directory of ['repo-info-card','repo-insights']){
    const manifest=JSON.parse(fs.readFileSync(path.join(root,'examples/plugins',directory,'manifest.json')));
    const result=await page.evaluate(async({id,permissions,pageId})=>{const api=electronAPI.plugins;await api.disable(id);const removed=await api.uninstall(id,false);const installed=await api.installFromDirectory();if(!installed.success)throw Error('Install failed: '+installed.error?.code+' after remove '+removed.error?.code);const enabled=await api.enable(id,permissions);if(!enabled.success)throw Error('Enable failed: '+enabled.error?.code);const page=await api.getPage(id,pageId);if(!page.success)throw Error('Page failed');await api.disable(id);const uninstalled=await api.uninstall(id,false);return {installed:true,enabled:true,page:true,disabled:true,uninstalled:uninstalled.success};},{id:manifest.id,permissions:manifest.permissions,pageId:manifest.contributes.pages[0].id});
    report.plugins.push(result);assert.equal(result.uninstalled,true);
   }
   report.privacy=await page.evaluate(()=>migrationSmoke.privacy());
   const diagnostics=await page.evaluate(()=>electronAPI.diagnostics.exportBundle({limit:5000}));
   assert.equal(diagnostics.version,2);assert.ok(Array.isArray(diagnostics.entries));
   if(!reliability)fs.writeFileSync(path.join(output,'private-diagnostics.json'),JSON.stringify(diagnostics,null,2));
  }
  report.containment=await app.evaluate(()=>global.migrationContainment);
  fs.writeFileSync(path.join(output,label+'-result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({label,repositories:report.repositories,business:report.business,privacy:report.privacy,performance:report.performance.map(r=>({name:r.name,bytes:r.writes.reduce((n,w)=>n+w.bytes,0),fullStoreSerializations:r.fullStoreSerializations}))}));
 }finally{await app.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
