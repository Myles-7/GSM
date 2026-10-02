const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { launchBuiltDesktop } = require('./start-home-desktop.cjs');
const { guardOutputPipe } = require('../electron/outputPipeGuard');

test('launches only the built desktop with its original identity and production origin', () => {
  const root = path.resolve('fixture workspace');
  let called;
  const child = new EventEmitter();
  const originalEnv = { NODE_ENV: 'development', ELECTRON_RUN_AS_NODE: '1', GSM_DEV_SERVER_URL: 'http://127.0.0.1:5174', OTHER: 'retained' };
  assert.equal(launchBuiltDesktop({ root, env: originalEnv, exists: () => true, spawn: (...args) => {called = args; return child;} }), child);
  assert.equal(called[0], path.join(root, 'node_modules/electron/dist/electron.exe'));
  assert.deepEqual(called[1], [path.join(root, 'electron/main.js')]);
  assert.equal(called[2].env.NODE_ENV, 'production');
  assert.equal(called[2].env.ELECTRON_RUN_AS_NODE, undefined);
  assert.equal(called[2].env.GSM_DEV_SERVER_URL, undefined);
  assert.equal(called[2].env.OTHER, 'retained');
  assert.equal(called[2].windowsHide, true);
  assert.equal(called[2].shell, false);
  assert.equal(called[2].cwd, root);
  assert.equal(originalEnv.NODE_ENV, 'development');
});

test('missing distribution fails explicitly without starting Vite or changing profiles', () => {
  assert.throws(() => launchBuiltDesktop({ root: path.resolve('.'), exists: () => false, spawn: () => assert.fail('must not spawn') }), /DESKTOP_FILES_MISSING/);
});

test('hidden entry uses production launcher and captures diagnostic output', () => {
  const script = fs.readFileSync(path.join(__dirname, 'start-desktop.vbs'), 'utf8');
  assert.match(script, /start-home-desktop\.cjs/);
  assert.doesNotMatch(script, /launch-desktop\.mjs/);
  assert.match(script, /shell\.Run\(command, 0, True\)/);
  assert.match(script, /2>&1/);
});

test('output guard tolerates a closed launcher pipe, not arbitrary failures', () => {
  const stream = new EventEmitter();
  guardOutputPipe(stream);
  assert.doesNotThrow(() => stream.emit('error', Object.assign(new Error('closed'), {code:'EPIPE'})));
  const unexpected = Object.assign(new Error('permission'), {code:'EACCES'});
  assert.throws(() => stream.emit('error', unexpected), e => e === unexpected);
});

test('a real child survives EPIPE after its launcher closes the output pipe', async () => {
  const guard = path.join(__dirname, '../electron/outputPipeGuard.js');
  const child = spawn(process.execPath, ['-e', `
    require(${JSON.stringify(guard)}).guardOutputPipe(process.stdout);
    process.on('message', () => {
      process.stdout.write('diagnostic output\\n'.repeat(10000), () => {
        process.send('still-running'); process.disconnect();
      });
    });
    process.send('ready');
  `], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  let errors = '';
  child.stderr.on('data', data => { errors += data; });
  const timeout = setTimeout(() => child.kill(), 5000);
  let survived = false;
  child.on('message', message => {
    if (message === 'ready') { child.stdout.destroy(); child.send('write'); }
    if (message === 'still-running') survived = true;
  });
  const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
  clearTimeout(timeout);
  assert.equal(code, 0, errors);
  assert.ok(survived);
});

test('a second instance never initializes windows or background services while quitting', () => {
  const entry = path.join(__dirname, '../electron/main.js');
  const localRequire = createRequire(entry);
  const app = new EventEmitter();
  const ready = [];
  let quit = 0;
  app.requestSingleInstanceLock = () => false;
  app.getPath = () => path.join(__dirname, 'not-a-real-profile');
  app.whenReady = () => ({ then: fn => { ready.push(fn); } });
  app.exit = code => { assert.equal(code, 0); quit++; };
  app.quit = () => assert.fail('secondary must exit before Chromium initializes');
  const electron = { app, ipcMain: {handle() {}, on() {}},
    protocol: {registerSchemesAsPrivileged() {}, handle: () => assert.fail('secondary protocol initialization')},
    nativeTheme: new EventEmitter(),
    BrowserWindow: class { constructor() { assert.fail('secondary window'); } },
  };
  const mockRequire = name => {
    if (name === 'electron') return electron;
    if (name === './htmlReading') return {createHtmlReadingService: () => assert.fail('secondary background service'), registerHtmlReadingIpc() {}};
    return localRequire(name);
  };
  vm.runInNewContext(fs.readFileSync(entry, 'utf8'), { require: mockRequire,
    __dirname: path.dirname(entry), process: {...process, stdout:new EventEmitter(), stderr:new EventEmitter()}, console });
  assert.equal(quit, 1);
  for (const callback of ready) assert.doesNotThrow(callback);
  assert.doesNotThrow(() => app.emit('activate'));
});
