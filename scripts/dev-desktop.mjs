import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const viteEntry = path.join(projectRoot, 'node_modules', 'vite', 'bin', 'vite.js');
const port = await findAvailablePort(5173);
const devServerUrl = `http://127.0.0.1:${port}`;

const vite = spawn(process.execPath, [viteEntry, '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
  cwd: projectRoot,
  stdio: 'inherit',
});

let electronProcess = null;
let stopping = false;

const stop = (exitCode = 0) => {
  if (stopping) return;
  stopping = true;
  process.exitCode = exitCode;

  for (const child of [electronProcess, vite]) {
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill();
    }
  }
};

vite.once('error', (error) => {
  console.error(`Failed to start Vite: ${error.message}`);
  stop(1);
});

vite.once('exit', (code, signal) => {
  if (stopping) return;
  console.error(`Vite stopped${signal ? ` (${signal})` : ` with exit code ${code ?? 1}`}.`);
  stop(code ?? 1);
});

process.once('SIGINT', () => stop(0));
process.once('SIGTERM', () => stop(0));

async function waitForDevServer() {
  const deadline = Date.now() + 30_000;

  while (Date.now() < deadline) {
    if (vite.exitCode !== null || vite.signalCode !== null) {
      throw new Error('Vite exited before its development server became ready.');
    }

    try {
      const response = await fetch(devServerUrl, { signal: AbortSignal.timeout(1_000) });
      if (response.ok) return;
    } catch {
      // Vite is still starting.
    }

    await delay(250);
  }

  throw new Error(`Timed out waiting for Vite at ${devServerUrl}.`);
}

async function findAvailablePort(startPort) {
  for (let port = startPort; port < startPort + 100; port += 1) {
    const available = await new Promise((resolve) => {
      const server = net.createServer();
      server.once('error', () => resolve(false));
      server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)));
    });
    if (available) return port;
  }

  throw new Error(`No available development port found near ${startPort}.`);
}

try {
  await waitForDevServer();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  stop(1);
}

if (!stopping) {
  const hasProxy = ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy']
    .some((name) => Boolean(process.env[name]));
  if (hasProxy && !process.env.ELECTRON_GET_USE_PROXY) {
    process.env.ELECTRON_GET_USE_PROXY = '1';
  }

  try {
    const electron = (await import('electron')).default;
    electronProcess = spawn(electron, [path.join(projectRoot, 'electron', 'main.js')], {
      cwd: projectRoot,
      env: { ...process.env, NODE_ENV: 'development', GSM_DEV_SERVER_URL: devServerUrl },
      stdio: 'inherit',
    });

    electronProcess.once('error', (error) => {
      console.error(`Failed to start Electron: ${error.message}`);
      stop(1);
    });

    electronProcess.once('exit', (code, signal) => {
      if (stopping) return;
      stop(signal ? 1 : code ?? 0);
    });
  } catch (error) {
    console.error('Failed to load Electron. Check the Electron binary download and proxy settings.');
    console.error(error instanceof Error ? error.message : String(error));
    stop(1);
  }
}
