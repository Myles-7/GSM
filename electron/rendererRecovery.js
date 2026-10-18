const path = require('node:path');
const fs = require('node:fs');

function installRendererRecovery({ window, dialog, cancel, userDataPath, locale = 'en', fileSystem = fs, now = Date.now }) {
  const contents = window.webContents;
  const directory = path.join(userDataPath, 'logs');
  const logPath = path.join(directory, 'renderer-health.jsonl');
  let prompting = false;
  let closing = false;
  const record = (event, details = {}) => {
    try {
      fileSystem.mkdirSync(directory, { recursive: true });
      if (fileSystem.existsSync(logPath) && fileSystem.statSync(logPath).size > 256 * 1024) {
        const previous = `${logPath}.previous`;
        if (fileSystem.existsSync(previous)) fileSystem.unlinkSync(previous);
        fileSystem.renameSync(logPath, previous);
      }
      // Lifecycle codes only. Never record page contents, prompts, credentials or URLs.
      fileSystem.appendFileSync(logPath, `${JSON.stringify({ at: now(), event, ...details })}\n`);
    } catch { console.error('[renderer-health] LOG_WRITE_FAILED'); }
  };
  const stop = async () => {
    try { await cancel(); } catch { record('cancel-failed'); }
  };
  const offer = async crashed => {
    if (closing || prompting || window.isDestroyed()) return;
    prompting = true;
    const zh = locale.startsWith('zh');
    try {
      const result = await dialog.showMessageBox(window, {
        type: 'warning', title: zh ? 'GSM 页面恢复' : 'GSM Page Recovery',
        message: zh ? crashed ? '页面进程已退出' : '页面暂时没有响应' : crashed ? 'The page process exited' : 'The page is not responding',
        detail: zh ? '重新加载会停止当前窗口请求，并保留已保存的草案。未保存的进度可能需要重试；不会自动续跑任务或应用分类。'
          : 'Reloading stops this window’s requests and keeps saved drafts. Unsaved progress may need retrying. Tasks and classification changes will not restart automatically.',
        buttons: zh ? ['重新加载页面', crashed ? '暂不恢复' : '继续等待'] : ['Reload Page', crashed ? 'Not Now' : 'Keep Waiting'],
        defaultId: 1, cancelId: 1, noLink: true,
      });
      if (result.response === 0 && !closing && !window.isDestroyed() && !contents.isDestroyed()) {
        await stop();
        if (!closing && !contents.isDestroyed()) { record('reload-confirmed'); contents.reload(); }
      }
    } catch { record('recovery-dialog-failed'); }
    finally { prompting = false; }
  };
  contents.on('render-process-gone', (_event, details) => {
    record('render-process-gone', { reason: String(details.reason).slice(0, 80), exitCode: details.exitCode });
    void stop();
    if (details.reason !== 'clean-exit') void offer(true);
  });
  window.on('unresponsive', () => { record('unresponsive'); void offer(false); });
  window.on('responsive', () => record('responsive'));
  window.on('closed', () => { closing = true; });
  contents.on('console-message', (_event, level, message) => {
    if (level < 2 || typeof message !== 'string') return;
    const code = /Maximum update depth|snapshot should be cached/.test(message) ? 'RENDER_UPDATE_LOOP'
      : /out of memory|heap limit/i.test(message) ? 'RENDER_MEMORY_LIMIT'
        : /NotFoundError/.test(message) ? 'RENDER_DOM_ERROR'
          : /ui\.errorBoundary|Minified React error|TypeError|RangeError/.test(message) ? 'RENDER_EXCEPTION' : null;
    if (code) record('console-error', { code });
  });
  return { logPath };
}
module.exports = { installRendererRecovery };
