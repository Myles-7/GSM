const ALLOWED_METHODS = new Set([
  'GET', 'HEAD', 'PUT', 'POST', 'DELETE', 'OPTIONS',
  'PROPFIND', 'PROPPATCH', 'MKCOL', 'COPY', 'MOVE', 'LOCK', 'UNLOCK',
]);
const ALLOWED_HEADERS = new Set([
  'authorization', 'content-type', 'accept', 'depth', 'if-match', 'if-none-match',
  'if', 'lock-token', 'timeout', 'destination', 'overwrite',
]);
const MAX_BYTES = 64 * 1024 * 1024;
const MAX_HEADER_BYTES = 16 * 1024;
const validRequestId = id => typeof id === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(id);
const failure = (error, extra = {}) => ({ success: false, error, ...extra });

function isTrustedWebdavFrame(event, window, appUrl, devUrl) {
  if (!window || window.isDestroyed() || event.sender !== window.webContents ||
      event.senderFrame !== window.webContents.mainFrame) return false;
  try {
    const actual = new URL(event.senderFrame.url);
    actual.hash = '';
    if (actual.href === new URL(appUrl).href) return true;
    const dev = devUrl && new URL(devUrl);
    return !!dev && dev.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(dev.hostname) &&
      actual.origin === dev.origin && actual.protocol === 'http:';
  } catch { return false; }
}

function validateRequest(params) {
  if (!params || typeof params !== 'object' || Array.isArray(params) ||
      !validRequestId(params.requestId)) throw new Error('Invalid request ID');
  if (typeof params.url !== 'string' || Buffer.byteLength(params.url) > 8192 ||
      /[\x00-\x20\x7f]/.test(params.url)) throw new Error('Invalid URL');
  let url;
  try { url = new URL(params.url); } catch { throw new Error('Invalid URL'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || params.url.includes('#')) {
    throw new Error('Unsupported URL');
  }
  const method = typeof params.method === 'string' ? params.method.toUpperCase() : '';
  if (!ALLOWED_METHODS.has(method)) throw new Error('Invalid DAV method');
  if (params.body !== undefined && (typeof params.body !== 'string' ||
      Buffer.byteLength(params.body) > MAX_BYTES || ['GET', 'HEAD'].includes(method))) {
    throw new Error('Invalid DAV body');
  }
  const headers = {};
  let headerBytes = 0;
  if (params.headers !== undefined) {
    if (!params.headers || typeof params.headers !== 'object' || Array.isArray(params.headers) ||
        Object.keys(params.headers).length > ALLOWED_HEADERS.size) throw new Error('Invalid DAV headers');
    for (const [key, value] of Object.entries(params.headers)) {
      const name = key.toLowerCase();
      if (!ALLOWED_HEADERS.has(name) || name in headers || typeof value !== 'string' ||
          Buffer.byteLength(value) > 8192 || /[\r\n\0]/.test(value)) throw new Error('Invalid DAV headers');
      headerBytes += Buffer.byteLength(key) + Buffer.byteLength(value);
      if (headerBytes > MAX_HEADER_BYTES) throw new Error('DAV headers too large');
      if (name === 'depth' && !['0', '1', 'infinity'].includes(value)) throw new Error('Invalid DAV depth');
      if (name === 'destination') {
        let destination;
        try { destination = new URL(value); } catch { throw new Error('Invalid DAV destination'); }
        if (destination.origin !== url.origin || destination.username || destination.password ||
            value.includes('#') || /[\x00-\x20\x7f]/.test(value)) {
          throw new Error('Invalid DAV destination');
        }
      }
      headers[name] = value;
    }
  }
  const timeoutMs = Number.isFinite(params.timeoutMs)
    ? Math.min(300000, Math.max(1000, Math.trunc(params.timeoutMs))) : 60000;
  return { url: url.href, method, headers, body: params.body, timeoutMs };
}

async function readBody(response, signal) {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;
  // Aborting fetch alone is not sufficient for an already-acquired body reader.
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    if (signal.aborted) throw new Error('DAV aborted');
    const length = response.headers.get('content-length');
    if (length && /^\d+$/.test(length) && Number(length) > MAX_BYTES) throw new Error('DAV response too large');
    while (true) {
      const { done, value } = await reader.read();
      if (signal.aborted) throw new Error('DAV aborted');
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_BYTES) throw new Error('DAV response too large');
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks).toString('utf8');
  } finally {
    signal.removeEventListener('abort', cancel);
    cancel();
    reader.releaseLock();
  }
}

