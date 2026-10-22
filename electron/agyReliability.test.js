const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { createAgyWorker, createAgyWorkspace, runAgy } = require('./agyRuntime');
const { AgyQueue } = require('./agyQueue');
const { AgyError } = require('./agyProtocol');
const { createAgyDesktop, DEFAULT_PREFS } = require('./agyDesktop');
const secure = { isEncryptionAvailable: () => true, encryptString: text => Buffer.from(text).reverse(), decryptString: bytes => Buffer.from(bytes).reverse().toString() };

test('a Windows lock on an exited request directory does not block fresh isolated requests', async t => {
  const cwd = await createAgyWorkspace(); let blocked = true; const directories = [];
  const worker = createAgyWorker({ executable: 'fixture', cwd,
    runtime: async options => { directories.push(options.cwd); return { text: 'done', usage: {} }; },
    removeDirectory: async directory => {
      if (directory === directories[0] && blocked) throw Object.assign(Error('busy'), { code: 'EBUSY' });
      await fs.rm(directory, { recursive: true, force: true });
    } });
  t.after(async () => { blocked = false; await worker.close(); });
  assert.equal((await worker.request({ requestId: 'first' })).text, 'done');
  assert.equal(worker.state().degraded, true);
  assert.equal((await worker.request({ requestId: 'second' })).text, 'done');
  assert.notEqual(directories[0], directories[1]);
  assert.equal(worker.state().pendingCleanup, 1);
});

test('a worker preserves the original cleanup failure and retains the exact process lease', async t => {
  const cwd = await createAgyWorkspace(); let settle;
  const cleanupSettled = new Promise(resolve => { settle = resolve; });
  const worker = createAgyWorker({ executable: 'fixture', cwd, runtime: async () => {
    throw Object.assign(new AgyError('CLEANUP_TIMEOUT'), { cleanupSettled });
  } });
  t.after(async () => { settle(); await new Promise(resolve => setTimeout(resolve, 20)); await worker.close(); });
  await assert.rejects(worker.request({ requestId: 'failed' }), { code: 'CLEANUP_TIMEOUT' });
  assert.equal(worker.state().suspect, 1);
});
test('one failed recycle is retryable; no poisoned maintenance promise or forgotten directory', async t => {
  const cwd = await createAgyWorkspace(); let blocked = true, calls = 0;
  const worker = createAgyWorker({ executable: 'fixture', cwd, runtime: async () => { calls++; return { text: 'done', usage: {} }; },
    removeDirectory: async directory => { if (directory === cwd && blocked) throw Object.assign(Error('busy'), { code: 'EBUSY' }); await fs.rm(directory, { recursive: true, force: true }); } });
  t.after(async () => { blocked = false; await worker.close(); });
  await assert.rejects(worker.recycle(), { code: 'EBUSY' });
  assert.equal(worker.state().degraded, true);
  await assert.rejects(worker.request({ requestId: 'blocked' }), { code: 'EBUSY' });
  assert.equal(calls, 0); blocked = false;
  await worker.recover();
  assert.equal((await worker.request({ requestId: 'recovered' })).text, 'done');
  assert.equal(worker.state().degraded, false); assert.equal(calls, 1);
});
test('admission timeout is terminal and explicitly unsent; suspect recovery cannot force-clear capacity', async () => {
  const queue = new AgyQueue(1); let close;
  await queue.run('a', 'first', async () => ({ cleanupSettled: new Promise(resolve => { close = resolve; }) }));
  assert.throws(() => queue.recover(), { code: 'RECOVERY_REQUIRED' });
  await assert.rejects(queue.run('a', 'deferred', () => assert.fail('must not run'), { maxQueued: 2, waitMs: 10, deferOnTimeout: true }),
    error => error.code === 'RESOURCE_DEFERRED' && error.details.sent === false);
  assert.equal(queue.state().queued, 0); close(); await Promise.resolve(); queue.recover(); await queue.shutdown();
});
test('durable beforePrompt hook is awaited and a failed write sends no prompt', async () => {
  const child = new EventEmitter(); child.pid = 1; child.stdin = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
  let sends = 0, rejectWrite;
  child.stdin.end = () => { sends++; };
  const pending = runAgy({ executable: 'fixture', cwd: __dirname, prompt: 'synthetic',
    spawnProcess: () => child, beforePrompt: () => new Promise((_resolve, reject) => { rejectWrite = reject; }),
    terminateProcess: () => child.emit('close', 1) });
  child.stdout.emit('data', Buffer.from(`${JSON.stringify({ event: 'init', init: { tools: [] } })}\n`));
  await Promise.resolve(); assert.equal(sends, 0); rejectWrite(new AgyError('RECOVERY_WRITE_FAILED'));
  await assert.rejects(pending, { code: 'RECOVERY_WRITE_FAILED' }); assert.equal(sends, 0);
});
for (const success of [true, false]) test(`probe ${success ? 'success' : 'failure'} retains cleanup capacity and cwd until exact exit`, async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'gsm-agy-control-test-')); let close, cwd;
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const cleanupSettled = new Promise(resolve => { close = resolve; });
  const service = createAgyDesktop({ userDataPath: directory, safeStorage: secure, platform: 'win32', inspect: async () => ({ path: 'fixture', fingerprint: 'fixture' }),
    runtime: async options => { cwd = options.cwd;
      if (!success) throw Object.assign(new AgyError('CLEANUP_TIMEOUT'), { cleanupSettled });
      return { text: '{"answer":"连接成功","missing":[]}', usage: {}, cleanupSettled }; } });
  await service.detect(1, 'detect'); const result = await service.probe(1, 'probe');
  assert.equal(result.ok, true); assert.equal((await service.getState()).pool.suspect, 1);
  await fs.access(cwd); close(); await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal((await service.getState()).pool.suspect, 0); await service.shutdown();
});
test('saving new model keeps old healthy calls but blocks untested profile; timeout changes preserve readiness', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'gsm-agy-config-test-')); let calls = 0;
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const service = createAgyDesktop({ userDataPath: directory, safeStorage: secure, platform: 'win32', inspect: async () => ({ path: 'fixture', fingerprint: 'fixture' }),
    runtime: async () => { calls++; return { text: '{"answer":"连接成功","missing":[]}', usage: {} }; } });
  service.setAccount(1, '42'); await service.detect(1, 'detect'); await service.probe(1, 'probe');
  await service.save(1, 'enable', { ...DEFAULT_PREFS, enabled: true, timeoutSeconds: 60 });
  const oldRevision = (await service.getState()).revision;
  const changed = await service.save(1, 'save', { ...DEFAULT_PREFS, enabled: true, model: 'untested', effort: 'max' });
  assert.equal(changed.value.requiresTest, true);
  const request = { system: 'test', user: 'test', model: 'untested', effort: 'max' };
  assert.equal((await service.generate(1, 'blocked', request)).code, 'TEST_REQUIRED'); assert.equal(calls, 1);
  assert.equal((await service.generate(1, 'old', { ...request, revision: oldRevision })).ok, true); assert.equal(calls, 2);
  await service.shutdown();
});

