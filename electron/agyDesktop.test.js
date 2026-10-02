const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { AgyError } = require('./agyProtocol');
const { DEFAULT_PREFS, validPrefs, parseModels, createAgyDesktop, inspectExecutable } = require('./agyDesktop');

async function setup(t, overrides = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'gsm-agy-test-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const service = createAgyDesktop({ userDataPath: directory, platform: 'win32',
    defaultExecutable: 'main-owned-path', selectExecutable: async () => 'native-picker-path',
    inspect: async candidate => ({ path: candidate, name: 'agy.exe', fingerprint: 'abc' }), ...overrides });
  return { service, directory };
}

test('validates all prefs and rejects executable, prompt or unknown fields', () => {
  assert.equal(validPrefs(DEFAULT_PREFS), true);
  for (const patch of [{ enabled: 'true' }, { executable: 'evil.exe' }, { prompt: 'secret' },
    { model: '--agent=evil' }, { mode: 'shell' }, { effort: 'auto' }, { maxQueued: 51 }, { timeoutSeconds: 0 }]) {
    assert.equal(Boolean(validPrefs({ ...DEFAULT_PREFS, ...patch })), false);
  }
});

test('validates feature overrides and rejects malformed limits', () => {
  assert.equal(validPrefs({ ...DEFAULT_PREFS, featureOverrides: { 'repository-summary': { model: '', effort: 'max', concurrency: 2, timeoutSeconds: 40 } } }), true);
  for (const featureOverrides of [{ shell: {} }, { other: { executable: 'bad' } }, { other: { concurrency: 6 } }, { other: { timeoutSeconds: 19 } }, { other: { model: '--evil' } }]) {
    assert.equal(Boolean(validPrefs({ ...DEFAULT_PREFS, featureOverrides })), false);
  }
});

test('production generation pool runs five calls, respects overrides and keeps old revisions', async t => {
  const seen = [];
  const releases = [];
  let probing = true;
  const { service } = await setup(t, { runtime: async options => {
    if (probing) return { text: '{"answer":"连接成功","missing":[]}', usage: {} };
    seen.push({ model: options.model, effort: options.effort, timeoutMs: options.timeoutMs });
    return new Promise(resolve => releases.push(() => resolve({ text: 'done', usage: {} })));
  } });
  await service.detect(1, 'detect'); await service.probe(1, 'probe');
  const configured = await service.save(1, 'save', { ...DEFAULT_PREFS, enabled: true, featureOverrides: {
    'repository-summary': { model: 'summary-model', effort: 'high', concurrency: 2, timeoutSeconds: 90 },
    'repository-details': { model: 'detail-model', effort: 'low', concurrency: 3 },
  } });
  probing = false;
  const revision = configured.value.revision;
  const requests = Array.from({ length: 5 }, (_, index) => service.generate(index, `r${index}`, {
    system: 'test', user: 'test', revision, feature: index < 2 ? 'repository-summary' : 'repository-details',
  }));
  for (let i = 0; i < 100 && seen.length < 5; i++) await new Promise(resolve => setTimeout(resolve, 1));
  assert.equal(seen.length, 5);
  assert.equal((await service.getState()).pool.running, 5);
  assert.deepEqual(seen.filter(item => item.model === 'summary-model'), [1, 2].map(() => ({ model: 'summary-model', effort: 'high', timeoutMs: 90000 })));
  const changed = await service.save(1, 'changed', { ...configured.value.prefs, model: 'new-global', featureOverrides: {} });
  assert.equal(changed.ok, true);
  releases.splice(0).forEach(release => release());
  assert.ok((await Promise.all(requests)).every(result => result.ok));
  const old = service.generate(1, 'old', { system: 't', user: 't', revision, feature: 'repository-summary' });
  for (let i = 0; i < 100 && releases.length === 0; i++) await new Promise(resolve => setTimeout(resolve, 1));
  assert.equal(seen.at(-1).model, 'summary-model');
  releases.splice(0).forEach(release => release()); await old;
  await service.shutdown();
});

test('a failing feature probe does not disable the global configuration', async t => {
  let failure = false;
  const { service } = await setup(t, { runtime: async () => {
    if (failure) throw new AgyError('AUTH_REQUIRED');
    return { text: '{"answer":"连接成功","missing":[]}', usage: {} };
  } });
  await service.detect(1, 'detect'); await service.probe(1, 'probe');
  await service.save(1, 'save', { ...DEFAULT_PREFS, enabled: true });
  failure = true;
  const result = await service.probe(1, 'feature', 'repository-summary');
  assert.equal(result.value.featureProbes['repository-summary'].code, 'AUTH_REQUIRED');
  assert.equal(result.value.enabled, true);
  await service.shutdown();
});

test('parses tab-separated models without forwarding diagnostics', () => {
  assert.deepEqual(parseModels('Fetching models...\nmodel-one\tModel One\nmodel-one\tModel One\n'), [{ id: 'model-one', label: 'Model One' }]);
  assert.throws(() => parseModels('login required PRIVATE_SENTINEL'), /INVALID_MODELS/);
});

test('prefs survive restart and renderer can display the main-process selected executable path', async t => {
  const { service, directory } = await setup(t);
  assert.equal((await service.detect(1, 'detect')).ok, true);
  const saved = await service.save(1, 'save', { ...DEFAULT_PREFS, mode: 'research', model: 'test-model' });
  assert.equal(saved.value.enabled, false);
  assert.equal(saved.value.executable.path, 'main-owned-path');
  const restarted = createAgyDesktop({ userDataPath: directory, platform: 'win32' });
  assert.equal((await restarted.getState()).prefs.model, 'test-model');
  assert.equal((await restarted.getState()).enabled, false);
  assert.equal((await restarted.getState()).executable.fingerprint, 'abc');
});

