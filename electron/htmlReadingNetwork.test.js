const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { resolveMailProxy, mailFailure } = require('./htmlReadingNetwork');
const { createHtmlReadingService } = require('./htmlReading');

test('mail uses explicit GSM proxy before environment or system proxy', async () => {
  const proxy = await resolveMailProxy({ config: { enabled: true, type: 'http', host: 'localhost', port: 7890, username: 'name', password: 'p@ss' }, env: { HTTPS_PROXY: 'http://ignored:80' }, resolveSystem: () => { throw Error('unused'); } });
  assert.equal(proxy, 'http://name:p%40ss@localhost:7890/');
});
test('mail follows environment proxy and falls back to system proxy when absent', async () => {
  assert.equal(await resolveMailProxy({ env: { HTTPS_PROXY: 'http://127.0.0.1:7890' } }), 'http://127.0.0.1:7890/');
  assert.equal(await resolveMailProxy({ env: {}, resolveSystem: async target => { assert.equal(target, 'https://smtp.gmail.com:465'); return 'PROXY 127.0.0.1:7890; DIRECT'; } }), 'http://127.0.0.1:7890/');
  assert.equal(await resolveMailProxy({ env: {}, resolveSystem: async () => 'DIRECT' }), undefined);
});
test('invalid or unsupported configured proxy fails without silently using direct SMTP', async () => {
  for (const proxy of ['socks5://localhost:7890', 'not-a-proxy', 'http://localhost:7890/path']) {
    await assert.rejects(resolveMailProxy({ env: { HTTPS_PROXY: proxy } }), { code: 'EPROXYCONFIG' });
  }
  await assert.rejects(resolveMailProxy({ config: { enabled: true, type: 'http', host: '', port: 7890 }, env: {} }), { code: 'EPROXYCONFIG' });
  await assert.rejects(resolveMailProxy({ env: {}, resolveSystem: async () => 'SOCKS5 localhost:7890; DIRECT' }), { code: 'EPROXYCONFIG' });
});
test('system proxy resolution is bounded and failure does not bypass proxy', async () => {
  await assert.rejects(resolveMailProxy({ env: {}, resolveSystem: () => new Promise(() => {}), timeoutMs: 10 }), { code: 'ETIMEDOUT' });
});
test('diagnostics distinguish disk errors and retain only allowlisted SMTP commands', () => {
  assert.equal(mailFailure({ code: 'ENOSPC' }, { phase: 'generation' }).failureCode, 'file');
  const auth = mailFailure({ code: 'EAUTH', command: 'AUTH PLAIN secret' });
  assert.equal(auth.transportCommand, 'AUTH'); assert.ok(!JSON.stringify(auth).includes('secret'));
  assert.equal(mailFailure({ command: 'sensitive-private-value' }).transportCommand, undefined);
});

function fixture(t, verify = async () => true) {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'gsm-mail-route-'));
  t.after(() => fs.rmSync(userData, { recursive: true, force: true }));
  const transports = []; let sends = 0;
  const service = createHtmlReadingService({ fs, path, userData,
    safeStorage: { isEncryptionAvailable: () => true, encryptString: text => Buffer.from(text), decryptString: buffer => buffer.toString() },
    getMailProxy: async () => 'http://proxy-user:proxy-secret@127.0.0.1:7890/',
    createTransport: options => { transports.push(options); return { verify, sendMail: async () => { sends++; return { accepted: ['reader@gmail.com'] }; }, close() {} }; }
  });
  service.saveCredential({ accountId: '42', from: 'sender@gmail.com', to: 'reader@gmail.com', password: 'abcdefghijklmnop' });
  return { service, transports, sends: () => sends, userData };
}
test('connection test and send use the same proxy while retaining Gmail TLS', async t => {
  const f = fixture(t);
  assert.equal((await f.service.verify('42')).success, true);
  assert.equal(f.sends(), 0);
  assert.equal((await f.service.send({ accountId: '42', html: '<!doctype html>', snapshotId: 'test' })).success, true);
  assert.equal(f.sends(), 1);
  for (const options of f.transports) {
    assert.equal(options.proxy, 'http://proxy-user:proxy-secret@127.0.0.1:7890/');
    assert.equal(options.secure, true);
    assert.equal(options.port, 465);
    assert.notEqual(options.tls?.rejectUnauthorized, false);
  }
  assert.ok(!JSON.stringify(f.service.status()).includes('proxy-secret'));
});
test('verification failure preserves attachment, reports network cause and redacts secrets', async t => {
  const f = fixture(t, async () => { throw Object.assign(Error('proxy-secret abcdefghijklmnop'), { code: 'ETIMEDOUT' }); });
  const checked = await f.service.verify('42');
  assert.equal(checked.success, false); assert.match(checked.error, /代理.*超时/);
  const result = await f.service.send({ accountId: '42', html: '<!doctype html>', snapshotId: 'test' });
  assert.equal(result.success, false); assert.equal(f.sends(), 0);
  const run = f.service.status().runs[0];
  assert.equal(run.phase, 'verification'); assert.equal(run.hasAttachment, true);
  assert.equal(run.networkRoute, 'proxy'); assert.equal(run.transportCode, 'ETIMEDOUT');
  assert.ok(!JSON.stringify({ checked, result, state: f.service.status() }).includes('proxy-secret'));
});
test('authentication rejection is distinct from network failure and never submits email', async t => {
  const f = fixture(t, async () => { throw Object.assign(Error('hidden'), { code: 'EAUTH' }); });
  assert.match((await f.service.verify('42')).error, /应用专用密码/);
  const result = await f.service.send({ accountId: '42', html: '<!doctype html>', snapshotId: 'test' });
  assert.equal(result.status, 'failed'); assert.equal(f.service.status().runs[0].failureCode, 'authentication');
  assert.equal(f.sends(), 0);
});
