const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const Module = require('node:module');
const { assertProfile, removeProfile, allowResource, stats, assertSampleCompleteness } = require('./fixtures/render-performance-guards.cjs');
const { diagnosticPlugin, getPlaywright } = require('./diagnose-render-performance.cjs');
const file = path.join(__dirname, 'fixtures/render-performance-data.ts');
const compiled = require('esbuild').transformSync(fs.readFileSync(file, 'utf8'), { loader: 'ts', format: 'cjs' }).code;
const moduleFixture = new Module(file); moduleFixture._compile(compiled, file);
const { makeFixture, ACCOUNT } = moduleFixture.exports;

test('fixture is deterministic, anonymous and keeps organization/release identities consistent', () => {
  const a = makeFixture(100); assert.deepEqual(a, makeFixture(100));
  assert.equal(a.releases.length, 200); assert.equal(a.discovery.length, 100);
  const ids = new Set(a.repositories.map(r => r.id)); assert.equal(ids.size, 100);
  const groups = new Set(a.groups.map(g => g.id));
  assert.ok(a.repositories.every(r => r.html_url.startsWith('https://example.invalid/') && (!r.subcategory_id || groups.has(r.subcategory_id))));
  assert.ok(a.releases.every(r => ids.has(r.repository.id))); assert.equal(ACCOUNT, 990001);
  assert.ok(a.data.channels.every(c => c.paused && !c.autoAnalyze && !c.ai));
});
test('fixture rejects invalid or accidentally huge scales', () => {
  for (const n of [0, -1, 1.5, NaN, 5001]) assert.throws(() => makeFixture(n));
});
test('profile guard refuses workspace, ordinary temp paths and traversal', () => {
  for (const candidate of [process.cwd(), os.tmpdir(), path.join(os.tmpdir(), 'personal'), path.join(os.tmpdir(), 'gsm-render-diag-ok', '..', 'personal')]) assert.throws(() => assertProfile(candidate));
});
test('cleanup removes only the named disposable profile, including failure cleanup', async () => {
  const profile = await fsp.mkdtemp(path.join(os.tmpdir(), 'gsm-render-diag-'));
  await fsp.writeFile(path.join(profile, 'fixture'), 'anonymous'); await removeProfile(profile);
  assert.equal(fs.existsSync(profile), false); await assert.rejects(removeProfile(path.join(os.tmpdir(), 'personal')));
});
test('resource allowlist refuses real Home, GitHub, paid provider and sibling files', () => {
  const build = path.join(os.tmpdir(), 'fixture-build'); const { pathToFileURL } = require('node:url');
  assert.equal(allowResource(pathToFileURL(path.join(build, 'assets/app.js')).href, build), true);
  for (const url of ['http://127.0.0.1:3000/api/health', 'https://api.github.com/user/starred/owner/repo', 'https://api.openai.com/v1/responses', pathToFileURL(path.join(build, '../personal/index.html')).href]) assert.equal(allowResource(url, build), false);
  assert.equal(allowResource('http://127.0.0.1:5197/src/main.tsx', build, 'http://127.0.0.1:5197'), true);
  assert.equal(allowResource('http://127.0.0.1:5197/api/star', build, 'http://127.0.0.1:5197'), false);
  assert.equal(allowResource('ws://127.0.0.1:5197/', build, 'http://127.0.0.1:5197'), true);
  assert.equal(allowResource('ws://127.0.0.1:3000/', build, 'http://127.0.0.1:5197'), false);
});
test('statistics reject incomplete samples and do not invent p95', () => {
  assert.deepEqual(stats([4, 1, 3, 2]), { n: 4, median: 2.5, min: 1, max: 4 });
  assert.throws(() => stats([])); assert.throws(() => stats([NaN]));
});

