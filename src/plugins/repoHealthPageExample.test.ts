import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve('examples/plugins/repo-health-page/ui/index.js'), 'utf8');
const html = readFileSync(resolve('examples/plugins/repo-health-page/ui/index.html'), 'utf8');
const pluginId = 'com.example.repo-health-page';
const pageId = 'dashboard';
const pageOrigin = `plugin-page://${pluginId}`;
const hostOrigin = 'http://127.0.0.1:5174';

function fixture() {
  const document = new DOMParser().parseFromString(html, 'text/html');
  const messages: Array<{ data: Record<string, unknown>; target: string }> = [];
  const listeners = new Map<string, (event: Record<string, unknown>) => void>();
  const parent = { postMessage: (data: Record<string, unknown>, target: string) => messages.push({ data, target }) };
  runInNewContext(source, {
    document, window: { parent, location: { origin: pageOrigin },
      addEventListener: (type: string, handler: (event: Record<string, unknown>) => void) => listeners.set(type, handler) },
  });
  function message(data: Record<string, unknown>, overrides = {}) {
    listeners.get('message')?.({ source: parent, origin: hostOrigin, data: { pluginId, pageId, ...data }, ...overrides });
  }
  return { document, messages, message };
}

describe('shipped repository health page bridge', () => {
  it('sends its precise origin and initializes searches through the hardened host contract', async () => {
    const host = fixture();
    host.message({ type: 'plugin-page:init', token: 'session-one' });
    const request = host.messages[0];
    expect(request.target).toBe('*');
    expect(request.data).toMatchObject({
      type: 'plugin-page:request', pluginId, pageId, token: 'session-one',
      origin: pageOrigin, method: 'repositories.search', requestId: '1',
    });
    host.message({ type: 'plugin-page:response', token: 'session-one', requestId: '1', success: true,
      value: [{ full_name: 'fixture/repository', stargazers_count: 42, pushed_at: '2026-10-01' }] });
    await Promise.resolve();
    expect(host.document.querySelector('#results strong')?.textContent).toBe('fixture/repository');
  });

  it('rejects responses with wrong source, host origin, identity, token or request ID', async () => {
    const host = fixture();
    host.message({ type: 'plugin-page:init', token: 'session-one' });
    const response = { type: 'plugin-page:response', token: 'session-one', requestId: '1', success: true, value: [] };
    host.message(response, { source: {} });
    host.message(response, { origin: 'https://hostile.invalid' });
    for (const override of [
      { pluginId: 'other' }, { pageId: 'other' }, { token: 'stale' },
      { requestId: 'unknown' }, { requestId: 1 },
    ]) host.message({ ...response, ...override });
    await Promise.resolve();
    expect(host.document.getElementById('status')?.textContent).toContain('Searching');
    host.message(response);
    await Promise.resolve();
    expect(host.document.getElementById('status')?.textContent).toContain('0 repositories');
  });

  it('replaces the session and drops late responses without replaying request IDs', async () => {
    const host = fixture();
    host.message({ type: 'plugin-page:init', token: 'old' });
    host.message({ type: 'plugin-page:init', token: 'new' });
    expect(host.messages[1].data).toMatchObject({ token: 'new', requestId: '2', origin: pageOrigin });
    host.message({ type: 'plugin-page:response', token: 'old', requestId: '1', success: true, value: [] });
    await Promise.resolve();
    expect(host.document.getElementById('status')?.textContent).toContain('Searching');
    host.message({ type: 'plugin-page:response', token: 'new', requestId: '2', success: true, value: [] });
    await Promise.resolve();
    expect(host.document.getElementById('status')?.textContent).toContain('0 repositories');
  });
});
