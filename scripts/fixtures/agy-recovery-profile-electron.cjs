// Read and restore task metadata only in an explicit stopped-profile COPY.
// All network and provider execution are denied; original profile is never opened.
const { app, BrowserWindow, ipcMain, session, safeStorage } = require('electron');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '../..');
const scratch = path.resolve(process.env.GSM_AGY_PROFILE_SCRATCH || '');
if (scratch !== path.join(root, 'output/agy-recovery-acceptance')) throw Error('Explicit owned scratch required');
const profile = path.join(scratch, 'profile');
if (!fs.existsSync(path.join(profile, 'IndexedDB'))) throw Error('Stopped copied profile required');
app.setPath('userData', profile); app.setPath('sessionData', profile);
let paidCalls = 0;
const runtime = require('../../electron/agyRuntime');
runtime.runAgy = async () => { paidCalls++; throw Error('PAID_CALL_FORBIDDEN'); };
global.fetch = async () => { throw Error('NETWORK_FORBIDDEN'); };
const { createAgyDesktop } = require('../../electron/agyDesktop');
const { registerAgyIpc } = require('../../electron/agyIpc');
const { isTrustedMainFrame } = require('../../electron/trustedRenderer');
const watchdog = setTimeout(() => app.exit(1), 30000);
app.whenReady().then(async () => {
  let window, service;
  try {
    session.defaultSession.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !['file:', 'data:'].includes(new URL(details.url).protocol) }));
    const bundle = await require('esbuild').build({ stdin: { contents: `export {readFullPersistedSnapshot} from './src/store/persistence/storage';export {aiTaskJournal} from './src/services/aiTaskJournal';`, resolveDir: root },
      bundle: true, write: false, format: 'iife', globalName: 'recoveryProfile', platform: 'browser', target: 'es2022',
      plugins: [{ name: 'sanitized-load-failure', setup(build) {
        // This data-only esbuild fixture has no Vite locale transform. The
        // packaged renderer acceptance separately exercises real locale chunks.
        build.onLoad({ filter: /i18n[\\/]index\.ts$/ }, args => ({ loader: 'ts', contents: fs.readFileSync(args.path, 'utf8')
          .replace(/^const localeModules = import\.meta\.glob.*$/m, 'const localeModules = {};') }));
        build.onLoad({ filter: /aiTaskJournal\.ts$/ }, args => ({ loader: 'ts', contents: fs.readFileSync(args.path, 'utf8')
          .replace('})().catch(error => { storageError =', "})().catch(error => { window.__recoveryLoadError = {name:error?.name, message:error instanceof TypeError?error.message:undefined, issues:error?.issues?.map(issue=>({path:issue.path,code:issue.code}))}; storageError =") }));
      } }] });
    const host = path.join(scratch, 'host.html'); fs.writeFileSync(host, '<!doctype html><title>AGY copied profile acceptance</title>');
    service = createAgyDesktop({ userDataPath: profile, safeStorage });
    window = new BrowserWindow({ show: false, webPreferences: { preload: path.join(root, 'electron/preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
    registerAgyIpc({ ipcMain, isMainFrame: event => isTrustedMainFrame(event, window, pathToFileURL(host).href, false), getService: () => service });
    await window.loadFile(host);
    await window.webContents.executeJavaScript(bundle.outputFiles[0].text);
    const evidence = await window.webContents.executeJavaScript(`(async()=>{
      const {readFullPersistedSnapshot,aiTaskJournal}=recoveryProfile;
      const before=await readFullPersistedSnapshot('github-stars-manager');
      const owner=String(before?.state?.user?.id||'');if(!owner)throw Error('Missing copied owner');
      const fields=['repositories','categories','subcategories','accountWorkspaces','repositoryCategoryAssignments','classificationSchemes'];
      const digest=async state=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(fields.map(key=>state[key])))))).map(value=>value.toString(16).padStart(2,'0')).join('');
      const baseline=await digest(before.state);
      await aiTaskJournal.load(owner);if(aiTaskJournal.storageError())throw Error(aiTaskJournal.storageError()+JSON.stringify(window.__recoveryLoadError));
      const tasks=aiTaskJournal.snapshot().filter(task=>task.owner===owner&&task.location!=='server');
      if(tasks.some(task=>task.items.some(item=>item.providerOutcome==='in_flight')))throw Error('Stale in_flight after restore');
      if(tasks.some(task=>['running','queued','committing'].includes(task.state)))throw Error('Unowned active task after restore');
      await aiTaskJournal.flush(owner);
      const after=await readFullPersistedSnapshot('github-stars-manager');
      if(baseline!==await digest(after.state))throw Error('Business fields changed');
      return {copiedProfile:true,storeVersion:after.version,repositories:after.state.repositories.length,taskRecords:tasks.length,
        businessFieldsPreserved:true,unknownCallsReplayed:0,conservativeRecovery:true};
    })()`);
    assert.equal(paidCalls, 0); assert.equal(evidence.storeVersion, 17);
    await service.shutdown(); window.destroy();
    fs.writeFileSync(path.join(scratch, 'profile-result.json'), JSON.stringify({ ...evidence, paidCalls, electron: process.versions.electron }, null, 2));
    console.log(JSON.stringify(evidence)); clearTimeout(watchdog); app.exit(0);
  } catch (error) { console.error(error); await service?.shutdown(); window?.destroy(); clearTimeout(watchdog); app.exit(1); }
});
