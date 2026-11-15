const { performance } = require('node:perf_hooks');

function hideWindowToTray(window, platform = process.platform) {
  if (!window || window.isDestroyed()) return;
  // A hidden, minimized Windows window can become visible without waking its
  // compositor. Clear the minimized state before parking it in the tray.
  if (platform === 'win32' && window.isMinimized()) window.restore();
  window.hide();
}

function minimizeWindowToTray(window, shouldHide, platform = process.platform, schedule = setImmediate) {
  if (!shouldHide()) return;
  if (platform !== 'win32') {
    hideWindowToTray(window, platform);
    return;
  }
  // Leave the native minimize event before changing the window's state.
  schedule(() => {
    if (!window.isDestroyed() && window.isMinimized() && shouldHide()) {
      hideWindowToTray(window, platform);
    }
  });
}

function restoreWindowFromTray(window, platform = process.platform) {
  if (window.isMinimized()) window.restore();
  // restore() can report visible before Chromium runs the content show path.
  if (platform === 'win32' || !window.isVisible()) window.show();
  window.focus();
}

const FRAME_PROBE = 'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))';
const WAKE_COOLDOWN_MS = 60_000;
const BUSY_RENDERER_CPU_PERCENT = 20;

/** Recover a focused Windows compositor without reloading the live document. */
function installWindowPaintRecovery({
  window, isTrusted, sampleRendererCpu, recordWake,
  now = () => performance.now(), schedule = setTimeout, cancel = clearTimeout,
}) {
  const contents = window.webContents;
  let probeToken = null;
  let startTimer = null;
  let lastWake = -Infinity;
  let responsive = true;
  const canProbe = () => responsive && !window.isDestroyed() && window.isVisible()
    && !window.isMinimized() && window.isFocused() && !contents.isDestroyed()
    && !contents.isCrashed() && !contents.isLoadingMainFrame() && isTrusted(contents.getURL());

  const cancelProbe = () => {
    if (startTimer !== null) cancel(startTimer);
    if (probeToken) cancel(probeToken.timer);
    startTimer = null;
    probeToken = null;
  };

  const probe = () => {
    startTimer = null;
    if (probeToken || now() - lastWake < WAKE_COOLDOWN_MS || !canProbe()) return;
    const url = contents.getURL();
    const token = { timer: null };
    probeToken = token;
    sampleRendererCpu(contents);
    token.timer = schedule(() => {
      if (probeToken !== token) return;
      probeToken = null;
      if (!canProbe() || contents.getURL() !== url) return;
      const cpu = sampleRendererCpu(contents);
      if (cpu !== null && cpu >= BUSY_RENDERER_CPU_PERCENT) return;

      lastWake = now();
      try {
        window.hide();
        restoreWindowFromTray(window);
        recordWake();
      } catch { /* Preserve the existing crash and unresponsive handling. */ }
    }, 5_000);
    const settle = () => {
      if (probeToken === token) probeToken = null;
      cancel(token.timer);
    };
    try {
      contents.invalidate();
      // A frame subscription can crash the GPU process during resize. A
      // requestAnimationFrame probe only verifies that frames resume.
      contents.executeJavaScript(FRAME_PROBE, false).then(settle, settle);
    } catch {
      settle();
    }
  };

  const queueProbe = () => {
    if (startTimer === null && !probeToken && now() - lastWake >= WAKE_COOLDOWN_MS) {
      startTimer = schedule(probe, 250);
    }
  };
  for (const event of ['show', 'restore', 'focus']) window.on(event, queueProbe);
  for (const event of ['hide', 'blur', 'minimize']) window.on(event, cancelProbe);
  contents.on('did-finish-load', queueProbe);
  contents.on('did-start-navigation', (_event, _url, sameDocument, mainFrame) => {
    if (mainFrame && !sameDocument) cancelProbe();
  });
  window.on('unresponsive', () => { responsive = false; cancelProbe(); });
  window.on('responsive', () => { responsive = true; queueProbe(); });
  window.once('closed', cancelProbe);
}

module.exports = { hideWindowToTray, minimizeWindowToTray, restoreWindowFromTray, installWindowPaintRecovery };
