const test = require('node:test');
const assert = require('node:assert/strict');
const { registerAgyIpc } = require('./agyIpc');

test('account changes and window destruction cancel owners and suppress late events/results', async () => {
  const handlers = new Map(), canceled = [], sent = [], destroyed = new Map(), releases = [];
  const service = {
    cancel: (...args) => canceled.push(args),
    generate: (owner, id, request, emit) => new Promise(resolve => releases.push(() => { emit({ type: 'text', text: 'late' }); resolve({ ok: true, value: { text: 'late' } }); })),
  };
  registerAgyIpc({ ipcMain: { handle: (key, handler) => handlers.set(key, handler) }, isMainFrame: () => true, getService: () => service });
  const event = owner => ({ sender: { id: owner, once: (_, callback) => destroyed.set(owner, callback), isDestroyed: () => false, send: (...args) => sent.push(args) } });
  const first = event(1), second = event(2);
  handlers.get('agy:setSession')(first, 'account-one');
  handlers.get('agy:setSession')(second, 'other-window');
  const a = handlers.get('agy:start')(first, 'same-id', 'account-one', {});
  const b = handlers.get('agy:start')(second, 'same-id', 'other-window', {});
  assert.equal((await handlers.get('agy:start')(first, 'same-id', 'account-one', {})).code, 'DUPLICATE_REQUEST');
  handlers.get('agy:setSession')(first, 'account-two');
  destroyed.get(2)();
  releases.forEach(release => release());
  assert.deepEqual(await a, { ok: false, code: 'SESSION_CHANGED' });
  assert.deepEqual(await b, { ok: false, code: 'SESSION_CHANGED' });
  assert.equal(sent.length, 0);
  assert.ok(canceled.filter(([owner]) => owner === 1).length >= 2);
  assert.ok(canceled.filter(([owner]) => owner === 2).length >= 2);
});

test('only main frame may invoke diagnostics and no prompt or path IPC exists', async () => {
  const handlers = new Map(), calls = [];
  const service = new Proxy({}, { get: (_, operation) => (...args) => { calls.push({ operation, args }); return {}; } });
  registerAgyIpc({ ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
    isMainFrame: event => event.authorized, getService: () => service });
  for (const [channel, handle] of handlers) {
    if (channel === 'agy:getState' || channel === 'agy:setSession') assert.throws(() => handle({ authorized: false }), /IPC_DENIED/);
    else await handle({ authorized: false }, 'request', { executable: 'evil.exe' });
  }
  assert.equal(calls.length, 0);
  assert.equal(handlers.has('agy:start'), true);
  handlers.get('agy:detect')({ authorized: true, sender: { id: 7 } }, 'request', 'evil.exe');
  assert.deepEqual(calls, [{ operation: 'detect', args: [7, 'request'] }]);
});
