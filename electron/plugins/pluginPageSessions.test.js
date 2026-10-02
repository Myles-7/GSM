const assert = require('node:assert/strict');
const test = require('node:test');
const { createPageSessions } = require('./pluginPageSessions');

test('binds plugin/page/token, prevents completed replay and revokes old/reopened sessions', () => {
  const sessions = createPageSessions();
  const sessionToken = sessions.open('com.example.page', 'one');
  const request = { pluginId: 'com.example.page', pageId: 'one', sessionToken, requestId: '1' };
  assert.equal(sessions.current({ ...request, pageId: 'two' }), false);
  assert.equal(sessions.current({ ...request, pluginId: 'com.other.page' }), false);
  sessions.acquire(request)();
  assert.throws(() => sessions.acquire(request), { code: 'PLUGIN_PAGE_RATE_LIMITED' });
  sessions.open(request.pluginId, request.pageId);
  assert.throws(() => sessions.acquire({ ...request, requestId: '2' }), { code: 'PLUGIN_PAGE_CLOSED' });
  const other = { ...request, sessionToken: sessions.open(request.pluginId, 'two'), pageId: 'two' };
  sessions.revoke(request.pluginId);
  assert.equal(sessions.current(other), false);
});

test('holds eight slots, enforces sliding-minute rate, and lets close revoke under saturation', (t) => {
  let now = 1000;
  t.mock.method(Date, 'now', () => now);
  const sessions = createPageSessions();
  const request = { pluginId: 'com.example.page', pageId: 'one', sessionToken: sessions.open('com.example.page', 'one') };
  const release = [];
  for (let i = 0; i < 8; i++) release.push(sessions.acquire({ ...request, requestId: String(i) }));
  assert.throws(() => sessions.acquire({ ...request, requestId: '9' }), { code: 'PLUGIN_PAGE_RATE_LIMITED' });
  release.forEach((finish) => finish());
  for (let i = 8; i < 120; i++) sessions.acquire({ ...request, requestId: String(i) })();
  assert.throws(() => sessions.acquire({ ...request, requestId: '120' }), { code: 'PLUGIN_PAGE_RATE_LIMITED' });
  now += 60000;
  sessions.acquire({ ...request, requestId: '120' })();
  assert.throws(() => sessions.acquire({ ...request, requestId: '1' }), { code: 'PLUGIN_PAGE_RATE_LIMITED' });
  sessions.close(request);
  assert.equal(sessions.current(request), false);
});