test('probe records failed tool use without forwarding unsafe tool names', async t => {
  const { service } = await setup(t, { runtime: async () => { throw new AgyError('NATIVE_TOOL_CALL', { toolCount: 58, tools: ['run_command'] }); } });
  await service.detect(1, 'detect');
  const result = await service.probe(1, 'probe');
  assert.equal(result.value.lastProbe.toolCount, 58);
  assert.equal(result.value.lastProbe.promptsSent, 0);
  assert.equal(result.value.enabled, false);
  assert.equal(JSON.stringify(result).includes('run_command'), false);
});

test('advertised tools do not block test, enabling or generation', async t => {
  let sent = false;
  const { service } = await setup(t, { runtime: async options => {
    options.onInit?.({ tools: ['run_command'] }); options.onPromptSent?.(); sent = true;
    return { text: '{"answer":"连接成功","missing":[]}', usage: {} };
  } });
  await service.detect(1, 'detect');
  assert.deepEqual(await service.save(1, 'early', { ...DEFAULT_PREFS, enabled: true }), { ok: false, code: 'TEST_REQUIRED' });
  const result = await service.probe(1, 'probe');
  assert.equal(result.value.lastProbe.code, 'SUCCESS');
  assert.equal(result.value.lastProbe.toolCount, 1);
  assert.equal(sent, true);
  assert.equal((await service.save(1, 'enable', { ...DEFAULT_PREFS, enabled: true })).value.enabled, true);
  const generated = await service.generate(1, 'generation', { model: '', effort: 'medium', system: 'Test', user: 'Test' });
  assert.equal(generated.ok, true);
});

test('isolates owners, allows control reads during generation and cancels without late commits', async t => {
  let started;
  const running = new Promise(resolve => { started = resolve; });
  const { service } = await setup(t, { models: async () => [], runtime: ({ signal }) => new Promise((_, reject) => {
    started(); signal.addEventListener('abort', () => reject(new AgyError('CANCELED')), { once: true });
  }) });
  await service.detect(1, 'detect');
  const pending = service.probe(1, 'probe');
  await running;
  assert.deepEqual(await service.listModels(2, 'models'), { ok: true, value: [] });
  service.cancel(2, 'probe');
  assert.equal((await service.getState()).busy, true);
  service.cancel(1, 'wrong-id');
  assert.equal((await service.getState()).busy, true);
  service.cancel(1, 'probe');
  assert.deepEqual(await pending, { ok: false, code: 'CANCELED' });
  assert.equal((await service.getState()).lastProbe, null);
  assert.equal((await service.getState()).busy, false);
});

test('invalidates executable identity before starting a process', async t => {
  let hash = 'one', invoked = false;
  const { service } = await setup(t, {
    inspect: async candidate => ({ path: candidate, name: 'agy.exe', fingerprint: hash }),
    models: async () => { invoked = true; return []; },
  });
  await service.detect(1, 'detect');
  hash = 'two';
  assert.deepEqual(await service.listModels(1, 'models'), { ok: false, code: 'EXECUTABLE_CHANGED' });
  assert.equal(invoked, false);
});

test('shutdown waits for process cancellation and rejects new requests', async t => {
  let started, finish;
  const running = new Promise(resolve => { started = resolve; });
  const { service } = await setup(t, { runtime: ({ signal }) => new Promise((_, reject) => {
    started();
    signal.addEventListener('abort', () => { finish = () => reject(new AgyError('CANCELED')); }, { once: true });
  }) });
  await service.detect(1, 'detect');
  const pending = service.probe(1, 'probe');
  await running;
  let stopped = false;
  const shutdown = service.shutdown().then(() => { stopped = true; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(stopped, false);
  assert.deepEqual(await service.detect(1, 'new'), { ok: false, code: 'CANCELED' });
  finish();
  await pending;
  await shutdown;
  assert.equal(stopped, true);
});

test('native picker cancellation and IO errors do not leak file paths', async t => {
  const { service } = await setup(t, { selectExecutable: async () => null,
    inspect: async () => { throw new Error('PRIVATE_PATH'); } });
  assert.deepEqual(await service.choose(1, 'choose'), { ok: false, code: 'CANCELED' });
  assert.deepEqual(await service.detect(1, 'detect'), { ok: false, code: 'IO_FAILED' });
});

test('unsupported platforms never execute detection', async t => {
  const { service } = await setup(t, { platform: 'linux', inspect: () => { throw Error('must not run'); } });
  assert.deepEqual(await service.detect(1, 'detect'), { ok: false, code: 'UNSUPPORTED' });
});

test('rejects shell payloads, arbitrary executable names, network paths and non-PE files', async t => {
  const { directory } = await setup(t);
  for (const candidate of ['agy.exe & calc.exe', 'C:\\Windows\\System32\\cmd.exe', '\\\\server\\share\\agy.exe']) {
    await assert.rejects(inspectExecutable(candidate), /INVALID_EXECUTABLE/);
  }
  const fake = path.join(directory, 'agy.exe');
  await fs.writeFile(fake, 'not an executable');
  await assert.rejects(inspectExecutable(fake), /INVALID_EXECUTABLE/);
});
