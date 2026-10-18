const assert = require('node:assert/strict');
const test = require('node:test');
const { validatePermission } = require('./permissionPolicy');
const descriptor = require('./permissionPolicy.json');
const schema = require('../../registry/schemas/community-plugin.schema.json');
const { validateRegistryEntry } = require('./pluginRegistrySchema');
const { isAllowedNetworkTarget } = require('./networkTargets');
const { createCapabilityRouter } = require('./capabilityRouter');

test('canonical permission descriptor matches the published schema', () => {
  const fields = schema.items.properties;
  assert.deepEqual(descriptor.basePermissions, fields.permissions.items.anyOf[0].enum);
  assert.equal(`^network:${descriptor.hostPattern.slice(1)}`, fields.permissions.items.anyOf[1].pattern);
  assert.equal(descriptor.hostPattern, fields.networkTargets.items.pattern);
  for (const value of ['network:api.github.com', 'storage']) assert.equal(validatePermission(value), true);
  for (const value of [null, 5, 'network:fetch', 'network:API.github.com', 'network:*.github.com',
    'network:localhost', 'network:127.0.0.1', 'network:api.github.com:443', 'network:api.github.com/', 'network:api.-github.com']) {
    assert.equal(validatePermission(value), false, String(value));
  }
});

test('registry rejects mismatched/duplicate/unknown targets and review/source drift', () => {
  const entry = { id: 'com.example.network', version: '1.0.0', apiVersion: '1', source: 'https://github.com/a/b',
    releaseUrl: 'https://github.com/a/b/releases/download/v1/a.zip', sha256: 'a'.repeat(64),
    permissions: ['network:api.github.com'], networkTargets: ['api.github.com'], dataUsage: 'Public GitHub API metadata only.',
    review: { status: 'approved', date: '2026-10-17', commit: 'b'.repeat(40) } };
  assert.equal(validateRegistryEntry(entry).ok, true);
  for (const extra of [{ networkTargets: [] }, { networkTargets: ['api.github.com', 'api.github.com'] },
    { permissions: ['network:fetch'] }, { permissions: ['storage', 'storage'], networkTargets: [] },
    { source: 'https://github.com/a/b?token=bad' }, { extra: true },
    { review: { ...entry.review, date: '2026-02-30' } }, { review: { ...entry.review, extra: true } }]) {
    assert.equal(validateRegistryEntry({ ...entry, ...extra }).ok, false, JSON.stringify(extra));
  }
});

test('all GitHub paths validate query and reject URL normalization tricks', async () => {
  const allowed = { host: 'api.github.com', path: '/repos/a/b/pulls', query: { state: 'open', page: 1 } };
  assert.equal(isAllowedNetworkTarget(allowed), true);
  assert.equal(isAllowedNetworkTarget({ host: allowed.host, path: '/users/a', query: { page: 1 } }), true);
  for (const args of [{ ...allowed, host: 'API.github.com' }, { ...allowed, body: 'x' },
    ...['/repos/a/../b', '/repos/a/%2e%2e', '/repos/a/b?x=y', '/repos/a/b/', '/repos/a/b/issues', '/users/a/'].map(path => ({ host: allowed.host, path })),
    { host: allowed.host, path: '/users/a', query: { token: 'bad' } },
    { host: allowed.host, path: '/users/a', query: { state: 'open' } },
    { ...allowed, query: { page: '1' } }, { ...allowed, query: { per_page: 101 } }]) {
    assert.equal(isAllowedNetworkTarget(args), false, JSON.stringify(args));
  }
  const router = createCapabilityRouter({});
  await assert.rejects(router.handle([], { capability: 'network', operation: 'request', args: allowed }), { code: 'PLUGIN_PERMISSION_DENIED' });
  assert.equal(await router.handle(['network:api.github.com'], { capability: 'network', operation: 'request', args: allowed }), null);
});