function registerWebdavIpc({ ipcMain, isMainFrame, fetchImpl, getDispatcher = () => undefined }) {
  const owners = new Map();
  const watched = new WeakSet();
  function cancelOwner(sender) {
    const requests = owners.get(sender);
    if (requests) for (const entry of requests.values()) entry.abort(false);
  }
  function watch(sender) {
    if (watched.has(sender)) return;
    watched.add(sender);
    sender.once('destroyed', () => cancelOwner(sender));
    sender.on('render-process-gone', () => cancelOwner(sender));
    sender.on('did-start-navigation', (_event, _url, inPlace, mainFrame) => {
      if (mainFrame && !inPlace) cancelOwner(sender);
    });
  }
  ipcMain.handle('webdav-cancel', (event, requestId) => {
    if (!isMainFrame(event)) return failure('DAV IPC denied');
    if (!validRequestId(requestId)) return failure('Invalid request ID');
    const entry = owners.get(event.sender)?.get(requestId);
    if (!entry || entry.frame !== event.senderFrame) return failure('DAV request not found');
    entry.abort(false);
    return { success: true };
  });
  ipcMain.handle('webdav-request', async (event, params) => {
    if (!isMainFrame(event)) return failure('DAV IPC denied');
    let request;
    try { request = validateRequest(params); } catch (error) { return failure(error.message); }
    const owner = event.sender;
    const requests = owners.get(owner) || new Map();
    if (requests.has(params.requestId)) return failure('Duplicate DAV request ID');
    if (requests.size >= 8) return failure('Too many DAV requests');
    owners.set(owner, requests);
    watch(owner);
    const controller = new AbortController();
    let rejectAbort;
    let timedOut = false;
    const aborted = new Promise((_resolve, reject) => { rejectAbort = reject; });
    const entry = {
      frame: event.senderFrame,
      abort(timeout) {
        if (controller.signal.aborted) return;
        timedOut = timeout;
        controller.abort();
        rejectAbort(new Error('DAV aborted'));
      },
    };
    requests.set(params.requestId, entry);
    const timer = setTimeout(() => entry.abort(true), request.timeoutMs);
    let dispatcher;
    try {
      dispatcher = getDispatcher();
      const result = await Promise.race([aborted, (async () => {
        const response = await fetchImpl(request.url, {
          method: request.method, headers: request.headers,
          ...(request.body !== undefined ? { body: request.body } : {}),
          signal: controller.signal, redirect: 'error',
          ...(dispatcher ? { dispatcher } : {}),
        });
        const body = await readBody(response, controller.signal);
        const headers = {};
        let headerBytes = 0;
        for (const name of ['content-type', 'server', 'dav', 'etag', 'last-modified']) {
          const value = response.headers.get(name);
          if (value) {
            headerBytes += Buffer.byteLength(name) + Buffer.byteLength(value);
            if (headerBytes > MAX_HEADER_BYTES || /[\r\n\0]/.test(value)) throw new Error('Invalid DAV response headers');
            headers[name] = value;
          }
        }
        return { success: true, status: response.status, statusText: response.statusText, body, headers };
      })()]);
      if (controller.signal.aborted || !isMainFrame(event)) return failure('DAV request canceled', { canceled: true });
      return result;
    } catch {
      // Network errors can contain DAV or proxy credentials; return fixed messages only.
      if (controller.signal.aborted) return failure(timedOut ? 'DAV request timed out' : 'DAV request canceled', { timedOut, canceled: !timedOut });
      controller.abort();
      return failure('DAV request failed');
    } finally {
      clearTimeout(timer);
      requests.delete(params.requestId);
      if (!requests.size) owners.delete(owner);
      // A broken proxy teardown must not hold an IPC cancellation/deadline open.
      if (dispatcher) {
        try { void dispatcher.destroy().catch(() => {}); } catch { /* fixed errors only */ }
      }
    }
  });
}

module.exports = { registerWebdavIpc, isTrustedWebdavFrame };