test('probe cancellation after a successful response retains its unsettled process lease', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'gsm-agy-cancel-lease-'));
  let settle, cwd;
  const cleanupSettled = new Promise(resolve => { settle = resolve; });
  const service = createAgyDesktop({ userDataPath: directory, safeStorage: secure, platform: 'win32', inspect: async () => ({ path: 'fixture', fingerprint: 'fixture' }),
    runtime: async options => { cwd = options.cwd; service.cancel(1, 'probe'); return { text: '{"answer":"连接成功","missing":[]}', usage: {}, cleanupSettled }; } });
  t.after(async () => { settle(); await service.shutdown(); await fs.rm(directory, { recursive: true, force: true }); });
  await service.detect(1, 'detect');
  const result = await service.probe(1, 'probe');
  assert.equal(result.code, 'CANCELED'); assert.equal((await service.getState()).pool.suspect, 1);
  await fs.access(cwd); settle(); await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal((await service.getState()).pool.suspect, 0);
});

test('result encryption failure preserves success classification and pending process capacity', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'gsm-agy-result-lease-'));
  let settle, cwd, encryptions = 0;
  const cleanupSettled = new Promise(resolve => { settle = resolve; });
  const service = createAgyDesktop({ userDataPath: directory,
    safeStorage: { ...secure, encryptString: text => { if (++encryptions === 2) throw Error('fixture terminal write unavailable'); return secure.encryptString(text); } },
    platform: 'win32', inspect: async () => ({ path: 'fixture', fingerprint: 'fixture' }), runtime: async options => {
      if (options.beforePrompt) { cwd = options.cwd; await options.beforePrompt(); return { text: 'generated', usage: {}, cleanupSettled }; }
      return { text: '{"answer":"连接成功","missing":[]}', usage: {} };
    } });
  t.after(async () => { settle(); await service.shutdown(); await fs.rm(directory, { recursive: true, force: true }); });
  service.setAccount(1, '42'); await service.detect(1, 'detect'); await service.probe(1, 'probe');
  await service.save(1, 'enable', { ...DEFAULT_PREFS, enabled: true });
  const result = await service.generate(1, 'write-failure', { system: 'fixture', user: 'input', model: '', effort: 'medium' });
  assert.equal(result.code, 'RECOVERY_WRITE_FAILED'); assert.equal(result.details.providerOutcome, 'succeeded');
  assert.equal((await service.getState()).pool.suspect, 1); await fs.access(cwd);
  settle(); await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal((await service.getState()).pool.suspect, 0);
});
