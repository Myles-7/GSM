const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

async function main() {
  const root = path.resolve(__dirname, '..');
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'gsm-agy-concurrency-ui-'));
  const out = path.join(root, 'output/agy-concurrency-ui');
  await fs.mkdir(out, { recursive: true });
  const env = { ...process.env, NODE_ENV: 'development', GSM_DESKTOP_LAUNCHER: '1', GSM_DEV_SERVER_URL: 'http://127.0.0.1:5173' };
  delete env.ELECTRON_RUN_AS_NODE;
  let app;
  const errors = [];
  const launch = async () => {
    app = await electron.launch({ executablePath: require('electron'), cwd: root, env,
      args: [path.join(root, 'scripts/fixtures/agy-concurrency-electron.cjs'), '--hidden', `--user-data-dir=${profile}`] });
    assert.equal(path.resolve(await app.evaluate(({ app }) => app.getPath('userData'))), path.resolve(profile));
    await app.evaluate(({ BrowserWindow }) => { for (const window of BrowserWindow.getAllWindows()) window.webContents.setBackgroundThrottling(false); });
    const page = await app.firstWindow();
    page.on('pageerror', error => errors.push(error.message));
    await page.waitForURL('http://127.0.0.1:5173/');
    await page.waitForFunction(async () => (await import('/src/store/useAppStore.ts')).useAppStore.persist.hasHydrated());
    await page.evaluate(async () => {
      const { useAppStore } = await import('/src/store/useAppStore.ts');
      const { changeAppLanguage } = await import('/src/i18n/index.ts');
      await changeAppLanguage('zh');
      sessionStorage.setItem('gsm:pending-settings-tab', 'ai');
      useAppStore.setState({ isAuthenticated: true, user: { id: 777, login: 'synthetic', avatar_url: '' }, githubToken: 'synthetic-ui-fixture',
        currentView: 'settings', language: 'zh', syncModeConfigured: true });
    });
    await page.locator('#agy-heading').waitFor();
    return page;
  };
  try {
    let page = await launch();
    let panel = page.locator('section[aria-labelledby="agy-heading"]');
    await panel.getByRole('button', { name: '刷新模型列表' }).click();
    await page.locator('#agy-model option[value="fixture-summary"]').waitFor({ state: 'attached' });
    await page.locator('#agy-model').selectOption('fixture-summary');
    await page.locator('#agy-concurrency').selectOption('5');
    const feature = panel.locator('details').filter({ has: page.locator('summary', { hasText: '仓库摘要' }) });
    await feature.locator('summary').click();
    await feature.getByLabel('仓库摘要 并发上限', { exact: true }).selectOption('2');
    await feature.getByLabel('仓库摘要 模型', { exact: true }).selectOption('fixture-details');
    await feature.getByLabel('仓库摘要 effort', { exact: true }).selectOption('high');
    await feature.locator('input[type="number"]').fill('90');
    await panel.getByRole('button', { name: '保存并测试', exact: true }).click();
    await panel.getByText(/中文结构化回答测试通过/).waitFor();
    await panel.getByRole('button', { name: '启用并设为当前', exact: true }).click();
    await panel.getByRole('button', { name: '当前 AI', exact: true }).waitFor();
    await feature.getByRole('button', { name: '测试已保存配置', exact: true }).click();
    await feature.getByText('测试成功', { exact: true }).waitFor();
    const state = await page.evaluate(() => window.electronAPI.agy.getState());
    assert.deepEqual(state.prefs.featureOverrides['repository-summary'], { concurrency: 2, model: 'fixture-details', effort: 'high', timeoutSeconds: 90 });
    await app.evaluate(() => { global.agyConcurrencyFixture.peak = 0; global.agyConcurrencyFixture.calls = []; });
    const generated = await page.evaluate(async () => {
      const { useAppStore } = await import('/src/store/useAppStore.ts');
      const { AIService } = await import('/src/services/aiService.ts');
      const { forAgyFeature } = await import('/src/services/agyProfiles.ts');
      const config = useAppStore.getState().aiConfigs.find(config => config.provider === 'agy-cli');
      const ai = new AIService(forAgyFeature(config, 'repository-summary'));
      return Promise.all(Array.from({ length: 5 }, (_, i) => ai.generateChatText({ system: 'Synthetic test', user: `item ${i}`, maxTokens: 500 })));
    });
    assert.equal(generated.length, 5);
    const runtime = await app.evaluate(() => global.agyConcurrencyFixture);
    assert.equal(runtime.peak, 2);
    assert.ok(runtime.calls.every(call => call.model === 'fixture-details' && call.effort === 'high' && call.timeoutMs === 90000));
    for (const language of ['zh', 'en']) {
      await page.evaluate(async language => {
        const { useAppStore } = await import('/src/store/useAppStore.ts');
        const { changeAppLanguage } = await import('/src/i18n/index.ts');
        await changeAppLanguage(language); useAppStore.setState({ language });
      }, language);
      for (const width of [390, 1280]) {
        await page.setViewportSize({ width, height: 960 });
        await panel.locator('details').first().scrollIntoViewIfNeeded();
        const screenshot = await app.evaluate(async ({ BrowserWindow }) =>
          (await BrowserWindow.getAllWindows()[0].webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG().toString('base64'));
        await fs.writeFile(path.join(out, `${language}-${width}.png`), Buffer.from(screenshot, 'base64'));
        const overflow = await panel.evaluate(element => element.scrollWidth > element.clientWidth + 2);
        assert.equal(overflow, false, `${language}/${width} panel overflow`);
      }
    }
    await page.locator('#agy-concurrency').focus();
    await page.keyboard.press('Tab');
    assert.ok(await page.evaluate(() => document.activeElement !== document.body));
    await app.close(); app = undefined;
    page = await launch(); panel = page.locator('section[aria-labelledby="agy-heading"]');
    const restored = await page.evaluate(() => window.electronAPI.agy.getState());
    assert.equal(restored.enabled, true);
    assert.deepEqual(restored.prefs.featureOverrides, state.prefs.featureOverrides);
    assert.equal(restored.prefs.concurrency, 5);
    assert.equal(errors.length, 0, errors.join('\n'));
    await fs.writeFile(path.join(out, 'report.json'), JSON.stringify({ offline: true, realGenerationCalls: 0, languages: ['zh', 'en'], widths: [390, 1280], profilePersistence: true, ipcPeak: runtime.peak, featureParameters: true, pageErrors: errors }, null, 2));
    console.log('Offline Electron profile settings, IPC concurrency, persistence and responsive checks passed');
  } finally {
    await app?.close();
    if (path.dirname(profile) === os.tmpdir() && path.basename(profile).startsWith('gsm-agy-concurrency-ui-'))
      await fs.rm(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
