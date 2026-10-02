'use strict';

// Opt-in Chromium probe. Run with Electron, never the production application entry.
const { app, BrowserWindow, protocol, nativeImage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { pageCsp, readPageResource } = require('./pluginPage');

const root = path.resolve(__dirname, '../..');
const output = path.join(root, 'output', 'plugin-native-smoke');
fs.mkdirSync(output, { recursive: true });
app.setPath('userData', path.join(output, 'userData'));
app.setPath('sessionData', path.join(output, 'sessionData'));
app.commandLine.appendSwitch('disable-gpu');
protocol.registerSchemesAsPrivileged([
  { scheme: 'plugin-page', privileges: { standard: true, secure: true, supportFetchAPI: true } },
  { scheme: 'smoke-host', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);
const directory = path.join(root, 'examples/plugins/repo-info-card');
const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json'), 'utf8'));
const origin = `plugin-page://${manifest.id}`;
const host = `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0">
<iframe id="page" title="Info Card" sandbox="allow-scripts allow-same-origin"
  src="${origin}/info-card/index.html" style="border:0;width:100%;height:100vh"></iframe>
<script>
const page = document.getElementById('page');
window.messages = [];
window.exports = [];
page.addEventListener('load', () => page.contentWindow.postMessage({
  type: 'plugin-page:init', pluginId: '${manifest.id}', pageId: 'info-card', token: 'native-fixture',
  context: { repository: { id: 1, name: 'fixture', full_name: 'fixture/project', description: 'Isolated repository fixture',
    owner: { login: 'fixture' }, stargazers_count: 12, language: 'TypeScript', topics: [] }, readme: '# Fixture README', language: 'en' }
}, '${origin}'));
window.addEventListener('message', event => {
  const data = event.data;
  if (event.source !== page.contentWindow || event.origin !== '${origin}' || data.origin !== '${origin}' ||
      data.pluginId !== '${manifest.id}' || data.pageId !== 'info-card' || data.token !== 'native-fixture') return;
  window.messages.push({ origin: event.origin, payloadOrigin: data.origin, method: data.method });
  let value = null;
  if (data.method === 'ai.generate') value = '<div id="card"><h1 class="title">Fixture Project</h1>' +
    '<p class="intro">A verified isolated card render.</p><div class="facts"><div class="fact">' +
    '<span class="label">Stars</span><p class="value">12</p></div></div>' +
    '<script>evil()<\\/script><img src="https://evil.example"><p onclick="evil()" style="color:red">Safe output</p></div>';
  else if (data.method === 'clipboard.write') window.exports.push(data.args.text);
  page.contentWindow.postMessage({ type: 'plugin-page:response', pluginId: '${manifest.id}', pageId: 'info-card',
    token: 'native-fixture', requestId: data.requestId, success: true, value }, '${origin}');
});
</script></body></html>`;

let window;
const timeout = setTimeout(() => { console.error('Native plugin smoke timed out'); app.exit(1); }, 30000);

app.whenReady().then(async () => {
  protocol.handle('smoke-host', () => new Response(host, { headers: { 'Content-Type': 'text/html' } }));
  protocol.handle('plugin-page', (request) => {
    const resource = readPageResource(request.url, directory, manifest);
    return resource ? new Response(resource.body, { headers: {
      'Content-Type': resource.mimeType, 'Content-Security-Policy': pageCsp(manifest.id),
    } }) : new Response('Not Found', { status: 404 });
  });
  window = new BrowserWindow({ show: false, width: 1000, height: 900, webPreferences: {
    nodeIntegration: false, contextIsolation: true, sandbox: true,
  } });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.session.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: !/^(plugin-page:|smoke-host:|data:)/.test(details.url) });
  });
  await window.loadURL('smoke-host://fixture/index.html');
  let frame;
  for (let attempt = 0; attempt < 100; attempt++) {
    frame = window.webContents.mainFrame.frames.find((item) => item.url.startsWith(origin));
    if (frame && await frame.executeJavaScript('typeof token !== "undefined" && !!token')) break;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.ok(frame);
  assert.equal(await frame.executeJavaScript('location.origin'), origin);
  assert.equal(await frame.executeJavaScript('typeof require'), 'undefined');
  assert.equal(await frame.executeJavaScript('typeof window.electronAPI'), 'undefined');
  assert.equal(await frame.executeJavaScript(`fetch('https://evil.example').then(() => false, () => true)`), true);
  assert.equal(await frame.executeJavaScript(`(() => {
    const script = document.createElement('script'); script.textContent = 'window.inlineExecuted = true';
    document.body.append(script); return !window.inlineExecuted;
  })()`), true);
  await frame.executeJavaScript('generate()');
  const fragment = await frame.executeJavaScript('fragment');
  assert.match(fragment, /Fixture Project/);
  assert.doesNotMatch(fragment, /evil|onclick|style=|<script|<img/);
  await frame.executeJavaScript("runExport('clipboard.write')");
  const exported = await window.webContents.executeJavaScript('window.exports[0]');
  assert.match(exported, /Fixture Project/);
  assert.doesNotMatch(exported, /evil|onclick|<script|<img/);
  const base64 = await frame.executeJavaScript('png()');
  const png = nativeImage.createFromBuffer(Buffer.from(base64, 'base64'));
  assert.equal(png.isEmpty(), false);
  assert.deepEqual(png.getSize(), { width: 2400, height: 2400 });
  const events = await window.webContents.executeJavaScript('window.messages');
  assert.ok(events.length >= 2);
  assert.ok(events.every((event) => event.origin === origin && event.payloadOrigin === origin));
  for (const [name, width, height] of [['desktop', 1000, 900], ['mobile', 390, 800]]) {
    window.setContentSize(width, height);
    await frame.executeJavaScript('renderPreview()');
    await new Promise((resolve) => setTimeout(resolve, 100));
    const capture = await window.webContents.capturePage();
    const bytes = capture.toBitmap();
    const colors = new Set();
    for (let index = 0; index < bytes.length; index += 400) colors.add(bytes.subarray(index, index + 3).toString('hex'));
    assert.ok(colors.size > 5, 'Screenshot must be nonblank');
    fs.writeFileSync(path.join(output, `${name}.png`), capture.toPNG());
    assert.equal(await frame.executeJavaScript('document.documentElement.scrollWidth <= innerWidth'), true);
  }
  fs.writeFileSync(path.join(output, 'card.png'), png.toPNG());
  console.log(JSON.stringify({ success: true, chromium: process.versions.chrome, origin,
    nodeBridge: false, externalFetchBlocked: true, inlineScriptsBlocked: true,
    sanitizedCopy: true, png: png.getSize(), desktopMobileNonblank: true }));
  clearTimeout(timeout);
  window.destroy();
  app.exit(0);
}).catch((error) => {
  console.error(error);
  clearTimeout(timeout);
  window?.destroy();
  app.exit(1);
});
