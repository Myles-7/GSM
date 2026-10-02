const assert = require('node:assert/strict');
const test = require('node:test');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const { isTrustedPluginFrame, createPluginIpcRegistrar, registerPluginPageNavigation } = require('./pluginIpc');

const entry = 'file:///C:/fixture/dist/index.html';
function host(url = entry) {
  const webContents = new EventEmitter();
  webContents.mainFrame = { url };
  webContents.isDestroyed = () => false;
  const window = { webContents, isDestroyed: () => false };
  return { window, event: { sender: webContents, senderFrame: webContents.mainFrame } };
}

test('plugin IPC trusts the selected local document, not opaque file origin or window identity alone', () => {
  const { window, event } = host();
  assert.equal(isTrustedPluginFrame(event, window, entry), true);
  event.senderFrame.url = `${entry}#/repositories`;
  assert.equal(isTrustedPluginFrame(event, window, entry), true);
  for (const url of [
    'https://hostile.example/index.html', 'file:///C:/fixture/other.html',
    `${entry}?hostile=1`, 'data:text/html,hostile', 'about:blank',
    'plugin-page://com.example.page/one/index.html', 'not a URL',
  ]) {
    event.senderFrame.url = url;
    assert.equal(isTrustedPluginFrame(event, window, entry), false, url);
  }
  event.senderFrame = { url: entry };
  assert.equal(isTrustedPluginFrame(event, window, entry), false, 'subframe with trusted URL');
  assert.equal(isTrustedPluginFrame({ ...event, sender: {} }, window, entry), false);
  assert.equal(isTrustedPluginFrame(event, null, entry), false);
});

test('development trusts only the configured loopback origin with no credentials', () => {
  const { window, event } = host('http://localhost:5173/#/repositories');
  const allowed = (dev) => isTrustedPluginFrame(event, window, null, dev);
  assert.equal(allowed('http://localhost:5173'), true);
  for (const url of ['http://localhost:5174', 'https://localhost:5173', 'http://127.0.0.1:5173',
    'http://user:secret@localhost:5173', 'https://hostile.example', 'blob:http://localhost:5173/fixture']) {
    event.senderFrame.url = url;
    assert.equal(allowed('http://localhost:5173'), false, url);
  }
  event.senderFrame.url = 'https://hostile.example';
  assert.equal(allowed('https://hostile.example'), false, 'remote development URL fails closed');
  event.senderFrame.url = entry;
  assert.equal(allowed('http://localhost:5173'), false, 'dev mode must not trust a file fallback');
});

test('registrar denies before any handler side effects, including during navigation', async () => {
  const { window, event } = host();
  const handlers = new Map();
  let calls = 0;
  let navigating = false;
  const handle = createPluginIpcRegistrar({
    ipcMain: { handle: (channel, callback) => handlers.set(channel, callback) },
    getWindow: () => window, getHostURL: () => entry,
    isNavigating: () => navigating,
  });
  handle('plugins:requestPageCapability', async (_event, value) => { calls++; return value; });
  handle('plugins:list', () => { calls++; return { plugins: [] }; }, { plugins: [], invalidPlugins: [] });
  handle('plugins:getSearchEndpoint', () => { calls++; return { endpoint: 'secret' }; }, { endpoint: null });
  assert.throws(() => handle('other:channel', () => null), /plugins:/);
  assert.equal(await handlers.get('plugins:requestPageCapability')(event, 'valid'), 'valid');
  event.senderFrame.url = 'https://hostile.example';
  assert.equal((await handlers.get('plugins:requestPageCapability')(event)).error.code, 'PLUGIN_IPC_DENIED');
  assert.deepEqual(await handlers.get('plugins:list')(event), { plugins: [], invalidPlugins: [] });
  assert.deepEqual(await handlers.get('plugins:getSearchEndpoint')(event), { endpoint: null });
  event.senderFrame.url = entry;
  navigating = true;
  assert.equal((await handlers.get('plugins:requestPageCapability')(event)).error.code, 'PLUGIN_IPC_DENIED');
  assert.equal(calls, 1);
});

test('navigation revokes before commit, retains initial blank frame sessions and same-document routes', () => {
  const { window } = host();
  const revoked = [];
  const lifecycle = registerPluginPageNavigation(window.webContents, () => ({
    revokePageSessions: (...args) => revoked.push(args),
  }));
  const emit = (name, detail) => window.webContents.emit(name, detail);
  emit('did-start-navigation', { isMainFrame: false, isSameDocument: false, frame: { url: 'about:blank' } });
  assert.deepEqual(revoked, []);
  emit('did-start-navigation', { isMainFrame: true, isSameDocument: true });
  assert.deepEqual(revoked, []);
  emit('did-start-navigation', { isMainFrame: false, isSameDocument: false,
    frame: { url: 'plugin-page://com.example.page/one/index.html' } });
  assert.deepEqual(revoked, [['com.example.page']]);
  emit('will-frame-navigate', { isMainFrame: false, isSameDocument: false,
    frame: { url: 'plugin-page://com.example.page/one/index.html' }, url: 'https://blocked.example' });
  assert.deepEqual(revoked.at(-1), ['com.example.page']);
  emit('did-start-navigation', { isMainFrame: true, isSameDocument: false });
  assert.deepEqual(revoked.at(-1), []);
  assert.equal(lifecycle.isNavigating(), true);
  emit('dom-ready', {});
  assert.equal(lifecycle.isNavigating(), false);
  emit('render-process-gone', {});
  assert.equal(lifecycle.isNavigating(), true);
  assert.deepEqual(revoked.at(-1), []);
  emit('destroyed', {});
  assert.deepEqual(revoked.at(-1), []);
});

test('production uses guarded registration for every plugin IPC and injects native host output', () => {
  const source = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8');
  assert.doesNotMatch(source, /ipcMain\.handle\('plugins:/);
  assert.equal((source.match(/handlePluginIpc\('plugins:/g) || []).length, 17);
  assert.match(source, /hostOperations:\s*createPluginHostOperations\(\{\s*clipboard,\s*nativeImage,\s*ClipboardItem,\s*dialog,\s*fs,\s*path,\s*getWindow:\s*\(\)\s*=>\s*mainWindow/);
  assert.match(source, /registerPluginPageNavigation\(mainWindow\.webContents,\s*\(\)\s*=>\s*pluginManager\)/);
  assert.match(source, /trustedPluginHostURL\s*=\s*pathToFileURL\(indexPath\)\.href/);
  assert.match(source, /trustedPluginHostURL\s*=\s*pathToFileURL\(fallbackPath\)\.href/);
});
