const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createAgyCallRegistry } = require('./agyCallRegistry');
const secure = { isEncryptionAvailable: () => true, encryptString: text => Buffer.from(text).reverse(), decryptString: bytes => Buffer.from(bytes).reverse().toString() };
async function fixture(t, options = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'gsm-agy-ledger-test-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return { directory, registry: createAgyCallRegistry({ directory, safeStorage: secure, ...options }) };
}
const input = { system: 'private-prompt-sentinel', user: 'evidence', profile: 'fingerprint:model:medium:text-v1', taskId: 'task', itemId: 'repo', context: { readme: 'original evidence' } };

test('a sent capacity failure remains unknown and cannot dispatch again under the same id', async t => {
  const { registry } = await fixture(t);
  await registry.reserve('42', 'capacity', input);
  await registry.sent('42', 'capacity');
  await registry.fail('42', 'capacity', 'SERVICE_UNAVAILABLE');
  const saved = await registry.read('42', 'capacity');
  assert.equal(saved.record.providerOutcome, 'unknown');
  assert.equal(saved.record.failureCode, 'SERVICE_UNAVAILABLE');
  assert.equal(saved.result, undefined);
  assert.equal((await registry.reserve('42', 'capacity', input)).existing, true);
});
test('intent and terminal survive restart; duplicate ids never become fresh dispatches', async t => {
  const { directory, registry } = await fixture(t);
  assert.equal((await registry.reserve('42', 'req', input)).existing, false);
  await registry.sent('42', 'req');
  await registry.succeed('42', 'req', { text: 'private-result-sentinel', usage: {} });
  const restarted = createAgyCallRegistry({ directory, safeStorage: secure });
  assert.equal((await restarted.list('42')).records[0].providerOutcome, 'succeeded');
  assert.equal((await restarted.reserve('42', 'req', input)).existing, true);
  const result = await restarted.read('42', 'req');
  assert.equal(result.result.text, 'private-result-sentinel');
  assert.equal(result.context.readme, 'original evidence');
  await assert.rejects(registry.ack('42', 'req', 'bad'), /RESULT_MISMATCH/);
  await restarted.ack('42', 'req', result.record.resultDigest);
  assert.equal((await registry.read('42', 'req')).result, undefined);
  const files = await fs.readdir(directory);
  const text = await fs.readFile(path.join(directory, files.find(name => name.endsWith('.json'))), 'utf8');
  assert.equal(text.includes('private-prompt-sentinel'), false);
  assert.equal(text.includes('private-result-sentinel'), false);
  assert.equal((await restarted.list('43')).records.length, 0);
});
test('concurrent reservations count towards quota; ack/discard release body space only', async t => {
  const { registry } = await fixture(t, { maxBytes: 20000, reservationBytes: 12000 });
  const results = await Promise.allSettled(['a', 'b'].map(id => registry.reserve('42', id, input)));
  assert.equal(results.filter(row => row.status === 'fulfilled').length, 1);
  assert.match(results.find(row => row.status === 'rejected').reason.message, /RECOVERY_STORAGE_FULL/);
  const id = results[0].status === 'fulfilled' ? 'a' : 'b';
  await registry.discard('42', id);
  assert.equal((await registry.reserve('42', 'c', input)).existing, false);
  assert.equal((await registry.list('42')).records.find(row => row.requestId === id).receipt, 'discarded');
});
test('unavailable encryption and failed intent never allow dispatch; corrupt records stay blocked', async t => {
  const { directory, registry } = await fixture(t, { safeStorage: { isEncryptionAvailable: () => false } });
  await assert.rejects(registry.reserve('42', 'req', input), /RECOVERY_ENCRYPTION_UNAVAILABLE/);
  const encrypted = createAgyCallRegistry({ directory, safeStorage: secure });
  await encrypted.reserve('42', 'req', input);
  const file = (await fs.readdir(directory)).find(name => name.endsWith('.json'));
  await fs.writeFile(path.join(directory, file), '{corrupt');
  assert.equal((await encrypted.list('42')).errors.length, 1);
  await assert.rejects(encrypted.reserve('42', 'req', input), /RECOVERY_RECORD_CORRUPT/);
});

test('explicit repair safely discards only corrupt records that prove they were never sent', async t => {
  const { directory, registry } = await fixture(t);
  await registry.reserve('42', 'req', input);
  const file = (await fs.readdir(directory)).find(name => name.endsWith('.json'));
  const row = JSON.parse(await fs.readFile(path.join(directory, file), 'utf8'));
  await fs.writeFile(path.join(directory, file), JSON.stringify({ ...row, version: 99 }));
  const issue = (await registry.list('42')).errors[0];
  assert.deepEqual(issue, {
    requestId: 'req', code: 'RECOVERY_RECORD_CORRUPT', certainty: 'definitely-unsent',
    dispatch: 'prepared', providerOutcome: 'not_started', createdAt: row.createdAt,
  });
  await registry.repair('42', 'req', 'discard-unsent');
  assert.equal((await registry.reserve('42', 'req', input)).existing, false);
  assert.ok((await fs.readdir(directory)).some(name => name.includes('.corrupt.discarded-unsent-')));
});

