const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createTrustedIpcMain } = require('./trustedRenderer');
const { registerDiagnosticsIpc } = require('./diagnosticsIpc');

test('diagnostics read/write/export and unload share trust; export deep-redacts historic data', async () => {
  const bus = new EventEmitter(), handlers = new Map(); let trusted = false, written = 0, flushed = 0;
  bus.handle = (name, handler) => handlers.set(name, handler);
  const ipc = createTrustedIpcMain({ ipcMain: bus, isTrusted: () => trusted });
  const detach = registerDiagnosticsIpc({ ipcMain: ipc, getLogger: () => ({
    ingestRenderer: entries => { written += entries.length; return { success: true }; },
    flushSync: () => { flushed++; },
    readTail: async () => [{ data: { password: 'private-password', requestBody: 'private project', nested: { token: 'secret-token' } }, message: 'auth_token=private-cookie ct0=private-csrf' }],
  }), getSystemInfo: async () => ({ credentials: 'private-config' }) });
  for (const handler of handlers.values()) await assert.rejects(async () => handler({}, {}), /DESKTOP_IPC_DENIED/);
  bus.emit('diagnostics:flush', {}, { entries: [{ message: 'denied' }] });
  assert.equal(written, 0); assert.equal(flushed, 0);
  trusted = true;
  bus.emit('diagnostics:flush', {}, { entries: [{ message: 'allowed' }] });
  assert.equal(written, 1); assert.equal(flushed, 1);
  const bundle = await handlers.get('diagnostics:exportBundle')({}, {}), text = JSON.stringify(bundle);
  assert.doesNotMatch(text, /private-password|private project|secret-token|private-cookie|private-csrf|private-config/);
  assert.equal(bundle.entries[0].data.requestBody, undefined);
  assert.equal((await handlers.get('diagnostics:append')({}, { entries: Array(201).fill({}) })).success, false);
  detach(); assert.equal(bus.listenerCount('diagnostics:flush'), 0);
});
