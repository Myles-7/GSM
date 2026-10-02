const { app, session } = require('electron');
const runtime = require('../../electron/agyRuntime');
runtime.runAgy = require('../agy-evaluation-budget.cjs').countedRuntime(runtime.runAgy, 'electron-evaluation');
const countedRun = runtime.runAgy;
runtime.runAgy = options => {
  if (process.env.GSM_AGY_E2E_ERROR)
    throw new (require('../../electron/agyProtocol').AgyError)(process.env.GSM_AGY_E2E_ERROR);
  return countedRun(options);
};

// Keep the real main/preload/UI, but never connect this temporary test profile
// to a running user's local backend or remote services.
app.whenReady().then(() => {
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    const url = new URL(details.url);
    const asset = url.hostname === '127.0.0.1' && url.port === '5173' && !url.pathname.startsWith('/api');
    callback({ cancel: ['ws:', 'wss:'].includes(url.protocol) || (['http:', 'https:'].includes(url.protocol) && !asset) });
  });
});
require('../../electron/main.js');
