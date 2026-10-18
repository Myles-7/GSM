function registerAgyIpc({ ipcMain, isMainFrame, getService }) {
  const sessions = new Map();
  const bindings = new Map();
  const inFlight = new Map();
  const operations = ['detect', 'choose', 'save', 'listModels', 'probe', 'recover'];
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
  ipcMain.handle('agy:setSession', (event, session, account) => {
    if (!isMainFrame(event) || typeof session !== 'string' || !/^[\w-]{1,80}$/.test(session)) throw new Error('AGY_IPC_DENIED');
    if (account !== undefined && (typeof account !== 'string' || !/^[\w-]{1,80}$/.test(account))) throw new Error('AGY_IPC_DENIED');
    const owner = event.sender.id;
    if (sessions.get(owner) === session && bindings.get(owner) !== account) throw new Error('AGY_SESSION_BINDING_CHANGED');
    if (sessions.get(owner) !== session) {
      getService().cancel(owner);
      if (!sessions.has(owner)) event.sender.once('destroyed', () => { getService().cancel(owner); getService().setAccount(owner, undefined); sessions.delete(owner); bindings.delete(owner); });
      sessions.set(owner, session);
    }
    getService().setAccount(owner, account);
    bindings.set(owner, account);
  });
  for (const operation of ['recoveryList', 'recoveryRead', 'recoveryAck', 'recoveryStage', 'recoveryDiscard', 'recoveryRepair']) {
    ipcMain.handle(`agy:${operation}`, async (event, session, ...args) => {
      if (!isMainFrame(event) || sessions.get(event.sender.id) !== session || !session) return { ok: false, code: 'SESSION_CHANGED' };
      try {
        const value = await getService()[operation](event.sender.id, ...args);
        if (!isMainFrame(event) || event.sender.isDestroyed() || sessions.get(event.sender.id) !== session) return { ok: false, code: 'SESSION_CHANGED' };
        return { ok: true, value };
      } catch (error) { return { ok: false, code: /^[A-Z_]+$/.test(error.code) ? error.code : 'RECOVERY_IO_FAILED' }; }
    });
  }
  ipcMain.handle('agy:start', async (event, id, session, request) => {
    if (!isMainFrame(event) || !session || sessions.get(event.sender.id) !== session) return { ok: false, code: 'SESSION_CHANGED' };
    const key = `${event.sender.id}:${id}`;
    if (inFlight.has(key)) return { ok: false, code: 'DUPLICATE_REQUEST' };
    const token = { canceled: false };
    inFlight.set(key, token);
    const isCurrent = () => !token.canceled && isMainFrame(event) && !event.sender.isDestroyed() && sessions.get(event.sender.id) === session;
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
