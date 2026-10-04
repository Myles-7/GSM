const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const ts = require('typescript');

// Execute the actual main functions and window event bindings, without starting Electron.
const source = ts.createSourceFile('main.js', fs.readFileSync(`${__dirname}/main.js`, 'utf8'), ts.ScriptTarget.Latest, true);
const functions = source.statements.filter(ts.isFunctionDeclaration);
function harness(platform = 'win32') {
  const calls = [];
  const window = Object.assign(new EventEmitter(), {
    visible: true, minimized: false, focused: true, destroyed: false,
    isDestroyed() { return this.destroyed; }, isVisible() { return this.visible; },
    isMinimized() { return this.minimized; }, isFocused() { return this.focused; },
    hide() { calls.push('hide'); this.visible = false; this.emit('hide'); },
    show() { calls.push('show'); this.visible = true; this.emit('show'); },
    focus() { calls.push('focus'); this.focused = true; },
    restore() { calls.push('restore'); this.minimized = false; this.emit('restore'); },
  });
  const context = vm.createContext({ mainWindow: window, isQuitting: false,
    desktopPrefs: { autoLaunch: false, closeToTray: true, minimizeToTray: true },
    tray: { isDestroyed: () => false, setContextMenu(menu) { context.menu = menu; }, setToolTip() {} },
    process: { platform }, console: { error() {} },
    Menu: { buildFromTemplate: rows => rows }, app: { quit: () => calls.push('quit') },
    createWindow: () => calls.push('create'), applyAutoLaunch: async () => ({ success: true }),
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
  return { context, window, calls };
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
  assert.equal(h.context.menu[0].label, '显示主窗口');
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