test('corrupt sent or unreadable records stay blocked until unknown outcome is explicitly abandoned', async t => {
  const { directory, registry } = await fixture(t);
  await registry.reserve('42', 'sent', input); await registry.sent('42', 'sent');
  const file = (await fs.readdir(directory)).find(name => name.endsWith('.json'));
  const row = JSON.parse(await fs.readFile(path.join(directory, file), 'utf8'));
  await fs.writeFile(path.join(directory, file), JSON.stringify({ ...row, version: 99 }));
  const issue = (await registry.list('42')).errors[0];
  assert.equal(issue.certainty, 'unknown');
  assert.equal(issue.dispatch, 'sent');
  await assert.rejects(registry.repair('42', 'sent', 'discard-unsent'), /RECOVERY_REPAIR_CONFIRMATION_REQUIRED/);
  await assert.rejects(registry.reserve('42', 'other', input), /RECOVERY_RECORD_CORRUPT/);
  await registry.repair('42', 'sent', 'abandon-unknown');
  await registry.reserve('42', 'other', input);
  assert.ok((await fs.readdir(directory)).some(name => name.includes('.corrupt.abandoned-unknown-')));
});

test('repairing one corrupt record leaves unrelated recovery records intact', async t => {
  const { directory, registry } = await fixture(t);
  await registry.reserve('42', 'good', input);
  await registry.reserve('42', 'bad', { ...input, itemId: 'bad' });
  const file = (await fs.readdir(directory)).find(name => name.endsWith('-bad.json'));
  const row = JSON.parse(await fs.readFile(path.join(directory, file), 'utf8'));
  await fs.writeFile(path.join(directory, file), JSON.stringify({ ...row, version: 99 }));
  await registry.list('42');
  await registry.repair('42', 'bad', 'discard-unsent');
  const listed = await registry.list('42');
  assert.deepEqual(listed.errors, []);
  assert.deepEqual(listed.records.map(record => record.requestId), ['good']);
});

test('success and staged commits retain quota until an idempotent consumption receipt', async t => {
  const { directory, registry } = await fixture(t, { maxBytes: 20000, reservationBytes: 12000 });
  await registry.reserve('42', 'one', input); await registry.sent('42', 'one');
  await registry.succeed('42', 'one', { text: 'generated', usage: {} });
  const saved = await registry.read('42', 'one');
  await registry.stage('42', 'one', saved.record.resultDigest, { kind: 'fixture', state: 'pending' });
  await assert.rejects(registry.reserve('42', 'two', input), /RECOVERY_STORAGE_FULL/);
  const restarted = createAgyCallRegistry({ directory, safeStorage: secure, maxBytes: 20000, reservationBytes: 12000 });
  assert.deepEqual((await restarted.read('42', 'one')).commit, { kind: 'fixture', state: 'pending' });
  await restarted.ack('42', 'one', saved.record.resultDigest);
  await restarted.ack('42', 'one', saved.record.resultDigest);
  await restarted.reserve('42', 'two', input);
  assert.equal((await restarted.read('42', 'one')).result, undefined);
});

test('restart releases abandoned in-flight reservations without dropping evidence or retrying calls', async t => {
  const { directory, registry } = await fixture(t, { maxBytes: 20000, reservationBytes: 12000 });
  await registry.reserve('42', 'interrupted', input); await registry.sent('42', 'interrupted');
  await assert.rejects(registry.reserve('42', 'blocked-live', input), /RECOVERY_STORAGE_FULL/);
  const restarted = createAgyCallRegistry({ directory, safeStorage: secure, maxBytes: 20000, reservationBytes: 12000 });
  await restarted.reserve('42', 'new-request', input);
  const saved = await restarted.read('42', 'interrupted');
  assert.equal(saved.record.providerOutcome, 'unknown');
  assert.equal(saved.context.readme, 'original evidence');
  assert.ok(saved.record.bytes < 12000);
  assert.equal((await restarted.reserve('42', 'interrupted', input)).existing, true);
});

test('restart preserves successful unconsumed results and releases only unsent abandoned reservations', async t => {
  const { directory, registry } = await fixture(t, { maxBytes: 30000, reservationBytes: 12000 });
  await registry.reserve('42', 'success', input); await registry.sent('42', 'success');
  await registry.succeed('42', 'success', { text: 'keep this result', usage: {} });
  await registry.reserve('42', 'unsent', input);
  const restarted = createAgyCallRegistry({ directory, safeStorage: secure, maxBytes: 30000, reservationBytes: 12000 });
  await restarted.reserve('42', 'fresh', input);
  const saved = await restarted.read('42', 'success'); assert.equal(saved.result.text, 'keep this result'); assert.equal(saved.record.bytes, 12000);
  const unsent = await restarted.read('42', 'unsent'); assert.equal(unsent.record.providerOutcome, 'not_started'); assert.ok(unsent.record.bytes < 12000);
  await restarted.sent('42', 'fresh');
  await restarted.list('42');
  assert.equal((await restarted.read('42', 'fresh')).record.bytes, 12000);
});

test('default quota recovers from five interrupted calls plus one unconsumed result', async t => {
  const { directory, registry } = await fixture(t);
  for (let index = 0; index < 5; index++) { await registry.reserve('42', `old-${index}`, input); await registry.sent('42', `old-${index}`); }
  await registry.reserve('42', 'retained', input); await registry.sent('42', 'retained'); await registry.succeed('42', 'retained', { text: 'preserve paid result', usage: {} });
  await assert.rejects(registry.reserve('42', 'project-map', input), /RECOVERY_STORAGE_FULL/);
  const restarted = createAgyCallRegistry({ directory, safeStorage: secure });
  await restarted.reserve('42', 'project-map', input); await restarted.sent('42', 'project-map');
  await restarted.succeed('42', 'project-map', { text: '{"projects":[]}', usage: {} });
  const result = await restarted.read('42', 'project-map'); await restarted.ack('42', 'project-map', result.record.resultDigest);
  assert.equal((await restarted.read('42', 'retained')).result.text, 'preserve paid result');
  assert.equal((await restarted.list('42')).records.filter(row => row.providerOutcome === 'unknown').length, 5);
});
