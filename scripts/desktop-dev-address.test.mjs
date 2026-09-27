import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDesktopDevAddress } from './desktop-dev-address.mjs';
import net from 'node:net';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

test('keeps automatic port selection when no desktop address is configured', () => {
  assert.equal(parseDesktopDevAddress(undefined), null);
  assert.equal(parseDesktopDevAddress(''), null);
});

test('preserves a pinned desktop storage origin', () => {
  assert.deepEqual(parseDesktopDevAddress('http://127.0.0.1:5174/'), {
    host: '127.0.0.1', port: 5174, url: 'http://127.0.0.1:5174',
  });
  assert.equal(parseDesktopDevAddress('http://localhost:5174').host, 'localhost');
});

test('rejects non-loopback, ambiguous or credential-bearing origins', () => {
  for (const url of [
    'https://127.0.0.1:5174', 'http://example.com:5174', 'http://127.0.0.1',
    'http://127.0.0.1:0', 'http://127.0.0.1:65536', 'http://user:pass@127.0.0.1:5174',
    'http://127.0.0.1:5174/path', 'http://127.0.0.1:5174/?test=1', 'http://127.0.0.1:5174/#hash',
  ]) assert.throws(() => parseDesktopDevAddress(url), undefined, url);
});

test('fails instead of opening another storage origin when the pinned port is occupied', async () => {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = server.address();
    await assert.rejects(promisify(execFile)(process.execPath, [
      fileURLToPath(new URL('./dev-desktop.mjs', import.meta.url)),
    ], {
      env: { ...process.env, GSM_DEV_SERVER_URL: `http://127.0.0.1:${port}` },
      timeout: 10000,
    }), error => error.code === 1 && error.stderr.includes(`Pinned desktop port ${port} is unavailable`));
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
