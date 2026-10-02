const childProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { guardOutputPipe } = require('../electron/outputPipeGuard');

// Windows backend service ownership stays independent of the desktop launcher.
function launchBuiltDesktop({ root = path.resolve(__dirname, '..'), env = process.env,
  exists = fs.existsSync, spawn = childProcess.spawn } = {}) {
  const executable = path.join(root, 'node_modules/electron/dist/electron.exe');
  const entry = path.join(root, 'electron/main.js');
  for (const file of [executable, entry, path.join(root, 'dist/index.html')]) {
    if (!exists(file)) throw new Error(`DESKTOP_FILES_MISSING: ${file}`);
  }
  const productionEnv = { ...env, NODE_ENV: 'production' };
  delete productionEnv.ELECTRON_RUN_AS_NODE;
  delete productionEnv.GSM_DEV_SERVER_URL;
  delete productionEnv.GSM_DESKTOP_LAUNCHER;
  return spawn(executable, [entry], { cwd: root, env: productionEnv,
    shell: false, stdio: 'inherit', windowsHide: true });
}

module.exports = { launchBuiltDesktop };
if (require.main === module) {
  guardOutputPipe(process.stdout);
  guardOutputPipe(process.stderr);
  try {
    const child = launchBuiltDesktop();
    child.once('error', error => { console.error('Unable to launch GSM:', error.message); process.exitCode = 1; });
    // A second-instance activation exits with zero and is never reported as a failure.
    child.once('exit', (code, signal) => { process.exitCode = signal ? 1 : code ?? 1; });
  } catch (error) {
    console.error('Unable to launch GSM:', error.message);
    process.exitCode = 1;
  }
}
