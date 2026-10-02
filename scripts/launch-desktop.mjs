import { spawn, spawnSync } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

process.chdir(rootDir);

console.log('=================================================================');
console.log('       GitHub Stars Manager (GSM) 桌面客户端启动器               ');
console.log('=================================================================');
console.log('');

const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const host = '127.0.0.1';
const desktopPort = 5174;
const devServerUrl = `http://${host}:${desktopPort}`;

let backendProcess = null;
let viteProcess = null;
let electronProcess = null;
let stopping = false;

function stop(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  process.exitCode = exitCode;

  for (const child of [electronProcess, viteProcess, backendProcess]) {
    if (child && child.exitCode === null && child.signalCode === null) {
      try {
        if (process.platform === 'win32') {
          // npm/tsx can have descendants; stop only services owned by this launch.
          spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
            windowsHide: true,
            stdio: 'ignore',
          });
        } else {
          child.kill();
        }
      } catch {}
    }
  }
}

process.once('SIGINT', () => stop(0));
process.once('SIGTERM', () => stop(0));

// 1. 检查后端服务 (3000)
async function isBackendRunning() {
  return new Promise((resolve) => {
    const req = http.get('http://127.0.0.1:3000/api/health', { timeout: 1500 }, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}

// 2. 检查前端 Vite (5174) 是否已经存活
async function isViteServing() {
  return new Promise((resolve) => {
    const req = http.get(devServerUrl, { timeout: 1500 }, (res) => {
      res.resume();
      resolve(Boolean(res.statusCode && res.statusCode >= 200 && res.statusCode < 500));
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}

// 检查端口是否可绑定（支持重试等待 TIME_WAIT 释放）
async function waitPortAvailable(port, maxWaitMs = 6000) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const available = await new Promise((resolve) => {
      const server = net.createServer();
      server.once('error', () => resolve(false));
      server.listen(port, host, () => {
        server.close(() => resolve(true));
      });
    });
    if (available) return true;
    await delay(300);
  }
  return false;
}

async function ensureBackend() {
  const running = await isBackendRunning();
  if (running) {
    console.log('[√] 后端服务已在运行 (端口 3000)');
    return;
  }

  console.log('[*] 正在启动后端服务 (Express / 端口 3000)...');
  backendProcess = spawn(npmCmd, ['run', 'dev:server'], {
    cwd: rootDir,
    stdio: 'inherit',
    shell: true,
    windowsHide: true,
  });
  backendProcess.once('error', (error) => {
    console.error(`[×] 后端启动异常: ${error.message}`);
    stop(1);
  });

  // 等待后端启动
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (stopping) return;
    if (backendProcess.exitCode !== null) {
      throw new Error(`后端服务启动失败 (退出码: ${backendProcess.exitCode})`);
    }
    if (await isBackendRunning()) {
      console.log('[√] 后端服务启动成功！');
      return;
    }
    await delay(500);
  }
  throw new Error('后端服务启动超时 (http://127.0.0.1:3000/api/health)');
}

async function ensureVite() {
  const serving = await isViteServing();
  if (serving) {
    console.log(`[√] 前端开发服务器已在运行 (${devServerUrl})`);
    return;
  }

  console.log(`[*] 检查桌面端口 ${desktopPort}...`);
  const portReady = await waitPortAvailable(desktopPort);
  if (!portReady) {
    // 如果仍然不能绑定，再次检测是否已有服务响应
    if (await isViteServing()) {
      console.log(`[√] 前端开发服务器已就绪 (${devServerUrl})`);
      return;
    }
    console.warn(`[!] 端口 ${desktopPort} 暂处于释放等待状态，正在尝试启动 Vite...`);
  }

  console.log(`[*] 正在启动桌面端 Vite 服务 (${devServerUrl})...`);
  const viteEntry = path.join(rootDir, 'node_modules', 'vite', 'bin', 'vite.js');
  viteProcess = spawn(process.execPath, [viteEntry, '--host', host, '--port', String(desktopPort), '--strictPort'], {
    cwd: rootDir,
    stdio: 'inherit',
    windowsHide: true,
  });

  viteProcess.once('error', (err) => {
    console.error(`[×] Vite 启动异常: ${err.message}`);
    stop(1);
  });

  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (stopping) return;
    if (viteProcess.exitCode !== null) {
      throw new Error(`Vite 启动失败 (退出码: ${viteProcess.exitCode})`);
    }
    if (await isViteServing()) {
      console.log('[√] 桌面端前端服务已就绪！');
      return;
    }
    await delay(300);
  }

  throw new Error(`启动 Vite 超时 (${devServerUrl})`);
}

async function launchElectron() {
  console.log('[*] 正在唤起 Electron 桌面客户端...');
  const electron = (await import('electron')).default;
  const electronEnv = { ...process.env };
  delete electronEnv.ELECTRON_RUN_AS_NODE;
  electronProcess = spawn(electron, [path.join(rootDir, 'electron', 'main.js')], {
    cwd: rootDir,
    env: {
      ...electronEnv,
      NODE_ENV: 'development',
      GSM_DEV_SERVER_URL: devServerUrl,
      GSM_DESKTOP_LAUNCHER: '1',
    },
    stdio: 'inherit',
    windowsHide: true,
  });

  electronProcess.once('error', (error) => {
    console.error(`[×] Electron 唤起失败: ${error.message}`);
    stop(1);
  });

  electronProcess.once('exit', (code, signal) => {
    console.log(`[*] 桌面客户端窗口已关闭 (退出码: ${code ?? 0})`);
    stop(signal ? 1 : code ?? 0);
  });
}

async function main() {
  try {
    await ensureBackend();
    if (stopping) return;
    await ensureVite();
    if (stopping) return;
    await launchElectron();
  } catch (err) {
    console.error('\n[×] 启动失败:', err instanceof Error ? err.message : String(err));
    stop(1);
  }
}

main();
