import type { Repository } from '../types';

export interface PluginPageSession {
  pluginId: string;
  pluginName: string;
  pageId: string;
  pageTitle: string;
  repository?: Repository;
}

let session: (PluginPageSession & { sessionId: string }) | null = null;
const listeners = new Set<() => void>();
const emit = () => { for (const listener of listeners) listener(); };
function revokeCurrent() {
  const previous = session;
  session = null;
  if (previous && typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('plugin-page:revoke', { detail: previous.pluginId }));
  }
}

export const pluginPageSession = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  },
  getSnapshot: () => session,
  open(next: PluginPageSession) {
    revokeCurrent();
    session = { ...next, sessionId: crypto.randomUUID() };
    emit();
  },
  close() {
    if (!session) return;
    revokeCurrent();
    emit();
  },
};

export const openPluginPage = pluginPageSession.open;
