// Isolated UI audit: mocked desktop bridge; no real credentials or AI requests.
const { chromium } = require(process.env.GSM_PLAYWRIGHT_PATH || 'playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const phase = process.argv[2] || 'after';
async function main() {
  const out = path.resolve('output/playwright/settings', phase);
  await fs.mkdir(out, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: 'light' });
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    return url.hostname === '127.0.0.1' && url.port === '5173' && !url.pathname.startsWith('/api')
      ? route.continue() : route.abort();
  });
  await context.addInitScript(() => {
    let state = { prefs: { model: 'fixture-model', effort: 'high', mode: 'model', timeoutSeconds: 180, maxQueued: 10, enabled: true, concurrency: 5, featureOverrides: {} },
      supported: true, enabled: true, executable: { name: 'agy.exe', path: 'C:\\fixture\\agy.exe', fingerprint: 'fixture' },
      lastProbe: { code: 'SUCCESS', fingerprint: 'fixture', identity: 'fixture:fixture-model:high:text-v1', at: new Date().toISOString(), promptsSent: 1, toolCount: 0 }, busy: false };
    window.__agyCalls = [];
    window.electronAPI = {
      agy: { getState: async () => structuredClone(state), detect: async () => ({ ok: true, value: state }),
        listModels: async () => ({ ok: true, value: [{ id: 'fixture-model', label: 'Fixture model' }] }),
        save: async (_id, prefs) => { state = { ...state, prefs, enabled: prefs.enabled }; return { ok: true, value: state }; },
        probe: async () => { window.__agyCalls.push('probe'); return { ok: true, value: state }; },
        cancel: async () => {}, setSession: async () => {}, onEvent: () => () => {} },
      desktop: { getPrefs: async () => ({ autoLaunch: false, closeToTray: true, minimizeToTray: true }) },
      getProxy: async () => ({ enabled: false, type: 'http', host: '', port: 7890 }),
      setProxy: async () => ({ success: true }),
      mcp: { getStatus: async () => ({ running: false }), getConfig: async () => null, setConfig: async () => ({ success: true }), pushSnapshot: async () => ({ success: true }) },
      plugins: { list: async () => ({ plugins: [], invalidPlugins: [] }), getSearchEndpoint: async () => ({ endpoint: null }), pushSnapshot: async () => ({ success: true }),
        registry: { load: async () => ({ success: true, registry: { fetchedAt: new Date().toISOString(), plugins: [], removed: [], rejected: [], error: null } }) } },
    };
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto('http://127.0.0.1:5173');
    await page.waitForFunction(async () => (await import(performance.getEntriesByType('resource').find(entry => new URL(entry.name).pathname === '/src/store/useAppStore.ts')?.name || '/src/store/useAppStore.ts')).useAppStore.persist.hasHydrated());
    await page.evaluate(async () => {
      const { useAppStore } = await import(performance.getEntriesByType('resource').find(entry => new URL(entry.name).pathname === '/src/store/useAppStore.ts')?.name || '/src/store/useAppStore.ts');
      useAppStore.setState({ isAuthenticated: true, githubToken: 'fixture', user: { id: 99990001, login: 'ui-fixture', avatar_url: '' },
        currentView: 'settings', language: 'zh', syncModeConfigured: true, activeAIConfig: 'agy-cli-local',
        aiConfigs: [{ id: 'api-fixture', name: 'API 示例', apiType: 'openai', baseUrl: 'https://example.invalid/v1', apiKey: 'fixture', model: 'fixture-model', isActive: false, concurrency: 2 }] });
      useAppStore.getState().setTheme('light');
    });
    await page.getByRole('tabpanel').waitFor();
    const report = [];
    for (const tab of ['general', 'appearance', 'starSync', 'ai', 'webdav', 'backup', 'backend', 'category', 'menu', 'data', 'logs', 'network', 'vectorSearch', 'mcp', 'plugins', 'htmlReading']) {
      await page.locator(`#settings-tab-${tab}`).click();
      await page.locator(`#settings-tabpanel-${tab}`).waitFor();
      await page.waitForTimeout(400);
      await page.screenshot({ path: path.join(out, `${tab}.png`), fullPage: true });
      const text = await page.locator(`#settings-tabpanel-${tab}`).innerText();
      await fs.writeFile(path.join(out, `${tab}.txt`), text);
      report.push({ tab, textLength: text.length, overflow: await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), overflowElements: await page.evaluate(() => Array.from(document.querySelectorAll('main *')).filter(el => el.getBoundingClientRect().right > innerWidth + 1).slice(0, 8).map(el => ({ tag: el.tagName, class: el.className, text: el.textContent.slice(0, 60) }))) });
    }
    if (phase === 'after') {
      await page.locator('#settings-tab-network').click();
      await page.getByRole('switch', { name: '启用网络代理', exact: true }).click();
      await page.getByRole('switch', { name: '启用远程下载', exact: true }).click();
      await page.locator('#proxy-host').waitFor();
      await page.waitForTimeout(250);
      await page.screenshot({ path: path.join(out, 'network-expanded.png'), fullPage: true });
      await page.locator('#settings-tab-htmlReading').click();
      for (const section of ['layout', 'mail', 'records']) {
        await page.locator(`#reading-tab-${section}`).click();
        await page.screenshot({ path: path.join(out, `htmlReading-${section}.png`), fullPage: true });
      }
      await page.locator('#settings-tab-ai').click();
      await page.locator('#settings-tabpanel-ai').waitFor();
      await page.getByRole('radio', { name: 'API 示例', exact: true }).click();
      await page.waitForFunction(async () => (await import(performance.getEntriesByType('resource').find(entry => new URL(entry.name).pathname === '/src/store/useAppStore.ts')?.name || '/src/store/useAppStore.ts')).useAppStore.getState().activeAIConfig === 'api-fixture');
      await page.reload();
      await page.waitForFunction(async () => (await import(performance.getEntriesByType('resource').find(entry => new URL(entry.name).pathname === '/src/store/useAppStore.ts')?.name || '/src/store/useAppStore.ts')).useAppStore.persist.hasHydrated());
      await page.locator('#settings-tab-ai').click();
      await page.getByRole('radio', { name: 'API 示例', exact: true }).waitFor();
      if (!await page.getByRole('radio', { name: 'API 示例', exact: true }).isChecked()) throw new Error('Active API selection was lost after reload');
      await page.getByRole('radio', { name: 'AGY CLI', exact: true }).click();
      await page.waitForFunction(async () => (await import(performance.getEntriesByType('resource').find(entry => new URL(entry.name).pathname === '/src/store/useAppStore.ts')?.name || '/src/store/useAppStore.ts')).useAppStore.getState().activeAIConfig === 'agy-cli-local');
      await page.getByRole('button', { name: '配置 AGY', exact: true }).click();
      await page.locator('#agy-heading').waitFor();
      await page.screenshot({ path: path.join(out, 'ai-agy.png'), fullPage: true });
      await page.getByRole('button', { name: '添加 API 服务', exact: true }).click();
      await page.locator('#ai-config-name').waitFor();
      await page.screenshot({ path: path.join(out, 'ai-api-form.png'), fullPage: true });
      for (const width of [1280, 1024, 768, 390]) {
        await page.setViewportSize({ width, height: 1000 });
        await page.screenshot({ path: path.join(out, `ai-${width}.png`), fullPage: true });
        report.push({ tab: `ai-${width}`, overflow: await page.evaluate(() => document.documentElement.scrollWidth > innerWidth) });
      }
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.evaluate(async () => { const { useAppStore } = await import(performance.getEntriesByType('resource').find(entry => new URL(entry.name).pathname === '/src/store/useAppStore.ts')?.name || '/src/store/useAppStore.ts'); useAppStore.getState().setTheme('dark'); });
      await page.screenshot({ path: path.join(out, 'ai-dark.png'), fullPage: true });
    }
    await fs.writeFile(path.join(out, 'report.json'), JSON.stringify({ report, errors, realAICalls: 0, mockAgyCalls: await page.evaluate(() => window.__agyCalls) }, null, 2));
    console.log(JSON.stringify({ phase, report, errors }));
  } catch (error) {
    await page.screenshot({ path: path.join(out, 'failure.png'), fullPage: true });
    console.log((await page.locator('body').innerText()).slice(0, 2200));
    console.log('Page errors:', errors);
    throw error;
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
