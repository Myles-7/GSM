const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

async function main() {
  const root = path.resolve(__dirname, '..');
  const userData = await fs.mkdtemp(path.join(os.tmpdir(), 'gsm-agy-e2e-'));
  const out = path.join(root, 'output', 'agy-settings');
  await fs.mkdir(out, { recursive: true });
  const env = { ...process.env, NODE_ENV: 'development', GSM_DESKTOP_LAUNCHER: '1', GSM_DEV_SERVER_URL: 'http://127.0.0.1:5173' };
  delete env.ELECTRON_RUN_AS_NODE;
  let app;
  const launch = async () => {
    app = await electron.launch({ executablePath: require('electron'),
      args: [path.join(root, 'scripts/fixtures/agy-electron-e2e.cjs'), '--hidden', `--user-data-dir=${userData}`], cwd: root, env });
    app.process().stderr.on('data', chunk => console.error(chunk.toString()));
    const actual = await app.evaluate(({ app: running }) => running.getPath('userData'));
    assert.equal(path.resolve(actual), path.resolve(userData), 'Never use the personal application profile');
    await app.evaluate(({ BrowserWindow }) => {
      for (const window of BrowserWindow.getAllWindows()) window.webContents.setBackgroundThrottling(false);
    });
    const page = await app.firstWindow();
    page.on('pageerror', error => console.error('Renderer:', error.message));
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      return (url.hostname === '127.0.0.1' && url.port === '5173' && !url.pathname.startsWith('/api')) || ['data:', 'blob:'].includes(url.protocol)
        ? route.continue() : route.abort();
    });
    await page.waitForURL('http://127.0.0.1:5173/');
    await page.waitForFunction(async () => {
      const { useAppStore } = await import(performance.getEntriesByType('resource').find(entry => new URL(entry.name).pathname === '/src/store/useAppStore.ts')?.name ?? '/src/store/useAppStore.ts');
      return useAppStore.persist.hasHydrated();
    });
    await page.evaluate(async () => {
      const { useAppStore } = await import(performance.getEntriesByType('resource').find(entry => new URL(entry.name).pathname === '/src/store/useAppStore.ts')?.name ?? '/src/store/useAppStore.ts');
      sessionStorage.setItem('gsm:pending-settings-tab', 'ai');
      useAppStore.setState({ isAuthenticated: true, githubToken: 'synthetic-ui-fixture', user: { id: 777, login: 'synthetic', avatar_url: '' },
        currentView: 'settings', language: 'zh', syncModeConfigured: true });
    });
    await page.reload();
    await page.waitForFunction(async () => (await import(performance.getEntriesByType('resource').find(entry => new URL(entry.name).pathname === '/src/store/useAppStore.ts')?.name ?? '/src/store/useAppStore.ts')).useAppStore.persist.hasHydrated());
    await page.evaluate(async () => {
      const { useAppStore } = await import(performance.getEntriesByType('resource').find(entry => new URL(entry.name).pathname === '/src/store/useAppStore.ts')?.name ?? '/src/store/useAppStore.ts');
      sessionStorage.setItem('gsm:pending-settings-tab', 'ai');
      useAppStore.setState({ isAuthenticated: true, githubToken: 'synthetic-ui-fixture',
        user: { id: 777, login: 'synthetic', avatar_url: '' }, currentView: 'settings', language: 'zh', syncModeConfigured: true });
    });
    try { await page.locator('#agy-heading').waitFor(); }
    catch (error) { console.error((await page.locator('body').innerText()).slice(0, 2000)); throw error; }
    return page;
  };
  try {
    let page = await launch();
    console.log('Isolated Electron settings loaded');
    const panel = page.locator('section[aria-labelledby="agy-heading"]');
    await panel.getByText(/\\agy\.exe$/).waitFor();
    await panel.getByRole('button', { name: '刷新模型列表' }).click();
    try { await page.waitForFunction(() => document.querySelectorAll('#agy-model option').length > 1); }
    catch (error) { console.error(await panel.innerText()); throw error; }
    const modelCount = await page.locator('#agy-model option').count() - 1;
    await panel.locator('summary').click();
    await page.locator('#agy-effort').selectOption('high');
    await page.locator('#agy-mode').selectOption('research');
    await page.locator('#agy-timeout').fill('240');
    const simulatedRecovery = [];
    for (const code of ['AUTH_REQUIRED', 'RATE_LIMIT', 'TIMEOUT', 'PERMISSION_DENIED']) {
      await app.evaluate((_electron, code) => { process.env.GSM_AGY_E2E_ERROR = code; }, code);
      await panel.getByRole('button', { name: '保存并测试' }).click();
      await panel.getByText(new RegExp(`\\(${code}\\)`)).first().waitFor();
      assert.equal((await page.evaluate(() => window.electronAPI.agy.getState())).enabled, false);
      simulatedRecovery.push(code);
    }
    await app.evaluate(() => { delete process.env.GSM_AGY_E2E_ERROR; });
    await panel.getByRole('button', { name: '保存并测试' }).click();
    await panel.getByText(/中文结构化回答测试通过/).waitFor({ timeout: 260000 });
    await panel.getByRole('button', { name: '启用并设为当前' }).click();
    await panel.getByRole('button', { name: '当前 AI', exact: true }).waitFor();
    const state = await page.evaluate(() => window.electronAPI.agy.getState());
    console.log(JSON.stringify({ modelCount, probe: state.lastProbe?.code, toolCount: state.lastProbe?.toolCount }));
    assert.equal(state.enabled, true);
    assert.equal(state.lastProbe.promptsSent, 1);
    const analysis = await page.evaluate(async () => {
      const { useAppStore } = await import(performance.getEntriesByType('resource').find(entry => new URL(entry.name).pathname === '/src/store/useAppStore.ts')?.name ?? '/src/store/useAppStore.ts');
      const { AIService } = await import(performance.getEntriesByType('resource').find(entry => new URL(entry.name).pathname === '/src/services/aiService.ts')?.name ?? '/src/services/aiService.ts');
      const store = useAppStore.getState();
      const config = store.aiConfigs.find(item => item.id === store.activeAIConfig);
      if (!config) throw new Error(JSON.stringify({ active: store.activeAIConfig, configs: store.aiConfigs.map(c => ({ id: c.id, active: c.isActive })),
        modules: performance.getEntriesByType('resource').filter(e => e.name.includes('useAppStore')).map(e => e.name) }));
      return new AIService(config, 'zh').analyzeRepository({
        id: 123456, name: 'SyntheticNotes', full_name: 'synthetic/SyntheticNotes', description: 'A local Markdown note editor.',
        language: 'TypeScript', topics: ['markdown', 'notes'], stargazers_count: 0, forks_count: 0,
        html_url: 'https://example.com/synthetic', updated_at: '2026-09-28', pushed_at: '2026-09-28',
      }, '# SyntheticNotes\\nA local Markdown note editor built with Electron. Available on Windows and Linux. Includes full-text search. No cloud sync or mobile app.');
    });
    assert.ok(/笔记|Markdown/i.test(analysis.summary));
    assert.ok(!/支持云同步|支持手机/.test(analysis.summary));
    await fs.writeFile(path.join(out, 'synthetic-analysis.json'), JSON.stringify(analysis, null, 2));
    const overflow = [];
    for (const language of ['zh', 'en']) {
      await page.evaluate(async language => {
        const { useAppStore } = await import(performance.getEntriesByType('resource').find(entry => new URL(entry.name).pathname === '/src/store/useAppStore.ts')?.name ?? '/src/store/useAppStore.ts');
        const { changeAppLanguage } = await import('/src/i18n/index.ts');
        await changeAppLanguage(language);
        useAppStore.setState({ language });
      }, language);
      for (const width of [1280, 390]) {
        await page.setViewportSize({ width, height: 1000 });
        await panel.scrollIntoViewIfNeeded();
        await page.evaluate(() => document.fonts.ready);
        const invalid = await panel.evaluate(section => [...section.querySelectorAll('button, input, select, label, p')]
          .filter(element => element.getBoundingClientRect().width > 0 && element.scrollWidth > element.clientWidth + 2)
          .map(element => ({ tag: element.tagName, text: element.textContent.slice(0, 80) })));
        if (invalid.length) overflow.push({ language, width, invalid });
        assert.equal(/\bagy\.(?!exe\b)/.test(await panel.innerText()), false);
        if (language === 'zh' || language === 'en') {
          const png = await app.evaluate(async ({ BrowserWindow }) => {
            const image = await BrowserWindow.getAllWindows()[0].webContents.capturePage(undefined, { stayHidden: true, stayAwake: true });
            return image.toPNG().toString('base64');
          });
          await fs.writeFile(path.join(out, `${language}-${width}.png`), Buffer.from(png, 'base64'));
        }
      }
    }
    assert.deepEqual(overflow, [], 'Settings controls must not clip in any supported language');
    await app.close();
    app = null;
    page = await launch();
    await page.locator('section[aria-labelledby="agy-heading"] summary').click();
    assert.equal(await page.locator('#agy-effort').inputValue(), 'high');
    assert.equal(await page.locator('#agy-mode').inputValue(), 'research');
    assert.equal(await page.locator('#agy-timeout').inputValue(), '240');
    assert.equal((await page.evaluate(() => window.electronAPI.agy.getState())).enabled, true);
    const report = { at: new Date().toISOString(), modelCount, lastProbe: state.lastProbe,
      locales: 2, viewports: [1280, 390], overflow, simulatedRecovery,
      recoveryFollowedByRealConnection: true, persistedAfterRestart: true, enabled: true, businessAnalysisPassed: true };
    await fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
  } finally {
    if (app) await app.close();
    await fs.rm(userData, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
