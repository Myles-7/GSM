const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { assertProfile, removeProfile, stats, assertSampleCompleteness } = require('./fixtures/render-performance-guards.cjs');
const defaultScenarios = [
  ...['list', 'grid'].flatMap(layout => [`repo-${layout}-show`, `repo-${layout}-category`, `repo-${layout}-all`, `group-${layout}-collapse`, `group-${layout}-expand`, `group-${layout}-jump`, `repo-${layout}-scroll`]),
  'builtin-show', 'builtin-channel', 'builtin-append', 'builtin-task-unrelated', 'builtin-repo-update', 'builtin-scroll', 'builtin-anchor-restore',
  'custom-show', 'custom-add-batch', 'custom-task-unrelated', 'custom-scroll', 'custom-anchor-restore', 'custom-channel', 'custom-edition',
  'repo-release-update', 'home-off-repo-update', 'home-on-repo-update',
];
const root = path.resolve(__dirname, '..');
const bundledPlaywright = path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
function getPlaywright() {
  for (const module of [process.env.GSM_PLAYWRIGHT_PATH, 'playwright', bundledPlaywright].filter(Boolean)) {
    try { return require(module); } catch (error) { if (error.code !== 'MODULE_NOT_FOUND') throw error; }
  }
  throw new Error('Set GSM_PLAYWRIGHT_PATH to an existing Playwright installation; no dependency is installed automatically.');
}
function diagnosticPlugin(profile) {
  const MagicString = require('magic-string');
  const onRender = '(id,phase,actualDuration,baseDuration,startTime,commitTime)=>window.gsmDiagnosticCommits?.push({id,phase,actualDuration,baseDuration,startTime,commitTime})';
  const targets = { '/BuiltinRepositoryResults.tsx': 'BuiltinRepositoryResults', '/CustomChannelResults.tsx': 'CustomChannelResults', '/RepositoryGroups.tsx': 'RepositoryGroups' };
  return { name: 'gsm-isolated-performance', enforce: 'pre', transform(source, id) {
    const normalized = id.replaceAll('\\', '/');
    if (normalized.endsWith('/src/main.tsx')) {
      const next = new MagicString(source).append('\nimport("/scripts/fixtures/render-performance-renderer.ts").then(module => module.install());\n');
      if (profile) next.replace('import { StrictMode }', 'import { StrictMode, Profiler }').replace('<App />', `<Profiler id="App" onRender={${onRender}}><App /></Profiler>`);
      return { code: next.toString(), map: next.generateMap({ hires: true, source: id, includeContent: true }) };
    }
    if (!profile) return;
    for (const [suffix, name] of [['/custom/analysis.ts', 'analyzedRepository'], ['/home/desktop.ts', 'desktopStoreRecords']]) {
      if (!normalized.endsWith(suffix)) continue;
      assert.ok(source.includes(`export function ${name}(`));
      const next = new MagicString(source).replace(`export function ${name}(`, `function ${name}DiagnosticInner(`).append(
        `\nexport function ${name}(...args:Parameters<typeof ${name}DiagnosticInner>):ReturnType<typeof ${name}DiagnosticInner>{const start=performance.now();try{return ${name}DiagnosticInner(...args);}finally{window.gsmDiagnosticFunctions?.push({name:'${name}',start,duration:performance.now()-start});}}\n`);
      if (name === 'desktopStoreRecords') next.replace('async function projectNow(', 'async function projectNowDiagnosticInner(').append(
        `\nasync function projectNow(...args:Parameters<typeof projectNowDiagnosticInner>){const start=performance.now();try{return await projectNowDiagnosticInner(...args);}finally{window.gsmDiagnosticFunctions?.push({name:'Home.projectNow',start,duration:performance.now()-start});}}\n`);
      return { code: next.toString(), map: next.generateMap({ hires: true, source: id, includeContent: true }) };
    }
    for (const [suffix, name] of Object.entries(targets)) {
      if (!normalized.endsWith(suffix)) continue;
      assert.ok(source.includes(`export function ${name}(`), `Profiler target drift: ${name}`);
      const next = new MagicString(source).replace(`export function ${name}(`, `function ${name}Inner(`).append(
        `\nimport {Profiler as DiagnosticProfiler,createElement as diagnosticElement} from 'react';\nexport function ${name}(props:Parameters<typeof ${name}Inner>[0]) {return diagnosticElement(DiagnosticProfiler,{id:'${name}',onRender:${onRender}},diagnosticElement(${name}Inner,props));}\n`);
      return { code: next.toString(), map: next.generateMap({ hires: true, source: id, includeContent: true }) };
    }
    if (normalized.endsWith('/RepositoryList.tsx')) {
      assert.ok(source.includes('export const RepositoryList:'));
      const next = new MagicString(source).replace('export const RepositoryList:', 'const RepositoryListInner:').append(
        `\nimport {Profiler as DiagnosticProfiler,createElement as diagnosticElement} from 'react';\nexport function RepositoryList(props:Parameters<typeof RepositoryListInner>[0]){return diagnosticElement(DiagnosticProfiler,{id:'RepositoryList',onRender:${onRender}},diagnosticElement(RepositoryListInner,props));}\n`);
      return { code: next.toString(), map: next.generateMap({ hires: true, source: id, includeContent: true }) };
    }
  } };
}
async function build(mode, out) {
  const { build: viteBuild, createServer } = await import('vite');
  const profile = mode === 'profile';
  const aliases = profile ? [{ find: /^react-dom$/, replacement: require.resolve('react-dom/profiling') }] : [];
  if (mode === 'dev') {
    const server = await createServer({ root, configFile: path.join(root, 'vite.config.ts'), plugins: [diagnosticPlugin(true)],
      server: { host: '127.0.0.1', port: 5197, strictPort: true, open: false } });
    await server.listen(); return { buildDir: out, server, origin: 'http://127.0.0.1:5197' };
  }
  await viteBuild({ root, configFile: path.join(root, 'vite.config.ts'), plugins: [diagnosticPlugin(profile)], resolve: { alias: aliases },
    build: { outDir: out, emptyOutDir: true, sourcemap: true }, logLevel: 'warn' });
  return { buildDir: out };
}
async function traceStart(cdp) {
  await cdp.send('Tracing.start', { categories: 'devtools.timeline,v8.execute,blink.user_timing,disabled-by-default-devtools.timeline,disabled-by-default-v8.cpu_profiler', transferMode: 'ReturnAsStream' });
}
async function traceEnd(cdp, file) {
  const complete = new Promise(resolve => cdp.once('Tracing.tracingComplete', resolve));
  await cdp.send('Tracing.end'); const { stream } = await complete;
  let raw = '';
  for (;;) { const chunk = await cdp.send('IO.read', { handle: stream }); raw += chunk.data; if (chunk.eof) break; }
  await cdp.send('IO.close', { handle: stream });
  await fs.writeFile(file, raw);
  const events = require('./summarize-render-trace.cjs').selectRendererEvents(JSON.parse(raw).traceEvents);
  // Inclusive event durations: keep categories separate; nested totals are not additive.
  const names = ['Layout', 'UpdateLayoutTree', 'Paint', 'Commit', 'RunTask'];
  return Object.fromEntries(names.map(name => {
    const list = events.filter(e => e.name === name && e.ph === 'X' && Number.isFinite(e.dur));
    return [name, { events: list.length, inclusiveMs: list.reduce((sum, e) => sum + e.dur / 1000, 0), maxMs: Math.max(0, ...list.map(e => e.dur / 1000)) }];
  }));
}
async function main() {
  const args = process.argv.slice(2);
  const option = (name, fallback) => args.find(a => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=') || fallback;
  const mode = option('mode', 'production'); assert.ok(['production', 'profile', 'dev'].includes(mode));
  const sizes = option('sizes', '100,500,1000').split(',').map(Number); assert.ok(sizes.every(n => Number.isInteger(n) && n > 0 && n <= 5000));
  assert.equal(new Set(sizes).size, sizes.length, 'Duplicate fixture sizes are not comparable');
  const requestedScenarios = option('scenarios', '').split(',').filter(Boolean);
  assert.equal(new Set(requestedScenarios).size, requestedScenarios.length, 'Duplicate scenarios');
  assert.ok(requestedScenarios.every(name => [...defaultScenarios, 'repo-list-append-scroll'].includes(name)), 'Unknown diagnostic scenario');
  const repetitions = Number(option('repetitions', '3')); assert.ok(Number.isInteger(repetitions) && repetitions >= 1 && repetitions <= 20);
  const output = path.join(root, 'output/render-performance', option('run', `${mode}-${new Date().toISOString().replaceAll(/[:.]/g, '-')}`));
  assert.ok(output.startsWith(path.join(root, 'output/render-performance') + path.sep));
  await fs.mkdir(output, { recursive: true });
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'gsm-render-diag-')); assertProfile(profile);
  const report = { mode, fixtureOnly: true, createdAt: new Date().toISOString(), samples: [], errors: [], forbidden: [], firstVisits: [], fixtures: [], homeBySize: [], output,
    gitHead: require('node:child_process').execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    projectVersion: JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8')).version,
    machine: { platform: process.platform, arch: process.arch, cpus: os.cpus().map(cpu => cpu.model), memoryBytes: os.totalmem() },
    methodology: { viewport: [1200, 800], repetitions, sizes, paintMetric: 'double-rAF opportunity proxy, not INP or exact pixel presentation', nestedTraceTotals: 'not additive', mockNetwork: 'in-process deterministic responses, not real backend latency' } };
  let app; let built;
  try {
    built = await build(mode, path.join(output, 'build'));
    report.bundleHash = require('node:crypto').createHash('sha256').update(await fs.readFile(path.join(built.buildDir, 'index.html')).catch(() => Buffer.from('dev'))).digest('hex');
    const env = { ...process.env, NODE_ENV: mode === 'dev' ? 'development' : 'production', GSM_DESKTOP_LAUNCHER: '1',
      GSM_DIAG_PROFILE: profile, GSM_DIAG_BUILD: built.buildDir };
    for (const key of Object.keys(env)) if (/TOKEN|SECRET|API_KEY|PROXY|ELECTRON_RUN_AS_NODE|GSM_DEV_SERVER_URL/.test(key)) delete env[key];
    if (built.origin) { env.GSM_DEV_SERVER_URL = built.origin; env.GSM_DIAG_DEV_ORIGIN = built.origin; }
    app = await getPlaywright()._electron.launch({ executablePath: require('electron'), cwd: root, env,
      args: [path.join(root, 'scripts/fixtures/render-performance-electron.cjs'), `--user-data-dir=${profile}`], timeout: 60000 });
    const actualProfile = await app.evaluate(({ app }) => app.getPath('userData')); assert.equal(path.resolve(actualProfile), profile);
    const page = await app.firstWindow();
    page.on('pageerror', error => report.errors.push(error.message));
    const logs = [];
    page.on('console', message => { if (/store.persist|home-sync|DIAGNOSTIC_FORBIDDEN/.test(message.text())) logs.push(message.text()); });
    await app.evaluate(({ BrowserWindow }) => { const window = BrowserWindow.getAllWindows()[0]; window.setContentSize(1200, 800); window.show(); window.focus(); window.webContents.closeDevTools(); });
    await page.waitForFunction(() => !!window.gsmDiagnostic, undefined, { timeout: 60000 });
    if (mode !== 'production') await page.evaluate(() => window.gsmDiagnostic.enableGeometry());
    report.runtime = await app.evaluate(({ app, BrowserWindow }) => ({ versions: process.versions, userData: 'disposable', sessionData: 'disposable',
      contentSize: BrowserWindow.getAllWindows()[0].getContentSize(), bounds: BrowserWindow.getAllWindows()[0].getBounds(), zoomFactor: BrowserWindow.getAllWindows()[0].webContents.getZoomFactor(),
      focused: BrowserWindow.getAllWindows()[0].isFocused(), appVersion: app.getVersion() }));
    report.url = (await page.url()).replace(output, '<diagnostic-output>');
    const api = (method, ...values) => page.evaluate(({ method, values }) => window.gsmDiagnostic[method](...values), { method, values });
    await page.waitForFunction(() => document.visibilityState === 'visible');
    const cdp = await page.context().newCDPSession(page);
    const waitCards = async selector => page.locator(selector).first().waitFor({ timeout: 15000 });
    const foreground = () => app.evaluate(({ BrowserWindow }) => { const window = BrowserWindow.getAllWindows()[0]; window.show(); window.focus(); });
    const settle = async () => { await foreground(); await page.waitForTimeout(500); };
    const measure = async (name, size, iteration, operation, trace = false) => {
      await foreground();
      if (trace) await traceStart(cdp);
      await api('start'); const operationResult = await operation();
      let contentReadyMs = null;
      if (name === 'custom-show') { await waitCards('[data-testid="custom-results-layout"] [data-reading-key]'); contentReadyMs = await api('elapsed'); }
      else if (name === 'builtin-show' || name === 'builtin-anchor-restore') { await waitCards('[data-testid="builtin-results-layout"] [data-reading-key]'); contentReadyMs = await api('elapsed'); }
      const sample = await api('finish', contentReadyMs);
      const row = { name, size, iteration, ...sample, operationResult, trace: null };
      if (trace) { const basename = `${size}-${name}-${iteration}.trace.json`; row.trace = { file: basename, metrics: await traceEnd(cdp, path.join(output, basename)) }; }
      report.samples.push(row); await fs.writeFile(path.join(output, 'samples.json'), JSON.stringify(report, null, 2));
      console.log(JSON.stringify({ name, size, iteration, ms: sample.paintOpportunityMs, cards: sample.cards, longTasks: sample.longTasks.length }));
      await page.waitForTimeout(1100);
      return row;
    };
    const run = async (name, size, setup, operation) => {
      if (requestedScenarios.length && !requestedScenarios.includes(name)) return;
      for (let i = 0; i < repetitions; i++) { await setup(); await measure(name, size, i, operation, args.includes('--trace') && i === 0); }
    };
    for (const size of sizes) {
      const releaseCount = Number(option('releases', String(size * 2)));
      const taskCount = Number(option('tasks', String(size)));
      const historyCount = Number(option('history', '2'));
      assert.ok(Number.isInteger(releaseCount) && releaseCount >= 0 && releaseCount <= size * 2, 'Invalid release fixture count');
      assert.ok(Number.isInteger(taskCount) && taskCount >= 0 && taskCount <= size, 'Invalid task fixture count');
      assert.ok([0, 2].includes(historyCount), 'History fixture supports exactly 0 or 2 editions');
      report.fixture = await api('configure', size, releaseCount, taskCount, historyCount);
      report.fixtures.push(report.fixture);
      await page.evaluate(() => document.fonts.ready);
      report.environment = await api('info');
      for (const layout of ['list', 'grid']) {
        await api('mode', layout);
        await run(`repo-${layout}-show`, size, async () => { await api('action', 'repo-empty'); await settle(); }, () => api('action', 'repo-show'));
        await run(`repo-${layout}-category`, size, async () => { await api('action', 'repo-show'); await api('action', 'all'); await settle(); }, () => api('action', 'category'));
        await run(`repo-${layout}-all`, size, async () => { await api('action', 'repo-show'); await api('action', 'category'); await settle(); }, () => api('action', 'all'));
        await api('action', 'repo-show'); await api('action', 'category'); await api('mode', layout, true); await settle();
        const group = page.locator('section[aria-labelledby="repository-group-diag:g0"]');
        await run(`group-${layout}-collapse`, size, async () => {
          const button = group.locator('button[aria-expanded="false"][aria-label="展开分组"]'); if (await button.count()) await button.evaluate(node => node.click()); await settle();
        }, async () => {
          const button = group.locator('button[aria-expanded="true"][aria-label="折叠分组"]');
          await button.evaluate(node => node.click());
        });
        await run(`group-${layout}-expand`, size, async () => {
          const expanded = group.locator('button[aria-expanded="true"][aria-label="折叠分组"]'); if (await expanded.count()) await expanded.evaluate(node => node.click()); await settle();
        }, async () => group.locator('button[aria-expanded="false"][aria-label="展开分组"]').evaluate(node => node.click()));
        await run(`group-${layout}-jump`, size, settle, () => page.getByRole('navigation', { name: '分组目录' }).getByRole('button').last().evaluate(node => node.click()));
        await api('mode', layout); await api('action', 'all'); await settle();
        await run(`repo-${layout}-scroll`, size, async () => { await page.evaluate(() => scrollTo(0, 0)); await settle(); }, async () => {
          for (let step = 0; step < 8; step++) { await page.mouse.wheel(0, 1000); await page.waitForTimeout(80); }
        });
        // Explicit supplemental scenario: reach the real list batch boundary, not just eight wheel ticks.
        if (layout === 'list' && requestedScenarios.includes('repo-list-append-scroll')) {
          await run('repo-list-append-scroll', size, async () => {
            await api('action', 'repo-empty'); await settle(); await api('action', 'repo-show');
            await api('action', 'category'); await settle(); await api('action', 'all');
            await page.evaluate(() => scrollTo(0, 0)); await page.mouse.move(700, 500); await settle();
            assert.equal(await page.locator('[data-selection-mode]').count(), Math.min(50, size), 'List append must start from a fixed batch');
          }, async () => {
            const fromCards = await page.locator('[data-selection-mode]').count();
            const fromScrollY = await page.evaluate(() => scrollY); let wheelSteps = 0;
            while (await page.locator('[data-selection-mode]').count() <= fromCards && wheelSteps < 30) {
              await page.mouse.wheel(0, 2000); await page.waitForTimeout(80); wheelSteps++;
            }
            const toCards = await page.locator('[data-selection-mode]').count();
            assert.ok(toCards > fromCards, 'List scroll never reached a real append boundary');
            return { fromCards, toCards, wheelSteps, fromScrollY, toScrollY: await page.evaluate(() => scrollY) };
          });
        }
      }
      // First visit is recorded independently: the lazy feature load is not silently discarded.
      const first = performance.now(); await api('action', 'builtin'); await waitCards('[data-testid="builtin-results-layout"] [data-reading-key]'); await settle();
      report.firstVisits.push({ size, name: 'builtin-first-visit-wall', ms: performance.now() - first });
      await run('builtin-show', size, async () => { await api('action', 'repo-show'); await settle(); }, () => api('action', 'builtin'));
      await run('builtin-channel', size, async () => { await api('action', 'builtin'); await settle(); }, () => api('action', 'channel'));
      await run('builtin-append', size, async () => { await api('action', 'builtin'); await api('seedBrowse', 'trending', Math.floor(size / 2)); await settle(); }, () => api('action', 'append'));
      await api('action', 'builtin'); await settle();
      await run('builtin-task-unrelated', size, settle, () => api('action', 'task-unrelated'));
      await run('builtin-repo-update', size, settle, () => api('action', 'repo-update'));
      await run('builtin-scroll', size, async () => { await page.evaluate(() => scrollTo(0, 0)); await settle(); }, async () => { for (let step = 0; step < 8; step++) { await page.mouse.wheel(0, 1000); await page.waitForTimeout(80); } });
      await run('builtin-anchor-restore', size, async () => { await api('action', 'builtin'); await api('action', 'repo-show'); await settle(); await api('anchor'); }, () => api('action', 'builtin'));
      if (!requestedScenarios.length || requestedScenarios.some(s => s.startsWith('custom-'))) {
      await run('custom-show', size, async () => { await api('action', 'repo-show'); await api('resetCustom'); await settle(); }, () => api('action', 'custom'));
      await api('action', 'custom'); await waitCards('[data-testid="custom-results-layout"] [data-reading-key]'); await settle();
      await run('custom-add-batch', size, async () => { await api('action', 'repo-show'); await api('resetCustom'); await settle(); await api('action', 'custom'); await settle(); }, async () => {
        const button = page.getByRole('button', { name: /加载更多项目|Load more projects|加载更多|Load more/ }).first();
        if (await button.count()) await button.evaluate(node => node.click()); else throw new Error('Custom batch control missing');
      });
      await run('custom-task-unrelated', size, settle, () => api('action', 'task-unrelated'));
      await run('custom-scroll', size, async () => { await page.evaluate(() => scrollTo(0, 0)); await settle(); }, async () => {
        for (let step = 0; step < 8; step++) { await page.mouse.wheel(0, 1000); await page.waitForTimeout(80); }
      });
      await run('custom-anchor-restore', size, async () => { await api('action', 'repo-show'); await api('resetCustom'); await settle(); await api('customAnchor'); }, () => api('action', 'custom'));
      await run('custom-channel', size, async () => { await api('action', 'custom'); await settle(); }, () => api('action', 'builtin'));
      await run('custom-edition', size, async () => { await api('action', 'repo-show'); await api('resetCustom'); await settle(); await api('action', 'custom'); await settle(); }, async () => {
        await page.getByRole('button', { name: '日期与规则版本' }).click();
        const date = page.locator('[data-state="open"]').getByText(/10月2日/, { exact: false }).last();
        await date.evaluate(node => node.closest('.rounded-md.border').querySelector('.cursor-pointer').click());
      });
      }
      await api('action', 'repo-show'); await api('mode', 'grid'); await settle();
      await run('repo-release-update', size, settle, () => api('action', 'release-update'));
      await run('home-off-repo-update', size, settle, () => api('action', 'repo-update'));
      if (!requestedScenarios.length || requestedScenarios.some(s => s.startsWith('home-on'))) {
        await api('home', true); await settle();
        await run('home-on-repo-update', size, settle, async () => { await api('action', 'repo-update'); });
        const flushed = await api('homeFlush'); report.homeBySize.push({ size, ...flushed }); assert.equal(flushed.pending, 0);
        await api('home', false);
      }
      await page.screenshot({ path: path.join(output, `${size}-final.png`) });
    }
    report.main = await app.evaluate(() => global.gsmDiagnosticMain);
    report.forbidden = report.main.forbidden.concat((await api('info')).forbidden);
    report.logs = logs;
    const keys = [...new Set(report.samples.map(row => `${row.size}:${row.name}`))];
    report.summary = keys.map(key => { const rows = report.samples.filter(row => `${row.size}:${row.name}` === key); return { key, paintOpportunityMs: stats(rows.map(r => r.paintOpportunityMs)),
      maxLongTaskMs: Math.max(0, ...rows.flatMap(r => r.longTasks.map(t => t.duration))), cards: rows.map(r => r.cards), commits: rows.map(r => r.commits.length) }; });
    assert.deepEqual(report.forbidden, [], 'A prohibited main/provider operation was attempted');
    assert.deepEqual(report.errors, [], 'Renderer errors invalidate samples');
    assertSampleCompleteness(report.samples, sizes, requestedScenarios.length ? requestedScenarios : defaultScenarios, repetitions);
    assert.ok(report.samples.every(sample => sample.focused && sample.visibility === 'visible'), 'Background/blurred samples invalidate the baseline');
    await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
    console.log(`REPORT ${path.join(output, 'report.json')}`);
  } catch (error) {
    report.failure = String(error.stack || error); await fs.writeFile(path.join(output, 'failed-report.json'), JSON.stringify(report, null, 2)); throw error;
  } finally {
    if (app) await app.close().catch(() => {});
    if (built?.server) await built.server.close();
    await removeProfile(profile);
  }
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { diagnosticPlugin, getPlaywright, defaultScenarios };
