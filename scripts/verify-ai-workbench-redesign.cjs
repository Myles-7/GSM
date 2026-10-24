// Isolated UI acceptance check. All external HTTP and WebSocket requests are
// blocked by agy-electron-e2e; no real account or model is used.
const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

async function main() {
  const root = path.resolve(__dirname, '..');
  const out = path.join(root, 'output', 'ai-workbench-redesign');
  await fs.mkdir(out, { recursive: true });
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'gsm-workbench-redesign-'));
  const env = { ...process.env, NODE_ENV: 'development', GSM_DESKTOP_LAUNCHER: '1', GSM_DEV_SERVER_URL: 'http://127.0.0.1:5173', PW_TEST_SCREENSHOT_NO_FONTS_READY: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  let app;
  const report = { fixtureOnly: true, realModelCalls: 0, screenshots: [], layouts: [], errors: [] };
  try {
    app = await electron.launch({ executablePath: require('electron'), cwd: root, env,
      args: [path.join(root, 'scripts/fixtures/agy-electron-e2e.cjs'), '--hidden', `--user-data-dir=${profile}`] });
    const page = await app.firstWindow();
    await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      window.webContents.setBackgroundThrottling(false);
      // Render in the background without taking keyboard focus. Hidden-window
      // native capture on Windows may lag behind the current DOM by a frame.
      window.showInactive();
    });
    page.setDefaultTimeout(15000);
    page.on('pageerror', error => report.errors.push(error.message));
    await page.waitForURL('http://127.0.0.1:5173/');
    await page.waitForFunction(async () => (await import(performance.getEntriesByType('resource').find(item => new URL(item.name).pathname === '/src/store/useAppStore.ts')?.name ?? '/src/store/useAppStore.ts')).useAppStore.persist.hasHydrated());
    await page.evaluate(async () => {
      const url = performance.getEntriesByType('resource').find(item => new URL(item.name).pathname === '/src/store/useAppStore.ts')?.name ?? '/src/store/useAppStore.ts';
      const { useAppStore } = await import(url);
      const now = new Date().toISOString();
      const repositories = ['fixture/agent-tools', 'fixture/workflow', 'fixture/local-runner', 'fixture/research-kit'].map((full_name, i) => ({
        id: 800 + i, name: full_name.split('/')[1], full_name, description: '用于界面验收的模拟仓库资料',
        html_url: `https://github.com/${full_name}`, stargazers_count: 1000 + i * 300, forks_count: 30,
        language: 'TypeScript', created_at: now, updated_at: now, pushed_at: now,
        owner: { login: 'fixture', avatar_url: '' }, topics: ['workflow'], default_branch: 'main', license: 'MIT', archived: false,
      }));
      useAppStore.setState({ isAuthenticated: true, user: { id: 777, login: 'design-fixture', avatar_url: '' },
        githubToken: 'synthetic-ui-fixture', language: 'zh', syncModeConfigured: true, currentView: 'ai', theme: 'dark', repositories,
        aiConfigs: [{ id: 'fixture-model', name: '验收模型', model: 'fixture-only', apiKey: 'synthetic', baseUrl: 'https://example.invalid', apiType: 'openai', isActive: true }],
        activeAIConfig: 'fixture-model', repositoryChatSettings: { ...useAppStore.getState().repositoryChatSettings, chatConfigId: 'fixture-model' } });
      localStorage.setItem('gsm_custom_inspiration_cards', '[{"title":"preserved fixture"}]');
    });
    await page.getByRole('heading', { name: '你想用 AI 完成什么？' }).waitFor();
    const capture = async (state, width, theme, height = 900) => {
      await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setContentSize(size.width, size.height), { width, height });
      await page.setViewportSize({ width, height });
      await page.evaluate(async next => {
        const url = performance.getEntriesByType('resource').find(item => new URL(item.name).pathname === '/src/store/useAppStore.ts')?.name ?? '/src/store/useAppStore.ts';
        (await import(url)).useAppStore.setState({ theme: next });
      }, theme);
      await page.evaluate(() => document.fonts.ready);
      const layout = await page.evaluate(() => {
        const send = document.querySelector('button[aria-label="发送"]')?.getBoundingClientRect();
        return { width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth,
          scrollHeight: document.documentElement.scrollHeight, send: send ? { top: send.top, bottom: send.bottom } : null };
      });
      assert.ok(layout.scrollWidth <= width + 2, `${state}: horizontal overflow at ${width}`);
      assert.ok(layout.scrollHeight <= height + 2, `${state}: outer page overflow at ${width}`);
      if (state === 'home' || state === 'conversation') assert.ok(layout.send && layout.send.bottom <= height + 1 && layout.send.top >= 0, `${state}: send control outside viewport`);
      const name = `${state}-${width}-${theme}.png`;
      await page.screenshot({ path: path.join(out, name), animations: 'disabled', timeout: 30000 });
      report.screenshots.push(name); report.layouts.push({ state, theme, ...layout });
      console.log(`Captured ${name}`);
    };
    for (const theme of ['dark', 'light']) for (const width of [1440, 1300, 768, 390]) await capture('home', width, theme, width === 390 ? 844 : 900);

    await page.getByRole('textbox', { name: '问题', exact: true }).fill('保留首次输入的研究目标');
    await page.getByRole('button', { name: /研究与对比/ }).click();
    await page.getByRole('dialog', { name: '添加研究仓库' }).waitFor();
    await page.getByRole('textbox', { name: '搜索仓库名称或描述' }).fill('agent');
    await page.getByRole('checkbox', { name: /fixture\/agent-tools/ }).check();
    await page.getByRole('button', { name: '使用所选仓库' }).click();
    await page.getByRole('dialog', { name: '添加研究仓库' }).waitFor({ state: 'hidden' });
    assert.equal(await page.getByRole('textbox', { name: '问题', exact: true }).inputValue(), '保留首次输入的研究目标');
    assert.equal(await page.evaluate(() => localStorage.getItem('gsm_custom_inspiration_cards')), '[{"title":"preserved fixture"}]');
    await page.getByRole('button', { name: '参数设置' }).click();
    await page.getByRole('dialog', { name: '参数设置' }).waitFor();
    await page.getByRole('combobox', { name: '任务深度', exact: true }).click();
    await page.getByRole('option', { name: '深入', exact: true }).click();
    await page.waitForFunction(async () => {
      const { repositoryChatStorage: storage } = await import('/src/services/repositoryChatStorage.ts');
      return (await storage.getSession(sessionStorage.getItem('gsm:ai-workbench-session')))?.workbench?.depth === 'deep';
    });
    assert.equal(await page.getByRole('textbox', { name: '问题', exact: true, includeHidden: true }).inputValue(), '保留首次输入的研究目标');
    await capture('parameters', 390, 'light', 844);
    await page.keyboard.press('Escape');
    await page.getByRole('dialog', { name: '参数设置' }).waitFor({ state: 'hidden' });
    assert.ok(await page.getByRole('button', { name: '参数设置' }).evaluate(element => element === document.activeElement), 'Parameters must restore keyboard focus');

    await page.evaluate(async () => {
      const { repositoryChatStorage: storage } = await import('/src/services/repositoryChatStorage.ts');
      const url = performance.getEntriesByType('resource').find(item => new URL(item.name).pathname === '/src/store/useAppStore.ts')?.name ?? '/src/store/useAppStore.ts';
      const { useAppStore } = await import(url);
      const id = sessionStorage.getItem('gsm:ai-workbench-session');
      const session = await storage.getSession(id), now = new Date().toISOString();
      const requirements = { purpose: '寻找本地部署的工作流工具', required: ['本地部署'], preferred: ['TypeScript'], excluded: [], questions: [], queries: ['workflow'] };
      const candidates = useAppStore.getState().repositories.map((repository, i) => ({ repository,
        summary: '模拟结果，仅用于检查页面交互。', reasons: [], limitations: [], sources: [repository.html_url], status: 'candidate',
        overview: { summary: '模拟结果：工作流编排与本地部署工具。', category: i % 2 ? '研究工具' : '工作流', categoryDescription: '模拟分类', kind: i % 2 ? 'library' : 'tool', status: 'ready', basis: 'metadata' } }));
      await storage.saveSession({ ...session, title: '工作流工具选型', updatedAt: now, workbench: { ...session.workbench,
        taskMode: 'discover', scope: 'github', inputIntent: 'results', requirements,
        searchBatches: [{ id: 'fixture-batch', createdAt: now, requirements, candidates, queries: ['workflow'], nextPage: 2 }] } });
      window.dispatchEvent(new Event('gsm:global-chat-history-changed'));
    });
    await page.getByRole('link', { name: 'agent-tools', exact: true }).waitFor();
    for (const theme of ['dark', 'light']) for (const width of [1440, 1300, 768, 390]) await capture('results', width, theme, width === 390 ? 844 : 900);
    await page.getByRole('button', { name: /^筛选/ }).click();
    await page.getByRole('dialog', { name: '筛选' }).waitFor();
    await capture('filters', 390, 'dark', 844);
    await page.keyboard.press('Escape');

    await page.evaluate(async () => {
      const { repositoryChatStorage: storage } = await import('/src/services/repositoryChatStorage.ts');
      const id = sessionStorage.getItem('gsm:ai-workbench-session'), now = new Date().toISOString();
      await storage.saveMessage({ id: 'fixture-question', sessionId: id, role: 'user', content: '这些项目有哪些区别？', evidenceIds: [], status: 'complete', createdAt: now });
      await storage.saveMessage({ id: 'fixture-answer', sessionId: id, role: 'assistant', content: '这是隔离验收的模拟回答。研究结果应结合资料来源与实际验证。', evidenceIds: [], status: 'complete', createdAt: new Date(Date.parse(now) + 1).toISOString() });
      window.dispatchEvent(new Event('gsm:global-chat-history-changed'));
    });
    await page.getByRole('tab', { name: '对话', exact: true }).click();
    await page.getByText('这些项目有哪些区别？', { exact: true }).waitFor();
    await capture('conversation', 390, 'light', 844);
    await capture('conversation', 1440, 'dark');
    assert.deepEqual(report.errors, []);
    console.log(JSON.stringify({ screenshots: report.screenshots.length, realModelCalls: 0, errors: report.errors }));
  } finally {
    await fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
    if (app) await app.close();
    const target = path.resolve(profile), parent = path.resolve(os.tmpdir());
    assert.equal(path.dirname(target), parent);
    assert.ok(path.basename(target).startsWith('gsm-workbench-redesign-'));
    await fs.rm(target, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
