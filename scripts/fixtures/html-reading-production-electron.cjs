// Smoke-test an actual production entry using a fresh, empty profile and no network.
const { app, BrowserWindow, session } = require('electron');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../..');
const output = path.join(root, 'output/html-reading-loop-20261004');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'gsm-production-smoke-'));
app.setPath('userData', profile);
process.env.NODE_ENV = 'production';
const entry = process.env.GSM_READING_PACKAGE_ENTRY || path.join(root, 'electron/main.js');
BrowserWindow.prototype.show = () => {};
let finished = false;
function complete(code, error) {
  if (finished) return;
  finished = true;
  fs.writeFileSync(path.join(output, 'production-smoke-report.json'), JSON.stringify({ passed: code === 0, entry, isolatedProfile: true, realGmailVerified: false, error: error ? String(error.stack || error) : undefined }, null, 2));
  app.exit(code);
}
setTimeout(() => complete(1, Error('Production startup timeout')), 30000).unref();
app.whenReady().then(() => {
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => callback({cancel: /^(https?|wss?):/.test(details.url)}));
});
app.on('browser-window-created', (_event, window) => {
  window.webContents.once('did-finish-load', () => {
    void window.webContents.executeJavaScript("new Promise(resolve=>{const check=()=>document.querySelector('#root')?.firstElementChild?resolve({root:true,mail:typeof window.electronAPI?.htmlReading?.send,preview:typeof window.electronAPI?.htmlReading?.preview,baseline:typeof window.electronAPI?.htmlReading?.baseline}):setTimeout(check,100);check();})").then(result => {
      assert.equal(result.root, true);assert.equal(result.mail,'function');assert.equal(result.preview,'function');assert.equal(result.baseline,'function');complete(0);
    }).catch(error => complete(1,error));
  });
  window.webContents.on('did-fail-load', (_event, code, description) => { if (code !== -3) complete(1,Error(description)); });
});
process.on('uncaughtException', error => complete(1,error));
require(entry);
