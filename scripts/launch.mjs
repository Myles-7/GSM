import { spawn } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

process.chdir(rootDir);

console.log('=================================================================');
console.log('         GitHub Stars Manager (GSM) 一键启动器                   ');
console.log('=================================================================');
console.log('');

function openBrowser() {
  console.log('[+] 正在自动打开浏览器: http://localhost:5173/');
  const startCmd = process.platform === 'win32' ? 'cmd.exe' : 'open';
  const args = process.platform === 'win32' ? ['/c', 'start', 'http://localhost:5173/'] : ['http://localhost:5173/'];
  spawn(startCmd, args, { stdio: 'ignore', detached: true }).unref();
}

// 检查是否已经在运行
function checkExistingInstance() {
  const req = http.get('http://127.0.0.1:5173/', (res) => {
    console.log('[*] 检测到 GSM 服务已经在运行中 (端口 5173 已就绪)！');
    openBrowser();
    console.log('\n[√] 页面已唤起，无需重复启动。按任意键或直接关闭此窗口即可。');
  });

  req.on('error', () => {
    // 未在运行，开始启动全栈服务
    startFullstack();
  });
}

function startFullstack() {
  console.log('[*] 正在启动前端与后端服务...');
  console.log('[*] 服务就绪后将自动在浏览器中打开: http://localhost:5173/');
  console.log('[*] 提示: 保持此窗口打开以维持服务运行，按 Ctrl+C 可停止服务。');
  console.log('-----------------------------------------------------------------');
  console.log('');

  const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const child = spawn(npmCmd, ['run', 'dev:all'], {
    stdio: 'inherit',
    shell: true,
    cwd: rootDir,
  });

  let opened = false;

  function pollFrontend(attempt = 0) {
    if (opened || attempt > 50) return;

    const testReq = http.get('http://127.0.0.1:5173/', (res) => {
      if (!opened && res.statusCode && res.statusCode >= 200 && res.statusCode < 400) {
        opened = true;
        console.log('\n[√] 前端已就绪，正在自动唤起默认浏览器...');
        openBrowser();
      }
    });

    testReq.on('error', () => {
      setTimeout(() => pollFrontend(attempt + 1), 600);
    });
  }

  setTimeout(() => pollFrontend(), 600);

  child.on('exit', (code) => {
    process.exit(code ?? 0);
  });
}

checkExistingInstance();
