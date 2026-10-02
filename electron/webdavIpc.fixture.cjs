// Standalone test entry only. Never import main.js or initialize GSM services.
const { app, BrowserWindow, ipcMain, nativeTheme } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { pathToFileURL } = require('node:url');
const { fetch: davFetch } = require('undici');
const { registerWebdavIpc, isTrustedWebdavFrame } = require('./webdavIpc');

const workspace = fs.realpathSync(path.resolve(__dirname, '..'));
const rootArg = process.argv.find(arg => arg.startsWith('--gsm-fixture-root='));
if (!rootArg) throw new Error('Missing isolated fixture directory');
const root = fs.realpathSync(rootArg.slice('--gsm-fixture-root='.length));
if (path.dirname(root) !== workspace || !path.basename(root).startsWith('.webdav-fixture-')) {
  throw new Error('Fixture directory must be a direct child of the isolated workspace');
}
app.setName('GSM WebDAV Isolated Fixture');
app.setPath('userData', path.join(root, 'userData'));
app.setPath('sessionData', path.join(root, 'sessionData'));
app.commandLine.appendSwitch('user-data-dir', path.join(root, 'userData'));
app.commandLine.appendSwitch('disable-background-networking');
app.commandLine.appendSwitch('disable-component-update');

let mainWindow;
let server;
const windows = [];
const hits = [];
const closedStreams = new Set();
const blocked = [];
const checks = [];
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const page = path.join(root, 'index.html');
const appUrl = pathToFileURL(page).href;
const watchdog = setTimeout(() => { console.error('Fixture deadline exceeded'); app.exit(1); }, 30000);
registerWebdavIpc({
  ipcMain, isMainFrame: event => isTrustedWebdavFrame(event, mainWindow, appUrl),
  fetchImpl: (url, init) => {
    // The fixture never allows even main-process traffic to external services.
    if (new URL(url).origin !== serverOrigin) throw new Error('Non-fixture DAV URL denied');
    return davFetch(url, init);
  },
});
let serverOrigin;
const evaluate = code => mainWindow.webContents.executeJavaScript(code);
async function check(name, operation) {
  await operation();
  checks.push(name);
  console.log(`PASS ${name}`);
}
async function waitFor(code) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await evaluate(code)) return;
    await delay(25);
  }
  throw new Error(`Fixture condition timed out: ${code}`);
}
function windowOptions() {
  return {
    width: 1000, height: 720, show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false, contextIsolation: true, sandbox: true,
      webSecurity: true, allowRunningInsecureContent: false, backgroundThrottling: false,
    },
  };
}
async function run() {
  assert.equal(app.getPath('userData'), path.join(root, 'userData'));
  assert.equal(app.getPath('sessionData'), path.join(root, 'sessionData'));
  server = http.createServer((request, response) => {
    hits.push({ path: request.url, method: request.method, auth: request.headers.authorization });
    response.setHeader('Access-Control-Allow-Origin', '*');
    if (request.url === '/api/health') {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end('{"status":"ok"}');
    } else if (request.url === '/redirect') {
      response.writeHead(302, { Location: 'https://external.invalid/private' });
      response.end();
    } else if (request.url.startsWith('/stream')) {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.write('{"partial":');
      request.on('close', () => closedStreams.add(request.url));
    } else if (request.url.startsWith('/dav') && request.method === 'PROPFIND') {
      response.writeHead(207, { 'Content-Type': 'application/xml', DAV: '1,2' });
      response.end('<D:multistatus xmlns:D="DAV:"><D:response><D:href>/dav/fixture.json</D:href></D:response></D:multistatus>');
    } else if (request.url === '/dav' && request.method === 'HEAD') {
      response.writeHead(405); response.end();
    } else if (request.url.startsWith('/dav') && request.method === 'PUT') {
      request.resume(); request.on('end', () => { response.writeHead(201); response.end(); });
    } else if (request.url.startsWith('/dav') && request.method === 'MKCOL') {
      response.writeHead(201); response.end();
    } else if (request.url.startsWith('/dav')) {
      response.writeHead(200, { Server: 'isolated-fixture', DAV: '1,2' });
      response.end('{"fixture":true}');
    } else if (request.url.endsWith('.svg')) {
      response.writeHead(200, { 'Content-Type': 'image/svg+xml;charset=utf-8' });
      const color = request.url.includes('dark') ? '#223344' : '#eeeeee';
      response.end(`<svg xmlns="http://www.w3.org/2000/svg" width="640" height="320"><rect width="640" height="320" fill="${color}"/></svg>`);
    } else {
      response.writeHead(404); response.end();
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  serverOrigin = `http://127.0.0.1:${server.address().port}`;
  mainWindow = new BrowserWindow(windowOptions());
  windows.push(mainWindow);
  mainWindow.webContents.on('console-message', ({ message, level }) => {
    if (level === 'error') console.error(`Renderer: ${message}`);
  });
  mainWindow.webContents.session.webRequest.onBeforeRequest((details, callback) => {
    const url = new URL(details.url);
    const permitted = url.protocol === 'file:' || url.protocol === 'about:' || url.protocol === 'blob:'
      || url.origin === serverOrigin;
    if (!permitted) blocked.push(details.url);
    callback({ cancel: !permitted });
  });
  mainWindow.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  await mainWindow.loadFile(page);
  await waitFor('!!window.davFixture');
  await check('production preload exposes owned DAV request/cancel with context isolation and sandbox', async () => {
    assert.deepEqual(await evaluate('[typeof electronAPI.webdavRequest,typeof electronAPI.webdavCancel,typeof require]'), ['function', 'function', 'undefined']);
  });
  await check('file-origin service uses unsaved inline credentials for HEAD/PROPFIND/MKCOL/PUT/GET', async () => {
    assert.equal(await evaluate(`davFixture.service(${JSON.stringify(serverOrigin)}).testConnection()`), true);
    assert.deepEqual(await evaluate(`davFixture.service(${JSON.stringify(serverOrigin)}).listFiles()`), ['fixture.json']);
    assert.equal(await evaluate(`davFixture.service(${JSON.stringify(serverOrigin)}).uploadFile('fixture.json','{}')`), true);
    assert.equal(await evaluate(`davFixture.service(${JSON.stringify(serverOrigin)}).downloadFile('fixture.json')`), '{"fixture":true}');
    assert.ok(hits.filter(hit => hit.path.startsWith('/dav')).every(hit =>
      hit.auth === `Basic ${Buffer.from('inline-fixture:not-a-real-secret').toString('base64')}`));
  });
  await check('real IPC abort closes a stalled undici response body', async () => {
    const result = await evaluate(`(async()=>{
      const controller=new AbortController();
      const pending=davFixture.desktopDavFetch(${JSON.stringify(`${serverOrigin}/stream-abort`)},{signal:controller.signal});
      setTimeout(()=>controller.abort(),150);
      try { await pending; return 'unexpected success'; } catch(error) { return error.name; }
    })()`);
    assert.equal(result, 'AbortError');
    await delay(200);
    assert.ok(closedStreams.has('/stream-abort'));
  });
  await check('main-process deadline closes a stalled body over real IPC', async () => {
    const result = await evaluate(`electronAPI.webdavRequest({requestId:'timeout-fixture',url:${JSON.stringify(`${serverOrigin}/stream-timeout`)},method:'GET',timeoutMs:1000})`);
    assert.equal(result.timedOut, true);
    await delay(100);
    assert.ok(closedStreams.has('/stream-timeout'));
  });
  await check('redirects fail closed rather than forwarding inline credentials', async () => {
    const result = await evaluate(`electronAPI.webdavRequest({requestId:'redirect-fixture',url:${JSON.stringify(`${serverOrigin}/redirect`)},method:'GET',headers:{Authorization:'Basic fixture'}})`);
    assert.deepEqual(result, { success: false, error: 'DAV request failed' });
  });
  await check('other BrowserWindow cannot borrow the primary window DAV authority', async () => {
    const other = new BrowserWindow(windowOptions());
    windows.push(other);
    await other.loadFile(page);
    const before = hits.length;
    const result = await other.webContents.executeJavaScript(`electronAPI.webdavRequest({requestId:'other-window',url:${JSON.stringify(`${serverOrigin}/dav`)},method:'HEAD'})`);
    assert.equal(result.success, false);
    assert.equal(hits.length, before);
    other.destroy();
  });
  await check('subframe receives no production preload API', async () => {
    assert.equal(await evaluate(`new Promise(resolve=>{
      const frame=document.createElement('iframe');
      frame.onload=()=>resolve(typeof frame.contentWindow.electronAPI);
      frame.src='about:blank';document.body.appendChild(frame);
    })`), 'undefined');
  });
  await check('file-origin automatic health probe makes no request', async () => {
    const before = hits.length;
    await evaluate('davFixture.health()');
    assert.equal(hits.length, before);
    assert.ok(!blocked.some(url => url.includes('/api/health')));
  });
  await check('file-origin explicit loopback HTTP backend still receives its health probe', async () => {
    assert.equal(await evaluate(`davFixture.health(${JSON.stringify(serverOrigin)})`), true);
    assert.ok(hits.some(hit => hit.path === '/api/health'));
  });
  await check('inert RSS HTML causes no image/frame/CSS request in real Chromium', async () => {
    const before = hits.length;
    const result = await evaluate(`davFixture.extract(${JSON.stringify(
      `<img src="${serverOrigin}/rss-image"><iframe src="${serverOrigin}/rss-frame"></iframe><link rel="stylesheet" href="${serverOrigin}/rss-css"><style>@import url("${serverOrigin}/rss-import");</style><a href="https://github.com/o/r">RSS &amp; repo</a>`
    )})`);
    assert.deepEqual(result, { text: 'RSS & repo', links: ['https://github.com/o/r'] });
    await delay(300);
    assert.equal(hits.length, before);
  });
  await check('native picture selects dark source as a direct-child image', async () => {
    nativeTheme.themeSource = 'dark';
    await evaluate(`davFixture.render(${JSON.stringify(
      `<picture><source media="(prefers-color-scheme: dark)" type="image/svg+xml" srcset="${serverOrigin}/dark.svg 1x"><img src="${serverOrigin}/light.svg" alt="Theme"></picture>`
    )})`);
    await waitFor(`document.querySelector('picture > img')?.currentSrc===${JSON.stringify(`${serverOrigin}/dark.svg`)} && document.querySelector('picture > img').naturalWidth===640`);
    assert.equal(await evaluate("document.querySelector('picture > source').type"), 'image/svg+xml');
    await evaluate("document.querySelector('picture > img').click()");
    assert.equal(await evaluate("document.querySelector('img[draggable=\"false\"]').src"), `${serverOrigin}/dark.svg`);
  });
  await check('native theme reselection updates currentSrc and lightbox', async () => {
    nativeTheme.themeSource = 'light';
    await waitFor(`document.querySelector('picture > img')?.currentSrc===${JSON.stringify(`${serverOrigin}/light.svg`)} && document.querySelector('img[draggable="false"]').src===${JSON.stringify(`${serverOrigin}/light.svg`)}`);
  });
  await check('download uses selected resource and sanitized SVG extension', async () => {
    const result = await evaluate(`(async()=>{
      const clicked=[];
      const original=HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click=function(){clicked.push(this.download)};
      try {
        const button=[...document.querySelectorAll('button')].find(button=>button.querySelector('.lucide-download'));
        button.click();
        for(let i=0;i<100&&!clicked.length;i++) await new Promise(resolve=>setTimeout(resolve,25));
        return clicked;
      } finally { HTMLAnchorElement.prototype.click=original; }
    })()`);
    assert.deepEqual(result, ['Theme.svg']);
    assert.ok(hits.some(hit => hit.path === '/light.svg'));
  });
  await check('unsafe source candidates are stripped before reaching Chromium', async () => {
    await evaluate(`davFixture.render(${JSON.stringify(
      `<picture><source srcset="file:///fixture-secret 1x, javascript:alert(1) 2x, ${serverOrigin}/dark.svg 3x"><img src="${serverOrigin}/light.svg" alt="Safe"></picture>`
    )})`);
    assert.equal(await evaluate("document.querySelector('source').srcset"), `${serverOrigin}/dark.svg 3x`);
  });
  await check('navigating away aborts the owned response stream', async () => {
    await evaluate(`void electronAPI.webdavRequest({requestId:'navigate-fixture',url:${JSON.stringify(`${serverOrigin}/stream-navigation`)},method:'GET'});undefined`);
    await delay(100);
    await mainWindow.loadFile(path.join(root, 'other.html'));
    await delay(200);
    assert.ok(closedStreams.has('/stream-navigation'));
    const result = await evaluate(`electronAPI.webdavRequest({requestId:'wrong-file',url:${JSON.stringify(`${serverOrigin}/dav`)},method:'HEAD'})`);
    assert.equal(result.success, false);
  });
  console.log(JSON.stringify({ passed: checks.length, electron: process.versions.electron, isolated: true, blockedExternal: blocked.length }));
}
app.whenReady().then(run).then(() => finish(0), error => {
  console.error(error.stack || error);
  finish(1);
});
function finish(code) {
  clearTimeout(watchdog);
  for (const window of windows) if (!window.isDestroyed()) window.destroy();
  if (server) { server.closeAllConnections(); server.close(); }
  app.exit(code);
}
