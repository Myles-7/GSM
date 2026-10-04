// Disposable verification server: concurrent source edits must not reset test UI.
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = fileURLToPath(new URL('../', import.meta.url));
const port = Number(process.argv[2] ?? 4183);
if (!Number.isInteger(port) || port < 1024 || port > 65535) {
  throw new Error('Invalid HTML verification port');
}
const server = await createServer({
  root,
  server: { host: '127.0.0.1', port, strictPort: true, hmr: false, watch: null },
});
await server.listen();
server.printUrls();
const close = async () => { await server.close(); process.exit(0); };
process.once('SIGINT', close);
process.once('SIGTERM', close);
