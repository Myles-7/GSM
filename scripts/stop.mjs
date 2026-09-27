import { execSync } from 'node:child_process';

const ports = [3000, 5173];
console.log('=================================================================');
console.log('           GitHub Stars Manager (GSM) 停止脚本');
console.log('=================================================================');
console.log('');

let found = false;

for (const port of ports) {
  try {
    const output = execSync(`netstat -ano | findstr :${port}`, { encoding: 'utf8' });
    const lines = output.split('\n');
    const pids = new Set();
    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 5 && parts[1].endsWith(`:${port}`)) {
        const pid = parts[parts.length - 1];
        if (pid && pid !== '0') {
          pids.add(pid);
        }
      }
    }
    for (const pid of pids) {
      found = true;
      console.log(`[+] 正在停止端口 ${port} 进程 (PID: ${pid})...`);
      try {
        execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore' });
      } catch {}
    }
  } catch {}
}

if (!found) {
  console.log('[*] 未检测到正在运行的 GSM 服务进程。');
} else {
  console.log('[√] GSM 服务进程已成功全部停止！');
}
