// Diagnostic entry only: install containment before loading the unchanged main.
const { app, BrowserWindow, session, ipcMain } = require('electron');
const path = require('node:path');
const { assertProfile, allowResource } = require('./render-performance-guards.cjs');
const profile = assertProfile(process.env.GSM_DIAG_PROFILE || '');
const buildDir = path.resolve(process.env.GSM_DIAG_BUILD);
// loadFile below redirects to this candidate, so IPC trust must name the same document.
// This adaptation exists only in the contained diagnostic process, never in production.
const trustedRenderer = require('../../electron/trustedRenderer');
const checkDocument = trustedRenderer.isTrustedDocument;
const checkFrame = trustedRenderer.isTrustedMainFrame;
const candidateURL = require('node:url').pathToFileURL(path.join(buildDir, 'index.html')).href;
trustedRenderer.isTrustedDocument = (value, appURL, devURL) => checkDocument(value, appURL ? candidateURL : appURL, devURL);
trustedRenderer.isTrustedMainFrame = (event, window, appURL, devURL) => checkFrame(event, window, appURL ? candidateURL : appURL, devURL);
app.setPath('userData', profile);
app.setPath('sessionData', path.join(profile, 'session'));
global.gsmDiagnosticMain = { blocked: [], forbidden: [], profile, buildDir };
const deny = name => { global.gsmDiagnosticMain.forbidden.push(name); throw new Error(`DIAGNOSTIC_FORBIDDEN:${name}`); };
global.fetch = async () => deny('main-fetch');
require('undici').fetch = async () => deny('undici-fetch');
for (const protocol of ['http', 'https']) {
  const module = require(`node:${protocol}`);
  module.request = module.get = () => deny(`main-${protocol}`);
}
const runtime = require('../../electron/agyRuntime');
runtime.runAgy = async () => deny('paid-ai');
const originalHandle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (name, handler) => originalHandle(name, (...args) => {
  if (/^(agy:(start|run|submit)|x-fetch|telegram-fetch|webdav-request|mcp[-:]start)/i.test(name)) return deny(`ipc:${name}`);
  return handler(...args);
});
const originalLoad = BrowserWindow.prototype.loadFile;
BrowserWindow.prototype.loadFile = function (file, options) {
  if (path.basename(file) === 'index.html') return originalLoad.call(this, path.join(buildDir, 'index.html'), options);
  return originalLoad.call(this, file, options);
};
app.whenReady().then(() => {
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    const allow = allowResource(details.url, buildDir, process.env.GSM_DIAG_DEV_ORIGIN);
    const startupMock = process.env.GSM_STARTUP_MOCK_ORIGIN && details.url.startsWith(`${process.env.GSM_STARTUP_MOCK_ORIGIN}/api/`);
    // Home mock is handled in process by the diagnostic renderer bridge.
    if (!allow && !startupMock) global.gsmDiagnosticMain.blocked.push({ url: details.url, method: details.method });
    callback({ cancel: !allow && !startupMock });
  });
});
require('../../electron/main.js');
