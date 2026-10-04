// Package the already-built desktop with its installed Electron/runtime dependencies.
// No dependency installation, version changes, user profile copying or program launch.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const output = path.resolve(root, process.argv[2] || 'output/html-reading-loop-20261004/GSM-desktop');
if (!output.startsWith(path.join(root, 'output') + path.sep)) throw Error('Package output must stay within workspace output.');
if (fs.existsSync(output)) throw Error('Output exists; use a new explicit package directory.');
for (const file of ['dist/index.html', 'node_modules/electron/dist/electron.exe', 'electron/main.js']) {
  if (!fs.existsSync(path.join(root, file))) throw Error('Build/runtime missing: ' + file);
}
fs.mkdirSync(output, { recursive: true });
fs.cpSync(path.join(root, 'node_modules/electron/dist'), path.join(output, 'runtime'), { recursive: true });
const application = path.join(output, 'app');
fs.mkdirSync(application);
fs.copyFileSync(path.join(root, 'package.json'), path.join(application, 'package.json'));
for (const folder of ['dist', 'electron', 'build']) {
  fs.cpSync(path.join(root, folder), path.join(application, folder), { recursive: true, filter: source => !/\.test\.[cm]?js$/.test(source) });
}
const dependencies = new Set();
const builtins = new Set(require('node:module').builtinModules);
function scan(directory) {
  for (const name of fs.readdirSync(directory)) {
    const file = path.join(directory, name), stat = fs.lstatSync(file);
    if (stat.isDirectory()) { scan(file); continue; }
    if (!name.endsWith('.js')) continue;
    for (const match of fs.readFileSync(file, 'utf8').matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)) {
      const id = match[1];
      if (id.startsWith('.') || path.isAbsolute(id) || id.startsWith('node:') || id === 'electron' || builtins.has(id)) continue;
      dependencies.add(id.startsWith('@') ? id.split('/').slice(0, 2).join('/') : id.split('/')[0]);
    }
  }
}
scan(path.join(application, 'electron'));
function copyDependency(id) {
  const source = path.join(root, 'node_modules', id), target = path.join(application, 'node_modules', id);
  if (fs.existsSync(target)) return;
  const metadata = JSON.parse(fs.readFileSync(path.join(source, 'package.json'), 'utf8'));
  fs.cpSync(source, target, { recursive: true });
  for (const child of Object.keys(metadata.dependencies || {})) copyDependency(child);
}
for (const id of dependencies) copyDependency(id);
fs.writeFileSync(path.join(output, '启动GSM.cmd'), '@echo off\r\nset NODE_ENV=production\r\nset ELECTRON_RUN_AS_NODE=\r\nset GSM_DEV_SERVER_URL=\r\nset GSM_DESKTOP_LAUNCHER=\r\nstart "" "%~dp0runtime\\electron.exe" "%~dp0app\\electron\\main.js"\r\n', 'utf8');
fs.writeFileSync(path.join(output, '使用说明.txt'), 'GSM 每日 HTML 阅读闭环桌面构建\r\n\r\n双击“启动GSM.cmd”。先从托盘完全退出旧 GSM，避免旧进程接管新启动。\r\n这是免安装目录包，使用现有 Electron 包名的 Windows 用户数据目录；不随包提供个人资料、邮箱授权或 API 密钥。\r\n源码根目录的 dist/electron 也已更新。首次使用请备份当前资料，再进入“设置 → 每日 HTML”检查保存配置。\r\n原先使用不同打包应用名或浏览器访问的资料不会自动迁移到此目录包。\r\n真实 Gmail/安卓验收请见项目 docs/html-reading-loop-20261004.md。\r\n', 'utf8');
const files = [];
function inventory(directory) {
  for (const name of fs.readdirSync(directory)) {
    const file = path.join(directory, name), stat = fs.lstatSync(file);
    if (stat.isDirectory()) inventory(file);
    else files.push({ file: path.relative(output, file).replace(/\\/g, '/'), bytes: stat.size, sha256: crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') });
  }
}
inventory(output);
fs.writeFileSync(path.join(output, 'manifest.json'), JSON.stringify({ generatedAt: new Date().toISOString(), version: JSON.parse(fs.readFileSync(path.join(root,'package.json'))).version, electron: JSON.parse(fs.readFileSync(path.join(root,'node_modules/electron/package.json'))).version, dependencies: [...dependencies], files }, null, 2));
process.stdout.write(`Desktop built: ${output}\n${files.length} files; no application started.\n`);
