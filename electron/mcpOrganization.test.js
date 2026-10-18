const test = require('node:test');
const assert = require('node:assert/strict');
const { organizationToolDefinitions, createOrganizationBroker } = require('./mcpOrganization');
const { createMcpLocalServer } = require('./mcpLocalServer');

test('organization tools expose drafts but no apply, star, or arbitrary URL capability', () => {
  assert.equal(organizationToolDefinitions.length, 8);
  assert.ok(organizationToolDefinitions.every(tool => !/(?:^|_)(apply|star|unstar|delete)(?:_|$)/.test(tool.name)));
  assert.equal(organizationToolDefinitions.find(tool => tool.name === 'gsm_organization_edit').inputSchema.additionalProperties, false);
});
test('broker binds replies to the original window and bounds disconnected requests', async () => {
  let sent;
  const sender = { isDestroyed: () => false, send: (_channel, request) => { sent = request; } };
  const broker = createOrganizationBroker(() => ({ isDestroyed: () => false, webContents: sender }), 20);
  const request = broker.request('gsm_organization_overview', {}, '42');
  assert.equal(broker.reply({}, sent.requestId, { secret: true }), false);
  assert.equal(broker.reply(sender, sent.requestId, { ownerId: '42' }), true);
  assert.deepEqual(await request, { ownerId: '42' });
  const expired = await broker.request('gsm_organization_overview', {}, '42'); assert.equal(expired.error.code, 'GSM_REQUEST_TIMEOUT');
  const pending = broker.request('gsm_organization_overview', {}, '42'); broker.stop(); assert.equal((await pending).error.code, 'GSM_DISCONNECTED');
});
test('listener status describes its actual address, not a new unbound configuration', async () => {
  const config = { enabled: true, host: '127.0.0.1', port: 41000 + Math.floor(Math.random() * 10000), token: 'fixture' };
  const server = createMcpLocalServer(() => ({ config, snapshot: {} }));
  try {
    const starting = server.start(); assert.equal(server.getStatus().running, false);
    const started = await starting; config.port += 1;
    assert.equal(server.getStatus().url, started.url);
    assert.equal(server.getStatus().running, true);
  } finally { await server.stop(); }
  assert.equal(server.getStatus().running, false);
});
test('authenticated HTTP requests reach the organization bridge in backend-connected mode', async () => {
  const port = 41000 + Math.floor(Math.random() * 10000);
  const calls = [];
  const server = createMcpLocalServer(() => ({ config: { enabled: true, host: '0.0.0.0', port, token: 'fixture-token' }, snapshot: { ownerId: '42', repositories: [], customCategories: [] } }), async (...args) => { calls.push(args); return { ownerId: '42', draftOnly: true }; });
  try {
    const started = await server.start(); assert.match(started.url, /127\.0\.0\.1/);
    const rpc = (method, params) => fetch(started.url, { method: 'POST', headers: { Authorization: 'Bearer fixture-token', 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) }).then(response => response.json());
    const listed = await rpc('tools/list'); assert.ok(listed.result.tools.some(tool => tool.name === 'gsm_organization_start'));
    const response = await rpc('tools/call', { name: 'gsm_organization_overview', arguments: {} });
    assert.deepEqual(calls[0], ['gsm_organization_overview', {}, '42']); assert.equal(JSON.parse(response.result.content[0].text).draftOnly, true);
    const denied = await fetch(started.url, { method: 'POST', body: '{}' }); assert.equal(denied.status, 401);
  } finally { await server.stop(); }
});
