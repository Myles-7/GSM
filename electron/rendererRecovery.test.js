const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { installRendererRecovery } = require('./rendererRecovery');
function fixture() {
  const lines = []; const calls = []; let resolve;
  const window = new EventEmitter(); window.isDestroyed = () => false;
  window.webContents = new EventEmitter(); window.webContents.isDestroyed = () => false; window.webContents.reload = () => calls.push('reload');
  const api = installRendererRecovery({ window, locale: 'zh-CN', userDataPath: '/isolated',
    cancel: () => calls.push('cancel'),
    dialog: { showMessageBox: () => { calls.push('dialog'); return new Promise(done => { resolve = done; }); } },
    fileSystem: { mkdirSync() {}, existsSync: () => false, appendFileSync: (_file,text) => lines.push(JSON.parse(text)) }, now: () => 1 });
  return { window, lines, calls, api, answer: response => resolve({ response }) };
}
const settle = () => new Promise(resolve => setImmediate(resolve));
test('a crash is recorded and requests stop, but reload is explicit and deduplicated', async () => {
  const f = fixture();
  f.window.webContents.emit('render-process-gone', {}, { reason: 'oom', exitCode: -1 });
  f.window.emit('unresponsive');
  assert.equal(f.calls.filter(value => value === 'dialog').length, 1);
  assert.equal(f.calls.includes('cancel'), true); assert.equal(f.calls.includes('reload'), false);
  f.answer(0); await settle();
  assert.equal(f.calls.at(-1), 'reload');
  assert.deepEqual(f.lines[0], { at: 1, event: 'render-process-gone', reason: 'oom', exitCode: -1 });
});
test('waiting preserves the page and diagnostics exclude console secrets', async () => {
  const f = fixture(); f.window.emit('unresponsive'); f.answer(1); await settle();
  f.window.webContents.emit('console-message', {}, 3, 'TypeError apiKey=secret-value https://private.example');
  assert.equal(f.calls.includes('reload'), false); assert.equal(f.calls.includes('cancel'), false);
  assert.equal(JSON.stringify(f.lines).includes('secret-value'), false);
  assert.equal(f.lines.at(-1).code, 'RENDER_EXCEPTION');
});
test('normal exits and closing windows do not offer or perform recovery', async () => {
  const f = fixture(); f.window.webContents.emit('render-process-gone', {}, { reason: 'clean-exit', exitCode: 0 });
  assert.equal(f.calls.includes('dialog'), false);
  f.window.emit('unresponsive'); f.window.emit('closed'); f.answer(0); await settle();
  assert.equal(f.calls.includes('reload'), false);
});
