const { app, session } = require('electron');
const runtime = require('../../electron/agyRuntime');
runtime.runAgy = require('../agy-evaluation-budget.cjs').countedRuntime(runtime.runAgy, 'workbench-overview-20261002');
app.whenReady().then(() => {
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    const url = new URL(details.url);
    const asset = url.hostname === '127.0.0.1' && url.port === '5173' && !url.pathname.startsWith('/api');
    callback({ cancel: ['ws:', 'wss:'].includes(url.protocol) || (['http:', 'https:'].includes(url.protocol) && !asset) });
  });
});
require('../../electron/main.js');
