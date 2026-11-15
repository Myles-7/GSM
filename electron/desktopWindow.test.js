const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const ts = require('typescript');
const windowLifecycle = require('./windowLifecycle');

// Execute the actual main functions and window event bindings, without starting Electron.
const source = ts.createSourceFile('main.js', fs.readFileSync(`${__dirname}/main.js`, 'utf8'), ts.ScriptTarget.Latest, true);
const functions = source.statements.filter(ts.isFunctionDeclaration);
function harness(platform = 'win32') {
  const calls = [];
  const immediates = [];
  const window = Object.assign(new EventEmitter(), {
    visible: true, minimized: false, focused: true, destroyed: false,
    isDestroyed() { return this.destroyed; }, isVisible() { return this.visible; },
    isMinimized() { return this.minimized; }, isFocused() { return this.focused; },
    hide() { calls.push('hide'); this.visible = false; this.emit('hide'); },
    show() { calls.push('show'); this.visible = true; this.emit('show'); },
    focus() { calls.push('focus'); this.focused = true; },
    restore() { calls.push('restore'); this.minimized = false; this.visible = true; this.emit('restore'); },
  });
  const context = vm.createContext({ mainWindow: window, isQuitting: false,
    desktopPrefs: { autoLaunch: false, closeToTray: true, minimizeToTray: true },
    tray: { isDestroyed: () => false, setContextMenu(menu) { context.menu = menu; }, setToolTip() {} },
    process: { platform }, console: { error() {} },
    Menu: { buildFromTemplate: rows => rows }, app: { quit: () => calls.push('quit') },
    createWindow: () => calls.push('create'), applyAutoLaunch: async () => ({ success: true }),
    hideWindowToTray: win => windowLifecycle.hideWindowToTray(win, platform),
    minimizeWindowToTray: (win, shouldHide) => windowLifecycle.minimizeWindowToTray(win, shouldHide, platform, callback => immediates.push(callback)),
    restoreWindowFromTray: win => windowLifecycle.restoreWindowFromTray(win, platform),
    normalizeDesktopPrefs: value => value, getDesktopUserDataPath: () => '/isolated', fs: {}, path: {},
    saveDesktopPrefs: (_storage, prefs) => { if (context.failSave) throw new Error('disk failure'); return prefs; },
  });
  for (const name of ['persistDesktopPrefs', 'restoreMainWindow', 'toggleMainWindowFromTray', 'setTrayPreference', 'refreshTrayMenu', 'setAutoLaunchWithRollback']) {
    const node = functions.find(row => row.name?.text === name); assert.ok(node, `Missing ${name}`);
    vm.runInContext(node.getText(source), context);
  }
  const create = functions.find(row => row.name?.text === 'createWindow');
  for (const statement of create.body.statements) {
    const text = statement.getText(source);
    if (/^mainWindow\.on\('(close|minimize|closed)'/.test(text)
        || text.includes("mainWindow.on('session-end'") || text.includes("mainWindow.on(event, refreshTrayMenu)")) {
      vm.runInContext(text, context);
    }
  }
  context.refreshTrayMenu();
  return { context, window, calls, flushMinimize: () => immediates.splice(0).forEach(callback => callback()) };
}
test('Windows tray restores hidden/minimized windows, focuses unfocused, hides focused', () => {
  for (const state of [{ visible: false }, { minimized: true }, { focused: false }]) {
    const h = harness(); Object.assign(h.window, state); h.context.toggleMainWindowFromTray();
    assert.equal(h.window.visible, true); assert.equal(h.window.minimized, false);
    assert.equal(h.window.focused, true); assert.equal(h.calls.includes('hide'), false);
  }
  const h = harness(); h.context.toggleMainWindowFromTray(); assert.deepEqual(h.calls, ['hide']);
  h.window.destroyed = true; h.context.toggleMainWindowFromTray(); assert.equal(h.calls.at(-1), 'create');
});
test('Windows tray restores, shows and then focuses even when native restore reports visible', () => {
  const h = harness();
  Object.assign(h.window, { visible: false, minimized: true, focused: false });
  h.context.toggleMainWindowFromTray();
  assert.deepEqual(h.calls, ['restore', 'show', 'focus']);
});
test('Windows schedules parking after minimize and cancels a stale hide if the user already restored', () => {
  const parked = harness();
  parked.window.minimized = true;
  parked.window.emit('minimize');
  assert.deepEqual(parked.calls, []);
  parked.flushMinimize();
  assert.deepEqual(parked.calls, ['restore', 'hide']);
  assert.equal(parked.window.minimized, false);
  parked.context.toggleMainWindowFromTray();
  assert.deepEqual(parked.calls.slice(2), ['show', 'focus']);

  const restored = harness();
  restored.window.minimized = true;
  restored.window.emit('minimize');
  restored.context.toggleMainWindowFromTray();
  restored.flushMinimize();
  assert.deepEqual(restored.calls, ['restore', 'show', 'focus']);
});
test('Windows close-to-tray also clears the minimized state', () => {
  const h = harness();
  h.window.minimized = true;
  let prevented = false;
  h.window.emit('close', { preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.deepEqual(h.calls, ['restore', 'hide']);
});
test('other platform tray behavior remains compatible', () => {
  for (const platform of ['darwin', 'linux']) {
    const h = harness(platform); h.window.focused = false; h.context.toggleMainWindowFromTray();
    assert.deepEqual(h.calls, ['hide']);
  }
});
test('menu follows visibility and minimizes to tray using existing preferences; disk failures restore checkboxes', () => {
  const h = harness(); assert.equal(h.context.menu[0].label, '隐藏主窗口');
  h.window.hide(); assert.equal(h.context.menu[0].label, '显示主窗口');
  h.context.menu[0].click(); assert.equal(h.window.visible, true);
  for (const [label, key] of [['关闭时最小化到托盘', 'closeToTray'], ['最小化时隐藏到托盘', 'minimizeToTray']]) {
    h.context.menu.find(item => item.label === label).click({ checked: false });
    assert.equal(h.context.desktopPrefs[key], false);
    h.context.failSave = true; h.context.menu.find(item => item.label === label).click({ checked: true });
    assert.equal(h.context.desktopPrefs[key], false);
    assert.equal(h.context.menu.find(item => item.label === label).checked, false);
    h.context.failSave = false;
  }
  h.window.minimized = true; h.window.emit('minimize', { preventDefault() {} });
  h.flushMinimize();
  assert.equal(h.context.menu[0].label, '显示主窗口');
});

function paintHarness() {
  const h = harness();
  const timers = new Map();
  let frameResolved;
  const conditions = { trusted: true, cpu: 0, crashed: false, now: 0 };
  h.window.webContents = Object.assign(new EventEmitter(), {
    isDestroyed: () => false,
    isCrashed: () => conditions.crashed,
    isLoadingMainFrame: () => false,
    getURL: () => 'file:///isolated/dist/index.html',
    invalidate: () => h.calls.push('invalidate'),
    executeJavaScript(script, userGesture) {
      assert.match(script, /requestAnimationFrame/);
      assert.equal(userGesture, false);
      h.calls.push('probe');
      return new Promise(resolve => { frameResolved = resolve; });
    },
  });
  windowLifecycle.installWindowPaintRecovery({
    window: h.window,
    isTrusted: () => conditions.trusted,
    sampleRendererCpu: () => conditions.cpu,
    recordWake: () => h.calls.push('wake'),
    now: () => conditions.now,
    schedule(callback, delay) {
      const timer = {};
      timers.set(timer, { callback, delay });
      return timer;
    },
    cancel: timer => timers.delete(timer),
  });
  const run = delay => {
    for (const [timer, pending] of [...timers]) {
      if (pending.delay === delay && timers.delete(timer)) pending.callback();
    }
  };
  return { ...h, conditions, timers, run, resolveFrame: () => frameResolved() };
}

test('paint recovery coalesces window events and keeps a healthy renderer untouched', async () => {
  const h = paintHarness();
  for (const event of ['show', 'restore', 'focus']) h.window.emit(event);
  h.run(250);
  assert.deepEqual(h.calls, ['invalidate', 'probe']);
  h.resolveFrame();
  await Promise.resolve();
  h.run(5_000);
  assert.deepEqual(h.calls, ['invalidate', 'probe']);
});

test('paint recovery wakes a focused compositor once without reloading the renderer', () => {
  const h = paintHarness();
  h.window.emit('focus');
  h.run(250);
  h.run(5_000);
  assert.deepEqual(h.calls, ['invalidate', 'probe', 'hide', 'show', 'focus', 'wake']);
  h.window.emit('focus');
  h.run(250);
  h.run(5_000);
  assert.equal(h.calls.filter(event => event === 'wake').length, 1);
});

test('paint recovery yields to background, busy, crashed, unresponsive or untrusted windows', () => {
  for (const change of [
    h => { h.window.focused = false; h.window.emit('blur'); },
    h => { h.conditions.cpu = 25; },
    h => { h.conditions.crashed = true; },
    h => { h.window.emit('unresponsive'); },
    h => { h.conditions.trusted = false; },
  ]) {
    const h = paintHarness();
    h.window.emit('focus');
    h.run(250);
    change(h);
    h.run(5_000);
    assert.deepEqual(h.calls, ['invalidate', 'probe']);
  }
});
test('Windows session query cancellation keeps close-to-tray; final session does not block close', () => {
  const h = harness(); let prevented = 0;
  const event = { preventDefault() { prevented++; } };
  h.window.emit('query-session-end', event); assert.equal(prevented, 0); assert.equal(h.context.isQuitting, false);
  h.window.emit('close', event); assert.equal(prevented, 1);
  h.window.emit('session-end', event); assert.equal(h.context.isQuitting, true);
  h.window.emit('close', event); assert.equal(prevented, 1); assert.equal(h.calls.includes('quit'), false);
  for (const platform of ['darwin', 'linux']) assert.equal(harness(platform).window.listenerCount('session-end'), 0);
});
