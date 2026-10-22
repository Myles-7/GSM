import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.GSM_AUDIT_PORT || 5187);
if (!Number.isInteger(port) || port < 1024 || port > 65535 || [3000, 5173, 5174].includes(port)) {
  throw new Error('Choose an isolated audit port, distinct from application and backend ports');
}
const entry = `
const originalFetch = window.fetch.bind(window);
window.fetch = (input, init) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, location.href);
  if (url.origin !== location.origin) return Promise.reject(new Error('Offline UI audit blocked external request'));
  return originalFetch(input, init);
};
const { useAppStore } = await import('/src/store/useAppStore.ts');
await useAppStore.persist.rehydrate();
if (useAppStore.getState().user && useAppStore.getState().user.id !== 990001) {
  throw new Error('Audit origin contains another account. Choose a fresh GSM_AUDIT_PORT.');
}
const { install } = await import('/scripts/fixtures/render-performance-renderer.ts');
install();
await import('/src/main.tsx');
await window.gsmDiagnostic.configure(100);
if (new URLSearchParams(location.search).has('exploration')) {
  const { configureExplorationAudit } = await import('/scripts/fixtures/exploration-audit.ts');
  const count = Number(new URLSearchParams(location.search).get('exploration') || 368);
  await configureExplorationAudit(Math.max(1, Math.min(1000, count)), new URLSearchParams(location.search).has('partialTask'), new URLSearchParams(location.search).has('searchAudit'));
}
if (new URLSearchParams(location.search).has('classification')) {
  const { configureClassificationAudit } = await import('/scripts/fixtures/classification-audit.ts');
  configureClassificationAudit();
}
if (new URLSearchParams(location.search).has('aiUx')) {
  const { configureAIUX } = await import('/scripts/fixtures/ai-ux-audit.ts');
  await configureAIUX(new URLSearchParams(location.search).get('aiUx'));
}
if (new URLSearchParams(location.search).has('agySettings')) {
  const { configureAgySettingsAudit } = await import('/scripts/fixtures/agy-settings-audit.ts');
  configureAgySettingsAudit();
}
if (new URLSearchParams(location.search).has('projectAudit')) {
  const { configureProjectAudit } = await import('/scripts/fixtures/project-audit.ts');
  await configureProjectAudit(new URLSearchParams(location.search));
}
`;
const plugin = {
  name: 'gsm-offline-ui-audit',
  resolveId(id) {
    if (id === '/__gsm_audit_entry.js') return '\0gsm-audit-entry';
  },
  load(id) {
    if (id === '\0gsm-audit-entry') return entry;
  },
  configureServer(server) {
    server.middlewares.use(async (request, response, next) => {
      const url = request.url?.split('?')[0];
      if (url !== '/') return next();
      const query = new URL(request.url, 'http://127.0.0.1');
      const viewport = query.searchParams.get('viewport');
      if (viewport === 'mobile' || viewport === 'short' || viewport === 'desktop') {
        const [width,height] = viewport === 'mobile' ? [390,844] : viewport === 'short' ? [1280,600] : [1600,1000];
        query.searchParams.delete('viewport');
        response.setHeader('Content-Type','text/html; charset=utf-8');
        response.end(`<!doctype html><meta charset="utf-8"><title>GSM ${width} × ${height} 隔离视口检查</title><style>body{margin:0;background:#e8e9eb;font:12px sans-serif}header{padding:8px}iframe{border:0;background:white;display:block;width:${width}px;height:${height}px}</style><header>合成数据视口检查 · ${width} × ${height} · <a href="/?exploration=368&viewport=mobile">移动端</a> · <a href="/?exploration=368&viewport=short">短窗口</a> · <a href="/?exploration=368&viewport=desktop">桌面</a></header><iframe title="GSM ${width} × ${height}" src="${query.pathname}${query.search.replace(/&/g,'&amp;')}"></iframe>`);
        return;
      }
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.setHeader('Content-Security-Policy', `default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self' ws://127.0.0.1:${port}; worker-src 'self' blob:; frame-src 'self' blob:; object-src 'none'`);
      const html = '<!doctype html><html lang="zh"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>GSM 离线界面审查</title></head><body><div id="root"></div><script type="module" src="/__gsm_audit_entry.js"></script></body></html>';
      response.end(await server.transformIndexHtml('/', html));
    });
  },
};
const server = await createServer({ root, cacheDir: path.join(root, 'node_modules', '.vite-ui-audit'), plugins: [plugin], server: { host: '127.0.0.1', port, strictPort: true, open: false } });
await server.listen();
console.log(`Offline UI audit: http://127.0.0.1:${port}/ (100 synthetic repositories; stop with Ctrl+C)`);
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await server.close(); process.exit(0); });
