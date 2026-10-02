'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  readClipboardSnapshot, sameClipboardSnapshot, canRestoreClipboardSnapshot, restoreClipboardSnapshot,
} = require('./fixtures/clipboardSnapshot.cjs');

const rawToken = 'electron application/osclipboard;format="Chromium internal source RFH token"';
const rawURL = 'electron application/osclipboard;format="Chromium internal source URL"';
class Item {
  constructor(data) { this.data = data; this.types = Object.keys(data); }
  async getType(type) { return this.data[type]; }
}
function item(data) {
  return new Item(Object.fromEntries(Object.entries(data).map(([type, bytes]) =>
    [type, new Blob([bytes], { type })])));
}
function fixture(initial) {
  let current = initial;
  let writes = 0;
  let clears = 0;
  return {
    api: { ClipboardItem: Item, clipboard: {
      read: async () => current,
      write: async (items) => { writes++; current = items; },
      clear: async () => { clears++; current = []; },
    } },
    set: (items) => { current = items; },
    counts: () => ({ writes, clears }),
  };
}

test('native fixture accepts standard MIME and exactly the two trusted native raw formats', async () => {
  const host = fixture([item({
    'text/plain': 'fixture', 'text/html': '<b>fixture</b>', 'text/rtf': '{\\rtf1 fixture}',
    'image/png': Buffer.from([0, 1, 2]), [rawToken]: Buffer.from([0, 255]), [rawURL]: 'fixture source',
  })]);
  const snapshot = await readClipboardSnapshot(host.api);
  assert.ok(canRestoreClipboardSnapshot(snapshot));
  host.set([item({ 'electron application/osclipboard;format="unknown proprietary"': 'opaque' })]);
  assert.equal(canRestoreClipboardSnapshot(await readClipboardSnapshot(host.api)), false);
  assert.deepEqual(host.counts(), { writes: 0, clears: 0 });
});

test('byte comparisons cover HTML, raw types and all items, not only plain text or pixels', async () => {
  const host = fixture([item({ 'text/plain': 'same', 'text/html': '<b>a</b>', [rawToken]: 'a' }), item({ 'text/rtf': 'second' })]);
  const original = await readClipboardSnapshot(host.api);
  for (const changed of [
    [item({ 'text/plain': 'same', 'text/html': '<b>b</b>', [rawToken]: 'a' }), item({ 'text/rtf': 'second' })],
    [item({ 'text/plain': 'same', 'text/html': '<b>a</b>', [rawToken]: 'b' }), item({ 'text/rtf': 'second' })],
    [item({ 'text/plain': 'same', 'text/html': '<b>a</b>', [rawToken]: 'a' })],
    [item({ 'text/plain': 'same', 'text/html': '<b>a</b>', [rawToken]: 'a' }), item({ 'text/rtf': 'changed' })],
  ]) {
    host.set(changed);
    assert.equal(sameClipboardSnapshot(await readClipboardSnapshot(host.api), original), false);
  }
});

test('restores every original item/type byte and never persists or prints fingerprints', async () => {
  const host = fixture([item({ 'text/plain': 'original', 'text/html': '<b>original</b>', [rawToken]: 'token', [rawURL]: 'source' }),
    item({ 'text/rtf': 'second item' })]);
  const original = await readClipboardSnapshot(host.api);
  host.set([item({ 'text/plain': 'temporary fixture' })]);
  const owned = await readClipboardSnapshot(host.api);
  assert.equal(await restoreClipboardSnapshot({ clipboard: host.api, original, owned }), true);
  assert.ok(sameClipboardSnapshot(await readClipboardSnapshot(host.api), original));
  assert.deepEqual(host.counts(), { writes: 1, clears: 0 });
});

test('concurrent changes to any raw or HTML bytes prevent restore writes and clears', async () => {
  const host = fixture([item({ 'text/plain': 'original' })]);
  const original = await readClipboardSnapshot(host.api);
  host.set([item({ 'text/plain': 'temporary', [rawToken]: 'owned' })]);
  const owned = await readClipboardSnapshot(host.api);
  host.set([item({ 'text/plain': 'temporary', [rawToken]: 'new user value' })]);
  assert.equal(await restoreClipboardSnapshot({ clipboard: host.api, original, owned }), false);
  assert.deepEqual(host.counts(), { writes: 0, clears: 0 });
});

test('unreadable native payloads abort before any mutation', async () => {
  const host = fixture([{ types: [rawToken], getType: async () => ({ notBlob: true }) }]);
  await assert.rejects(readClipboardSnapshot(host.api), /non-Blob/);
  assert.deepEqual(host.counts(), { writes: 0, clears: 0 });
});
