'use strict';

function parseUrl(value) {
  if (typeof value !== 'string' || value.length > 8192 || /[\x00-\x20\x7f]/.test(value)) return null;
  try { const url = new URL(value); return url.username || url.password ? null : url; }
  catch { return null; }
}

function isTrustedDocument(value, appURL, devURL) {
  const actual = parseUrl(value);
  if (!actual) return false;
  actual.hash = '';
  const app = parseUrl(appURL);
  if (app?.protocol === 'file:' && !app.search) {
    app.hash = '';
    if (!actual.search && actual.href === app.href) return true;
  }
  const dev = parseUrl(devURL);
  return !!dev && dev.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(dev.hostname)
    && !!dev.port && dev.pathname === '/' && !dev.search && !dev.hash
    && actual.protocol === dev.protocol && actual.origin === dev.origin
    && actual.pathname === '/' && !actual.search;
}

function isTrustedMainFrame(event, window, appURL, devURL) {
  try {
    return !!window && !window.isDestroyed() && !window.webContents.isDestroyed()
      && event?.sender === window.webContents && event.senderFrame === window.webContents.mainFrame
      && isTrustedDocument(event.senderFrame.url, appURL, devURL);
  } catch { return false; }
}

function createTrustedIpcMain({ ipcMain, isTrusted }) {
  return {
    handle(channel, handler) {
      ipcMain.handle(channel, (event, ...args) => {
        if (!isTrusted(event)) throw new Error('DESKTOP_IPC_DENIED');
        return handler(event, ...args);
      });
    },
  };
}

function isSafeExternalUrl(value) {
  const url = parseUrl(value);
  return !!url && (['http:', 'https:'].includes(url.protocol) && !!url.hostname
    || url.protocol === 'mailto:' && !!url.pathname);
}

function registerMainDocumentNavigation(webContents, isAllowed, openExternal) {
  const protect = (event, url) => {
    if (isAllowed(url)) return;
    event.preventDefault();
  };
  webContents.on('will-navigate', protect);
  webContents.on('will-frame-navigate', event => { if (event.isMainFrame) protect(event, event.url); });
  // Navigation and redirects never launch external programs; explicit popups do.
  webContents.on('will-redirect', (event, url, _inPlace, isMainFrame) => {
    if (isMainFrame) protect(event, url);
  });
  webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) void Promise.resolve().then(() => openExternal(url)).catch(() => {});
    return { action: 'deny' };
  });
}

module.exports = { isTrustedDocument, isTrustedMainFrame, createTrustedIpcMain, isSafeExternalUrl, registerMainDocumentNavigation };
