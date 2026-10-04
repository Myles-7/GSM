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
if (new URLSearchParams(location.search).has('aiUx')) {
  const { configureAIUX } = await import('/scripts/fixtures/ai-ux-audit.ts');
  await configureAIUX(new URLSearchParams(location.search).get('aiUx'));
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
