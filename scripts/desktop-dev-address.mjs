export function parseDesktopDevAddress(value) {
  if (!value) return null;
  const url = new URL(value);
  if (
    url.protocol !== 'http:' ||
    !['127.0.0.1', 'localhost'].includes(url.hostname) ||
    !url.port || url.port === '0' ||
    url.username || url.password || url.pathname !== '/' || url.search || url.hash
  ) {
    throw new Error('GSM_DEV_SERVER_URL must be an HTTP loopback origin with an explicit nonzero port.');
  }
  return { host: url.hostname, port: Number(url.port), url: url.origin };
}
