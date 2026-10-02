const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { build } = require('esbuild');

const workspace = fs.realpathSync(path.resolve(__dirname, '..'));
let root;
async function run() {
  root = fs.mkdtempSync(path.join(workspace, '.webdav-fixture-'));
  fs.mkdirSync(path.join(root, 'userData'));
  fs.mkdirSync(path.join(root, 'sessionData'));
  await build({
    entryPoints: [path.join(__dirname, 'webdavIpc.fixture.renderer.tsx')],
    outfile: path.join(root, 'renderer.js'), bundle: true, platform: 'browser',
    format: 'iife', target: 'chrome120',
    define: { 'import.meta.env': '{}', 'process.env.NODE_ENV': '"test"' },
    loader: { '.css': 'empty', '.woff2': 'empty', '.woff': 'empty', '.ttf': 'empty' },
    plugins: [{
      name: 'fixture-memory-store',
      setup(api) {
        // Never hydrate GSM data. Only renderer language/theme and backend secret are needed.
        api.onLoad({ filter: /[/\\]src[/\\]store[/\\]useAppStore\.ts$/ }, () => ({
          contents: `export const useAppStore=Object.assign(selector=>selector({language:'en',theme:'dark'}),{getState:()=>({language:'en',backendApiSecret:''})});`,
          loader: 'js',
        }));
        api.onLoad({ filter: /[/\\]src[/\\]i18n[/\\]index\.ts$/ }, () => ({
          contents: `import i18next from 'i18next';i18next.init({lng:'en',resources:{}});export const i18n=i18next;export const getCurrentAppLanguage=()=> 'en';`,
          loader: 'js', resolveDir: workspace,
        }));
      },
    }],
  });
  fs.writeFileSync(path.join(root, 'index.html'), '<!doctype html><meta charset="utf-8"><div id="root"></div><script src="./renderer.js"></script>');
  fs.writeFileSync(path.join(root, 'other.html'), '<!doctype html><meta charset="utf-8"><p>Untrusted fixture page</p>');
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.NODE_OPTIONS;
  const child = spawn(require('electron'), [
    path.join(__dirname, 'webdavIpc.fixture.cjs'), `--gsm-fixture-root=${root}`,
    `--user-data-dir=${path.join(root, 'userData')}`,
  ], { cwd: workspace, env, windowsHide: true, stdio: 'inherit' });
  const timer = setTimeout(() => child.kill(), 45000);
  const code = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', code => resolve(code ?? 1));
  }).finally(() => clearTimeout(timer));
  process.exitCode = code;
}
run().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (!root) return;
  const resolved = fs.realpathSync(root);
  if (path.dirname(resolved) !== workspace || !path.basename(resolved).startsWith('.webdav-fixture-')) {
    throw new Error('Refusing fixture cleanup outside the isolated workspace');
  }
  await fs.promises.rm(resolved, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
});
