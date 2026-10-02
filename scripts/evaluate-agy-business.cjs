const { _electron: electron } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const ux = require('./fixtures/ai-ux-content.cjs');

async function main() {
  const root = path.resolve(__dirname, '..');
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'gsm-agy-business-'));
  const projectPath = path.join(temp, 'SyntheticNotes');
  await fs.mkdir(projectPath);
  await fs.writeFile(path.join(projectPath, 'README.md'), '# SyntheticNotes\n\n## Features\nA local Markdown note editor for Windows and Linux. Full-text search is included. Cloud sync and mobile apps are not supported.\n\n## Installation\nRun npm install then npm start.\n');
  const env = { ...process.env, NODE_ENV: 'development', GSM_DESKTOP_LAUNCHER: '1', GSM_DEV_SERVER_URL: 'http://127.0.0.1:5173' };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ executablePath: require('electron'), cwd: root, env,
    args: [path.join(root, 'scripts/fixtures/agy-electron-e2e.cjs'), '--hidden', `--user-data-dir=${path.join(temp, 'profile')}`] });
  const report = { startedAt: new Date().toISOString(), tasks: [], syntheticOnly: true };
  const only = process.argv.find(arg => arg.startsWith('--only='))?.slice(7);
  const effort = process.argv.find(arg => arg.startsWith('--effort='))?.slice(9) || 'high';
  const selection = only?.length > 100 ? 'text-workflows' : only?.replace(/[^a-z0-9,-]/gi, '_');
  const reportPath = path.join(root, only ? `output/agy-business-retest-${selection}.json` : 'output/agy-business-report.json');
  try {
    assert.equal(await app.evaluate(({ app }) => app.getPath('userData')), path.join(temp, 'profile'));
    const page = await app.firstWindow();
    await page.waitForURL('http://127.0.0.1:5173/');
    await page.waitForFunction(async () => (await import(performance.getEntriesByType('resource').find(entry => new URL(entry.name).pathname === '/src/store/useAppStore.ts')?.name ?? '/src/store/useAppStore.ts')).useAppStore.persist.hasHydrated());
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
    await page.locator('#agy-model').waitFor();
    await page.waitForFunction(async () => {
      const state = await window.electronAPI.agy.getState();
      return !!state.executable && !state.busy;
    });
    const panel = page.locator('section[aria-labelledby="agy-heading"]');
    await panel.locator('summary').click();
    await page.locator('#agy-effort').selectOption(effort);
    await page.locator('#agy-mode').selectOption('research');
    await panel.getByRole('button', { name: '保存并测试' }).click();
    await panel.getByText(/中文结构化回答测试通过/).waitFor({ timeout: 260000 });
    await panel.getByRole('button', { name: '启用并设为当前' }).click();
    await panel.getByRole('button', { name: '当前 AI', exact: true }).waitFor();
    await page.evaluate(async ({ effort }) => {
      const api = window.electronAPI.agy;
      const detected = await api.getState();
      if (!detected.enabled || detected.lastProbe?.code !== 'SUCCESS') throw new Error('Connection failed');
      const { useAppStore } = await import(performance.getEntriesByType('resource').find(entry => new URL(entry.name).pathname === '/src/store/useAppStore.ts')?.name ?? '/src/store/useAppStore.ts');
      useAppStore.setState({ isAuthenticated: true, githubToken: 'synthetic-ui-fixture', user: { id: 777, login: 'synthetic', avatar_url: '' },
        activeAIConfig: 'agy-cli-local', currentView: 'ai', language: 'zh', syncModeConfigured: true,
        repositoryChatSettings: { ...useAppStore.getState().repositoryChatSettings, agentBudget: {
          ...useAppStore.getState().repositoryChatSettings.agentBudget, maxDurationMs: 300000 } } });
      await (await import(performance.getEntriesByType('resource').find(entry => new URL(entry.name).pathname === '/src/services/agyClient.ts')?.name ?? '/src/services/agyClient.ts')).refreshAgyDeviceState();
      if (!useAppStore.getState().aiConfigs.some(c => c.id === 'agy-cli-local')) throw new Error('Evaluation setup did not retain CLI configuration');
    }, { effort });
    await app.evaluate(({ dialog }, directory) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] }); }, projectPath);
    const names = ['summary-zh', 'summary-en', 'summary-platforms', 'category', 'custom-category', 'gist-purpose',
      'gist-limits', 'release-changes', 'release-negation', 'rerank-repository', 'rerank-gist', 'query-expansion',
      'query-constraints', 'requirements-zh', 'requirements-en', 'article-format', 'structured-constraints',
      'missing-evidence', 'local-research', 'multi-repository', 'ux-content-30'];
    for (let index = 0; index < names.length; index++) {
      if (only && !only.split(',').includes(names[index])) continue;
      const started = Date.now();
      let result;
      try {
        result = await page.evaluate(async ({ index, uxTasks }) => {
          const loaded = module => performance.getEntriesByType('resource').find(entry => new URL(entry.name).pathname === module)?.name ?? module;
          const { useAppStore } = await import(performance.getEntriesByType('resource').find(entry => new URL(entry.name).pathname === '/src/store/useAppStore.ts')?.name ?? '/src/store/useAppStore.ts');
          const { AIService } = await import(loaded('/src/services/aiService.ts'));
          const config = useAppStore.getState().aiConfigs.find(c => c.id === 'agy-cli-local');
          const ai = new AIService(config, index === 1 || index === 14 ? 'en' : 'zh');
          const repo = (id, name, description) => ({ id, name, full_name: `synthetic/${name}`, description,
            html_url: `https://github.com/synthetic/${name}`, language: 'TypeScript', topics: ['markdown', 'notes'],
            owner: { login: 'synthetic', avatar_url: '' }, forks: 0, forks_count: 0, stargazers_count: 1,
            default_branch: 'main', created_at: '2026-09-01', updated_at: '2026-09-28', pushed_at: '2026-09-28' });
          const notes = repo(101, 'SyntheticNotes', 'Local Markdown note editor. Windows and Linux; full-text search; no cloud sync or mobile apps.');
          const calc = repo(102, 'SyntheticCalc', 'A terminal-only arithmetic calculator. No note editing.');
          const readme = '# SyntheticNotes\n\n## Features\nA local Markdown note editor for Windows and Linux. Full-text search is included. Cloud sync and mobile apps are not supported.\n\n## Installation\nRun npm install then npm start.\n';
          const gist = { id: 'synthetic-gist', description: 'Pure add function', public: true, html_url: 'https://gist.github.com/synthetic',
            created_at: '2026-09-28', updated_at: '2026-09-28', comments: 0, owner: null,
            files: { 'add.py': { filename: 'add.py', type: 'text/plain', language: 'Python', size: 30 } } };
          let value, passed = false, criterion = '';
          if (index === 20) {
            const { USER_REQUIREMENTS_FIRST } = await import(loaded('/src/services/answerRequirements.ts'));
            const raw = await ai.generateChatText({
              system: `${USER_REQUIREMENTS_FIRST}\nAnswer each independent task using only its own evidence. Return ONLY JSON {"answers":[{"id":"T01","answer":"actual answer in requested format","facts":{},"quotes":["exact evidence excerpt"],"missing":[]}]}.
Facts must contain exactly the fields named in each question, with booleans for yes/no, arrays for platforms, and "unknown" only for absent evidence. Quotes must be exact evidence substrings supporting conclusions; never invent supporting text. Missing is an array of unresolved facts keys only. JSON/steps/paragraph requirements govern answer, not the outer transport JSON. Do not just outline the requested work.`,
              user: JSON.stringify(uxTasks), maxTokens: 16000,
            });
            value = JSON.parse(raw);
            criterion = '30 independent synthetic content tasks in one batched real model request; not 30 independent workflow E2E runs.';
            passed = Array.isArray(value.answers) && value.answers.length === 30;
          } else if (index <= 4) {
            value = await ai.analyzeRepository(notes, readme, index === 4 ? ['笔记工具', '数学工具'] : undefined);
            criterion = 'Valid structured analysis, note/Markdown purpose, no invented cloud/mobile support';
            passed = !!value.summary && /笔记|note|Markdown/i.test(value.summary)
              && !/支持云同步|支持手机|supports cloud sync/i.test(value.summary) && Array.isArray(value.tags);
            if (index === 2) passed &&= value.platforms.includes('windows') && value.platforms.includes('linux') && !value.platforms.includes('android');
          } else if (index <= 6) {
            value = await ai.analyzeGist(gist, 'def add(a, b):\n    return a + b\n# No file or network access.');
            criterion = 'Describes addition, no network/file side effects invented';
            passed = /加|sum|add/i.test(value) && !/发送请求|写入文件/.test(value);
          } else if (index <= 8) {
            value = await ai.analyzeReleaseSummary('v2.0: Added full-text search. Fixed a Windows startup crash. Cloud sync remains unsupported. No mobile app.', { repoName: notes.full_name, tagName: 'v2.0' });
            criterion = 'Includes search and Windows startup fix; preserves cloud negation';
            passed = /搜索/.test(value) && /Windows/i.test(value) && /修复|解决/.test(value) && !/新增云同步|支持云同步功能/.test(value);
          } else if (index === 9) {
            value = await ai.searchRepositoriesWithSemanticReranking([calc, notes], '本地 Markdown 笔记编辑器');
            criterion = 'Ranks note editor first using known IDs';
            passed = value[0]?.id === 101 && value.every(item => [101, 102].includes(item.id));
          } else if (index === 10) {
            value = await ai.searchGistsWithReranking([gist, { ...gist, id: 'other', description: 'CSS color theme', files: {} }], 'Python 两数相加函数');
            criterion = 'Ranks addition gist first';
            passed = value[0]?.id === gist.id;
          } else if (index <= 12) {
            value = await ai.generateHyDEQuery(index === 11 ? '本地 Markdown 笔记全文搜索' : 'Windows 离线笔记，无需云服务');
            criterion = 'Nonempty relevant query expansion, not unrelated answer';
            passed = /note|markdown|笔记|offline|离线/i.test(value) && value.length < 5000;
          } else if (index <= 14) {
            useAppStore.setState({ language: index === 14 ? 'en' : 'zh' });
            value = await (await import(loaded('/src/services/aiWorkbenchService.ts'))).prepareWorkbenchRequirements({
              question: index === 14 ? 'Find a Windows offline Markdown note editor with full-text search, excluding cloud-only services.' : '找 Windows 离线 Markdown 笔记软件，必须有全文搜索，排除仅云端服务。',
            });
            criterion = 'Preserves Windows, offline/search constraints and exclusion';
            passed = /Windows/i.test(JSON.stringify(value)) && /offline|离线/i.test(JSON.stringify(value))
              && value.queries.length > 0 && value.excluded.length > 0;
            useAppStore.setState({ language: 'zh' });
          } else if (index <= 17) {
            const user = index === 15 ? '基于资料写一段100至200字中文介绍。标题为“本地笔记”，说明适合谁、支持平台和限制，不要只列提纲。'
              : index === 16 ? '只返回JSON：{"platforms":["Windows","Linux"],"cloudSync":false,"mobile":false}，不得增加字段。'
                : '资料有没有证明移动端可用？用中文回答，不能猜测。资料：项目只有一个名字 UnknownNotes，其他信息未知。';
            value = await ai.generateChatText({ system: 'Follow the exact user request. Use only supplied facts; say unknown for missing evidence.',
              user: index === 17 ? user : `${user}\n资料：${readme}` });
            criterion = index === 15 ? 'Requested title, prose length and limitations' : index === 16 ? 'Exact JSON with negation' : 'Correctly admits missing evidence';
            if (index === 15) passed = value.includes('本地笔记') && value.length >= 100 && value.length <= 500 && /Windows/.test(value);
            else if (index === 16) { const parsed = JSON.parse(value); passed = parsed.cloudSync === false && parsed.mobile === false && parsed.platforms.join(',') === 'Windows,Linux' && Object.keys(parsed).length === 3; }
            else passed = /未知|无法|不能|没有|未提供|不足/.test(value) && !/支持移动端。/.test(value);
          } else if (index === 18) {
            const selected = await window.electronAPI.agy.chooseProject(crypto.randomUUID());
            if (!selected.ok) throw new Error(selected.code);
            value = await (await import(loaded('/src/services/localResearch.ts'))).researchLocalProject(selected.value,
              '请用中文说明用途、支持平台、全文搜索、云同步和移动端支持情况，给出安装命令。', config, 'zh', new AbortController().signal);
            await window.electronAPI.agy.revokeProject(selected.value.id);
            criterion = 'Real local read pipeline, source hashes, complete requirements and grounded review';
            passed = value.quality === 'model-reviewed' && value.evidences.some(e => e.source === 'local' && e.contentHash.length === 64)
              && /Windows/.test(value.content) && /Linux/.test(value.content) && /npm install/.test(value.content)
              && /云/.test(value.content) && /移动/.test(value.content);
          } else {
            const { GitHubApiService } = await import(loaded('/src/services/githubApi.ts'));
            const proto = GitHubApiService.prototype;
            proto.getCurrentUser = async () => ({ id: 424242, login: 'synthetic', avatar_url: '', name: 'Synthetic' });
            proto.getRepositoryHeadSha = async () => 'abcdef1234567890';
            proto.getRepositoryTree = async () => ({ entries: [{ path: 'README.md', type: 'blob' }], truncated: false });
            proto.getRepositoryFile = async (_owner, name) => ({ path: 'README.md', content: name === 'SyntheticNotes' ? readme : '# SyntheticCalc\nTerminal-only arithmetic calculator. No note editing.', ref: 'abcdef1234567890', size: 300 });
            proto.getRepositoryMarkdownEvidenceFile = proto.getRepositoryFile;
            const modelConfig = { ...config, agyMode: 'model' };
            useAppStore.setState({ aiConfigs: [modelConfig] });
            value = await (await import(loaded('/src/services/aiWorkbenchService.ts'))).answerWorkbench({ question: '比较两者的用途，哪个适合本地Markdown笔记？请给明确建议与理由。',
              repositories: [notes, calc], depth: 'standard', messages: [], session: { id: 'eval-multi', kind: 'workbench',
                repoId: 101, repoFullName: notes.full_name, sourceRefSha: '', title: 'Synthetic', createdAt: '2026-09-28', updatedAt: '2026-09-28' } });
            criterion = 'Both repositories researched, correct recommendation and evidence';
            passed = value.quality === 'model-reviewed' && value.claims?.length > 0 && value.comparison?.length > 0
              && value.evidences.some(e => e.repoFullName === notes.full_name) && value.evidences.some(e => e.repoFullName === calc.full_name)
              && /SyntheticNotes/.test(value.content) && /SyntheticCalc/.test(value.content) && /笔记/.test(value.content);
          }
          return { passed, criterion, value };
        }, { index, uxTasks: ux.tasks.map(({ expected, ...input }) => input) });
        if (index === 20) {
          result.scores = ux.score(result.value?.answers);
          result.passedCount = result.scores.filter(item => item.passed).length;
          result.passed = result.passed && result.passedCount >= 27;
          result.scope = 'Batched model content checks, with offline workflow tests reported separately. Exact quotes are not independent semantic proof.';
        }
      } catch (error) { result = { passed: false, error: error.message }; }
      report.tasks.push({ name: names[index], durationMs: Date.now() - started, ...result });
      await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
      console.log(JSON.stringify({ name: names[index], passed: result.passed, durationMs: Date.now() - started, error: result.error }));
      if (result.error?.includes('EVALUATION_BUDGET')) break;
    }
    report.completedAt = new Date().toISOString();
    report.passed = report.tasks.filter(task => task.passed).length;
    report.verified = only ? report.tasks.length === only.split(',').length && report.passed === report.tasks.length
      : report.tasks.length >= 20 && report.passed >= 18;
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
    if (!report.verified) process.exitCode = 1;
  } finally {
    await app.close();
    await fs.rm(temp, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
