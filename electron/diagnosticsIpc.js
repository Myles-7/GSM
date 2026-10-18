'use strict';

const redact = require('./redact');

/** All registrations use the shared main-document trust boundary, including unload. */
function registerDiagnosticsIpc({ ipcMain, getLogger, getSystemInfo, setDebugMode = () => {} }) {
  const ingest = payload => {
    if (!payload || !Array.isArray(payload.entries) || payload.entries.length > 200) return { success: false };
    if (Buffer.byteLength(JSON.stringify(payload)) > 1024 * 1024) return { success: false };
    setDebugMode(payload.debugMode === true);
    return getLogger().ingestRenderer(payload.entries);
  };
  const filters = input => ({
    since: typeof input?.since === 'string' ? input.since.slice(0, 64) : undefined,
    level: ['debug', 'info', 'warn', 'error'].includes(input?.level) ? input.level : undefined,
    sources: Array.isArray(input?.sources) ? input.sources.filter(s => ['main', 'frontend', 'plugins'].includes(s)) : undefined,
    limit: Number.isFinite(input?.limit) ? Math.max(1, Math.min(5000, input.limit)) : 2000,
  });
  ipcMain.handle('diagnostics:append', (_event, payload) => ingest(payload));
  const detach = ipcMain.on('diagnostics:flush', (_event, payload) => {
    ingest(payload); getLogger().flushSync();
  });
  ipcMain.handle('diagnostics:getLogs', async (_event, input) => {
    getLogger().flushSync();
    return redact.sanitizeDiagnosticData(await getLogger().readTail(filters(input)));
  });
  ipcMain.handle('diagnostics:getSystemInfo', async () => redact.sanitizeDiagnosticData(await getSystemInfo()));
  ipcMain.handle('diagnostics:exportBundle', async (_event, input) => {
    getLogger().flushSync();
    // Re-sanitize historic files as well as newly written entries.
    return redact.sanitizeDiagnosticData({ version: 2, exportedAt: new Date().toISOString(),
      environment: await getSystemInfo(), entries: await getLogger().readTail(filters(input)) });
  });
  return detach;
}

module.exports = { registerDiagnosticsIpc };
