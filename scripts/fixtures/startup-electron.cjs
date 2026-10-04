// Startup-only extensions to the existing containment entry; no renderer fixture module.
const { BrowserWindow, contentTracing } = require('electron');
const path = require('node:path');
const startedAt = Date.now();
global.gsmStartup = { startedAt, traceSetupMs: 0 };
const load = BrowserWindow.prototype.loadFile;
BrowserWindow.prototype.loadFile = async function(file, options) {
  if (path.basename(file) === 'index.html') {
    this.setContentSize(1200, 800);
    this.webContents.closeDevTools();
    if (process.env.GSM_STARTUP_SEED_ONLY === '1') return load.call(this, path.join(process.env.GSM_DIAG_BUILD, 'seed.html'), options);
    const begin = Date.now();
    await contentTracing.startRecording({ included_categories: ['devtools.timeline','v8.execute','blink.user_timing','disabled-by-default-devtools.timeline','disabled-by-default-v8.cpu_profiler'] });
    global.gsmStartup.traceSetupMs = Date.now() - begin;
    global.gsmStartup.navigationAt = Date.now();
    return load.call(this, file, options);
  }
  return load.call(this, file, options);
};
// Substitute only the preload path in the in-memory main module; disk source stays unchanged.
const Module = require('node:module');
const fs = require('node:fs');
const originalLoader = Module._extensions['.js'];
const mainFile = path.resolve(__dirname, '../../electron/main.js');
Module._extensions['.js'] = (module, filename) => {
  if (path.resolve(filename) !== mainFile) return originalLoader(module, filename);
  const source = fs.readFileSync(filename, 'utf8');
  const target = "preload: path.join(__dirname, 'preload.js')";
  if (source.split(target).length !== 2) throw new Error('Diagnostic preload path drift');
  const desktopDiagnostic = process.env.GSM_DIAG_DESKTOP === '1' ? `
global.gsmDesktopDiagnostic = {
  clickTray: () => tray.emit('click'),
  preference: (key, value) => setTrayPreference(key, value),
  state: () => ({ visible:mainWindow.isVisible(), minimized:mainWindow.isMinimized(), focused:mainWindow.isFocused(), quitting:isQuitting, prefs:{...desktopPrefs} }),
  session: name => { let prevented=false; mainWindow.emit(name, { preventDefault(){prevented=true;} }); return {prevented,quitting:isQuitting}; },
};` : '';
  module._compile(source.replace(target, "preload: path.join(process.env.GSM_DIAG_BUILD, 'startup-preload.cjs')") + desktopDiagnostic, filename);
};
require('./render-performance-electron.cjs');
