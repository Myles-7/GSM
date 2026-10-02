const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { registerWebdavIpc, isTrustedWebdavFrame } = require('./webdavIpc');

const appUrl = 'file:///isolated/dist/index.html';
const request = extra => ({
  requestId: 'request-1', url: 'https://dav.example/backup/data.json', method: 'GET', ...extra,
});
function fixture(fetchImpl = async () => new Response('body'), options = {}) {
  const handlers = new Map();
  const sender = new EventEmitter();
  sender.mainFrame = { url: appUrl };
  const window = { isDestroyed: () => false, webContents: sender };
  const event = { sender, senderFrame: sender.mainFrame };
  const calls = [];
  registerWebdavIpc({
    ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
    isMainFrame: event => isTrustedWebdavFrame(event, window, appUrl),
    fetchImpl: (...args) => { calls.push(args); return fetchImpl(...args); },
    ...options,
  });
  return {
    sender, event, window, calls,
    send: (params = request(), source = event) => handlers.get('webdav-request')(source, params),
    cancel: (id = 'request-1', source = event) => handlers.get('webdav-cancel')(source, id),
  };
}
const tick = () => new Promise(resolve => setImmediate(resolve));

test('trust requires the actual app main frame, not a matching URL in a child or other window', () => {
  const { event, window } = fixture();
  assert.equal(isTrustedWebdavFrame(event, window, appUrl), true);
  event.senderFrame.url += '#settings';
  assert.equal(isTrustedWebdavFrame(event, window, appUrl), true);
  assert.equal(isTrustedWebdavFrame({ ...event, senderFrame: { url: appUrl } }, window, appUrl), false);
  assert.equal(isTrustedWebdavFrame({ ...event, sender: {} }, window, appUrl), false);
  for (const url of ['file:///isolated/dist/other.html', `${appUrl}?evil=1`, 'https://dav.example/', 'data:text/html,app']) {
    event.senderFrame.url = url;
    assert.equal(isTrustedWebdavFrame(event, window, appUrl), false);
  }
  assert.equal(isTrustedWebdavFrame(event, null, appUrl), false);
});

test('development trust is limited to the configured loopback HTTP origin', () => {
  const { event, window } = fixture();
  event.senderFrame.url = 'http://localhost:5173/#settings';
  assert.equal(isTrustedWebdavFrame(event, window, appUrl, 'http://localhost:5173'), true);
  for (const dev of ['http://localhost:5174', 'http://remote.example:5173', 'https://localhost:5173']) {
    assert.equal(isTrustedWebdavFrame(event, window, appUrl, dev), false);
  }
  event.senderFrame.url = 'http://127.0.0.1:5173';
  assert.equal(isTrustedWebdavFrame(event, window, appUrl, 'http://localhost:5173'), false);
});

test('untrusted request and cancellation never touch the network', async () => {
  const f = fixture();
  const child = { ...f.event, senderFrame: { url: appUrl } };
  assert.equal((await f.send(request(), child)).success, false);
  assert.equal(f.cancel('request-1', child).success, false);
  assert.equal(f.calls.length, 0);
});

const invalid = [
  null, [], request({ requestId: '../bad' }), request({ requestId: 'x'.repeat(129) }),
  request({ url: 'file:///secret' }), request({ url: 'ftp://dav.example/' }),
  request({ url: 'https://alice:secret@dav.example/' }), request({ url: 'https://dav.example/#fragment' }),
  request({ url: 'https://dav.example/\nsecret' }), request({ url: 'x'.repeat(8193) }),
  request({ url: `https://dav.example/${'\u00e9'.repeat(4100)}` }),
  request({ method: 'CONNECT' }), request({ method: 'TRACE' }), request({ method: 'GET ', body: 'text' }),
  request({ body: 'body' }), request({ method: 'PUT', body: {} }),
  request({ method: 'PUT', body: '\u00e9'.repeat(32 * 1024 * 1024 + 1) }),
  request({ headers: [] }), request({ headers: { Cookie: 'secret' } }),
  request({ headers: { Host: 'evil.example' } }), request({ headers: { Origin: 'evil.example' } }),
  request({ headers: { Authorization: 'Basic good\r\nCookie: bad' } }),
  request({ headers: { Authorization: 'x'.repeat(8193) } }),
  request({ headers: { Authorization: 'x'.repeat(8000), Accept: 'x'.repeat(8000), If: 'x'.repeat(8000) } }),
  request({ headers: { Accept: 'text/xml', accept: '*/*' } }),
  request({ headers: { Depth: '2' } }), request({ headers: { Accept: 1 } }),
  request({ headers: { Destination: 'https://evil.example/data' } }),
  request({ headers: { Destination: 'https://user:pass@dav.example/data' } }),
  request({ headers: { Destination: 'https://dav.example/data#frag' } }),
];
for (const [index, params] of invalid.entries()) {
  test(`invalid DAV input ${index} is rejected before fetch`, async () => {
    const f = fixture();
    assert.equal((await f.send(params)).success, false);
    assert.equal(f.calls.length, 0);
  });
}