test('sample matrix rejects missing, duplicate, blurred, non-finite and wrong-identity rows', () => {
  const row = { size: 100, name: 'builtin-show', iteration: 0, paintOpportunityMs: 10, observationMs: 360, repositoryCount: 100, focused: true, visibility: 'visible' };
  const rows = [row, { ...row, iteration: 1 }];
  assertSampleCompleteness(rows, [100], ['builtin-show'], 2);
  for (const invalid of [[], [row], [row, row], [{ ...row, paintOpportunityMs: NaN }, rows[1]], [{ ...row, focused: false }, rows[1]],
    [{ ...row, repositoryCount: 50 }, rows[1]], [{ ...row, observationMs: 9 }, rows[1]]]) assert.throws(() => assertSampleCompleteness(invalid, [100], ['builtin-show'], 2));
});
test('diagnostic transforms operate in memory and ordinary build does not enable Profiler', () => {
  const main = fs.readFileSync(path.join(__dirname, '../src/main.tsx'), 'utf8');
  const baseline = diagnosticPlugin(false).transform(main, '/src/main.tsx');
  assert.ok(baseline.code.includes('render-performance-renderer')); assert.ok(!baseline.code.includes('<Profiler')); assert.ok(baseline.map);
  const profiled = diagnosticPlugin(true).transform(main, '/src/main.tsx'); assert.ok(profiled.code.includes('<Profiler'));
  assert.equal(fs.readFileSync(path.join(__dirname, '../src/main.tsx'), 'utf8'), main);
  assert.throws(() => diagnosticPlugin(true).transform('wrong export', '/BuiltinRepositoryResults.tsx'));
});

test('diagnostic RepositoryList wrapper supports early references in development module cycles', () => {
  const source = 'globalThis.gsmDiagnosticEarlyReference = RepositoryList; export const RepositoryList: (props: {}) => null = () => null;';
  const transformed = diagnosticPlugin(true).transform(source, '/RepositoryList.tsx');
  const code = require('esbuild').transformSync(transformed.code, { loader: 'tsx', format: 'cjs' }).code;
  const isolated = new Module(file); isolated.require = require;
  const saved = global.gsmDiagnosticEarlyReference;
  try { isolated._compile(code, file); assert.equal(global.gsmDiagnosticEarlyReference, isolated.exports.RepositoryList); }
  finally { if (saved === undefined) delete global.gsmDiagnosticEarlyReference; else global.gsmDiagnosticEarlyReference = saved; }
});
test('existing automation runtime is available without changing project dependencies', () => {
  assert.ok(getPlaywright()._electron.launch);
});

test('source-map attribution preserves CPU self time without summing ancestors', async () => {
  const temp = await fsp.mkdtemp(path.join(os.tmpdir(), 'gsm-render-diag-'));
  try {
    const script = path.join(temp, 'app.js');
    await fsp.writeFile(`${script}.map`, JSON.stringify({ version: 3, sources: ['src/hot.ts'], names: ['work'], mappings: 'AAAAA' }));
    const trace = path.join(temp, 'trace.json');
    await fsp.writeFile(trace, JSON.stringify({ traceEvents: [{ name: 'ProfileChunk', pid: 1, tid: 1, id: 'a', args: { data: {
      cpuProfile: { nodes: [{ id: 1, callFrame: { url: '' } }, { id: 2, parent: 1, callFrame: { url: require('node:url').pathToFileURL(script).href, lineNumber: 0, columnNumber: 0 } }], samples: [2] }, timeDeltas: [5000] } } }] }));
    const summary = require('./summarize-render-trace.cjs').summarize(trace, temp);
    assert.equal(summary.sampleCount, 1); assert.equal(summary.topSelf[0].sampledSelfMs, 5); assert.equal(summary.topSelf[0].name, 'work');
  } finally { await removeProfile(temp); }
});

test('trace metrics select the operation renderer main thread, excluding compositor work', () => {
  const events = [{ name: 'gsm:diag-operation-start', pid: 1, tid: 2 }, { name: 'Layout', pid: 1, tid: 2 },
    { name: 'RunTask', pid: 1, tid: 3 }, { name: 'RunTask', pid: 4, tid: 2 }];
  assert.deepEqual(require('./summarize-render-trace.cjs').selectRendererEvents(events), events.slice(0, 2));
});

test('CPU chunks emitted on a sampler thread attach to the correct renderer Profile', () => {
  const events = [{ name: 'gsm:diag-operation-start', pid: 1, tid: 2 }, { name: 'Profile', pid: 1, tid: 2, id: 'main' },
    { name: 'ProfileChunk', pid: 1, tid: 3, id: 'main' }, { name: 'ProfileChunk', pid: 1, tid: 3, id: 'worker' },
    { name: 'ProfileChunk', pid: 4, tid: 3, id: 'main' }];
  assert.deepEqual(require('./summarize-render-trace.cjs').selectRendererEvents(events, true), events.slice(0, 3));
});

