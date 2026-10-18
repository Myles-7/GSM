// Isolated native smoke: real preload, trusted registrar, plugin protocol and worker.
const { app, BrowserWindow, ipcMain, protocol } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const { createPluginManager } = require('../../electron/plugins/pluginManager');
const { createPluginIpcRegistrar } = require('../../electron/plugins/pluginIpc');
const { PAGE_SCHEME, pageCsp } = require('../../electron/plugins/pluginPage');
const root = path.resolve(__dirname, '../..');
const output = path.join(root, 'output/v086-continuation/native-plugin-smoke');
fs.mkdirSync(output, { recursive: true });
app.setPath('userData', path.join(output, 'profile'));
protocol.registerSchemesAsPrivileged([{ scheme: PAGE_SCHEME, privileges: { standard: true, secure: true } }]);
const watchdog = setTimeout(() => { console.error('Native plugin smoke timed out'); app.exit(1); }, 25_000);
app.whenReady().then(async () => {
  let window;
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'gsm-native-plugin-'));
  const manager = createPluginManager({ pluginsRoot: path.join(workspace, 'plugins'), statePath: path.join(workspace, 'state.json'),
    dataRoot: path.join(workspace, 'data'), logsRoot: path.join(workspace, 'logs') });
  try {
    const source = path.join(workspace, 'source');
    fs.mkdirSync(source);
    const id = 'com.example.native-smoke';
    const permissions = ['network:api.github.com'];
    fs.writeFileSync(path.join(source, 'manifest.json'), JSON.stringify({ manifestVersion: 1, id, name: 'Native smoke',
      version: '1.0.0', apiVersion: '1', permissions, contributes: { pages: [{ id: 'one', title: 'One', entry: 'index.html' }] } }));
    fs.writeFileSync(path.join(source, 'index.html'), '<!doctype html><script src="page.js"></script>');
    fs.writeFileSync(path.join(source, 'page.js'), `window.addEventListener('message', async event => {
      if (event.data?.type !== 'smoke:init') return;
      let blocked = false;
      try { await fetch('https://api.github.com/users/octocat'); } catch { blocked = true; }
      event.source.postMessage({ type: 'smoke:ready', bridgeAbsent: typeof window.electronAPI === 'undefined',
        fetchBlocked: blocked, token: event.data.token }, '*');
    });`);
    assert.equal(manager.installFromDirectory(source).success, true);
    assert.equal((await manager.enable(id, permissions)).success, true);
    const worker = manager.installFromDirectory(path.join(root, 'examples/plugins/markdown-exporter'));
    assert.equal(worker.success, true);
    assert.equal((await manager.enable(worker.pluginId, ['repositories:read', 'storage', 'clipboard:write'])).success, true);
    const exported = await manager.runExporter({ pluginId: worker.pluginId, exporterId: 'markdown', repositories: [] });
    assert.equal(exported.success, true);
    protocol.handle(PAGE_SCHEME, request => {
      const resource = manager.readPageResource(request.url);
      return resource ? new Response(resource.body, { headers: { 'Content-Type': resource.mimeType,
        'Content-Security-Policy': pageCsp(new URL(request.url).hostname), 'Access-Control-Allow-Origin': 'null' } }) : new Response('', { status: 404 });
    });
    const host = path.join(workspace, 'host.html');
    fs.writeFileSync(host, '<!doctype html><title>Plugin platform smoke</title>');
    window = new BrowserWindow({ show: false, webPreferences: { preload: path.join(root, 'electron/preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true } });
    const registrar = createPluginIpcRegistrar({ ipcMain, getWindow: () => window, getHostURL: () => pathToFileURL(host).href });
    registrar('plugins:getPage', (_event, pluginId, pageId) => manager.getPage(pluginId, pageId));
    const envelopes = [];
    registrar('plugins:requestPageCapability', (_event, request) => {
      envelopes.push(request);
      return manager.requestPageCapability(request);
    });
    await window.loadFile(host);
    const result = await window.webContents.executeJavaScript(`(async () => {
      const page = await electronAPI.plugins.getPage('${id}', 'one');
      if (!page.success) throw Error('page unavailable');
      const iframe = document.createElement('iframe');
      iframe.sandbox = 'allow-scripts allow-same-origin';
      const ready = new Promise(resolve => window.addEventListener('message', event => {
        if (event.source === iframe.contentWindow && event.origin === 'plugin-page://${id}' && event.data.type === 'smoke:ready') resolve(event.data);
      }));
      iframe.onload = () => iframe.contentWindow.postMessage({ type: 'smoke:init', token: page.sessionToken }, 'plugin-page://${id}');
      iframe.src = page.url; document.body.append(iframe);
      const isolated = await ready;
      const request = { pluginId: '${id}', pageId: 'one', sessionToken: page.sessionToken, requestId: 'native',
        method: 'network.request', args: { host: 'api.github.com', path: '/users/octocat' } };
      const authorization = await electronAPI.plugins.requestPageCapability(request);
      if (!authorization.success) throw Error('authorization failed');
      const completed = await electronAPI.plugins.requestPageCapability({ ...request, networkTicket: authorization.value.networkTicket });
      const replay = await electronAPI.plugins.requestPageCapability({ ...request, networkTicket: authorization.value.networkTicket });
      const second = await electronAPI.plugins.requestPageCapability({ ...request, requestId: 'late' });
      return { bridgeAbsent: isolated.bridgeAbsent, fetchBlocked: isolated.fetchBlocked, completed: completed.success,
        replayDenied: !replay.success, lateTicket: second.value.networkTicket, sessionToken: page.sessionToken };
    })()`);
    assert.equal(result.bridgeAbsent, true);
    assert.equal(result.fetchBlocked, true);
    assert.equal(result.completed, true);
    assert.equal(result.replayDenied, true);
    await manager.disable(id);
    const late = await manager.requestPageCapability({ pluginId: id, pageId: 'one', sessionToken: result.sessionToken,
      requestId: 'late', method: 'network.request', args: { host: 'api.github.com', path: '/users/octocat' }, networkTicket: result.lateTicket });
    assert.equal(late.success, false);
    assert.equal(envelopes.every(request => !Object.hasOwn(request.args, 'token') && !Object.hasOwn(request.args, 'Authorization')), true);
    const evidence = { nativeElectron: process.versions.electron, preloadMainFrameOnly: true, pageCsp: true,
      sessionCompletion: true, replayDenied: true, disableDropsLate: true, workerExporter: true };
    fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify(evidence, null, 2));
    console.log(JSON.stringify(evidence));
    clearTimeout(watchdog); manager.shutdown(); window.destroy(); app.exit(0);
  } catch (error) {
    console.error(error); clearTimeout(watchdog); manager.shutdown(); window?.destroy(); app.exit(1);
  }
});
