'use strict';

const { PAGE_SCHEME } = require('./pluginPage');

function isTrustedPluginFrame(event, window, hostURL, devURL) {
  try {
    if (!window || window.isDestroyed() || window.webContents.isDestroyed() ||
      event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) return false;
    const actual = new URL(event.senderFrame.url);
    if (actual.username || actual.password) return false;
    if (devURL !== undefined) {
      const expected = new URL(devURL);
      return ['http:', 'https:'].includes(expected.protocol) &&
        ['localhost', '127.0.0.1', '[::1]'].includes(expected.hostname) &&
        !expected.username && !expected.password && actual.protocol === expected.protocol &&
        actual.origin === expected.origin;
    }
    const expected = new URL(hostURL);
    if (expected.protocol !== 'file:' || actual.protocol !== 'file:' || expected.search || actual.search) return false;
    actual.hash = '';
    expected.hash = '';
    return actual.href === expected.href;
  } catch {
    return false;
  }
}

function createPluginIpcRegistrar({ ipcMain, getWindow, getHostURL, getDevURL = () => undefined, isNavigating = () => false }) {
  return (channel, handler, denied = {
    success: false, error: { code: 'PLUGIN_IPC_DENIED', message: 'Plugin IPC requires the trusted host document' },
  }) => {
    if (!channel.startsWith('plugins:')) throw new Error('Plugin registrar accepts only plugins: channels');
    ipcMain.handle(channel, (event, ...args) => {
      if (isNavigating() || !isTrustedPluginFrame(event, getWindow(), getHostURL(), getDevURL())) return denied;
      return handler(event, ...args);
    });
  };
}

function registerPluginPageNavigation(webContents, getManager) {
  let navigating = false;
  function revoke(event, _url, isInPlace, isMainFrame) {
    if (event.defaultPrevented) return;
    const sameDocument = event.isSameDocument ?? isInPlace;
    const mainFrame = event.isMainFrame ?? isMainFrame;
    if (sameDocument) return;
    if (mainFrame) {
      navigating = true;
      getManager()?.revokePageSessions();
      return;
    }
    // Revoke the OLD document, never the about:blank -> initial page session.
    try {
      const previous = new URL(event.frame?.url);
      if (previous.protocol === `${PAGE_SCHEME}:`) getManager()?.revokePageSessions(previous.hostname);
    } catch {
      // Blank or already-detached frames have no plugin session to revoke.
    }
  }
  function revokeAll() {
    navigating = true;
    getManager()?.revokePageSessions();
  }
  webContents.on('did-start-navigation', revoke);
  webContents.on('will-frame-navigate', revoke);
  webContents.on('dom-ready', () => { navigating = false; });
  webContents.on('render-process-gone', revokeAll);
  webContents.once('destroyed', revokeAll);
  return { isNavigating: () => navigating };
}

module.exports = { isTrustedPluginFrame, createPluginIpcRegistrar, registerPluginPageNavigation };