test('CPU attribution excludes tracing setup and post-operation samples', async () => {
  const temp = await fsp.mkdtemp(path.join(os.tmpdir(), 'gsm-render-diag-'));
  try {
    const script = path.join(temp, 'app.js');
    await fsp.writeFile(`${script}.map`, JSON.stringify({ version: 3, sources: ['src/hot.ts'], names: ['work'], mappings: 'AAAAA' }));
    const trace = path.join(temp, 'trace.json');
    await fsp.writeFile(trace, JSON.stringify({ traceEvents: [
      { name: 'gsm:diag-operation-start', pid: 1, tid: 2, ts: 1000 }, { name: 'gsm:diag-operation-end', pid: 1, tid: 2, ts: 2000 },
      { name: 'Profile', pid: 1, tid: 2, id: 'a', args: { data: { startTime: 0 } } },
      { name: 'ProfileChunk', pid: 1, tid: 3, id: 'a', args: { data: { cpuProfile: {
        nodes: [{ id: 1, callFrame: { url: require('node:url').pathToFileURL(script).href, lineNumber: 0, columnNumber: 0 } }],
        samples: [1, 1, 1] }, timeDeltas: [1000, 1000, 1000] } } },
    ] }));
    const summary = require('./summarize-render-trace.cjs').summarize(trace, temp);
    assert.equal(summary.sampleCount, 1); assert.equal(summary.topSelf[0].sampledSelfMs, 1);
  } finally { await removeProfile(temp); }
});

test('Electron fixture installs profile and prohibited-call guards before loading main', async () => {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'gsm-render-diag-'));
  const saved = { profile: process.env.GSM_DIAG_PROFILE, build: process.env.GSM_DIAG_BUILD, fetch: global.fetch, diagnostics: global.gsmDiagnosticMain };
  try {
    process.env.GSM_DIAG_PROFILE = directory; process.env.GSM_DIAG_BUILD = path.join(directory, 'build');
    const paths = {}; const handlers = {}; const runtime = {}; const http = {}; const undici = {};
    const trusted = { ...require('../electron/trustedRenderer') };
    class Window { loadFile(file) { return file; } }
    const electron = { app: { setPath: (key, value) => { paths[key] = value; }, whenReady: () => ({ then: callback => callback() }) }, BrowserWindow: Window,
      session: { defaultSession: { webRequest: { onBeforeRequest: () => {} } } }, ipcMain: { handle: (name, handler) => { handlers[name] = handler; } } };
    const entry = path.join(__dirname, 'fixtures/render-performance-electron.cjs'); const fixtureModule = new Module(entry);
    fixtureModule.require = name => {
      if (name === 'electron') return electron;
      if (name === 'undici') return undici;
      if (name === 'node:http' || name === 'node:https') return http;
      if (name.endsWith('/agyRuntime')) return runtime;
      if (name.endsWith('/trustedRenderer')) return trusted;
      if (name.endsWith('/main.js')) { assert.equal(paths.userData, directory); assert.ok(runtime.runAgy); return {}; }
      if (name === './render-performance-guards.cjs') return require('./fixtures/render-performance-guards.cjs');
      return require(name);
    };
    fixtureModule._compile(fs.readFileSync(entry, 'utf8'), entry);
    assert.equal(paths.sessionData, path.join(directory, 'session'));
    for (const channel of ['agy:start', 'webdav-request', 'x-fetch-timeline', 'mcp-start']) {
      electron.ipcMain.handle(channel, () => assert.fail('Forbidden handler must never execute'));
      assert.throws(() => handlers[channel](), /DIAGNOSTIC_FORBIDDEN/);
    }
    await assert.rejects(runtime.runAgy(), /DIAGNOSTIC_FORBIDDEN/); await assert.rejects(undici.fetch(), /DIAGNOSTIC_FORBIDDEN/);
    assert.throws(() => http.request(), /DIAGNOSTIC_FORBIDDEN/);
    assert.equal(new Window().loadFile('index.html'), path.join(directory, 'build/index.html'));
    const candidate = require('node:url').pathToFileURL(path.join(directory, 'build/index.html')).href;
    assert.equal(trusted.isTrustedDocument(candidate, 'file:///original/dist/index.html'), true);
    assert.equal(trusted.isTrustedDocument('file:///original/dist/index.html', 'file:///original/dist/index.html'), false);
    assert.equal(trusted.isTrustedDocument('https://evil.invalid/', 'file:///original/dist/index.html'), false);
  } finally {
    for (const [key, value] of [['GSM_DIAG_PROFILE', saved.profile], ['GSM_DIAG_BUILD', saved.build]]) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    global.fetch = saved.fetch; global.gsmDiagnosticMain = saved.diagnostics; await removeProfile(directory);
  }
});
