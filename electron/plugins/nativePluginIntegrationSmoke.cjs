'use strict';

// Real Chromium/IPC with production helpers and preload; never boot production main.
const { app, BrowserWindow, ipcMain, protocol, nativeImage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const { once } = require('node:events');
const { createPluginManager } = require('./pluginManager');
const { createPluginHostOperations } = require('./pluginHostOperations');
const { createPluginIpcRegistrar, registerPluginPageNavigation } = require('./pluginIpc');
const { PAGE_SCHEME, pageCsp } = require('./pluginPage');

const root = path.resolve(__dirname, '../..');
const outputRoot = path.join(root, 'output', 'plugin-integration-smoke');
fs.mkdirSync(outputRoot, { recursive: true });
const output = fs.mkdtempSync(path.join(outputRoot, 'run-'));
app.setPath('userData', path.join(output, 'userData'));
app.setPath('sessionData', path.join(output, 'sessionData'));
app.commandLine.appendSwitch('disable-gpu');
protocol.registerSchemesAsPrivileged([{ scheme: PAGE_SCHEME, privileges: { standard: true, secure: true } }]);

const hostPath = path.join(__dirname, 'fixtures/native-host.html');
const hostURL = pathToFileURL(hostPath).href;
const pluginId = 'com.githubstarsmanager.repo-info-card';
const pageId = 'info-card';
const writes = [];
let window;
let manager;
let dialogChoice = 'success';
let finishDialog;
let finishRemoteResponse;
let finishNavigationProbe;
let phase = 'initialize';
const timeout = setTimeout(() => { console.error(`Native plugin integration timed out: ${phase}`); app.exit(1); }, 40000);

async function invoke(method, ...args) {
  return window.webContents.executeJavaScript(`window.electronAPI.plugins[${JSON.stringify(method)}](...${JSON.stringify(args)})`);
}
function request(page, method, args = {}, requestId = 'fixture-request') {
  return { pluginId, pageId, sessionToken: page.sessionToken, requestId, method, args };
}
async function isClosed(page) {
  const result = await manager.requestPageCapability(request(page, 'clipboard.write', { text: 'must not write' }, 'revoked'));
  assert.equal(result.error?.code, 'PLUGIN_PAGE_CLOSED');
}

app.whenReady().then(async () => {
  const hostOperations = createPluginHostOperations({
    clipboard: {
      writeText: (text) => writes.push({ type: 'text', text }),
      writeImage: (image) => writes.push({ type: 'image', size: image.getSize() }),
    },
    nativeImage, path, getWindow: () => window,
    fs: { promises: { writeFile: async (filePath, bytes) => {
      assert.equal(filePath, path.join(output, 'fixture.png'));
      writes.push({ type: 'file', size: bytes.length });
    } } },
    dialog: { showSaveDialog: async () => {
      if (dialogChoice === 'pending') return new Promise((resolve) => { finishDialog = resolve; });
      return dialogChoice === 'cancel' ? { canceled: true } : { canceled: false, filePath: path.join(output, 'fixture.png') };
    } },
  });
  manager = createPluginManager({ pluginsRoot: path.join(output, 'plugins'), hostOperations });
  assert.equal(manager.installFromDirectory(path.join(root, 'examples/plugins/repo-info-card')).success, true);
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'examples/plugins/repo-info-card/manifest.json'), 'utf8'));
  assert.equal(manifest.id, pluginId);
  assert.equal((await manager.enable(pluginId, manifest.permissions)).success, true);
  protocol.handle(PAGE_SCHEME, (incoming) => {
    const resource = manager.readPageResource(incoming.url);
    return resource ? new Response(resource.body, { headers: {
      'Content-Type': resource.mimeType, 'Content-Security-Policy': pageCsp(pluginId),
    } }) : new Response('Not Found', { status: 404 });
  });
  // Intercept HTTPS locally: hostile main-frame tests make no external requests.
  protocol.handle('https', async (incoming) => {
    assert.equal(new URL(incoming.url).hostname, 'hostile.invalid');
    if (incoming.url.includes('/pending')) {
      await new Promise((resolve) => { finishRemoteResponse = resolve; });
    }
    return new Response(fs.readFileSync(hostPath), { headers: { 'Content-Type': 'text/html' } });
  });
  window = new BrowserWindow({ show: false, webPreferences: {
    nodeIntegration: false, contextIsolation: true, sandbox: true,
    preload: path.join(root, 'electron/preload.js'),
  } });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  const lifecycle = registerPluginPageNavigation(window.webContents, () => manager);
  const handle = createPluginIpcRegistrar({
    ipcMain: { handle: (channel, handler) => ipcMain.handle(channel, async (event, ...args) => {
      const result = await handler(event, ...args);
      if (channel === 'plugins:getPage' && lifecycle.isNavigating()) finishNavigationProbe?.(result);
      return result;
    }) },
    getWindow: () => window, getHostURL: () => hostURL,
    isNavigating: lifecycle.isNavigating,
  });
  handle('plugins:list', () => manager.list(), { plugins: [], invalidPlugins: [] });
  handle('plugins:getPage', (_event, id, page) => manager.getPage(id, page));
  handle('plugins:requestPageCapability', (_event, input) => manager.requestPageCapability(input));
  phase = 'load trusted host';
  await window.loadFile(hostPath);
  const listing = await invoke('list');
  assert.equal(listing.plugins.length, 1);
  let page = await invoke('getPage', pluginId, pageId);
  assert.equal(page.success, true);
  assert.equal((await invoke('requestPageCapability', request(page, 'clipboard.write', { text: '<div>sanitized fixture</div>' }, 'text'))).success, true);
  const png = nativeImage.createFromBitmap(Buffer.from([0, 0, 255, 255]), { width: 1, height: 1 }).toPNG().toString('base64');
  assert.equal((await invoke('requestPageCapability', request(page, 'clipboard.writeImage', { dataBase64: png }, 'image'))).success, true);
  assert.equal((await invoke('requestPageCapability', request(page, 'downloads.saveFile', { fileName: 'fixture.png', dataBase64: png }, 'save'))).success, true);
  assert.deepEqual(writes.map((item) => item.type), ['text', 'image', 'file']);
  dialogChoice = 'cancel';
  const canceled = await invoke('requestPageCapability', request(page, 'downloads.saveFile', { fileName: 'fixture.png', dataBase64: png }, 'cancel'));
  assert.equal(canceled.success, true);
  assert.equal(canceled.value.canceled, true);
  assert.equal(writes.length, 3);

  phase = 'initial plugin frame';
  await window.webContents.executeJavaScript(`document.getElementById('page').src = ${JSON.stringify(page.url)}`);
  let frame;
  for (let attempt = 0; attempt < 100; attempt++) {
    frame = window.webContents.mainFrame.frames.find((item) => item.url === page.url);
    if (frame) break;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.ok(frame, 'plugin iframe must load');
  assert.equal(await frame.executeJavaScript('typeof window.electronAPI'), 'undefined');
  assert.equal(await frame.executeJavaScript('location.origin'), `plugin-page://${pluginId}`);
  assert.equal((await invoke('requestPageCapability', request(page, 'clipboard.write', { text: 'initial frame retained' }, 'initial'))).success, true);
  const writesBeforeNavigation = writes.length;
  window.webContents.on('will-frame-navigate', (event) => {
    if (!event.isMainFrame && event.url.startsWith('https:')) event.preventDefault();
  });
  phase = 'blocked subframe navigation';
  await frame.executeJavaScript("location.href = 'https://hostile.invalid/blocked'");
  await isClosed(page);
  assert.equal(writes.length, writesBeforeNavigation);
  assert.equal(frame.url, page.url, 'blocked frame remains in old document but session is revoked');

  phase = 'expired save dialog';
  page = await invoke('getPage', pluginId, pageId);
  dialogChoice = 'pending';
  const pendingSave = invoke('requestPageCapability', request(page, 'downloads.saveFile', { fileName: 'fixture.png', dataBase64: png }, 'pending-save'));
  for (let attempt = 0; attempt < 100 && !finishDialog; attempt++) await new Promise((resolve) => setTimeout(resolve, 10));
  assert.ok(finishDialog);
  manager.revokePageSessions();
  finishDialog({ canceled: false, filePath: path.join(output, 'fixture.png') });
  assert.equal((await pendingSave).error.code, 'PLUGIN_PAGE_CLOSED');
  assert.equal(writes.length, writesBeforeNavigation);

  page = await invoke('getPage', pluginId, pageId);
  await window.webContents.executeJavaScript("location.hash = 'repositories'");
  assert.equal((await invoke('requestPageCapability', request(page, 'clipboard.write', { text: 'hash retained' }, 'hash'))).success, true);
  phase = 'main navigation before commit';
  const navigationProbe = new Promise((resolve) => { finishNavigationProbe = resolve; });
  // executeJavaScript waits for pending loads. Schedule this IPC in the OLD
  // document before navigation so the probe really runs prior to commit.
  await window.webContents.executeJavaScript(`setTimeout(() => window.electronAPI.plugins.getPage(${JSON.stringify(pluginId)}, ${JSON.stringify(pageId)}), 100)`);
  const navigationStarted = once(window.webContents, 'did-start-navigation');
  const remoteLoaded = window.loadURL('https://hostile.invalid/pending');
  await navigationStarted;
  await isClosed(page);
  assert.equal(window.webContents.getURL().split('#')[0], hostURL, 'old document still present at navigation start');
  assert.equal((await navigationProbe).error.code, 'PLUGIN_IPC_DENIED', 'cannot reopen from unloading document');
  for (let attempt = 0; attempt < 100 && !finishRemoteResponse; attempt++) await new Promise((resolve) => setTimeout(resolve, 10));
  assert.ok(finishRemoteResponse);
  finishRemoteResponse();
  await remoteLoaded;
  phase = 'hostile HTTPS document';
  assert.equal(await window.webContents.executeJavaScript('location.origin'), 'https://hostile.invalid');
  assert.equal((await invoke('getPage', pluginId, pageId)).error.code, 'PLUGIN_IPC_DENIED');
  assert.deepEqual((await invoke('list')).plugins, []);
  assert.equal((await invoke('requestPageCapability', request(page, 'clipboard.write', { text: 'remote forbidden' }, 'remote'))).error.code, 'PLUGIN_IPC_DENIED');
  await window.loadFile(hostPath);
  page = await invoke('getPage', pluginId, pageId);
  assert.equal(page.success, true, 'return to local trusted host can reopen');
  const destroyed = once(window.webContents, 'destroyed');
  window.destroy();
  await destroyed;
  await isClosed(page);
  console.log(JSON.stringify({ success: true, chromium: process.versions.chrome,
    actualProductionPreload: true, sharedProductionGuardAndLifecycle: true,
    isolatedProfile: output, localIPCAllowed: true, sameFrameHostileHTTPSDenied: true,
    initialFrameRetained: true, blockedFrameRevoked: true, hashRouteRetained: true,
    mainNavigationRevokedBeforeCommit: true, unloadingHostReopenDenied: true,
    destructionRevoked: true, nativeImageDecoded: true,
    fakeClipboardAndSaveDispatch: true, canceledAndExpiredSaveNeverWrite: true,
    realClipboardOrUserFilesWritten: false, liveAIOrAccount: false }));
  clearTimeout(timeout);
  manager.shutdown();
  app.exit(0);
}).catch((error) => {
  console.error(error);
  clearTimeout(timeout);
  window?.destroy();
  manager?.shutdown();
  app.exit(1);
});
