'use strict';

// Opt-in isolated real-main/App probe. Never invoke against the normal profile.
const { app, BrowserWindow, session, protocol, clipboard, ClipboardItem, nativeImage, dialog, ipcMain, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { createPluginManager } = require('./plugins/pluginManager');
const {
  readClipboardSnapshot, sameClipboardSnapshot, canRestoreClipboardSnapshot, restoreClipboardSnapshot,
} = require('./plugins/fixtures/clipboardSnapshot.cjs');
const root = path.resolve(__dirname, '..');
function sourceFingerprint() {
  const files = [];
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const filePath = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(filePath);
      else if (/\.(?:[cm]?js|tsx?|html|css|json)$/.test(entry.name) && !/\.test\./.test(entry.name)) files.push(filePath);
    }
  }
  for (const directory of ['src', 'electron', 'examples/plugins']) visit(path.join(root, directory));
  const hash = createHash('sha256');
  for (const filePath of files.sort()) {
    hash.update(path.relative(root, filePath));
    hash.update('\0');
    hash.update(createHash('sha256').update(fs.readFileSync(filePath)).digest());
  }
  return hash.digest('hex');
}
const sourceBefore = sourceFingerprint();
const origin = 'http://127.0.0.1:5174';
const outputRoot = path.join(root, 'output', 'p020-app-smoke');
fs.mkdirSync(outputRoot, { recursive: true });
const output = fs.mkdtempSync(path.join(outputRoot, 'run-'));
const exportsRoot = path.join(output, 'exports');
fs.mkdirSync(exportsRoot);
app.setPath('userData', path.join(output, 'userData'));
app.setPath('sessionData', path.join(output, 'sessionData'));
app.setName('GSM P020 Isolated Smoke');
process.env.NODE_ENV = 'development';
process.env.GSM_DEV_SERVER_URL = origin;
process.env.GSM_DESKTOP_LAUNCHER = '1';
if (!process.argv.includes('--hidden')) process.argv.push('--hidden');
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');

const pluginId = 'com.githubstarsmanager.repo-info-card';
const readmeURL = 'https://api.github.com/repos/fixture/p020/readme';
const readme = '# P020 Fixture README\n\nDeterministic isolated repository. No real account or provider.';
const card = '<div id="card"><h1 class="title">P020 Fixture Card</h1>' +
  '<p class="intro">Verified real App plugin workflow.</p><div class="facts"><div class="fact">' +
  '<span class="label">Stars</span><p class="value">42</p></div></div>' +
  '<script>evil()<\\/script><img src="https://hostile.invalid"><p onclick="evil()">Safe fixture</p></div>';
