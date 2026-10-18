// Resolve the same network configuration as desktop requests without exposing
// proxy credentials to renderer state, delivery records or error messages.
const proxyError = () => Object.assign(new Error('MAIL_PROXY_CONFIG'), { code: 'EPROXYCONFIG' });
function validateProxy(value) {
  try {
    if (typeof value !== 'string' || value.length > 4096 || /[\r\n]/.test(value)) throw proxyError();
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.pathname !== '/' || url.search || url.hash) throw proxyError();
    return url.href;
  } catch { throw proxyError(); }
}
async function resolveMailProxy({ config, env = process.env, resolveSystem, timeoutMs = 5000 } = {}) {
  if (config?.enabled) {
    if (typeof config.host !== 'string' || !config.host || !Number.isInteger(Number(config.port)) || Number(config.port) < 1 || Number(config.port) > 65535 || !['http', 'https'].includes(config.type)) throw proxyError();
    const host = config.host.includes(':') && !config.host.startsWith('[') ? `[${config.host}]` : config.host;
    // Config is a host, not a URL. Reject separators before building the URL.
    if (/[\s/@?#\\]/.test(host)) throw proxyError();
    const auth = config.username ? `${encodeURIComponent(config.username)}:${encodeURIComponent(config.password || '')}@` : '';
    return validateProxy(`${config.type}://${auth}${host}:${config.port}`);
  }
  const value = env.HTTPS_PROXY || env.https_proxy || env.ALL_PROXY || env.all_proxy;
  if (value) return validateProxy(value);
  if (!resolveSystem) return undefined;
  let timer;
  try {
    const result = await Promise.race([
      resolveSystem('https://smtp.gmail.com:465'),
      new Promise((_, reject) => { timer = setTimeout(() => reject(Object.assign(new Error('MAIL_PROXY_TIMEOUT'), { code: 'ETIMEDOUT' })), timeoutMs); })
    ]);
    // Honour the first route, including PAC, rather than silently bypassing a
    // configured proxy after a failure. Gmail is the sole destination.
    const first = String(result).split(';')[0].trim();
    if (first === 'DIRECT') return undefined;
    const match = /^(PROXY|HTTP|HTTPS)\s+(\S+)$/i.exec(first);
    if (!match) throw proxyError();
    return validateProxy(`${match[1].toUpperCase() === 'HTTPS' ? 'https' : 'http'}://${match[2]}`);
  } finally { clearTimeout(timer); }
}

function mailFailure(error, { phase = 'verification', proxy = false } = {}) {
  const allowed = ['EAUTH', 'EPROXY', 'EPROXYCONFIG', 'CANCELLED', 'ENOSPC', 'EACCES', 'EPERM', 'EIO', 'ENOENT', 'ECONNRESET', 'ECONNREFUSED', 'ENETUNREACH', 'EHOSTUNREACH', 'ENOTFOUND', 'EAI_AGAIN', 'ETIMEDOUT', 'ESOCKET', 'ECONNECTION', 'EENVELOPE'];
  const transportCode = allowed.includes(error?.code) ? error.code : 'UNKNOWN';
  const command = typeof error?.command === 'string' ? error.command.split(' ')[0] : '';
  const transportCommand = ['CONN', 'EHLO', 'HELO', 'AUTH', 'STARTTLS', 'MAIL', 'RCPT', 'DATA'].includes(command) ? command : undefined;
  let failureCode = 'transport', message;
  if (transportCode === 'EAUTH') { failureCode = 'authentication'; message = 'Gmail 认证失败，请检查 Google 的 16 位应用专用密码，不是账户登录密码。'; }
  else if (transportCode === 'CANCELLED') { failureCode = 'cancelled'; message = '账户或任务已变化，未提交邮件。'; }
  else if (transportCode === 'EPROXYCONFIG') { failureCode = 'proxyConfig'; message = '邮件代理配置不可用。请在网络设置中使用 HTTP／HTTPS 代理（支持 CONNECT）；SMTP 暂不支持 SOCKS 代理。'; }
  else if (phase === 'generation') { failureCode = 'file'; message = 'HTML 附件保存失败，请检查数据目录权限和磁盘剩余空间。'; }
  else if (transportCode === 'EPROXY') message = '代理拒绝连接 Gmail，请检查代理授权及是否允许连接 smtp.gmail.com:465。';
  else if (transportCode === 'EENVELOPE') { failureCode = 'recipient'; message = 'Gmail 拒绝邮件地址，请检查发件地址和收件地址。'; }
  else if (transportCode === 'ETIMEDOUT') message = proxy ? '通过代理连接 Gmail 超时，请确认代理已启动且允许连接 smtp.gmail.com:465。' : '直连 Gmail 超时，请启用可访问 Gmail 的桌面或系统 HTTP 代理后重新测试连接。';
  else message = proxy ? '通过代理连接 Gmail 失败，请检查代理运行状态、网络和 Gmail SMTP 访问。' : '连接 Gmail 失败，请检查网络，或配置可访问 Gmail 的 HTTP 代理。';
  return { error: message, failureCode, transportCode, ...(transportCommand ? { transportCommand } : {}) };
}
module.exports = { resolveMailProxy, mailFailure };
