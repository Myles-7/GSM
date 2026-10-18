const { app, BrowserWindow, ipcMain, protocol, nativeImage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const { createPluginManager } = require('../../electron/plugins/pluginManager');
const { createPluginIpcRegistrar } = require('../../electron/plugins/pluginIpc');
const { PAGE_SCHEME, pageCsp } = require('../../electron/plugins/pluginPage');
const root = path.resolve(__dirname, '../..');
const output = path.join(root, 'output/v086-continuation/official-plugin-smoke');
fs.mkdirSync(output, { recursive: true });
app.setPath('userData', path.join(output, 'profile'));
protocol.registerSchemesAsPrivileged([{ scheme: PAGE_SCHEME, privileges: { standard: true, secure: true } }]);
const watchdog = setTimeout(() => { console.error('Official plugin smoke timeout'); app.exit(1); }, 45_000);
app.whenReady().then(async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'gsm-official-smoke-'));
  const outputs = [];
  const manager = createPluginManager({ pluginsRoot: path.join(workspace, 'plugins'), statePath: path.join(workspace, 'state.json'),
    dataRoot: path.join(workspace, 'data'), logsRoot: path.join(workspace, 'logs'), hostOperations: {
      clipboardWrite: ({ text, isCurrent }) => { assert.ok(isCurrent()); assert.match(text, /card/); outputs.push('html'); return null; },
      clipboardWriteImage: ({ buffer, isCurrent }) => { assert.ok(isCurrent()); const size = nativeImage.createFromBuffer(buffer).getSize(); assert.ok(size.width > 0); outputs.push('png-copy'); return null; },
      saveFile: ({ fileName, buffer, isCurrent }) => { assert.ok(isCurrent()); const size = nativeImage.createFromBuffer(buffer).getSize(); assert.ok(size.width > 0); fs.writeFileSync(path.join(output, fileName), buffer); outputs.push('png-save'); return { fileName }; },
    } });
  let window;
  try {
    for (const directory of ['repo-info-card', 'repo-insights']) {
      const source = path.join(root, 'examples/plugins', directory);
      const manifest = JSON.parse(fs.readFileSync(path.join(source, 'manifest.json')));
      assert.equal(manager.installFromDirectory(source).success, true);
      assert.equal((await manager.enable(manifest.id, manifest.permissions)).success, true);
    }
    protocol.handle(PAGE_SCHEME, request => {
      const resource = manager.readPageResource(request.url);
      return resource ? new Response(resource.body, { headers: { 'Content-Type': resource.mimeType,
        'Content-Security-Policy': pageCsp(new URL(request.url).hostname), 'Access-Control-Allow-Origin': 'null' } }) : new Response('', { status: 404 });
    });
    const host = path.join(workspace, 'host.html');
    fs.writeFileSync(host, '<!doctype html><title>Official plugin smoke</title>');
    window = new BrowserWindow({ show: false, width: 1400, height: 950, webPreferences: { preload: path.join(root, 'electron/preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false } });
    const errors = [];
    window.webContents.on('console-message', event => { if (event.level === 'error') errors.push(event.message); });
    const registrar = createPluginIpcRegistrar({ ipcMain, getWindow: () => window, getHostURL: () => pathToFileURL(host).href });
    registrar('plugins:getPage', (_event, id, page) => manager.getPage(id, page));
    registrar('plugins:requestPageCapability', (_event, request) => manager.requestPageCapability(request));
    await window.loadFile(host);
    await window.webContents.executeJavaScript(`
      globalThis.smoke = { ai: 0, network: 0, frames: new Map(), errors: [] };
      const repo = { id: 1, full_name: 'owner/project', name: 'project', html_url: 'https://github.com/owner/project',
        owner: { login: 'owner' }, stargazers_count: 42, forks_count: 3, open_issues_count: 2,
        description: 'Fixture repository', created_at: '2025-01-01T00:00:00Z', pushed_at: '2026-10-16T00:00:00Z', private: false };
      function bodyFor(path) {
        if (path.endsWith('/stats/commit_activity')) return Array.from({ length: 52 }, (_, i) => ({ week: 1700000000 + i * 604800, total: i, days: [1,2,3,4,5,6,7] }));
        if (path.endsWith('/stats/code_frequency')) return [[1700000000,100,-10],[1700604800,150,-20]];
        if (path.endsWith('/languages')) return { TypeScript: 10000, JavaScript: 4000 };
        if (path.endsWith('/contributors')) return [{login:'owner', contributions:80, html_url:'https://github.com/owner'}, {login:'other',contributions:20}];
        if (path.endsWith('/releases')) return [{ name:'v1',tag_name:'v1.0.0',published_at:'2026-10-01T00:00:00Z', html_url:'https://github.com/owner/project/releases/tag/v1',body:'Fixture release'}];
        if (path.endsWith('/security-advisories') || path.endsWith('/pulls') || path.endsWith('/stargazers/history')) return [];
        if (path.endsWith('/community/profile')) return {health_percentage:90,files:{readme:{url:'https://github.com/owner/project'},license:{name:'MIT'}}};
        if (path.startsWith('/users/')) return {login:'owner',name:'Owner',followers:12};
        return repo;
      }
      window.addEventListener('message', async event => {
        const request = event.data;
        const frame = smoke.frames.get(request?.pluginId);
        if (!frame || event.source !== frame.iframe.contentWindow || request.type !== 'plugin-page:request' || request.token !== frame.token) return;
        const envelope = {pluginId:request.pluginId,pageId:request.pageId,sessionToken:frame.token,requestId:request.requestId,method:request.method,args:request.args};
        try {
          let result = await electronAPI.plugins.requestPageCapability(envelope);
          if (result.success && request.method === 'ai.generate') { smoke.ai++; result.value = '<div id="card"><h1>Fixture card</h1><p>42 stars</p></div>'; }
          if (result.success && request.method === 'network.request') {
            smoke.network++;
            const checked = await electronAPI.plugins.requestPageCapability({...envelope,networkTicket:result.value.networkTicket});
            result = checked.success ? {success:true,value:{status:200,body:bodyFor(request.args.path),acct:'fixture-account'}} : checked;
          }
          event.source.postMessage({type:'plugin-page:response',pluginId:request.pluginId,pageId:request.pageId,requestId:request.requestId,token:frame.token,...result}, event.origin);
        } catch(error) { smoke.errors.push(String(error)); }
      });
      globalThis.openPlugin = async (id, pageId) => {
        for (const item of smoke.frames.values()) item.iframe.remove(); smoke.frames.clear();
        const page = await electronAPI.plugins.getPage(id,pageId);
        if (!page.success) throw Error('page unavailable');
        const iframe = document.createElement('iframe'); iframe.style.cssText='width:1350px;height:880px;border:0';
        iframe.sandbox='allow-scripts allow-same-origin';
        smoke.frames.set(id,{iframe,token:page.sessionToken});
        const ready = new Promise(resolve => iframe.onload=() => { iframe.contentWindow.postMessage({type:'plugin-page:init',pluginId:id,pageId,token:page.sessionToken,context:{repository:repo,readme:'# Fixture README',language:'en',theme:'dark',accountTag:'fixture-account'}}, 'plugin-page://'+id); resolve(); });
        iframe.src=page.url;document.body.append(iframe);await ready;
      }; void 0;
    `);
    await window.webContents.executeJavaScript("openPlugin('com.githubstarsmanager.repo-info-card','info-card')");
    const cardFrame = window.webContents.mainFrame.frames.find(frame => frame.url.includes('repo-info-card'));
    assert.ok(cardFrame);
    const card = await cardFrame.executeJavaScript(`(async () => {
      await new Promise((resolve, reject) => {
        const deadline = performance.now() + 3000;
        const timer = setInterval(() => {
          if (state.repository) { clearInterval(timer); resolve(); }
          else if (performance.now() > deadline) { clearInterval(timer); reject(Error('Plugin init was not received')); }
        }, 10);
      });
      await generate();
      if (!state.fragment) throw Error('Generation failed: '+document.getElementById('status').textContent);
      selectPreviewTab('code');codeEditor.value=codeEditor.value.replace('Fixture card','Edited fixture');selectPreviewTab('preview');
      await copyCode();await copyImage();await saveImage();
      const before=state.fragment;selectCanvas('5x2');
      const mismatch=copyImageButton.disabled && saveImageButton.disabled;
      return {generated:!!state.fragment,edited:state.fragment.includes('Edited fixture'),mismatch,unchanged:before===state.fragment, languages:CARD_LANGUAGES.length};
    })()`);
    assert.equal(card.generated, true); assert.equal(card.edited, true); assert.equal(card.mismatch, true); assert.equal(card.unchanged, true);
    assert.equal(card.languages, 10);
    assert.deepEqual(outputs, ['html', 'png-copy', 'png-save']);
    fs.writeFileSync(path.join(output, 'info-card.png'), (await window.webContents.capturePage()).toPNG());
    await window.webContents.executeJavaScript("openPlugin('com.githubstarsmanager.repo-insights','insights')");
    const insights = window.webContents.mainFrame.frames.find(frame => frame.url.includes('repo-insights'));
    assert.ok(insights);
    const chartResult = await insights.executeJavaScript(`new Promise(resolve => {
      let attempts=0; const timer=setInterval(() => {
        const count=Object.keys(Chart.instances).length;
        if (count>=3 || ++attempts>100) { clearInterval(timer);resolve({count,body:document.body.textContent}); }
      },30);
    })`);
    assert.ok(chartResult.count >= 3);
    window.minimize(); window.restore();
    for (let i = 0; i < 8; i++) window.setSize(i % 2 ? 1400 : 900, i % 2 ? 950 : 650);
    const charts = await insights.executeJavaScript(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(Object.keys(Chart.instances).length))))`);
    assert.ok(charts >= 3);
    fs.writeFileSync(path.join(output, 'insights.png'), (await window.webContents.capturePage()).toPNG());
    const bridge = await window.webContents.executeJavaScript('({ai:smoke.ai,network:smoke.network,errors:smoke.errors})');
    assert.ok(bridge.ai >= 1); assert.ok(bridge.network >= 8); assert.deepEqual(bridge.errors, []);
    assert.equal(errors.some(message => /ownerDocument|TypeError|ReferenceError/.test(message)), false, errors.join('\n'));
    const evidence = { electron: process.versions.electron, card, outputs, charts, bridge: { ai: bridge.ai, network: bridge.network }, errors };
    fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify(evidence, null, 2));
    console.log(JSON.stringify(evidence)); clearTimeout(watchdog); manager.shutdown(); window.destroy(); app.exit(0);
  } catch (error) { console.error(error); clearTimeout(watchdog); manager.shutdown(); window?.destroy(); app.exit(1); }
});
