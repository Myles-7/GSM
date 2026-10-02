import { afterEach, describe, expect, it, vi } from 'vitest';
import { openPluginPage, pluginPageSession } from './pluginPageSession';

afterEach(() => { pluginPageSession.close(); vi.restoreAllMocks(); });
describe('App-level plugin modal session', () => {
  it('survives card ownership, replaces sessions, and synchronously signals revocation on close', () => {
    const listener = vi.fn();
    const off = pluginPageSession.subscribe(listener);
    const revoked = vi.fn();
    window.addEventListener('plugin-page:revoke', revoked);
    const next = { pluginId: 'com.example.page', pluginName: 'Example', pageId: 'one', pageTitle: 'One' };
    openPluginPage(next);
    const first = pluginPageSession.getSnapshot()!.sessionId;
    openPluginPage(next);
    expect(pluginPageSession.getSnapshot()!.sessionId).not.toBe(first);
    expect(revoked).toHaveBeenCalledTimes(1);
    pluginPageSession.close();
    expect(revoked).toHaveBeenCalledTimes(2);
    expect(pluginPageSession.getSnapshot()).toBeNull();
    expect(listener).toHaveBeenCalledTimes(3);
    off();
    window.removeEventListener('plugin-page:revoke', revoked);
  });
});
