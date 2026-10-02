function registerAgyIpc({ ipcMain, isMainFrame, getService }) {
  const sessions = new Map();
  const inFlight = new Map();
  const operations = ['detect', 'choose', 'save', 'listModels', 'probe'];
  ipcMain.handle('agy:getState', event => {
    if (!isMainFrame(event)) throw new Error('AGY_IPC_DENIED');
    return getService().getState();
  });
  for (const operation of operations) {
    ipcMain.handle(`agy:${operation}`, (event, requestId, prefs) => {
      if (!isMainFrame(event)) return { ok: false, code: 'IPC_DENIED' };
      return getService()[operation](event.sender.id, requestId, ...(['save', 'probe'].includes(operation) ? [prefs] : []));
    });
  }
  ipcMain.handle('agy:cancel', (event, requestId) => {
    if (!isMainFrame(event) || typeof requestId !== 'string') return;
    const pending = inFlight.get(`${event.sender.id}:${requestId}`);
    if (pending) pending.canceled = true;
    getService().cancel(event.sender.id, requestId);
  });
  ipcMain.handle('agy:setSession', (event, session) => {
    if (!isMainFrame(event) || typeof session !== 'string' || !/^[\w-]{1,80}$/.test(session)) throw new Error('AGY_IPC_DENIED');
    const owner = event.sender.id;
    if (sessions.get(owner) !== session) {
      getService().cancel(owner);
      if (!sessions.has(owner)) event.sender.once('destroyed', () => { getService().cancel(owner); sessions.delete(owner); });
      sessions.set(owner, session);
    }
  });
  ipcMain.handle('agy:start', async (event, id, session, request) => {
    if (!isMainFrame(event) || !session || sessions.get(event.sender.id) !== session) return { ok: false, code: 'SESSION_CHANGED' };
    const key = `${event.sender.id}:${id}`;
    if (inFlight.has(key)) return { ok: false, code: 'DUPLICATE_REQUEST' };
    const token = { canceled: false };
    inFlight.set(key, token);
    const isCurrent = () => !token.canceled && !event.sender.isDestroyed() && sessions.get(event.sender.id) === session;
    try {
      const result = await getService().generate(event.sender.id, id, request, update => {
        if (isCurrent()) event.sender.send('agy:event', { ...update, requestId: id, session });
      }, isCurrent);
      return isCurrent() ? result : { ok: false, code: 'SESSION_CHANGED' };
    } finally { inFlight.delete(key); }
  });
  for (const operation of ['chooseProject', 'readProject', 'revokeProject']) {
    ipcMain.handle(`agy:${operation}`, (event, ...args) => {
      if (!isMainFrame(event)) return { ok: false, code: 'IPC_DENIED' };
      return getService()[operation](event.sender.id, ...args);
    });
  }
}

module.exports = { registerAgyIpc };