let phase = 'bootstrap';
let window;
let providerOrigin;
let providerCalls = 0;
let readmeCalls = 0;
let providerSawReadme = false;
let lastPage;
let clipboardMutated = false;
let clipboardSnapshot;
let lastClipboard;
const blocked = new Set();
const pageRequests = [];
const savedFiles = [];
const evidence = { realMain: true, realApp: true, origin, output, fakeAccount: true, liveAI: false, externalWrites: false };
const originalClipboardWriteText = clipboard.writeText.bind(clipboard);
const originalClipboardWrite = clipboard.write.bind(clipboard);
const originalClipboardClear = clipboard.clear.bind(clipboard);
let realClipboardAllowed = false;
const clipboardReadAPI = { clipboard: { read: () => clipboard.read() }, ClipboardItem };
async function readClipboard() { return readClipboardSnapshot(clipboardReadAPI); }
async function assertClipboardOwned() {
  if (!sameClipboardSnapshot(await readClipboard(), lastClipboard || clipboardSnapshot)) {
    clipboardMutated = false;
    realClipboardAllowed = false;
    evidence.clipboardRestore = 'not overwritten: concurrent clipboard change';
    throw new Error('Clipboard changed concurrently; no further writes permitted');
  }
}
function assertPhysicalTypes(snapshot, type) {
  if (snapshot.items.length !== 1 || snapshot.types.length !== 1 || snapshot.types[0] !== type) {
    clipboardMutated = false;
    realClipboardAllowed = false;
    throw new Error('Unexpected physical clipboard types; no restore overwrite permitted');
  }
}
async function restoreClipboard() {
  if (!clipboardMutated) return evidence.clipboardRestore === 'verified all original item/type bytes';
  const restored = await restoreClipboardSnapshot({
    clipboard: {
      clipboard: { read: () => clipboard.read(), write: originalClipboardWrite, clear: originalClipboardClear },
      ClipboardItem,
    },
    original: clipboardSnapshot,
    owned: lastClipboard,
  });
  if (!restored) {
    evidence.clipboardRestore = 'not overwritten: concurrent clipboard change';
    clipboardMutated = false;
    return false;
  }
  clipboardMutated = false;
  lastClipboard = clipboardSnapshot;
  evidence.clipboardRestore = 'verified all original item/type bytes';
  evidence.clipboardAllTypesRestored = true;
  evidence.clipboardRestoreComparison = 'all original items/types: byte lengths and SHA-256';
  return true;
}
clipboard.writeText = async (text) => {
  evidence.copiedHTML = text.includes('P020 Fixture Card') && !/evil|onclick|<script|<img/.test(text);
  if (realClipboardAllowed) {
    await assertClipboardOwned();
    evidence.physicalClipboardAttempted = true;
    await originalClipboardWriteText(text);
    clipboardMutated = true;
    lastClipboard = await readClipboard();
    assertPhysicalTypes(lastClipboard, 'text/plain');
    assert.ok(lastClipboard.bytesByItem[0].get('text/plain').equals(Buffer.from(text)), 'physical copied HTML text bytes must match');
    evidence.physicalHTMLCopied = true;
  }
};
clipboard.write = async (items) => {
  const png = await items[0].getType('image/png');
  const image = nativeImage.createFromBuffer(Buffer.from(await png.arrayBuffer()));
  assert.deepEqual(image.getSize(), { width: 2400, height: 2400 });
  evidence.copiedImage = true;
  if (realClipboardAllowed) {
    await assertClipboardOwned();
    evidence.physicalClipboardAttempted = true;
    try {
      await originalClipboardWrite(items);
      evidence.physicalPNGWriteCompleted = true;
    } catch (error) {
      evidence.physicalPNGFailureStage = 'native-write';
      console.error('Fixture PNG native write failed:', error);
      throw error;
    }
    clipboardMutated = true;
    lastClipboard = await readClipboard();
    assertPhysicalTypes(lastClipboard, 'image/png');
    const physical = nativeImage.createFromBuffer(lastClipboard.bytesByItem[0].get('image/png'));
    evidence.physicalPNGPixelEquality = !physical.isEmpty() && physical.toBitmap().equals(image.toBitmap());
    evidence.physicalPNGSize = physical.getSize();
    assert.ok(!physical.isEmpty() && physical.toBitmap().equals(image.toBitmap()), 'physical clipboard PNG pixels must match');
    evidence.physicalPNGCopied = true;
  }
};
dialog.showSaveDialog = async (_owner, options) => {
  const filePath = path.join(exportsRoot, path.basename(options.defaultPath));
  assert.equal(path.dirname(filePath), exportsRoot);
  savedFiles.push(filePath);
  return { canceled: false, filePath };
};
dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] });
shell.openExternal = async () => { throw new Error('External shell launches disabled in smoke'); };

