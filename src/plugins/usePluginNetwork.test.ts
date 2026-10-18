import { webcrypto } from 'node:crypto';
import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isAllowedNetworkTarget } from './networkTargets';
import { parsePermission } from './permissionPolicy';
import { resolvePluginAccountTag } from './pluginAccountTag';
import { readNetworkBody, requestPluginNetwork } from './usePluginNetwork';
import { pluginClient } from './pluginClient';
import { useAppStore } from '../store/useAppStore';
vi.unmock('../store/useAppStore');

const require = createRequire(import.meta.url);
const mainNetwork = require('../../electron/plugins/networkTargets.js');
const mainPermissions = require('../../electron/plugins/permissionPolicy.js');
const session = { pluginId: 'com.example.page', pageId: 'one', sessionToken: 'session', requestId: 'req' };
const args = { host: 'api.github.com', path: '/repos/a/b' };
const token = 'test-secret-only-in-https';

beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto);
  useAppStore.setState({ githubToken: token });
  vi.spyOn(pluginClient, 'requestPageCapability').mockImplementation(async request => ({
    success: true, value: request.networkTicket ? null : { networkTicket: 'ticket' },
  }));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('session-bound network capability', () => {
  it('shares canonical host/query validation with main and prevents users query bypass', () => {
    const vectors = [args, { ...args, path: '/users/a', query: { page: 1 } },
      { ...args, path: '/users/a', query: { token } }, { ...args, path: '/repos/a/..' },
      { ...args, path: '/repos/a/%2f' }, { ...args, query: { page: 101 } }, { ...args, host: 'API.github.com' }];
    for (const vector of vectors) expect(isAllowedNetworkTarget(vector)).toBe(mainNetwork.isAllowedNetworkTarget(vector));
    for (const p of ['storage', 'network:api.github.com', 'network:fetch', 'network:API.github.com', 'network:localhost']) {
      expect(parsePermission(p)).toEqual(mainPermissions.parsePermission(p));
    }
    expect(isAllowedNetworkTarget(vectors[2])).toBe(false);
  });

  it('sends credentials only to HTTPS fetch; completion contains no response or token', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('{"stars":123}'));
    vi.stubGlobal('fetch', fetch);
    const result = await requestPluginNetwork(session, args, () => true, new AbortController().signal);
    expect(result).toEqual({ success: true, value: { status: 200, body: { stars: 123 }, acct: expect.any(String) } });
    expect(fetch).toHaveBeenCalledWith('https://api.github.com/repos/a/b', expect.objectContaining({
      redirect: 'error', credentials: 'omit', headers: expect.objectContaining({ Authorization: `Bearer ${token}` }),
    }));
    expect(pluginClient.requestPageCapability).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(vi.mocked(pluginClient.requestPageCapability).mock.calls)).not.toContain(token);
    expect(JSON.stringify(vi.mocked(pluginClient.requestPageCapability).mock.calls)).not.toContain('stars');
    expect(vi.mocked(pluginClient.requestPageCapability).mock.calls[1][0]).toEqual({ ...session, method: 'network.request', args, networkTicket: 'ticket' });
  });

  it('drops a response if main authorization was revoked during the request', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}')));
    vi.mocked(pluginClient.requestPageCapability).mockResolvedValueOnce({ success: true, value: { networkTicket: 'ticket' } })
      .mockResolvedValueOnce({ success: false, error: { code: 'PLUGIN_PAGE_CLOSED', message: 'closed' } });
    expect(await requestPluginNetwork(session, args, () => true, new AbortController().signal)).toMatchObject({ success: false, error: { code: 'PLUGIN_PAGE_CLOSED' } });
  });

  it.each(['page', 'account'])('cancels a stalled response reader on %s cancellation and releases main reservation', async kind => {
    const cancel = vi.fn();
    let opened!: () => void;
    const ready = new Promise<void>(resolve => { opened = resolve; });
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => { opened(); return new Response(new ReadableStream({ cancel })); }));
    const controller = new AbortController();
    const pending = requestPluginNetwork(session, args, () => true, controller.signal);
    await ready;
    await Promise.resolve();
    if (kind === 'page') controller.abort();
    else { useAppStore.setState({ githubToken: 'other' }); useAppStore.setState({ githubToken: token }); }
    expect(await pending).toMatchObject({ success: false, error: { code: 'PLUGIN_PAGE_CLOSED' } });
    expect(cancel).toHaveBeenCalled();
    expect(pluginClient.requestPageCapability).toHaveBeenCalledTimes(2);
  });

  it('bounds successful/error bodies and closes streams on oversized declarations', async () => {
    const cancel = vi.fn();
    const response = new Response(new ReadableStream({ cancel }), { headers: { 'content-length': '100' } });
    await expect(readNetworkBody(response, 5, new AbortController().signal)).rejects.toThrow(RangeError);
    expect(cancel).toHaveBeenCalled();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('x'.repeat(65 * 1024), { status: 400 })));
    expect(await requestPluginNetwork(session, args, () => true, new AbortController().signal)).toMatchObject({ success: false, error: { code: 'PLUGIN_NETWORK_RESPONSE_TOO_LARGE' } });
  });

  it('uses distinct account namespaces on A-B-A including equal-length credentials', async () => {
    const a = await resolvePluginAccountTag('token-A');
    const b = await resolvePluginAccountTag('token-B');
    expect(a).not.toBe(b);
    expect(await resolvePluginAccountTag('token-A')).toBe(a);
    expect(await resolvePluginAccountTag(null)).toBe('anon');
  });

  it('fails safely into separate opaque namespaces if digest is unavailable', async () => {
    vi.spyOn(crypto.subtle, 'digest').mockRejectedValue(new Error('unavailable'));
    const a = await resolvePluginAccountTag('token-A');
    const b = await resolvePluginAccountTag('token-B');
    expect(a).not.toBe(b);
    expect(a).not.toContain('token-A');
  });
});
