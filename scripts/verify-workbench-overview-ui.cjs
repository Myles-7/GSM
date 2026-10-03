const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

async function main() {
  const root = path.resolve(__dirname, '..');
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'gsm-workbench-overview-'));
  const output = path.join(root, 'output/workbench-overview');
  await fs.mkdir(output, { recursive: true });
  const env = { ...process.env, NODE_ENV: 'development', GSM_DESKTOP_LAUNCHER: '1', GSM_DEV_SERVER_URL: 'http://127.0.0.1:5173' };
  delete env.ELECTRON_RUN_AS_NODE;
  let app;
  const errors = [];
  const report = { date: '2026-10-02', fixtureOnly: true, realModelCalls: 0, screenshots: [], sizes: [], checks: [] };
  const launch = async () => {
    app = await electron.launch({ executablePath: require('electron'), cwd: root, env,
      args: [path.join(root, 'scripts/fixtures/agy-concurrency-electron.cjs'), '--hidden', `--user-data-dir=${profile}`] });
    app.process().on('exit', (code, signal) => { if (code) console.error('Electron exited', { code, signal }); });
    await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows().forEach(window => window.webContents.setBackgroundThrottling(false)); });
    const page = await app.firstWindow();
    page.on('pageerror', error => errors.push(error.message));
    await page.waitForURL('http://127.0.0.1:5173/');
    await page.waitForFunction(async () => {
      const loaded = performance.getEntriesByType('resource').find(entry => new URL(entry.name).pathname === '/src/store/useAppStore.ts')?.name ?? '/src/store/useAppStore.ts';
      return (await import(loaded)).useAppStore.persist.hasHydrated();
    });
    return page;
  };
  const seed = async (page, count, language, theme) => {
    await page.evaluate(async ({ count, language, theme }) => {
      const loaded = module => performance.getEntriesByType('resource').find(entry => new URL(entry.name).pathname === module)?.name ?? module;
      const { useAppStore } = await import(loaded('/src/store/useAppStore.ts'));
      const { repositoryChatStorage: storage } = await import(loaded('/src/services/repositoryChatStorage.ts'));
      await (await import(loaded('/src/i18n/index.ts'))).changeAppLanguage(language);
      useAppStore.setState({ isAuthenticated: true, user: { id: 778, login: 'synthetic', avatar_url: '/icon.png' },
        githubToken: 'synthetic-ui-fixture', language, theme, syncModeConfigured: true, currentView: 'ai' });
      const zh = language === 'zh';
      const groups = zh ? ['论文阅读与管理', '科学计算与建模', '科研流程与资源'] : ['Papers and reading', 'Computing and modeling', 'Research workflows'];
      const names = ['PaperDesk', 'Numerical-Lab', 'Awesome-Research-Resources', 'Literature-Reader', 'Experiment-Notebook', 'Research-Workflow'];
      const descriptions = zh
        ? ['用于本地阅读、标注和整理论文的工具，支持按主题管理阅读笔记；云同步未在当前资料中说明。', '提供数值计算与模型实验的开发库，适合搭建计算流程，不是开箱即用的论文管理应用。', '汇集科研工具、文献阅读与实验管理项目的资源目录，方便找资料，本身不实现这些工具。']
        : ['A local tool for reading, annotating and organizing papers. Cloud synchronization is not described.', 'A numerical computing library for building model experiments, rather than a ready-to-use reading app.', 'A directory of research and experiment tools. It collects resources rather than implementing them.'];
      const timestamp = new Date().toISOString();
      const candidates = Array.from({ length: count }, (_, i) => {
        const name = `${names[i % names.length]}${i >= names.length ? '-' + i : ''}`;
        const repository = { id: 1000 + i, name, full_name: `open-research/${name}`, description: descriptions[i % 3], html_url: `https://github.com/open-research/${name}`,
          owner: { login: 'open-research', avatar_url: '/icon.png' }, topics: ['research'], language: i % 3 === 2 ? null : i % 2 ? 'Python' : 'TypeScript',
          stargazers_count: 2800 - i * 13, forks_count: 10, forks: 10, license: 'MIT', created_at: timestamp, updated_at: timestamp, pushed_at: timestamp };
        return { repository, summary: descriptions[i % 3], reasons: [zh ? '与科研阅读和计算场景有关。' : 'Relevant to research and reading.'],
          limitations: [zh ? '当前介绍仅依据合成项目说明，不代表真实产品评测。' : 'Synthetic fixture; not an evaluation of a real product.'],
          sources: [repository.html_url], status: 'candidate', overview: { summary: descriptions[i % 3], category: groups[i % 3],
            categoryDescription: zh ? ['阅读论文、整理知识和笔记', '算法、数值模型与实验计算', '项目目录与科研流程辅助'][i % 3] : ['Reading and knowledge organization', 'Numerical experiments and algorithms', 'Directories and research workflows'][i % 3],
            kind: ['tool', 'library', 'resource'][i % 3], status: 'ready', basis: 'metadata' } };
      });
      const id = `overview-${count}-${language}-${theme}`;
      const requirements = { purpose: zh ? '科研项目与工具速览' : 'Research projects and tools', required: [], preferred: [], excluded: [], questions: [], queries: ['research'] };
      await storage.saveSession({ id, ownerId: '778', kind: 'workbench', deviceOnly: true, title: requirements.purpose,
        repoId: 0, repoFullName: '', sourceRefSha: '', createdAt: timestamp, updatedAt: timestamp,
        workbench: { scope: 'github', depth: 'standard', inputIntent: 'results', selectedRepositories: [],
          searchBatches: [{ id: 'batch-one', createdAt: timestamp, requirements, candidates, queries: ['research'], nextPage: 2,
            overviewSummary: zh ? '这批项目分为论文阅读、科学计算和科研资源三类，既有可使用的工具，也有供开发的库与资源目录。' : 'These projects cover paper reading, scientific computing and research resources, including tools, libraries and directories.' }] } });
      await storage.saveMessage({ id: `${id}-question`, sessionId: id, role: 'user', status: 'complete', evidenceIds: [], createdAt: timestamp,
        content: zh ? '找一些科研和论文阅读相关项目，先简单介绍和分类。' : 'Find research and paper-reading projects, with short introductions and categories.' });
      await storage.saveMessage({ id: `${id}-answer`, sessionId: id, role: 'assistant', status: 'complete', evidenceIds: [], createdAt: new Date(Date.now() + 1).toISOString(), answerPhase: 'final', quality: 'unreviewed',
        content: zh ? '项目可分为论文阅读、科学计算与科研资源三类。工具适合直接使用；开发库面向编程；资源清单用于继续发现项目。' : 'The projects cover paper reading, scientific computing and research resources. Tools support direct use, libraries support development, and directories help discover more projects.' });
      window.dispatchEvent(new CustomEvent('gsm:select-workbench-session', { detail: id }));
    }, { count, language, theme });
    try { await page.getByRole('tab', { name: language === 'zh' ? '项目总览' : 'Project overview', exact: true }).waitFor({ timeout: 10000 }); }
    catch (error) { console.error((await page.locator('body').innerText()).slice(0, 7000)); console.error(errors); throw error; }
    await page.evaluate(id => window.dispatchEvent(new CustomEvent('gsm:select-workbench-session', { detail: id })), `overview-${count}-${language}-${theme}`);
    try { await page.locator('[data-testid="overview-card"]').first().waitFor(); }
    catch (error) { console.error((await page.locator('body').innerText()).slice(0, 5000)); console.error(errors); throw error; }
    await page.waitForFunction(count => document.querySelectorAll('[data-testid="overview-card"]').length === count, count);
  };
  try {
    let page;
    for (const language of ['zh', 'en']) for (const theme of ['light', 'dark']) {
      page = await launch();
      await seed(page, 30, language, theme);
      for (const width of [390, 1280, 1536, 1920]) {
        await page.setViewportSize({ width, height: 1000 });
        await page.evaluate(() => document.fonts.ready);
        const size = await page.evaluate(() => {
          const pane = document.querySelector('.workbench-results-pane');
          const cards = [...pane.querySelectorAll('[data-testid="overview-card"]')];
          return { width: innerWidth, scroll: document.documentElement.scrollWidth, pane: pane.getBoundingClientRect().width,
            cards: cards.map(card => ({ width: card.getBoundingClientRect().width, overflow: card.scrollWidth - card.clientWidth })) };
        });
        assert.ok(size.scroll <= size.width + 2, `Page overflow at ${width}`);
        assert.ok(size.cards.every(card => card.width >= 259 && card.overflow <= 2), `Card overflow at ${width}`);
        const filename = `${language}-${theme}-${width}.png`;
        const screenshot = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG().toString('base64'));
        await fs.writeFile(path.join(output, filename), Buffer.from(screenshot, 'base64'));
        report.screenshots.push(filename); report.sizes.push({ language, theme, ...size, cards: size.cards.length });
      }
      await app.close(); app = undefined;
    }
    page = await launch();
    await page.setViewportSize({ width: 1536, height: 1000 });
    await seed(page, 3, 'zh', 'light');
    const results = page.locator('[data-testid="workbench-results"]');
    await results.getByLabel('选择当前筛选结果', { exact: true }).check();
    await results.getByRole('button', { name: '加入上下文', exact: true }).click();
    await page.waitForFunction(async () => {
      const loaded = module => performance.getEntriesByType('resource').find(entry => new URL(entry.name).pathname === module)?.name ?? module;
      const { repositoryChatStorage: storage } = await import(loaded('/src/services/repositoryChatStorage.ts'));
      return (await storage.getSession('overview-3-zh-light')).workbench.selectedRepositories.length === 3;
    });
    report.checks.push('Bulk selection adds exactly the selected three projects to context');
    await results.getByRole('button', { name: '查看项目详情: open-research/PaperDesk', exact: true }).click();
    await page.getByRole('heading', { name: 'open-research/PaperDesk', exact: true }).waitFor();
    await page.getByRole('heading', { name: '限制与未知', exact: true }).waitFor();
    await page.keyboard.press('Escape');
    report.checks.push('Details drawer opens and closes with keyboard');
    const separator = page.getByRole('separator', { name: '调整项目与对话分栏' });
    await separator.focus(); await page.keyboard.press('ArrowLeft');
    assert.equal(await separator.getAttribute('aria-valuenow'), '58');
    await page.getByRole('button', { name: '并排对话', exact: true }).click();
    assert.equal(await page.locator('.workbench-chat-pane').isVisible(), false);
    report.checks.push('Keyboard resizing and conversation docking');
    await page.reload();
    await page.waitForFunction(() => localStorage.getItem('gsm:workbench-ratio') === '58' && localStorage.getItem('gsm:workbench-dock') === 'false');
    await page.evaluate(async () => { const loaded = module => performance.getEntriesByType('resource').find(entry => new URL(entry.name).pathname === module)?.name ?? module; const { useAppStore } = await import(loaded('/src/store/useAppStore.ts')); useAppStore.setState({ currentView: 'ai', user: { id: 778, login: 'synthetic', avatar_url: '/icon.png' }, isAuthenticated: true, githubToken: 'synthetic-ui-fixture', syncModeConfigured: true }); window.dispatchEvent(new CustomEvent('gsm:select-workbench-session', { detail: 'overview-3-zh-light' })); });
    await page.locator('[data-testid="overview-card"]').first().waitFor();
    assert.equal(await page.locator('.workbench-chat-pane').isVisible(), false);
    report.checks.push('Layout survives reload');
    await seed(page, 120, 'zh', 'light');
    assert.equal(await page.locator('[data-testid="overview-card"]').count(), 120);
    await page.getByLabel('搜索项目名称或用途', { exact: true }).fill('PaperDesk-114');
    assert.equal(await page.locator('[data-testid="overview-card"]').count(), 1);
    report.checks.push('120 projects render; search narrows the result set');
    await app.close(); app = undefined;
    page = await launch();
    assert.equal(await page.evaluate(() => localStorage.getItem('gsm:workbench-ratio')), '58');
    assert.equal(await page.evaluate(() => localStorage.getItem('gsm:workbench-dock')), 'false');
    report.checks.push('Layout survives Electron restart');
    assert.deepEqual(errors, []);
    report.errors = errors;
    await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
  } finally {
    if (app) await app.close();
    const target = path.resolve(profile);
    assert.ok(target.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(target).startsWith('gsm-workbench-overview-'));
    await fs.rm(target, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
