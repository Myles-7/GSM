// Uses only generated synthetic HTML and temporary profiles. Never loads GSM main.js.
const { app, BrowserWindow, Menu, session } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { createReadingPreview } = require('../../electron/htmlReadingPreview');
const workspace = path.resolve(__dirname, '../..');
const output = path.join(workspace, 'output/html-reading-loop-20261004');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'gsm-native-reading-test-'));
app.setPath('userData', path.join(temporary, 'profile'));
app.on('window-all-closed', () => {});
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
let window;
let previewMenu;
function hiddenWindow(options) {
  window = new BrowserWindow(options);
  window.show = () => {};
  const setMenu = window.setMenu.bind(window);
  window.setMenu = value => { previewMenu = value; setMenu(value); };
  return window;
}
const run = script => window.webContents.executeJavaScript(script);
async function click(selector) {
  await run(`document.querySelector(${JSON.stringify(selector)}).click()`);
  await wait(180);
}
app.whenReady().then(async () => {
  try {
    const html = fs.readFileSync(path.join(output, 'GSM-每日阅读闭环示例.html'), 'utf8');
    const preview = createReadingPreview({ BrowserWindow: hiddenWindow, Menu, session, shell: { openExternal: async () => { throw Error('No external navigation in fixture'); } }, fs, path, tempDirectory: temporary });
    await preview(html);
    const firstSession = window.webContents.session;
    assert.equal(await run('typeof window.electronAPI'), 'undefined');
    assert.equal(await run('typeof window.require'), 'undefined');
    assert.equal(window.isVisible(), false);
    const layouts = [];
    for (const width of [360, 390, 430, 768, 1024]) {
      window.setContentSize(width, 780);
      for (let attempt = 0; attempt < 20 && await run('innerWidth') !== width; attempt++) await wait(100);
      const layout = await run('({width:innerWidth,scroll:document.documentElement.scrollWidth})');
      assert.equal(layout.width, width);
      assert.ok(layout.scroll <= width + 1);
      layouts.push(layout);
    }
    window.setContentSize(390, 780);
    await click('[data-open]');
    assert.equal(await run("document.querySelector('#detail-page').hidden"), false);
    await click('#detail-options-open');
    assert.ok(await run("document.querySelectorAll('#detail-outline button').length"));
    await click('#detail-outline button');
    assert.equal(await run("document.querySelector('#detail-options').open"), false);
    await run("(()=>{const n=document.querySelector('textarea[data-field=note]');n.value='native fixture note';n.dispatchEvent(new Event('input',{bubbles:true}));n.dispatchEvent(new Event('focusout',{bubbles:true}));})()");
    await wait(220);
    assert.ok(await run("document.querySelector('#note-save-status').textContent.includes('已保存')"));
    await click('#detail-back');
    assert.equal(await run("document.querySelector('#detail-page').hidden"), true);
    await click('#export');
    assert.ok(await run("JSON.parse(document.querySelector('#return-text').value).operations.some(op=>op.field==='note')"));
    await click('#copy');
    assert.ok(await run("document.querySelector('#return-text').value.includes('native fixture note')"));
    await click('#close-export');
    previewMenu.items[1].submenu.items[1].click();
    await wait(150);
    assert.equal(await run('document.body.dataset.mode'), 'dark');
    fs.writeFileSync(path.join(output, 'Electron-独立预览-390-dark.png'), (await window.webContents.capturePage()).toPNG());
    assert.equal(await run("fetch('https://example.invalid').then(()=>false,()=>true)"), true);
    window.destroy();
    await wait(100);
    await preview(html);
    assert.notEqual(window.webContents.session, firstSession);
    assert.equal(await run("Object.keys(localStorage).some(key=>key.startsWith('gsm-reading:'))"), true);
    assert.equal(await run("Object.values(localStorage).some(value=>value.includes('native fixture note'))"), false);
    window.destroy();
    fs.writeFileSync(path.join(output, 'native-preview-report.json'), JSON.stringify({ passed: true, layouts, ipcAbsent: true, newSessionIsolated: true, detailOutlineNoteBack: true, networkDenied: true, realGmailVerified: false, realAndroidVerified: false }, null, 2));
    process.stdout.write('Native isolated preview passed.\n');
    app.exit(0);
  } catch (error) {
    process.stderr.write(String(error.stack || error) + '\n');
    if (window && !window.isDestroyed()) window.destroy();
    app.exit(1);
  } finally {
    try { fs.rmSync(temporary, { recursive: true, force: true }); } catch { /* Chromium may hold profile files until exit. */ }
  }
});
