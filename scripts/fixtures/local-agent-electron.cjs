// Isolated native shell: synthetic account only, no production profile or network.
const { app, BrowserWindow, session } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'gsm-local-agent-')));
app.commandLine.appendSwitch('remote-debugging-port', '9317');
process.env.NODE_ENV = 'development';
process.env.GSM_DEV_SERVER_URL = 'http://127.0.0.1:5207';
BrowserWindow.prototype.show = () => {};
app.whenReady().then(() => {
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    const url = new URL(details.url);
    callback({ cancel: ['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol) && (url.port !== '5207' || url.pathname.startsWith('/api')) });
  });
});
setTimeout(() => app.exit(1), 180000).unref();
require('../../electron/main.js');
