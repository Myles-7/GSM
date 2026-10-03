// Isolated task-center UI audit. All nonlocal requests are blocked; no real AI calls.
const { chromium } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const base = process.env.GSM_AUDIT_URL || 'http://127.0.0.1:5173';
async function main() {
  const out = path.resolve('output/playwright/task-center'); await fs.mkdir(out, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    return url.origin === base && !url.pathname.startsWith('/api') ? route.continue() : route.abort();
  });
  const page = await context.newPage(), errors = [], checks = [];
  page.on('pageerror', error => errors.push(error.message));
  const moduleUrl = pathname => `performance.getEntriesByType('resource').find(entry => new URL(entry.name).pathname === ${JSON.stringify(pathname)})?.name || ${JSON.stringify(pathname)}`;
  try {
    await page.goto(base);
    await page.waitForFunction(async () => (await import(performance.getEntriesByType('resource').find(entry => new URL(entry.name).pathname === '/src/store/useAppStore.ts')?.name || '/src/store/useAppStore.ts')).useAppStore.persist.hasHydrated());
    await page.evaluate(async ({ storeUrl, journalUrl }) => {
      const { useAppStore } = await import(eval(storeUrl));
      useAppStore.setState({ isAuthenticated: true, user: { id: 99990002, login: 'task-fixture', avatar_url: '' }, githubToken: 'fixture',
        currentView: 'tasks', language: 'zh', syncModeConfigured: true, aiConfigs: [], repositories: [], gists: [], starredGists: [], syncConfigs: [] });
      const { aiTaskJournal } = await import(eval(journalUrl));
      await aiTaskJournal.load('99990002');
      for (let index = 0; index < 35; index++) {
        const state = index % 5 === 0 ? 'failed' : index % 5 === 1 ? 'complete' : 'running';
        aiTaskJournal.project({ id: `fixture-${index}`, owner: '99990002', kind: index % 2 ? 'details' : 'summary', state,
          title: index === 0 ? 'owner/very-long-project-name-with-many-words-and-a-continuousidentifier0123456789'.repeat(2) : `owner/project-${index}`,
          createdAt: new Date(Date.now() - index * 1000).toISOString(), updatedAt: new Date().toISOString(), phase: 'verification',
          startedAt: new Date(Date.now() - 70000).toISOString(), endedAt: state === 'running' ? undefined : new Date().toISOString(),
          error: state === 'failed' ? 'AGY_RATE_LIMIT: wait before retrying / 请稍后重试' : undefined,
          items: Array.from({ length: 120 }, (_, item) => ({ id: String(item), label: `owner/project-${item}`, state: item < 80 ? 'complete' : item % 2 ? 'failed' : 'pending' })),
          configId: 'fixture-config', config: { model: 'fixture-model', provider: 'agy-cli', effort: 'high', timeoutSeconds: 180 }, target: { view: 'repositories' } });
      }
      await aiTaskJournal.flush('99990002');
    }, { storeUrl: moduleUrl('/src/store/useAppStore.ts'), journalUrl: moduleUrl('/src/services/aiTaskJournal.ts') });
    await page.getByTestId('task-center').waitFor();
    for (const language of ['zh', 'en']) for (const theme of ['light', 'dark']) for (const width of [390, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate(async ({ language, theme, storeUrl }) => {
        const { useAppStore } = await import(eval(storeUrl)); useAppStore.getState().setLanguage(language); useAppStore.getState().setTheme(theme);
      }, { language, theme, storeUrl: moduleUrl('/src/store/useAppStore.ts') });
      await page.getByTestId('task-center').getByRole('heading', { level: 1 }).waitFor();
      await page.screenshot({ path: path.join(out, `${language}-${theme}-${width}-list.png`) });
      const center = page.getByTestId('task-center');
      await center.locator('article button').first().click();
      await center.getByRole('complementary').waitFor();
      await page.screenshot({ path: path.join(out, `${language}-${theme}-${width}-detail.png`) });
      const overflow = await center.evaluate(element => element.scrollWidth > element.clientWidth + 1);
      const overflowing = await center.evaluate(element => [...element.querySelectorAll('button,input,select,h3')].filter(node => node.getBoundingClientRect().width && (node.getBoundingClientRect().right > innerWidth + 1 || node.scrollWidth > node.clientWidth + 2)).map(node => ({ tag: node.tagName, text: node.textContent.slice(0, 80) })));
      checks.push({ language, theme, width, overflow, overflowing });
      if (overflow || overflowing.length) throw new Error(`Task center overflow: ${JSON.stringify(checks.at(-1))}`);
      await center.getByRole('button', { name: language === 'zh' ? '返回列表' : 'Back to list', exact: true }).first().click();
      await page.getByRole('button', { name: /^(任务中心|Task center)/ }).first().click();
      await page.getByTestId('task-drawer').waitFor();
      await page.screenshot({ path: path.join(out, `${language}-${theme}-${width}-drawer.png`) });
      await page.keyboard.press('Escape');
      if (!await page.getByRole('button', { name: /^(任务中心|Task center)/ }).first().evaluate(element => document.activeElement === element)) throw new Error('Drawer did not restore keyboard focus');
    }
    await page.reload();
    await page.waitForFunction(async () => {
      const { aiTaskJournal } = await import(performance.getEntriesByType('resource').find(entry => new URL(entry.name).pathname === '/src/services/aiTaskJournal.ts')?.name || '/src/services/aiTaskJournal.ts');
      await aiTaskJournal.load('99990002'); return aiTaskJournal.snapshot().filter(task => task.owner === '99990002').length === 35;
    });
    const persisted = await page.evaluate(async journalUrl => {
      const { aiTaskJournal } = await import(eval(journalUrl)); return aiTaskJournal.snapshot().filter(task => task.id.startsWith('fixture-')).map(task => task.state);
    }, moduleUrl('/src/services/aiTaskJournal.ts'));
    if (persisted.some(state => state === 'running')) throw new Error('Local running tasks were not marked interrupted after restart');
    if (errors.length) throw new Error(errors.join('\n'));
    await fs.writeFile(path.join(out, 'report.json'), JSON.stringify({ checks, errors, realAICalls: 0, persistedRecords: persisted.length }, null, 2));
    console.log(JSON.stringify({ checks, persistedRecords: persisted.length, errors, realAICalls: 0 }));
  } catch (error) { await page.screenshot({ path: path.join(out, 'failure.png') }); throw error; }
  finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