test('DAV methods, inline auth, text body and bounded metadata round-trip without cookies or redirects', async () => {
  const f = fixture(async () => new Response('<xml/>', {
    status: 207, statusText: 'Multi-Status',
    headers: { 'content-type': 'application/xml', dav: '1,2', server: 'fixture', 'set-cookie': 'secret' },
  }));
  const result = await f.send(request({
    method: 'propfind', headers: { Authorization: 'Basic inline-new', Depth: '1', 'Content-Type': 'application/xml' },
    body: '<propfind/>', timeoutMs: 15_000,
  }));
  assert.deepEqual(result, {
    success: true, status: 207, statusText: 'Multi-Status', body: '<xml/>',
    headers: { 'content-type': 'application/xml', server: 'fixture', dav: '1,2' },
  });
  assert.equal(f.calls[0][1].redirect, 'error');
  assert.equal(f.calls[0][1].headers.authorization, 'Basic inline-new');
  assert.equal(f.calls[0][1].body, '<propfind/>');
  assert.ok(f.calls[0][1].signal instanceof AbortSignal);
});

test('duplicate IDs and per-owner concurrency are bounded; completed IDs can be reused', async () => {
  const f = fixture(() => new Promise(() => {}));
  const pending = [];
  for (let index = 0; index < 8; index++) pending.push(f.send(request({ requestId: `id-${index}` })));
  assert.match((await f.send(request({ requestId: 'id-0' }))).error, /Duplicate/);
  assert.match((await f.send(request({ requestId: 'ninth' }))).error, /Too many/);
  for (let index = 0; index < 8; index++) assert.equal(f.cancel(`id-${index}`).success, true);
  assert.ok((await Promise.all(pending)).every(result => result.canceled));
  const retry = f.send(request({ requestId: 'id-0' }));
  assert.equal(f.cancel('id-0').success, true);
  assert.equal((await retry).canceled, true);
});

test('cancellation requires the request owner and frame', async () => {
  const f = fixture(() => new Promise(() => {}), { isMainFrame: () => true });
  const pending = f.send();
  assert.equal(f.cancel('request-1', { ...f.event, sender: new EventEmitter() }).success, false);
  assert.equal(f.cancel('request-1', { ...f.event, senderFrame: {} }).success, false);
  assert.equal(f.cancel('bad/id').success, false);
  assert.equal(f.cancel().success, true);
  assert.equal((await pending).canceled, true);
  assert.equal(f.calls[0][1].signal.aborted, true);
});

test('abort through a stalled body cancels the reader and releases the request', async () => {
  let canceled = false;
  const f = fixture(async () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(new TextEncoder().encode('partial')); },
    cancel() { canceled = true; },
  })));
  const pending = f.send();
  await tick();
  f.cancel();
  assert.equal((await pending).canceled, true);
  await tick();
  assert.equal(canceled, true);
  assert.equal(f.calls[0][1].signal.aborted, true);
});

test('timeouts abort the underlying fetch and remain active through body consumption', async () => {
  let canceled = false;
  const f = fixture(async () => new Response(new ReadableStream({ cancel() { canceled = true; } })));
  const result = await f.send(request({ timeoutMs: 1 }));
  assert.equal(result.timedOut, true);
  assert.equal(result.canceled, false);
  assert.equal(f.calls[0][1].signal.aborted, true);
  await tick();
  assert.equal(canceled, true);
});