// Intercept IPC only for observation. All production callbacks still run.
const register = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, handler) => register(channel, async (event, ...args) => {
  const result = await handler(event, ...args);
  if (channel === 'plugins:getPage' && result.success) lastPage = { ...result, pluginId: args[0], pageId: args[1] };
  if (channel === 'plugins:requestPageCapability') pageRequests.push({
    method: args[0]?.method, success: result.success, code: result.error?.code,
  });
  return result;
});
function allowed(urlValue, method = 'GET') {
  try {
    const url = new URL(urlValue);
    if (url.protocol === 'plugin-page:' || url.protocol === 'data:' || url.protocol === 'blob:') return true;
    if (url.origin === origin && method === 'GET' && !url.pathname.startsWith('/api')) return true;
    if (url.protocol === 'ws:' && url.host === '127.0.0.1:5174') return true;
    return !!providerOrigin && url.origin === providerOrigin &&
      ['/v1/chat/completions', '/'].includes(url.pathname) && ['POST', 'OPTIONS'].includes(method);
  } catch { return false; }
}
const originalFetch = globalThis.fetch;
globalThis.fetch = (input, options) => {
  const url = String(input?.url ?? input);
  if (!allowed(url, options?.method ?? 'GET')) {
    blocked.add(new URL(url).origin);
    return Promise.reject(new Error('Network blocked by isolated smoke'));
  }
  return originalFetch(input, options);
};
const undici = require('undici');
const undiciFetch = undici.fetch;
undici.fetch = (input, options) => {
  const url = String(input?.url ?? input);
  if (!allowed(url, options?.method ?? 'GET')) return Promise.reject(new Error('Network blocked by isolated smoke'));
  return undiciFetch(input, options);
};

const provider = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  if (req.method !== 'POST' || req.url !== '/v1/chat/completions') { res.writeHead(404); res.end(); return; }
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 256 * 1024) { res.writeHead(413); res.end(); return; }
  }
  const request = JSON.parse(body);
  assert.equal(request.model, 'p020-fixture-model');
  assert.equal(req.headers.authorization, 'Bearer fixture-only-key');
  providerCalls++;
  providerSawReadme ||= JSON.stringify(request.messages).includes('P020 Fixture README');
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ choices: [{ message: { content: card } }] }));
});

