// An unpacked Windows build with a contained test entry; production main/preload
// and renderer are loaded unchanged from the package, with all outbound I/O denied.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../..');
const output = process.env.GSM_PACKAGED_SMOKE_ROOT ? path.resolve(process.env.GSM_PACKAGED_SMOKE_ROOT) : path.join(root, 'output/reliability');
if (![path.join(root, 'output/reliability'), path.join(root, 'output/agy-recovery-acceptance')].includes(output)) throw Error('Explicit owned output required');
const run = process.env.GSM_PACKAGED_SMOKE_RUN || '';
if (run && !/^[\w-]{1,40}$/.test(run)) throw Error('Invalid fixture run id');
const executable = path.join(output, `package${run ? '-' + run : ''}/win-unpacked/GitHub Stars Manager.exe`);
const archive = path.join(output, `package${run ? '-' + run : ''}/win-unpacked/resources/app.asar`);
const unpacked = path.join(output, `packaged-smoke-input${run ? '-' + run : ''}`);
const profile = path.join(output, 'packaged-smoke-profile-' + Date.now());
function copyDirectory(source, target) {
  fs.mkdirSync(target, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name), to = path.join(target, entry.name);
    if (entry.isDirectory()) copyDirectory(from, to);
    else if (entry.isFile()) fs.copyFileSync(from, to);
    else throw Error('Unexpected link in renderer build: ' + entry.name);
  }
}
async function main() {
  if (!process.env.GSM_ASAR_MODULE) throw Error('Use the installed builder ASAR module');
  const asar = require(process.env.GSM_ASAR_MODULE);
  if (fs.existsSync(profile)) throw Error('Fresh fixture profile required');
  if (process.env.GSM_PACKAGED_SMOKE_INPUT) {
    const source = path.resolve(process.env.GSM_PACKAGED_SMOKE_INPUT);
    if (!source.startsWith(path.join(root, 'release') + path.sep) || fs.existsSync(path.dirname(archive))) throw Error('Fresh copied package required');
    copyDirectory(source, path.dirname(path.dirname(archive)));
  }
  for (const file of ['electron/main.js', 'electron/preload.js', 'electron/agyCallRegistry.js', 'electron/agyDesktop.js', 'electron/agyRuntime.js', 'electron/agyQueue.js']) {
    assert.equal(asar.extractFile(archive, file).equals(fs.readFileSync(path.join(root, file))), true, 'Packaged source mismatch: ' + file);
  }
  console.log('Extracting contained package');
  asar.extractAll(archive, unpacked);
  console.log('Extracted package');
  if (process.env.GSM_PACKAGED_SMOKE_INPUT) {
    const verifyRenderer = relative => {
      const expected = path.join(root, relative), actual = path.join(unpacked, relative);
      assert.deepEqual(fs.readdirSync(actual).sort(), fs.readdirSync(expected).sort(), 'Packaged renderer inventory mismatch: ' + relative);
      for (const entry of fs.readdirSync(expected, { withFileTypes: true })) {
        const file = path.join(relative, entry.name);
        if (entry.isDirectory()) verifyRenderer(file);
        else if (entry.isFile()) assert.equal(fs.readFileSync(path.join(root, file)).equals(fs.readFileSync(path.join(unpacked, file))), true, 'Packaged renderer mismatch: ' + file);
        else throw Error('Unexpected renderer link');
      }
    };
    verifyRenderer('dist');
  } else {
    // Legacy source-only fixture can use a newer renderer than its initial package.
    copyDirectory(path.join(root, 'dist'), path.join(unpacked, 'dist'));
  }
  const metadata = JSON.parse(fs.readFileSync(path.join(unpacked, 'package.json')));
  metadata.main = '.reliability-acceptance.cjs';
  fs.writeFileSync(path.join(unpacked, 'package.json'), JSON.stringify(metadata));
  fs.writeFileSync(path.join(unpacked, metadata.main), `
const {app,session,net,shell,ipcMain}=require('electron');
const path=require('node:path');
const expected=path.resolve(process.env.GSM_PACKAGED_SMOKE_PROFILE||'');
if(!expected.startsWith(${JSON.stringify(output + path.sep)})||!path.basename(expected).startsWith('packaged-smoke-profile-'))throw Error('Explicit isolated profile required');
app.setPath('userData',expected);app.setPath('sessionData',expected);app.setLoginItemSettings=()=>{};
global.reliabilityContainment={attempted:0,paidCalls:0};
const denied=async()=>{global.reliabilityContainment.attempted++;throw Error('PACKAGED_SMOKE_OFFLINE');};
global.fetch=denied;require('undici').fetch=denied;net.fetch=denied;
for(const name of ['http','https']){const mod=require('node:'+name);mod.request=mod.get=()=>{throw Error('PACKAGED_NETWORK_DENIED');};}
require('nodemailer').createTransport=()=>({verify:denied,sendMail:denied,close(){}});
require('./electron/agyRuntime').runAgy=async()=>{global.reliabilityContainment.paidCalls++;throw Error('PAID_CALL_DENIED');};
shell.openExternal=denied;
const handle=ipcMain.handle.bind(ipcMain);ipcMain.handle=(channel,fn)=>handle(channel,(...args)=>{
 if(/^(agy:(probe|start)|webdav-request|mcp:start)/.test(channel))return denied();return fn(...args);
});
app.whenReady().then(()=>session.defaultSession.webRequest.onBeforeRequest((details,callback)=>callback({cancel:!['file:','data:','blob:','plugin-page:'].includes(new URL(details.url).protocol)})));
require('./electron/main.js');
`);
  console.log('Packing contained entry and final renderer');
  await asar.createPackage(unpacked, archive);
  console.log('Launching packaged application');
  let playwright;
  for (const candidate of ['playwright', path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')]) try { playwright = require(candidate); break; } catch { /* next installed runtime */ }
  if (!playwright) throw Error('Playwright unavailable');
  const env = { ...process.env, NODE_ENV: 'production', GSM_PACKAGED_SMOKE_PROFILE: profile };
  for (const key of Object.keys(env)) if (/TOKEN|SECRET|API_KEY|PROXY|ELECTRON_RUN_AS_NODE|GSM_DEV_SERVER_URL/.test(key)) delete env[key];
  const app = await playwright._electron.launch({ executablePath: executable, cwd: root, env, args: [], timeout: 60000 });
  try {
    const page = await app.firstWindow(); await page.waitForFunction(() => !!window.electronAPI?.agy, undefined, { timeout: 30000 });
    const state = await page.evaluate(() => electronAPI.agy.getState());
    assert.equal(state.enabled, false); assert.equal(state.pool.running, 0);
    const details = await app.evaluate(({ app }) => ({ packaged: app.isPackaged, version: app.getVersion(), profile: app.getPath('userData'), containment: global.reliabilityContainment }));
    assert.equal(details.packaged, true); assert.equal(details.profile, profile); assert.equal(details.containment.paidCalls, 0);
    assert.ok(page.url().includes('app.asar/dist/index.html'));
    const recovery = await page.evaluate(async () => {
      const api = electronAPI.agy;
      await api.setSession('packaged-recovery', '7');
      const result = await api.recoveryList('packaged-recovery');
      if (!result.ok || result.value.records.length) throw Error('Recovery IPC not available');
      return ['recoveryList','recoveryRead','recoveryStage','recoveryAck','recoveryDiscard'].every(key => typeof api[key] === 'function');
    });
    assert.equal(recovery, true);
    const bridge = await page.evaluate(async () => {
      const frame = document.createElement('iframe');
      await new Promise(resolve => {frame.onload = resolve;frame.src = 'about:blank';document.body.append(frame);});
      return { host: !!window.electronAPI, isolated: !frame.contentWindow.electronAPI };
    });
    assert.equal(bridge.host, true); assert.equal(bridge.isolated, true);
    const evidence = { packaged: true, platform: 'win32-x64', containedTestEntry: true, productionMain: true, productionPreload: true,
      rendererFromAsar: true, rendererMatchesBuild: !!process.env.GSM_PACKAGED_SMOKE_INPUT, profileIsolated: true, iframeBridgeDenied: bridge.isolated, recoveryIPC: recovery, productionSourcesMatch: true,
      paidCalls: details.containment.paidCalls, appVersion: details.version };
    fs.writeFileSync(path.join(output, 'packaged-result.json'), JSON.stringify(evidence, null, 2)); console.log(JSON.stringify(evidence));
  } finally { await app.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
