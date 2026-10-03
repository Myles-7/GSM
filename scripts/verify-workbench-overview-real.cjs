const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

async function main() {
  const root = path.resolve(__dirname, '..');
  const ledgerPath = path.join(root, 'output/agy-generation-ledger.jsonl');
  const ledger = (await fs.readFile(ledgerPath, 'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);
  const requirementsOnly = process.argv.includes('--requirements-only');
  if (ledger.length + (requirementsOnly ? 1 : 3) > 170) throw new Error('Insufficient calls within the existing 170-call ceiling.');
  if (!requirementsOnly && ledger.some(item => item.kind === 'workbench-overview-20261002')) throw new Error('This evaluation already started; inspect the saved report before rerunning.');
  if (requirementsOnly && ledger.filter(item => item.kind === 'workbench-overview-20261002').length !== 3) throw new Error('The requirements probe runs once after the three completed overview checks.');
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'gsm-workbench-real-'));
  const device = JSON.parse(await fs.readFile(path.join(process.env.APPDATA, 'Electron/agy-device.json'), 'utf8'));
  await fs.writeFile(path.join(profile, 'agy-device.json'), JSON.stringify(device));
  const env = { ...process.env, NODE_ENV: 'development', GSM_DESKTOP_LAUNCHER: '1', GSM_DEV_SERVER_URL: 'http://127.0.0.1:5173' };
  delete env.ELECTRON_RUN_AS_NODE;
  let app;
  const report = { date: '2026-10-02', syntheticOnly: true, productionRendererAndIPC: true, initialCalls: ledger.length, checks: [] };
  const output = path.join(root, requirementsOnly ? 'output/workbench-requirements-real.json' : 'output/workbench-overview-real.json');
  try {
    app = await electron.launch({ executablePath: require('electron'), cwd: root, env,
      args: [path.join(root, 'scripts/fixtures/workbench-overview-real.cjs'), '--hidden', `--user-data-dir=${profile}`] });
    await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows().forEach(window => window.webContents.setBackgroundThrottling(false)); });
    const page = await app.firstWindow();
    await page.waitForURL('http://127.0.0.1:5173/');
    await page.waitForFunction(async () => {
      const loaded = performance.getEntriesByType('resource').find(entry => new URL(entry.name).pathname === '/src/store/useAppStore.ts')?.name ?? '/src/store/useAppStore.ts';
      return (await import(loaded)).useAppStore.persist.hasHydrated();
    });
    await page.evaluate(async () => {
      const loaded = module => performance.getEntriesByType('resource').find(entry => new URL(entry.name).pathname === module)?.name ?? module;
      const { useAppStore } = await import(loaded('/src/store/useAppStore.ts'));
      const { refreshAgyDeviceState } = await import(loaded('/src/services/agyClient.ts'));
      const { AGY_CONFIG_ID } = await import(loaded('/src/utils/aiConfig.ts'));
      useAppStore.setState({ isAuthenticated: true, user: { id: 779, login: 'synthetic-evaluation', avatar_url: '/icon.png' },
        githubToken: 'synthetic-fixture', syncModeConfigured: true, currentView: 'ai', language: 'zh' });
      await refreshAgyDeviceState();
      const config = useAppStore.getState().aiConfigs.find(item => item.id === AGY_CONFIG_ID);
      if (!config?.isActive) throw new Error('The saved AGY configuration is unavailable.');
      useAppStore.setState({ activeAIConfig: AGY_CONFIG_ID, repositoryChatSettings: { ...useAppStore.getState().repositoryChatSettings, chatConfigId: AGY_CONFIG_ID } });
      window.overviewEvaluation = { config, snapshots: {} };
    });
    if (requirementsOnly) {
      report.requirements = await page.evaluate(async () => {
        const loaded = module => performance.getEntriesByType('resource').find(entry => new URL(entry.name).pathname === module)?.name ?? module;
        const { prepareWorkbenchRequirements } = await import(loaded('/src/services/aiWorkbenchService.ts'));
        return prepareWorkbenchRequirements({ question: '按刚才已回答的条件，找一批科研相关项目，简单介绍并分类。',
          previous: { purpose: '跨学科科研工具速览', required: ['与科研有关'], preferred: ['不限编程语言和操作系统', '先给用途分类与一句话介绍'], excluded: ['深入读取项目源码'], questions: [], queries: [] },
          messages: [{ id: 'answered', sessionId: 'synthetic', role: 'user', status: 'complete', evidenceIds: [], createdAt: new Date().toISOString(),
            content: '我需要跨学科通用科研工具，不限语言和操作系统，先按用途简单介绍和分类，不要深挖源码；这些问题都已确认。' }],
        });
      });
      assert.deepEqual(report.requirements.questions, []);
      assert.ok(report.requirements.queries.length > 0);
      report.finalCalls = (await fs.readFile(ledgerPath, 'utf8')).trim().split('\n').filter(Boolean).length;
      report.passed = true;
      console.log(JSON.stringify({ passed: true, finalCalls: report.finalCalls, noRepeatedClarification: true }));
      return;
    }
    for (const language of ['zh', 'en']) {
      const result = await page.evaluate(async language => {
        const loaded = module => performance.getEntriesByType('resource').find(entry => new URL(entry.name).pathname === module)?.name ?? module;
        const { AIService } = await import(loaded('/src/services/aiService.ts'));
        const { forAgyFeature } = await import(loaded('/src/services/agyProfiles.ts'));
        const { summarizeWorkbenchCandidates } = await import(loaded('/src/services/workbenchOverview.ts'));
        const descriptions = [
          'PaperDesk is a local Markdown editor and paper annotation tool for Windows and Linux. Cloud sync and mobile apps are not supported.',
          'NumericalLab is a Python library for numerical optimization and scientific models. It is not a desktop application.',
          'AwesomeResearch is a curated directory linking to paper-reading, computing and workflow projects. It does not implement those tools.',
          'PlotFlow is a desktop tool for plotting experimental measurements. It supports CSV import. macOS compatibility is not stated.',
          'BioPipe is a Python library for composing bioinformatics data processing pipelines. A graphical interface is not described.',
          'ExperimentBook is a local experiment log tool with Markdown notes and file attachments. Team collaboration is not described.',
          '',
          'MathExamples is a collection of worked notebooks for learning numerical methods. It is educational material, not a production computation service.',
        ];
        const timestamp = new Date().toISOString();
        const candidates = descriptions.map((description, i) => ({ repository: { id: i + 1, name: ['PaperDesk', 'NumericalLab', 'AwesomeResearch', 'PlotFlow', 'BioPipe', 'ExperimentBook', 'UnknownProject', 'MathExamples'][i],
          full_name: 'synthetic/' + ['PaperDesk', 'NumericalLab', 'AwesomeResearch', 'PlotFlow', 'BioPipe', 'ExperimentBook', 'UnknownProject', 'MathExamples'][i],
          description, html_url: '', owner: { login: 'synthetic', avatar_url: '' }, topics: [], language: null, stargazers_count: 0, forks_count: 0, forks: 0,
          created_at: timestamp, updated_at: timestamp, pushed_at: timestamp }, summary: description, reasons: [], limitations: [], sources: [], status: 'candidate' }));
        const started = Date.now();
        const items = await summarizeWorkbenchCandidates({ candidates, language,
          requirements: { purpose: 'Research and scientific computing tools', required: [], preferred: [], excluded: [], questions: [], queries: [] },
          ai: new AIService(forAgyFeature(window.overviewEvaluation.config, 'workbench'), language), concurrency: 1,
          onUpdate: () => {} });
        window.overviewEvaluation.snapshots[language] = items;
        return { language, durationMs: Date.now() - started, items };
      }, language);
      report.checks.push(result);
      await fs.writeFile(output, JSON.stringify(report, null, 2));
      assert.equal(result.items.length, 8);
      assert.ok(result.items.every(item => item.overview && item.overview.status !== 'failed'), 'All eight items must pass structured validation');
      assert.equal(result.items[2].overview.kind, 'resource');
      assert.equal(result.items[1].overview.kind, 'library');
      assert.equal(result.items[6].overview.status, 'insufficient');
      assert.ok(language === 'zh' ? /[\u4e00-\u9fff]/.test(result.items[0].overview.summary) : /[A-Za-z]/.test(result.items[0].overview.summary));
    }
    const answer = await page.evaluate(async () => {
      const loaded = module => performance.getEntriesByType('resource').find(entry => new URL(entry.name).pathname === module)?.name ?? module;
      const { answerWorkbenchOverview } = await import(loaded('/src/services/aiWorkbenchService.ts'));
      const result = await answerWorkbenchOverview({ question: '用中文简要说明 PaperDesk 和 AwesomeResearch 的区别。PaperDesk 是否支持云同步？不要给安装命令。',
        candidates: window.overviewEvaluation.snapshots.zh, messages: [] });
      return result;
    });
    report.answer = answer;
    assert.ok(/PaperDesk/.test(answer.content) && /AwesomeResearch/.test(answer.content));
    assert.ok(/不支持|不提供|没有|无云/.test(answer.content));
    assert.ok(!/npm install|pip install/.test(answer.content));
    report.finalCalls = (await fs.readFile(ledgerPath, 'utf8')).trim().split('\n').filter(Boolean).length;
    assert.ok(report.finalCalls <= 170);
    report.passed = true;
    console.log(JSON.stringify({ passed: true, initialCalls: report.initialCalls, finalCalls: report.finalCalls, languages: ['zh', 'en'] }));
  } catch (error) {
    report.failure = error.message; throw error;
  } finally {
    await fs.writeFile(output, JSON.stringify(report, null, 2));
    if (app) await app.close();
    const target = path.resolve(profile);
    assert.ok(target.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(target).startsWith('gsm-workbench-real-'));
    await fs.rm(target, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
