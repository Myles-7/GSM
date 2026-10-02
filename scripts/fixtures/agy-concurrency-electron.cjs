const { app, session } = require('electron');
const desktop = require('../../electron/agyDesktop');
const original = desktop.createAgyDesktop;
const { AgyError } = require('../../electron/agyProtocol');
global.agyConcurrencyFixture = { active: 0, peak: 0, calls: [] };
desktop.createAgyDesktop = options => original({ ...options,
  inspect: async executable => ({ path: executable, name: 'agy.exe', fingerprint: 'offline-concurrency-fixture' }),
  models: async () => [{ id: 'fixture-summary', label: 'Fixture summary' }, { id: 'fixture-details', label: 'Fixture details' }],
  runtime: async ({ signal, model, effort, timeoutMs, prompt, onText }) => {
    const state = global.agyConcurrencyFixture;
    state.active++; state.peak = Math.max(state.peak, state.active);
    state.calls.push({ model, effort, timeoutMs });
    try {
      await new Promise((resolve, reject) => {
        const cancel = () => { clearTimeout(timer); reject(new AgyError('CANCELED')); };
        const timer = setTimeout(() => { signal.removeEventListener('abort', cancel); resolve(); }, 250);
        signal.addEventListener('abort', cancel, { once: true });
        if (signal.aborted) cancel();
      });
      const text = prompt.includes('连接成功') ? '{"answer":"连接成功","missing":[]}' : 'Synthetic response';
      onText?.(text);
      return { text, usage: {} };
    } finally { state.active--; }
  },
});
app.whenReady().then(() => {
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    const url = new URL(details.url);
    const asset = url.hostname === '127.0.0.1' && url.port === '5173' && !url.pathname.startsWith('/api');
    callback({ cancel: ['ws:', 'wss:'].includes(url.protocol) || (['http:', 'https:'].includes(url.protocol) && !asset) });
  });
});
require('../../electron/main.js');
