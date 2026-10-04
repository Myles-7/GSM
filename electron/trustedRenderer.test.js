const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { isTrustedDocument, isTrustedMainFrame, createTrustedIpcMain, isSafeExternalUrl, registerMainDocumentNavigation } = require('./trustedRenderer');
const { registerAgyIpc } = require('./agyIpc');
const { registerWebdavIpc } = require('./webdavIpc');
const { registerHtmlReadingIpc } = require('./htmlReading');
const { createPluginIpcRegistrar, registerPluginPageNavigation } = require('./plugins/pluginIpc');
const APP = 'file:///D:/GSM/dist/index.html';
const DEV = 'http://127.0.0.1:5173';

function fixture(url = APP) {
  const wc = Object.assign(new EventEmitter(), {
    mainFrame: { url }, isDestroyed: () => false,
    setWindowOpenHandler(handler) { this.open = handler; }, isLoadingMainFrame: () => false,
    send() { throw new Error('Unexpected renderer event'); },
  });
  const window = { webContents: wc, isDestroyed: () => false };
  const event = { sender: wc, senderFrame: wc.mainFrame };
  const handlers = new Map();
  const ipc = createTrustedIpcMain({ ipcMain: { handle: (key, handler) => handlers.set(key, handler) },
    isTrusted: e => isTrustedMainFrame(e, window, APP, DEV) });
  return { wc, window, event, handlers, ipc };
}

test('only exact app documents or configured loopback entry documents receive trust', () => {
  for (const value of [APP, `${APP}#settings`, DEV, `${DEV}/#settings`]) assert.ok(isTrustedDocument(value, APP, DEV), value);
  for (const value of [undefined, 'https://evil.invalid', `${APP}?debug=1`, 'file:///D:/GSM/dist/other.html',
    `${DEV}/other.html`, `${DEV}/?debug=1`, 'http://127.0.0.1:5174/', 'http://localhost:5173/',
    'http://user:pass@127.0.0.1:5173/', 'javascript:alert(1)', `${DEV}/\n`]) {
    assert.equal(isTrustedDocument(value, APP, DEV), false, String(value));
  }
  for (const invalidDev of ['https://127.0.0.1:5173', 'http://example.invalid:5173', `${DEV}/page`, `${DEV}/?x=1`, `${DEV}/#x`, 'http://127.0.0.1']) {
    assert.equal(isTrustedDocument(invalidDev, APP, invalidDev), false, invalidDev);
  }
  assert.equal(isTrustedDocument(DEV, APP, undefined), false);
});

test('IPC checks window, main frame, document, and destroyed frame before handler side effects', () => {
  const f = fixture(); let calls = 0;
  f.ipc.handle('x-auth:get', () => { calls++; return 'secret-fixture'; });
  const get = f.handlers.get('x-auth:get');
  assert.equal(get(f.event), 'secret-fixture');
  for (const event of [{ ...f.event, sender: {} }, { ...f.event, senderFrame: { url: APP } }, {}]) {
    assert.throws(() => get(event), /DESKTOP_IPC_DENIED/);
  }
  f.wc.mainFrame.url = 'https://evil.invalid/'; assert.throws(() => get(f.event), /DESKTOP_IPC_DENIED/);
  f.wc.mainFrame.url = DEV; assert.equal(get(f.event), 'secret-fixture');
  f.wc.isDestroyed = () => true; assert.throws(() => get(f.event), /DESKTOP_IPC_DENIED/);
  assert.equal(calls, 2);
});

test('all privileged module handlers reject an external main frame through the shared registrar', async () => {
  const f = fixture('https://evil.invalid/');
  const trust = e => isTrustedMainFrame(e, f.window, APP, DEV);
  const forbiddenService = new Proxy({}, { get() { throw new Error('Unexpected service access'); } });
  registerAgyIpc({ ipcMain: f.ipc, isMainFrame: trust, getService: () => forbiddenService });
  registerWebdavIpc({ ipcMain: f.ipc, isMainFrame: trust, fetchImpl: () => { throw new Error('Unexpected fetch'); } });
  const monitor = new EventEmitter();
  const detach = registerHtmlReadingIpc({ ipcMain: f.ipc, isMainFrame: trust, service: forbiddenService, getWindow: () => f.window, powerMonitor: monitor });
  createPluginIpcRegistrar({ ipcMain: f.ipc, getWindow: () => f.window, getHostURL: () => APP })('plugins:list', () => forbiddenService.list());
  try {
    for (const [channel, handler] of f.handlers) await assert.rejects(async () => handler(f.event, 'request-fixture'), /DESKTOP_IPC_DENIED/, channel);
    // Scheduling must not send generation payloads or consume a day's attempt in an untrusted document.
    assert.doesNotThrow(() => monitor.emit('resume'));
  } finally { detach(); }
});

test('main navigation, redirects and popups deny untrusted documents and unsafe external schemes', async () => {
  const f = fixture(); const external = [];
  registerMainDocumentNavigation(f.wc, url => isTrustedDocument(url, APP, DEV), url => external.push(url));
  for (const kind of ['will-navigate', 'will-frame-navigate', 'will-redirect']) {
    const event = { url: 'https://example.invalid', isMainFrame: true, prevented: false, preventDefault() { this.prevented = true; } };
    f.wc.emit(kind, event, event.url, false, true); assert.equal(event.prevented, true);
    const local = { ...event, url: APP, prevented: false };
    f.wc.emit(kind, local, APP, false, true); assert.equal(local.prevented, false);
  }
  assert.deepEqual(f.wc.open({ url: 'file:///D:/secret.txt' }), { action: 'deny' });
  assert.deepEqual(f.wc.open({ url: 'https://example.invalid/popup' }), { action: 'deny' });
  await Promise.resolve(); assert.deepEqual(external, ['https://example.invalid/popup']);
  for (const url of ['javascript:alert(1)', 'file:///D:/secret', 'data:text/html,hello', 'custom://launch', 'https://user:pass@example.invalid']) {
    assert.equal(isSafeExternalUrl(url), false, url);
  }
  assert.ok(isSafeExternalUrl('mailto:hello@example.invalid'));
  const frame = { isMainFrame: false, url: 'gsm-plugin://fixture/page', preventDefault() { throw new Error('Main policy must not handle plugin subframe'); } };
  f.wc.emit('will-frame-navigate', frame);
});

test('blocked navigation leaves plugin host usable instead of entering a permanent navigating state', () => {
  const f = fixture(); let revoked = 0;
  registerMainDocumentNavigation(f.wc, url => isTrustedDocument(url, APP), () => {});
  const policy = registerPluginPageNavigation(f.wc, () => ({ revokePageSessions() { revoked++; } }));
  const event = { isMainFrame: true, url: 'https://evil.invalid', defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
  f.wc.emit('will-frame-navigate', event);
  assert.equal(policy.isNavigating(), false); assert.equal(revoked, 0);
});

test('main-process registration cannot bypass the shared IPC boundary', () => {
  const source = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8');
  assert.doesNotMatch(source, /\bipcMain\.(?:handle|on|once)\s*\(/);
  assert.doesNotMatch(source, /register(?:Agy|Webdav|HtmlReading)Ipc\(\{\s*ipcMain\s*[,}]/);
  assert.doesNotMatch(source, /createPluginIpcRegistrar\(\{\s*ipcMain\s*[,}]/);
  for (const name of ['registerAgyIpc', 'registerWebdavIpc', 'registerHtmlReadingIpc', 'createPluginIpcRegistrar']) {
    assert.match(source, new RegExp(`${name}\\(\\{\\s*ipcMain: trustedIpcMain`));
  }
});