async function js(code) { return window.webContents.executeJavaScript(code); }
async function until(code, label, frame) {
  phase = label;
  for (let attempt = 0; attempt < 250; attempt++) {
    try {
      const value = await (frame ? frame.executeJavaScript(code) : js(code));
      if (value) return value;
    } catch { /* Lazy module and frame readiness are asynchronous. */ }
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  throw new Error(`Timed out: ${label}`);
}
async function click(selector, text) {
  const rect = await js(`(() => {
    const node = Array.from(document.querySelectorAll(${JSON.stringify(selector)}))
      .find(node => ${text ? `node.textContent.trim() === ${JSON.stringify(text)} &&` : ''} node.getBoundingClientRect().width > 0);
    if (!node) throw new Error('Missing target: ' + ${JSON.stringify(text || selector)});
    node.scrollIntoView({block:'center'});
    const rect = node.getBoundingClientRect(); return {x:rect.x+rect.width/2,y:rect.y+rect.height/2};
  })()`);
  window.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(rect.x), y: Math.round(rect.y) });
  window.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', x: Math.round(rect.x), y: Math.round(rect.y), clickCount: 1 });
  window.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', x: Math.round(rect.x), y: Math.round(rect.y), clickCount: 1 });
}
async function screenshot(name) {
  await new Promise((resolve) => setTimeout(resolve, 180));
  const capture = await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true });
  const bitmap = capture.toBitmap();
  const colors = new Set();
  for (let index = 0; index < bitmap.length; index += 400) colors.add(bitmap.subarray(index, index + 3).toString('hex'));
  assert.ok(colors.size > 5, `${name} screenshot must not be blank`);
  fs.writeFileSync(path.join(output, `${name}.png`), capture.toPNG());
}
async function openCard() {
  await until(`!!document.querySelector('button[aria-label="More repository actions"]')`, 'repository card menu');
  await click('button[aria-label="More repository actions"]');
  await until(`Array.from(document.querySelectorAll('[role="menuitem"]')).some(node => node.textContent.trim() === 'Repo Info Card')`, 'Info Card menu action');
  await click('[role="menuitem"]', 'Repo Info Card');
  await until(`!!document.querySelector('iframe[src^="plugin-page:"]')`, 'real plugin modal');
  let frame;
  for (let attempt = 0; attempt < 100; attempt++) {
    frame = window.webContents.mainFrame.frames.find((item) => item.url.startsWith(`plugin-page://${pluginId}/info-card/`));
    if (frame) break;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  assert.ok(frame);
  await until(`typeof token !== 'undefined' && !!token && document.getElementById('repo-name').textContent.includes('p020')`, 'repository init context', frame);
  return frame;
}
async function assertRevoked(page, requestId) {
  const result = await js(`window.electronAPI.plugins.requestPageCapability(${JSON.stringify({
    pluginId, pageId: 'info-card', sessionToken: page.sessionToken, requestId,
    method: 'repositories.get', args: { repositoryId: 420001 },
  })})`);
  assert.equal(result.error?.code, 'PLUGIN_PAGE_CLOSED');
}
let finishing = false;
async function finish(error) {
  if (finishing) return;
  finishing = true;
  clearTimeout(timeout);
  try { await restoreClipboard(); } catch (restoreError) { error ||= restoreError; }
  evidence.physicalClipboardVerified = !!(evidence.physicalHTMLCopied &&
    evidence.physicalPNGCopied && evidence.clipboardAllTypesRestored);
  if (evidence.physicalClipboardAttempted && !evidence.physicalClipboardVerified) {
    error ||= new Error('Physical clipboard acceptance or complete restore did not pass');
  }
  evidence.sourceFingerprintBefore = sourceBefore;
  evidence.sourceFingerprintAfter = sourceFingerprint();
  evidence.sourceStable = evidence.sourceFingerprintBefore === evidence.sourceFingerprintAfter;
  if (!evidence.sourceStable) error ||= new Error('Source files changed during native acceptance; rerun against stable sources');
  evidence.success = !error;
  evidence.phase = phase;
  evidence.providerCalls = providerCalls;
  evidence.providerSawReadme = providerSawReadme;
  evidence.readmeCalls = readmeCalls;
  evidence.savedFiles = savedFiles;
  evidence.blockedOrigins = [...blocked];
  evidence.pageRequests = pageRequests;
  if (error) {
    console.error(error);
    if (window && !window.isDestroyed()) {
      try { await screenshot('failure'); } catch { /* Preserve original failure. */ }
    }
  }
  fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence));
  provider.closeAllConnections();
  provider.close();
  app.exit(error ? 1 : 0);
}
const timeout = setTimeout(() => { void finish(new Error(`Real App smoke timed out: ${phase}`)); }, 120000);

app.whenReady().then(async () => {
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    const localReadme = details.url.split('?')[0] === readmeURL && details.method === 'GET';
    const accept = localReadme || allowed(details.url, details.method);
    if (!accept) { try { blocked.add(new URL(details.url).origin); } catch {} }
    callback({ cancel: !accept });
  });
  protocol.handle('https', (incoming) => {
    assert.equal(incoming.url.split('?')[0], readmeURL);
    readmeCalls++;
    return new Response(JSON.stringify({
      content: Buffer.from(readme).toString('base64'), encoding: 'base64', name: 'README.md',
    }), { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': origin } });
  });
  clipboardSnapshot = await readClipboard();
  assert.ok(sameClipboardSnapshot(clipboardSnapshot, await readClipboard()), 'clipboard snapshot must be stable before mutation');
  realClipboardAllowed = canRestoreClipboardSnapshot(clipboardSnapshot);
  evidence.originalClipboardTypes = clipboardSnapshot.types;
  evidence.systemClipboard = realClipboardAllowed ? 'temporary write with full byte-verified restore' : 'skipped: formats outside trusted native restore set; adapter spy only';
  await new Promise((resolve) => provider.listen(0, '127.0.0.1', resolve));
  providerOrigin = `http://127.0.0.1:${provider.address().port}`;
}).catch((error) => { void finish(error); });

