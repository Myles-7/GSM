const test = require('node:test');
const assert = require('node:assert/strict');
const { AgyQueue } = require('./agyQueue');
const { AgyError } = require('./agyProtocol');

test('enforces global and feature caps across owners without head-of-line blocking', async () => {
  const queue = new AgyQueue(5);
  queue.configure(5, { summary: 1, details: 2 });
  const releases = [];
  const work = () => new Promise(resolve => releases.push(resolve));
  const requests = [
    queue.run(1, 's1', work, { feature: 'summary', maxQueued: 10 }),
    queue.run(2, 's2', work, { feature: 'summary', maxQueued: 10 }),
    ...Array.from({ length: 3 }, (_, i) => queue.run(2, `d${i}`, work, { feature: 'details', maxQueued: 10 })),
    ...Array.from({ length: 2 }, (_, i) => queue.run(3, `o${i}`, work, { maxQueued: 10 })),
  ];
  assert.equal(queue.running.size, 5);
  assert.equal(queue.state().features.summary.running, 1);
  assert.equal(queue.state().features.details.running, 2);
  assert.equal(queue.pending.length, 2);
  while (queue.running.size || queue.pending.length) {
    for (const release of releases.splice(0)) release();
    await new Promise(resolve => setImmediate(resolve));
    assert.ok(queue.running.size <= 5);
  }
  await Promise.all(requests);
  await queue.shutdown();
});

test('prioritizes interactive requests but serves background after three', async () => {
  const queue = new AgyQueue();
  let release;
  const first = queue.run(1, 'first', () => new Promise(resolve => { release = resolve; }));
  const order = [];
  const requests = [queue.run(1, 'background', async () => order.push('background'), { maxQueued: 10 })];
  for (let i = 0; i < 5; i++) requests.push(queue.run(2, `chat${i}`, async () => order.push(`chat${i}`), { maxQueued: 10, priority: 'interactive' }));
  release(); await first; await Promise.all(requests);
  assert.deepEqual(order, ['chat0', 'chat1', 'chat2', 'background', 'chat3', 'chat4']);
});

test('reducing concurrency drains existing work without killing it', async () => {
  const queue = new AgyQueue(5);
  const releases = [];
  const requests = Array.from({ length: 5 }, (_, i) => queue.run(i, `r${i}`, signal => new Promise(resolve => { releases.push(() => { assert.equal(signal.aborted, false); resolve(); }); })));
  queue.configure(1);
  let started = false;
  const pending = queue.run(8, 'pending', async () => { started = true; }, { maxQueued: 5 });
  releases.splice(0, 4).forEach(release => release());
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(started, false);
  releases[0](); await Promise.all([...requests, pending]);
  assert.equal(queue.effective, 1);
});

test('rate limit halves capacity, queued cancellation works during cooldown, successes restore gradually', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 100000 });
  const queue = new AgyQueue(5);
  await assert.rejects(queue.run(1, 'limited', async () => { throw new AgyError('RATE_LIMIT'); }), { code: 'RATE_LIMIT' });
  assert.equal(queue.effective, 2);
  let started = false;
  const waiting = queue.run(1, 'waiting', async () => { started = true; }, { maxQueued: 5 });
  queue.cancel(1, 'waiting');
  await assert.rejects(waiting, { code: 'CANCELED' });
  assert.equal(started, false);
  t.mock.timers.tick(60000);
  for (let i = 0; i < 5; i++) await queue.run(1, `success${i}`, async () => 1);
  assert.equal(queue.effective, 3);
  await assert.rejects(queue.run(1, 'quota', async () => { throw new AgyError('QUOTA_EXHAUSTED'); }));
  assert.equal(queue.effective, 3);
  await queue.shutdown();
});

test('updates queue positions after a queued request is canceled', async () => {
  const queue = new AgyQueue();
  let release;
  const first = queue.run(1, 'active', () => new Promise(resolve => { release = resolve; }));
  const positions = [];
  const second = queue.run(1, 'second', async () => 'second', { maxQueued: 3 });
  const third = queue.run(1, 'third', async () => 'third', { maxQueued: 3, onQueued: position => positions.push(position) });
  assert.equal(positions[positions.length - 1], 2);
  queue.cancel(1, 'second');
  await assert.rejects(second, { code: 'CANCELED' });
  assert.equal(positions[positions.length - 1], 1);
  release();
  await first;
  assert.equal(await third, 'third');
  await queue.shutdown();
});

test('serializes requests, applies capacity and prevents duplicate IDs', async () => {
  const queue = new AgyQueue();
  let release;
  const first = queue.run(1, 'first', () => new Promise(resolve => { release = resolve; }));
  const second = queue.run(2, 'second', async () => 'second', { maxQueued: 1 });
  await assert.rejects(queue.run(3, 'overflow', async () => '', { maxQueued: 1 }), { code: 'BUSY' });
  await assert.rejects(queue.run(2, 'second', async () => '', { maxQueued: 5 }), { code: 'DUPLICATE_REQUEST' });
  release('first');
  assert.equal(await first, 'first');
  assert.equal(await second, 'second');
  await queue.shutdown();
});

test('queue timeout and cancellation do not occupy the next slot', async () => {
  const queue = new AgyQueue();
  let release;
  const active = queue.run(1, 'active', () => new Promise(resolve => { release = resolve; }));
  const timeout = queue.run(2, 'timeout', async () => assert.fail('must not run'), { maxQueued: 3, waitMs: 5 });
  await assert.rejects(timeout, { code: 'QUEUE_TIMEOUT' });
  const canceled = queue.run(2, 'cancel', async () => assert.fail('must not run'), { maxQueued: 3 });
  queue.cancel(2);
  await assert.rejects(canceled, { code: 'CANCELED' });
  release();
  await active;
  assert.equal(await queue.run(2, 'next', async () => 7), 7);
});

test('rejects late results from a canceled active owner and drains shutdown', async () => {
  const queue = new AgyQueue();
  let release;
  const active = queue.run(1, 'active', () => new Promise(resolve => { release = resolve; }));
  queue.cancel(2);
  assert.equal(queue.active.controller.signal.aborted, false);
  queue.cancel(1);
  release('late');
  await assert.rejects(active, { code: 'CANCELED' });
  await queue.shutdown();
  await assert.rejects(queue.run(1, 'closed', async () => 1), { code: 'CANCELED' });
});
