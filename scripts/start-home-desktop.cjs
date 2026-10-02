// Launch the built desktop UI. The Windows backend service runs independently.
const { spawn } = require('node:child_process');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const env = { ...process.env, NODE_ENV: 'production' };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(path.join(root, 'node_modules/electron/dist/electron.exe'), [path.join(root, 'electron/main.js')], { cwd: root, env, detached: true, stdio: 'ignore', windowsHide: false });
child.on('error', error => { console.error('Unable to launch GSM:', error.message); process.exitCode = 1; });
child.unref();
