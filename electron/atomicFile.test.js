'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { writeFileAtomicSync } = require('./atomicFile');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gsm-atomic-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const filename = path.join(root, 'state.json');
  fs.writeFileSync(filename, 'previous');
  return { root, filename };
}

test('a transient destination lock preserves the previous file until replacement succeeds', t => {
  const { root, filename } = fixture(t);
  let attempts = 0;
  const waits = [];
  writeFileAtomicSync(filename, Buffer.from('current'), { platform: 'win32', wait: ms => waits.push(ms),
    fileSystem: { ...fs, renameSync(from, to) {
      if (++attempts <= 2) {
        assert.equal(fs.readFileSync(to, 'utf8'), 'previous');
        throw Object.assign(new Error('locked'), { code: 'EBUSY' });
      }
      fs.renameSync(from, to);
    } },
  });
  assert.deepEqual(waits, [10, 20]);
  assert.equal(fs.readFileSync(filename, 'utf8'), 'current');
  assert.deepEqual(fs.readdirSync(root), ['state.json']);
});

for (const [platform, code, attemptsExpected] of [['win32', 'EPERM', 5], ['win32', 'ENOSPC', 1], ['linux', 'EACCES', 1]]) {
  test(`failed replacement preserves durable state and cleans temporary files (${platform}/${code})`, t => {
    const { root, filename } = fixture(t);
    let attempts = 0;
    assert.throws(() => writeFileAtomicSync(filename, 'current', { platform, wait() {}, fileSystem: {
      ...fs, renameSync() { attempts++; throw Object.assign(new Error('blocked'), { code }); },
    } }), { code });
    assert.equal(attempts, attemptsExpected);
    assert.equal(fs.readFileSync(filename, 'utf8'), 'previous');
    assert.deepEqual(fs.readdirSync(root), ['state.json']);
  });
}

test('a failed temporary write cannot change the destination', t => {
  const { root, filename } = fixture(t);
  assert.throws(() => writeFileAtomicSync(filename, 'current', { fileSystem: {
    ...fs, writeFileSync() { throw Object.assign(new Error('full'), { code: 'ENOSPC' }); },
  } }), { code: 'ENOSPC' });
  assert.equal(fs.readFileSync(filename, 'utf8'), 'previous');
  assert.deepEqual(fs.readdirSync(root), ['state.json']);
});