for (const [name, args] of [
  ['destroyed', []], ['render-process-gone', [{}, {}]],
  ['did-start-navigation', [{}, 'https://evil.example/', false, true]],
]) {
  test(`${name} aborts in-flight requests without returning partial data`, async () => {
    const f = fixture(() => new Promise(() => {}));
    const pending = f.send();
    f.sender.emit(name, ...args);
    assert.equal((await pending).canceled, true);
    assert.equal(f.calls[0][1].signal.aborted, true);
  });
}

test('same-document and child navigations do not cancel the main frame request', async () => {
  let resolve;
  const f = fixture(() => new Promise(done => { resolve = done; }));
  const pending = f.send();
  f.sender.emit('did-start-navigation', {}, `${appUrl}#settings`, true, true);
  f.sender.emit('did-start-navigation', {}, 'https://child.example/', false, false);
  assert.equal(f.calls[0][1].signal.aborted, false);
  resolve(new Response('ok'));
  assert.equal((await pending).success, true);
});

test('late responses from a navigated frame are discarded', async () => {
  let resolve;
  const f = fixture(() => new Promise(done => { resolve = done; }));
  const pending = f.send();
  f.event.senderFrame.url = 'https://evil.example/';
  resolve(new Response('private'));
  assert.deepEqual(await pending, { success: false, error: 'DAV request canceled', canceled: true });
});

test('response size limit is enforced while streaming and cancels the transport', async () => {
  let canceled = false;
  const f = fixture(async () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(64 * 1024 * 1024 + 1)); },
    cancel() { canceled = true; },
  })));
  assert.deepEqual(await f.send(), { success: false, error: 'DAV request failed' });
  assert.equal(canceled, true);
  assert.equal(f.calls[0][1].signal.aborted, true);
});

test('network errors do not disclose credentials and the owned dispatcher is destroyed', async () => {
  let destroyed = false;
  const dispatcher = { destroy: async () => { destroyed = true; } };
  const f = fixture(async () => { throw new Error('https://alice:secret@proxy.invalid'); }, {
    getDispatcher: () => dispatcher,
  });
  assert.deepEqual(await f.send(), { success: false, error: 'DAV request failed' });
  assert.equal(destroyed, true);
});

test('all explicitly allowed DAV methods use the same constrained transport', async () => {
  const f = fixture(async (_url, init) => new Response(init.method === 'HEAD' ? null : 'ok'));
  for (const method of ['GET', 'HEAD', 'PUT', 'POST', 'DELETE', 'OPTIONS', 'PROPFIND', 'PROPPATCH', 'MKCOL', 'COPY', 'MOVE', 'LOCK', 'UNLOCK']) {
    assert.equal((await f.send(request({ method }))).success, true);
  }
});

test('declared oversized bodies are rejected before any reader read', async () => {
  let reads = 0, canceled = false;
  const f = fixture(async () => ({
    headers: new Headers({ 'content-length': `${64 * 1024 * 1024 + 1}` }),
    body: { getReader: () => ({
      read: async () => { reads++; return { done: true }; },
      cancel: async () => { canceled = true; }, releaseLock() {},
    }) },
  }));
  assert.equal((await f.send()).success, false);
  assert.equal(reads, 0);
  assert.equal(canceled, true);
});

test('oversized returned metadata is rejected without echoing arbitrary server headers', async () => {
  const f = fixture(async () => new Response('ok', {
    headers: { server: 'x'.repeat(16 * 1024 + 1) },
  }));
  assert.deepEqual(await f.send(), { success: false, error: 'DAV request failed' });
});

test('proxy initialization failure is sanitized and cannot bypass the configured proxy', async () => {
  const f = fixture(async () => new Response('unexpected'), {
    getDispatcher: () => { throw new Error('proxy://user:secret@proxy.example'); },
  });
  assert.deepEqual(await f.send(), { success: false, error: 'DAV request failed' });
  assert.equal(f.calls.length, 0);
});

test('proxy teardown cannot make cancellation hang or leak a synchronous failure', async () => {
  for (const destroy of [() => new Promise(() => {}), () => { throw new Error('proxy credentials'); }]) {
    const f = fixture(() => new Promise(() => {}), { getDispatcher: () => ({ destroy }) });
    const pending = f.send();
    f.cancel();
    const result = await Promise.race([pending, new Promise(resolve => setTimeout(() => resolve('hung'), 100))]);
    assert.equal(result.canceled, true);
  }
});
