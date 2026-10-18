'use strict';

const { randomUUID } = require('node:crypto');
const { protocolError } = require('./pluginProtocol');

function createPageSessions() {
  const sessions = new Map();
  const tickets = new Map();
  const key = (pluginId, pageId) => `${pluginId}:${pageId}`;
  const dispose = id => {
    sessions.delete(id);
    for (const [ticket, item] of tickets) if (item.key === id) {
      clearTimeout(item.timer); item.release(); tickets.delete(ticket);
    }
  };
  return {
    open(pluginId, pageId) {
      dispose(key(pluginId, pageId));
      const token = randomUUID();
      sessions.set(key(pluginId, pageId), { token, seen: new Set(), pending: 0, times: [] });
      return token;
    },
    current({ pluginId, pageId, sessionToken }) {
      return !!sessionToken && sessions.get(key(pluginId, pageId))?.token === sessionToken;
    },
    close(request) {
      if (this.current(request)) dispose(key(request.pluginId, request.pageId));
    },
    revoke(pluginId) {
      for (const id of sessions.keys()) if (!pluginId || id.startsWith(`${pluginId}:`)) dispose(id);
    },
    hold(request, release) {
      const ticket = randomUUID();
      const timer = setTimeout(() => { tickets.delete(ticket); release(); }, 30_000);
      timer.unref?.();
      tickets.set(ticket, { key: key(request.pluginId, request.pageId), token: request.sessionToken,
        requestId: request.requestId, args: JSON.stringify(request.args), release, timer });
      return ticket;
    },
    complete(request) {
      const item = tickets.get(request.networkTicket);
      if (!this.current(request) || !item || item.key !== key(request.pluginId, request.pageId) ||
        item.token !== request.sessionToken || item.requestId !== request.requestId || item.args !== JSON.stringify(request.args)) {
        throw protocolError('PLUGIN_PAGE_CLOSED', 'Network authorization expired');
      }
      tickets.delete(request.networkTicket); clearTimeout(item.timer); item.release();
    },
    acquire(request) {
      if (!this.current(request)) throw protocolError('PLUGIN_PAGE_CLOSED', 'Plugin page session expired');
      if (typeof request.requestId !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(request.requestId)) {
        throw protocolError('PLUGIN_PAGE_REQUEST_INVALID', 'Page request id is invalid');
      }
      const session = sessions.get(key(request.pluginId, request.pageId));
      const now = Date.now();
      session.times = session.times.filter((time) => now - time < 60_000);
      if (session.seen.has(request.requestId) || session.pending >= 8 || session.times.length >= 120 || session.seen.size >= 10_000) {
        throw protocolError('PLUGIN_PAGE_RATE_LIMITED', 'Plugin page request limit exceeded');
      }
      session.seen.add(request.requestId);
      session.times.push(now);
      session.pending++;
      let released = false;
      return () => { if (!released) { released = true; session.pending--; } };
    },
  };
}

module.exports = { createPageSessions };
