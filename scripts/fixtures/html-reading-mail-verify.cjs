// Read-only verification of the saved Gmail credential. Never sends mail or
// starts the real application scheduler; state is isolated in a temporary dir.
const { app, safeStorage, session } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHtmlReadingService } = require('../../electron/htmlReading');
const { resolveMailProxy } = require('../../electron/htmlReadingNetwork');
const { createTransport } = require('nodemailer');
const profileArg = process.argv.find(value => value.startsWith('--profile='));
const reportArg = process.argv.find(value => value.startsWith('--report='));
if (!profileArg || !reportArg) throw Error('Expected --profile and --report');
const profile = path.resolve(profileArg.slice(10));
const report = path.resolve(reportArg.slice(9));
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'gsm-mail-verify-'));
// Chromium's profile encryption key is needed to decrypt the existing blob.
// Copy it only to the disposable profile; never print it or change the original.
if (fs.existsSync(path.join(profile, 'Local State'))) fs.copyFileSync(path.join(profile, 'Local State'), path.join(temporary, 'Local State'));
app.setPath('userData', temporary);
app.whenReady().then(async () => {
  let result = { success: false, error: '验证未完成。' }, route, proxyPort;
  try {
    fs.mkdirSync(path.join(temporary, 'html-reading'));
    fs.copyFileSync(path.join(profile, 'html-reading', 'gmail.enc'), path.join(temporary, 'html-reading', 'gmail.enc'));
    const configFile = path.join(profile, 'proxy-config.json');
    const config = fs.existsSync(configFile) ? JSON.parse(fs.readFileSync(configFile, 'utf8')) : undefined;
    const service = createHtmlReadingService({ fs, path, userData: temporary, safeStorage, createTransport,
      getMailProxy: async () => {
        const proxy = await resolveMailProxy({ config, resolveSystem: target => session.defaultSession.resolveProxy(target) });
        route = proxy ? 'proxy' : 'direct'; proxyPort = proxy ? new URL(proxy).port : undefined; return proxy;
      }
    });
    const accountId = service.status().credential?.accountId;
    if (!accountId) throw Error('CREDENTIAL_UNAVAILABLE');
    result = await service.verify(accountId);
  } catch { result = { success: false, error: '已保存的邮箱配置无法读取，未发送邮件。' }; }
  fs.writeFileSync(report, JSON.stringify({ ...result, route, proxyPort, checkedAt: new Date().toISOString(), mailSent: false }, null, 2));
  app.quit();
}).catch(() => app.exit(1));
app.on('will-quit', () => { try { fs.rmSync(temporary, { recursive: true, force: true }); } catch { /* Chromium may still hold the disposable profile lock. */ } });
