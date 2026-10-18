const { spawn, execFileSync } = require('node:child_process');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'output/local-agent-organization');
const runtime = process.env.GSM_PLAYWRIGHT_MODULE;
const captureScreenshots = process.env.GSM_CAPTURE_SCREENSHOTS !== '0';
if (!runtime) throw new Error('Set GSM_PLAYWRIGHT_MODULE to the bundled playwright module.');
const { chromium } = require(runtime);
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
fs.mkdirSync(output, { recursive: true });
const child = spawn(path.join(root, 'node_modules/electron/dist/electron.exe'), [path.join(__dirname, 'fixtures/local-agent-electron.cjs')], { cwd: root, env, windowsHide: true, stdio: 'ignore' });
let browser;
let activePage;
let stage = 'launch';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function run() {
  for (let n = 0; n < 100; n++) {
    try { browser = await chromium.connectOverCDP('http://127.0.0.1:9317'); break; } catch { await sleep(250); }
  }
  assert.ok(browser, 'Isolated Electron did not start');
  stage = 'seed';
  const page = browser.contexts()[0].pages().find(page => page.url().startsWith('http://127.0.0.1:5207'));
  assert.ok(page, 'Native shell did not load the isolated development entry');
  activePage = page;
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.waitForFunction(() => !!document.querySelector('#root')?.firstElementChild);
  await page.waitForFunction(async () => (await import('/src/store/useAppStore.ts')).useAppStore.persist.hasHydrated());
  await page.waitForFunction(() => performance.getEntriesByName('gsm:backend-initialize-finished').length > 0);
  await page.evaluate(async () => {
    const { useAppStore } = await import('/src/store/useAppStore.ts');
    const date = '2026-10-07T00:00:00.000Z';
    const repositories = Array.from({ length: 10 }, (_, n) => ({ id: n + 1, name: `numerical-project-with-a-long-name-${n + 1}`,
      full_name: `fixture/numerical-project-with-a-long-name-${n + 1}`, description: 'Scientific computing and data processing',
      html_url: `https://github.com/fixture/project-${n + 1}`, owner: { login: 'fixture', avatar_url: '' }, language: 'Python', topics: ['science'],
      stargazers_count: 10, forks: 0, forks_count: 0, created_at: date, updated_at: date, pushed_at: date, category_id: null, subcategory_id: null }));
    useAppStore.setState({ user: { id: 42, login: 'fixture', name: 'Offline Fixture', avatar_url: '', html_url: 'https://github.com/fixture' },
      githubToken: 'synthetic-no-credential', isAuthenticated: true, repositories, searchResults: repositories,
      accountWorkspaces: {}, language: 'zh', currentView: 'repositories', selectedCategory: 'all', syncModeConfigured: true,
      aiConfigs: [], activeAIConfig: null, mcpConfig: { enabled: true, host: '127.0.0.1', port: 43287, token: 'synthetic-local-agent-token' } });
    const { backend } = await import('/src/services/backendAdapter.ts');
    Object.defineProperty(backend, 'isAvailable', { configurable: true, get: () => true });
    backend.getMcpStatus = async () => ({ enabled: true, token: 'synthetic-backend-token', vectorAvailable: false, endpoints: { streamableHttp: '/mcp', sse: '/mcp/sse', messages: '/mcp/sse/messages' } });
    const { refreshMcpElectronBridge } = await import('/src/services/mcpElectronBridge.ts'); refreshMcpElectronBridge();
  });
  await page.waitForFunction(async () => {
    const status = await window.electronAPI.mcp.getStatus();
    return status.running && status.url === 'http://127.0.0.1:43287/mcp';
  });
  await sleep(700);
  stage = 'connect-mcp';
  const { Client } = await import(pathToFileURL(path.join(root, 'server/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js')).href);
  const { StreamableHTTPClientTransport } = await import(pathToFileURL(path.join(root, 'server/node_modules/@modelcontextprotocol/sdk/dist/esm/client/streamableHttp.js')).href);
  const client = new Client({ name: 'gsm-isolated-agent-smoke', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL('http://127.0.0.1:43287/mcp'), { requestInit: { headers: { Authorization: 'Bearer synthetic-local-agent-token' } } }));
  const tools = (await client.listTools()).tools.map(tool => tool.name); assert.ok(tools.includes('gsm_organization_edit'));
  stage = 'draft-tools';
  const call = async (name, args = {}) => {
    const response = await client.callTool({ name, arguments: args }); const data = JSON.parse(response.content[0].text);
    assert.ok(!response.isError, JSON.stringify(data)); return data;
  };
  const overview = await call('gsm_organization_overview'); assert.equal(overview.ownerId, '42'); assert.equal(overview.repositoryCount, 10);
  const task = await call('gsm_organization_start', { ownerId: '42', requestId: 'smoke-start', redesign: true });
  const evidence = await call('gsm_organization_evidence', { ownerId: '42', repositoryId: 1 }); assert.equal(evidence.untrustedContent, true);
  const assignments = ['purpose', 'technology'].flatMap(schemeId => Array.from({ length: 10 }, (_, n) => ({ schemeId, repositoryId: n + 1, categoryId: 'main', subcategoryId: 'child', disposition: 'move', reason: 'Synthetic test: numerical computing library' })));
  const edit = { ownerId: '42', taskId: task.taskId, expectedRevision: task.expectedRevision, requestId: 'smoke-edit',
    categories: ['purpose', 'technology'].flatMap(schemeId => [{ schemeId, kind: 'create', ref: 'main', name: schemeId === 'purpose' ? '科学计算与研究工具' : '科学计算技术与数值库' },
      { schemeId, kind: 'create', ref: 'child', parentId: 'main', name: '数值计算与数据处理' }]), assignments, progress: '10 个虚构仓库的两套归属已提交，等待人工确认' };
  const edited = await call('gsm_organization_edit', edit); assert.equal(edited.coverage.purpose.valid, 10); assert.equal(edited.coverage.technology.valid, 10);
  const repeated = await call('gsm_organization_edit', edit); assert.equal(repeated.replayed, true);
  const review = await call('gsm_organization_review', { ownerId: '42', taskId: task.taskId }); assert.equal(review.coverage.purpose.missing.length, 0);
  await call('gsm_organization_open_preview', { ownerId: '42', taskId: task.taskId });
  stage = 'preview';
  await page.getByRole('dialog').waitFor(); await page.getByText('本地 Agent 整理', { exact: true }).first().waitFor();
  await page.setViewportSize({ width: 1360, height: 900 }); await sleep(300); if (captureScreenshots) await page.screenshot({ path: path.join(output, 'desktop-preview.png') });
  await page.setViewportSize({ width: 390, height: 844 }); await sleep(300); if (captureScreenshots) await page.screenshot({ path: path.join(output, 'narrow-preview.png') });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Narrow page overflows');
  await page.setViewportSize({ width: 1360, height: 900 });
  await page.getByRole('button', { name: '检查并应用', exact: true }).click(); await sleep(150); if (captureScreenshots) await page.screenshot({ path: path.join(output, 'confirmation.png') });
  await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  await page.evaluate(async () => { const { useAppStore } = await import('/src/store/useAppStore.ts'); useAppStore.getState().setCurrentView('settings'); });
  await page.getByRole('tab', { name: /MCP/ }).click(); await page.getByText('桌面整理连接', { exact: true }).waitFor();
  if (captureScreenshots) await page.screenshot({ path: path.join(output, 'desktop-settings.png') });
  await page.setViewportSize({ width: 390, height: 844 }); await sleep(150); if (captureScreenshots) await page.screenshot({ path: path.join(output, 'narrow-settings.png') });
  const integrity = await page.evaluate(async () => {
    const { useAppStore } = await import('/src/store/useAppStore.ts'); const state = useAppStore.getState();
    return { categoryCount: state.customCategories.length, classified: state.repositories.filter(repo => repo.category_id).length, localTokenUnchanged: state.mcpConfig.token === 'synthetic-local-agent-token' };
  });
  assert.deepEqual(integrity, { categoryCount: 0, classified: 0, localTokenUnchanged: true }); assert.equal(errors.length, 0, errors.join('\n'));
  let codexConfigurationVerified = false;
  try {
    const command = process.env.APPDATA + '/npm/node_modules/@openai/codex/bin/codex.js';
    const config = execFileSync(process.execPath, [command, '-c', 'mcp_servers.gsm-local.url="http://127.0.0.1:43287/mcp"', '-c', 'mcp_servers.gsm-local.http_headers={Authorization="Bearer synthetic-local-agent-token"}', 'mcp', 'get', 'gsm-local', '--json'], { env: { ...env, CODEX_HOME: fs.mkdtempSync(path.join(os.tmpdir(), 'gsm-codex-config-')) }, windowsHide: true, encoding: 'utf8', timeout: 15000 });
    codexConfigurationVerified = JSON.parse(config).name === 'gsm-local';
  } catch { /* No CLI conversation or client configuration mutation is performed. */ }
  await client.close();
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify({ passed: true, tools, integrity, syntheticRepositories: 10, backendConnectedSimulation: true, sdkHandshake: true,
    codexConfigurationVerified, screenshotsCaptured: captureScreenshots, codexDesktopConversationVerified: false, realModelVerified: false, errors }, null, 2));
  console.log('Native Electron MCP -> draft -> preview passed; 10 synthetic repositories; no classification applied.');
}
run().catch(async error => {
  console.error(stage, error.stack, error.cause);
  if (activePage && !activePage.isClosed()) console.error('MCP lifecycle diagnostic', await activePage.evaluate(async () => ({ status: await window.electronAPI.mcp.getStatus(), config: { ...(await window.electronAPI.mcp.getConfig()), token: '[redacted]' } })).catch(() => 'Renderer unavailable'));
  process.exitCode = 1;
}).finally(async () => {
  await browser?.close().catch(() => {});
  if (child.exitCode === null) child.kill();
});