// Prepare before main constructs its stateful manager, not after its initial scan.
const manager = createPluginManager({ pluginsRoot: path.join(app.getPath('userData'), 'plugins') });
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'examples/plugins/repo-info-card/manifest.json'), 'utf8'));
assert.equal(manager.installFromDirectory(path.join(root, 'examples/plugins/repo-info-card')).success, true);
manager.enable(pluginId, manifest.permissions).then((result) => {
  assert.equal(result.success, true);
  manager.shutdown();
  // Production owns windows, preload, IPC and all renderer application code.
  require('./main.js');
}).catch((error) => { void finish(error); });

app.whenReady().then(async () => {
  for (let attempt = 0; attempt < 200; attempt++) {
    window = BrowserWindow.getAllWindows()[0];
    if (window) break;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.ok(window, 'real main must create its window');
  window.setContentSize(1280, 900);
  // Windows does not create a capture surface for the never-shown production
  // --hidden window. Render it outside the desktop without taking user focus.
  window.setSkipTaskbar(true);
  window.setPosition(-10000, -10000);
  window.showInactive();
  window.webContents.on('console-message', (_event, _level, message) => {
    if (/Uncaught|ErrorBoundary/.test(message)) console.error(`Renderer: ${message}`);
  });
  await until(`document.readyState === 'complete' && !!document.querySelector('input') && document.body.innerText.includes('GitHub')`, 'real login');
  assert.equal(await js('location.origin'), origin);
  assert.ok(app.getPath('userData').startsWith(output));
  await screenshot('login');
  await js(`(async () => {
    const loaded = performance.getEntriesByType('resource').map(entry=>entry.name);
    const moduleURL = path => loaded.find(url=>new URL(url).pathname.endsWith(path)) ?? path;
    window.fixtureStore = (await import(moduleURL('/src/store/useAppStore.ts'))).useAppStore;
    window.fixtureJournal = (await import(moduleURL('/src/services/aiTaskJournal.ts'))).aiTaskJournal;
    window.fixtureRegistry = (await import(moduleURL('/src/plugins/pluginRegistry.ts'))).pluginRegistry;
    window.fixtureStore.setState({ language:'en',isAuthenticated:true, user:{id:420,login:'fixture',avatar_url:'',html_url:'https://github.com/fixture'},
      githubToken:'fixture-not-a-github-token',currentView:'repositories',selectedCategory:'all',
      syncMode:'stars',syncModeConfigured:true,
      aiConfigs:[{id:'fixture-ai',name:'Local Fixture Provider',provider:'http',apiType:'openai',baseUrl:${JSON.stringify(providerOrigin)},
        apiKey:'fixture-only-key',model:'p020-fixture-model',isActive:true,concurrency:1}],activeAIConfig:'fixture-ai',
      repositories:[{id:420001,name:'p020',full_name:'fixture/p020',description:'Isolated real App fixture',
        html_url:'https://github.com/fixture/p020',stargazers_count:42,forks_count:3,forks:3,language:'TypeScript',
        created_at:'2026-01-01T00:00:00Z',updated_at:'2026-10-01T00:00:00Z',pushed_at:'2026-10-01T00:00:00Z',
        owner:{login:'fixture',avatar_url:''},topics:['fixture'],license:'MIT',ai_summary:'Isolated fixture summary',
        ai_tags:['fixture'],analyzed_at:'2026-10-01T00:00:00Z'}] });
    await window.fixtureRegistry.refresh();
  })()`);
  let frame = await openCard();
  const firstPage = { ...lastPage };
  await until(`typeof context !== 'undefined' && context.readme?.includes('P020 Fixture README')`, 'real README context', frame);
  await frame.executeJavaScript("document.getElementById('generate').click()");
  await until(`!!document.querySelector('[role="alertdialog"]')`, 'personal AI confirmation');
  assert.equal(providerCalls, 0, 'provider may not run before consent');
  const pendingTasks = await js(`window.fixtureJournal.snapshot().filter(task=>task.kind==='plugins' && task.owner==='420')`);
  assert.equal(pendingTasks.length, 1);
  assert.equal(pendingTasks[0].items[0].state, 'running');
  await screenshot('plugin-confirmation');
  await click('[role="alertdialog"] button', 'Send to AI');
  await until(`typeof fragment === 'string' && fragment.includes('P020 Fixture Card')`, 'confirmed card generation', frame);
  assert.equal(providerCalls, 1);
  assert.ok(providerSawReadme);
  const tasks = await js(`window.fixtureJournal.snapshot().filter(task=>task.kind==='plugins' && task.owner==='420')`);
  assert.equal(tasks[0].state, 'complete');
  assert.equal(tasks[0].configId, 'fixture-ai');
  assert.equal(tasks[0].items[0].state, 'complete');
  evidence.personalConsentAndJournal = true;
  await screenshot('plugin');
  await frame.executeJavaScript("document.getElementById('copy-code').click()");
  await until(`document.getElementById('status').textContent.includes('Copied')`, 'HTML copy', frame);
  assert.ok(evidence.copiedHTML);
  await frame.executeJavaScript("document.getElementById('copy-image').click()");
  for (let attempt = 0; attempt < 200 && !pageRequests.some((request) => request.method === 'clipboard.writeImage'); attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  assert.ok(pageRequests.some((request) => request.method === 'clipboard.writeImage' && request.success), 'PNG copy must complete through production IPC');
  await until(`document.getElementById('status').textContent.includes('Copied')`, 'PNG copy', frame);
  assert.ok(evidence.copiedImage);
  if (realClipboardAllowed) assert.ok(await restoreClipboard(), 'physical clipboard must restore all original items and bytes');
  await frame.executeJavaScript("document.getElementById('save-image').click()");
  for (let attempt = 0; attempt < 100 && (!savedFiles.length || !fs.existsSync(savedFiles[0])); attempt++) await new Promise((resolve) => setTimeout(resolve, 30));
  assert.ok(savedFiles.length && fs.existsSync(savedFiles[0]));
  assert.ok(fs.statSync(savedFiles[0]).size > 0);
  evidence.realFixtureFileSaved = true;
  await click('[role="dialog"] button', 'Close');
  await until(`!document.querySelector('iframe[src^="plugin-page:"]')`, 'modal close');
  await assertRevoked(firstPage, 'close-fixture');
  evidence.closeRevoked = true;
  frame = await openCard();
  const secondPage = { ...lastPage };
  await js(`window.fixtureStore.getState().setUser({id:421,login:'fixture-b',avatar_url:'',html_url:'https://github.com/fixture-b'})`);
  await until(`!document.querySelector('iframe[src^="plugin-page:"]')`, 'account-switch close');
  await assertRevoked(secondPage, 'account-fixture');
  evidence.accountSwitchRevoked = true;
  await js(`window.fixtureStore.getState().setSyncModeConfigured(true)`);
  await js(`sessionStorage.setItem('gsm:pending-settings-tab','appearance'); window.fixtureStore.setState({currentView:'settings'})`);
  await until(`document.querySelector('#settings-tab-appearance')?.getAttribute('aria-selected') === 'true'`, 'appearance panel');
  await js('window.scrollTo(0,0)');
  await screenshot('appearance');
  await click('button#settings-tab-vectorSearch');
  await until(`document.querySelector('#settings-tab-vectorSearch')?.getAttribute('aria-selected') === 'true'`, 'vector settings');
  await screenshot('vector');
  evidence.screenshots = ['login', 'plugin-confirmation', 'plugin', 'appearance', 'vector'];
  phase = 'complete';
  await finish();
}).catch((error) => { void finish(error); });
