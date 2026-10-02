const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

async function main() {
  const root = path.resolve(__dirname, '..');
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'gsm-ai-ux-ui-'));
  const out = path.join(root, 'output', 'ai-ux-workbench');
  await fs.mkdir(out, { recursive: true });
  const env = { ...process.env, NODE_ENV: 'development', GSM_DESKTOP_LAUNCHER: '1', GSM_DEV_SERVER_URL: 'http://127.0.0.1:5173' };
  delete env.ELECTRON_RUN_AS_NODE;
  let app;
  try {
    app = await electron.launch({ executablePath: require('electron'), cwd: root, env,
      args: [path.join(root, 'scripts/fixtures/agy-electron-e2e.cjs'), '--hidden', `--user-data-dir=${profile}`] });
    assert.equal(path.resolve(await app.evaluate(({ app }) => app.getPath('userData'))), path.resolve(profile));
    const page = await app.firstWindow();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.waitForURL('http://127.0.0.1:5173/');
    await page.waitForFunction(async () => (await import(performance.getEntriesByType('resource').find(entry => new URL(entry.name).pathname === '/src/store/useAppStore.ts')?.name ?? '/src/store/useAppStore.ts')).useAppStore.persist.hasHydrated());
    await page.evaluate(async () => {
      const { useAppStore } = await import(performance.getEntriesByType('resource').find(entry => new URL(entry.name).pathname === '/src/store/useAppStore.ts')?.name ?? '/src/store/useAppStore.ts');
      const { repositoryChatStorage: storage } = await import('/src/services/repositoryChatStorage.ts');
      const { changeAppLanguage } = await import('/src/i18n/index.ts');
      await changeAppLanguage('zh');
      useAppStore.setState({ isAuthenticated: true, user: { id: 777, login: 'synthetic', avatar_url: '' },
        githubToken: 'synthetic-ui-fixture', language: 'zh', syncModeConfigured: true, currentView: 'ai' });
      const now = new Date().toISOString();
      await storage.saveSession({ id: 'ux-fixture', ownerId: '777', kind: 'workbench', deviceOnly: true,
        repoId: 0, repoFullName: '', sourceRefSha: '', title: 'Synthetic Notes', createdAt: now, updatedAt: now,
        workbench: { scope: 'local', depth: 'standard', selectedRepositories: [], searchBatches: [],
          localProject: { name: 'Synthetic Notes', identity: 'a'.repeat(64) } } });
      await storage.saveEvidence({ id: 'ux-source', source: 'local', repoFullName: 'local/Synthetic Notes', path: 'README.md',
        excerpt: 'Local Markdown editor. No cloud sync.', contentHash: 'fixture-hash', retrievedAt: now, url: 'local-evidence:fixture' });
      await storage.saveMessage({ id: 'ux-question', sessionId: 'ux-fixture', role: 'user', content: 'Explain the project and its limitations.',
        evidenceIds: [], status: 'complete', createdAt: now });
      await storage.saveMessage({ id: 'ux-answer', sessionId: 'ux-fixture', role: 'assistant',
        content: 'Local Markdown editor. No cloud sync.', evidenceIds: ['ux-source'], status: 'complete', answerPhase: 'final',
        quality: 'model-reviewed', coverage: [{ requirement: 'Limitations', status: 'answered', answerExcerpt: 'No cloud sync.' }],
        claims: [{ text: 'No cloud sync.', evidenceId: 'ux-source', quote: 'No cloud sync.' }],
        researchSources: [{ repository: 'local/Synthetic Notes', status: 'complete', evidenceIds: ['ux-source'] }],
        comparison: [{ repository: 'local/Synthetic Notes', requirement: 'Cloud sync', status: 'unsupported',
          evidenceId: 'ux-source', quote: 'No cloud sync.' }],
        createdAt: new Date(Date.now() + 1).toISOString() });
      const { aiTaskJournal } = await import('/src/services/aiTaskJournal.ts');
      const task = aiTaskJournal.begin('777', 'summary', [{ id: '1', label: 'synthetic/one' }, { id: '2', label: 'synthetic/two' }]);
      task.item('1', 'complete');
      task.finish();
      const partial = aiTaskJournal.begin('777', 'discovery', [{ id: 'one', label: 'One' }, { id: 'two', label: 'Two' }]);
      partial.item('one', 'complete');
      partial.item('two', 'failed');
      partial.finish();
      sessionStorage.setItem('gsm:ai-workbench-session', 'ux-fixture');
    });
    await page.reload();
    await page.waitForFunction(async () => (await import(performance.getEntriesByType('resource').find(entry => new URL(entry.name).pathname === '/src/store/useAppStore.ts')?.name ?? '/src/store/useAppStore.ts')).useAppStore.persist.hasHydrated());
    await page.evaluate(async () => {
      const { useAppStore } = await import(performance.getEntriesByType('resource').find(entry => new URL(entry.name).pathname === '/src/store/useAppStore.ts')?.name ?? '/src/store/useAppStore.ts');
      useAppStore.setState({ isAuthenticated: true, user: { id: 777, login: 'synthetic', avatar_url: '' },
        githubToken: 'synthetic-ui-fixture', language: 'zh', syncModeConfigured: true, currentView: 'ai' });
    });
    try { await page.getByText('Local Markdown editor. No cloud sync.', { exact: true }).first().waitFor(); }
    catch (error) { console.error((await page.locator('body').innerText()).slice(0, 5000)); throw error; }
    const overflow = [];
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate(() => document.fonts.ready);
      assert.ok(await page.getByText('已经模型复核，非独立事实验证', { exact: true }).isVisible());
      assert.ok(await page.getByRole('button', { name: '选择项目目录', exact: true }).isVisible());
      assert.ok(await page.getByRole('columnheader', { name: 'Cloud sync' }).isVisible());
      assert.ok(await page.getByRole('cell', { name: /不支持/ }).isVisible());
      const dimensions = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: innerWidth }));
      if (dimensions.scroll > dimensions.width + 2) overflow.push({ width, ...dimensions });
      const image = await app.evaluate(async ({ BrowserWindow }) =>
        (await BrowserWindow.getAllWindows()[0].webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG().toString('base64'));
      await fs.writeFile(path.join(out, `workbench-${width}.png`), Buffer.from(image, 'base64'));
    }
    assert.deepEqual(overflow, []);
    await page.getByText('README.md: 重新绑定目录后检查', { exact: true }).waitFor();
    await page.evaluate(async () => {
      const loaded = module => performance.getEntriesByType('resource').find(entry => new URL(entry.name).pathname === module)?.name ?? module;
      const { useAppStore } = await import(loaded('/src/store/useAppStore.ts'));
      await (await import(loaded('/src/i18n/index.ts'))).changeAppLanguage('en');
      useAppStore.setState({ language: 'en' });
    });
    await page.getByText('README.md: Rebind folder to check', { exact: true }).waitFor();
    for (const width of [390, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await page.getByText('Model-reviewed; not independently verified', { exact: true }).waitFor();
      const invalid = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2);
      assert.equal(invalid, false, 'English workbench must not overflow');
    }
    await page.evaluate(async () => {
      const loaded = module => performance.getEntriesByType('resource').find(entry => new URL(entry.name).pathname === module)?.name ?? module;
      const { useAppStore } = await import(loaded('/src/store/useAppStore.ts'));
      await (await import(loaded('/src/i18n/index.ts'))).changeAppLanguage('zh');
      useAppStore.setState({ language: 'zh' });
    });
    const taskButton = page.getByRole('button', { name: 'AI 任务', exact: true });
    await taskButton.focus();
    await page.keyboard.press('Enter');
    await page.getByRole('heading', { name: 'AI 任务', exact: true }).waitFor();
    assert.ok(await page.getByRole('button', { name: '继续', exact: true }).isVisible());
    assert.ok(await page.getByRole('button', { name: '仅重试失败项', exact: true }).isVisible());
    assert.ok(await page.getByText('部分完成 · 1/2', { exact: true }).isVisible());
    await page.keyboard.press('Escape');
    await page.getByRole('heading', { name: 'AI 任务', exact: true }).waitFor({ state: 'hidden' });
    await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'AI 任务');
    assert.ok(await taskButton.evaluate(element => element === document.activeElement), 'Closing the task panel returns keyboard focus');
    assert.deepEqual(errors, []);
    const report = { at: new Date().toISOString(), fixtureOnly: true, realModelCalls: 0,
      viewports: [1280, 390], localRebindVisible: true, reviewVisible: true,
      taskPanelKeyboardAndFocus: true, partialTaskAndFailureRetryVisible: true, comparisonVisible: true, freshnessRebindVisible: true,
      languages: ['zh', 'en'], overflow, errors };
    await fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
  } finally {
    if (app) await app.close();
    const target = path.resolve(profile);
    assert.ok(target.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(target).startsWith('gsm-ai-ux-ui-'));
    await fs.rm(target, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
