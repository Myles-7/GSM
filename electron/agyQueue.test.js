const test = require('node:test');
const assert = require('node:assert/strict');
const { AgyQueue } = require('./agyQueue');

test('cancellation racing a validated result still holds suspect capacity until the child exits', async () => {
  const queue = new AgyQueue(1); let deliver, close;
  const cleanupSettled = new Promise(resolve => { close = resolve; });
  const first = queue.run('a', 'canceled-artifact', () => new Promise(resolve => { deliver = resolve; }));
  queue.cancel('a', 'canceled-artifact');
  deliver({ text: 'late', cleanupSettled });
  await assert.rejects(first, { code: 'CANCELED' });
  assert.equal(queue.state().effective, 0);
  let started = false;
  const next = queue.run('a', 'next-artifact', async () => { started = true; return 'ok'; }, { maxQueued: 1 });
  assert.equal(started, false); close(); assert.equal(await next, 'ok'); await queue.shutdown();
});

test('background fills actual spare capacity even while a foreground feature is capped', async () => {
  const queue = new AgyQueue(3); queue.configure(3, { details: 1 });
  let release; const order = [];
  const first = queue.run('a', 'manual-one', () => new Promise(resolve => { release = resolve; }), { feature: 'details', priority: 'interactive' });
  const pending = queue.run('a', 'manual-two', async () => order.push('manual'), { feature: 'details', priority: 'interactive', maxQueued: 3 });
  await queue.run('a', 'auto', async () => order.push('auto'), { feature: 'discovery', maxQueued: 3 });
  assert.deepEqual(order, ['auto']); release(); await Promise.all([first, pending]);
  assert.deepEqual(order, ['auto', 'manual']); await queue.shutdown();
});

test('round robins three foreground producers without starving the last batch', async () => {
  const queue = new AgyQueue(1); let release;
  const active = queue.run('a', 'active', () => new Promise(resolve => { release = resolve; }));
  const order = [], pending = [];
  for (const producer of ['one', 'two', 'three']) for (let i = 0; i < 3; i++) {
    pending.push(queue.run('a', `${producer}-${i}`, async () => order.push(producer), { maxQueued: 20, priority: 'interactive', producer }));
  }
  release(); await Promise.all([active, ...pending]);
  assert.deepEqual(order, ['one', 'two', 'three', 'one', 'two', 'three', 'one', 'two', 'three']);
  assert.equal(queue.producerTurns.size, 0); await queue.shutdown();
});

test('limits organization backlog separately from other features', async () => {
  const queue = new AgyQueue(1); let release;
  const first = queue.run('a', 'active-org', () => new Promise(resolve => { release = resolve; }), { feature: 'organization' });
  const second = queue.run('a', 'waiting-org', async () => 'ok', { feature: 'organization', maxQueued: 10, maxFeatureQueued: 1 });
  await assert.rejects(queue.run('a', 'excess-org', async () => assert.fail('must not start'), { feature: 'organization', maxQueued: 10, maxFeatureQueued: 1 }), { code: 'BUSY' });
  const chat = queue.run('b', 'chat', async () => 'chat', { feature: 'repository-chat', maxQueued: 10 });
  release(); await Promise.all([first, second, chat]); await queue.shutdown();
});

test('holds suspect capacity until the exact child exits, then automatically drains', async () => {
  const queue = new AgyQueue(1); let release;
  let confirmExit; const cleanupSettled = new Promise(resolve => { confirmExit = resolve; });
  const first = queue.run('a', 'r1', () => new Promise((_resolve, reject) => { release = reject; })).catch(error => error);
  const waiting = queue.run('a', 'r2', async () => 'ok', { maxQueued: 1 });
  release(Object.assign(new Error('uncertain'), { code: 'CLEANUP_TIMEOUT', cleanupSettled }));
  assert.equal((await first).code, 'CLEANUP_TIMEOUT');
  assert.equal(queue.state().effective, 0); assert.equal(queue.state().queued, 1);
  confirmExit(); assert.equal(await waiting, 'ok');
  assert.equal(queue.state().quarantined, false);
  assert.equal(await queue.run('a', 'r3', async () => 'ok'), 'ok');
  await queue.shutdown();
});

test('delivers completed artifacts while holding capacity for their unconfirmed cleanup', async () => {
  const queue = new AgyQueue(1); let close;
  const cleanupSettled = new Promise(resolve => { close = resolve; });
  const artifact = { text: 'complete' }; Object.defineProperty(artifact, 'cleanupSettled', { value: cleanupSettled });
  assert.equal(await queue.run('a', 'done', async () => artifact), artifact);
  assert.equal(queue.state().effective, 0);
  let started = false;
  const next = queue.run('b', 'next', async () => { started = true; return 'next'; }, { maxQueued: 1 });
  assert.equal(started, false); close(); assert.equal(await next, 'next');
  assert.equal(queue.state().effective, 1); await queue.shutdown();
});
const { AgyError } = require('./agyProtocol');

test('cleanup failure does not abort healthy sibling work', async () => {
  const queue = new AgyQueue(2); let fail, close; const cleanupSettled = new Promise(resolve => { close = resolve; });
  const first = queue.run('a', 'failed', () => new Promise((_resolve, reject) => { fail = reject; })).catch(error => error);
  let abortObserved = false;
  const sibling = queue.run('a', 'sibling', signal => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => { abortObserved = true; setTimeout(() => reject(new AgyError('CANCELED')), 5); });
  })).catch(error => error);
  fail(Object.assign(new AgyError('CLEANUP_TIMEOUT'), { cleanupSettled })); await first;
  assert.equal(abortObserved, false);
  assert.throws(() => queue.recover(), { code: 'BUSY' });
  queue.cancel('a', 'sibling'); await sibling;
  assert.equal(queue.state().quarantined, false); close(); await Promise.resolve(); queue.recover();
  assert.equal(queue.state().effective, 2);
  assert.equal(await queue.run('a', 'next', async () => 'ok'), 'ok');
  await queue.shutdown();
});

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

test('background uses spare capacity and never bypasses queued interactive work', async () => {
  const queue = new AgyQueue();
  let release;
  const first = queue.run(1, 'first', () => new Promise(resolve => { release = resolve; }));
  const order = [];
  const requests = [queue.run(1, 'background', async () => order.push('background'), { maxQueued: 10 })];
  for (let i = 0; i < 5; i++) requests.push(queue.run(2, `chat${i}`, async () => order.push(`chat${i}`), { maxQueued: 10, priority: 'interactive' }));
  release(); await first; await Promise.all(requests);
  assert.deepEqual(order, ['chat0', 'chat1', 'chat2', 'chat3', 'chat4', 'background']);
});

test('generation admission expires unsent and only an explicit new submission starts', async () => {
  const queue = new AgyQueue(1); let release; let deferred = 0; let started = 0;
  const active = queue.run('a', 'occupied', () => new Promise(resolve => { release = resolve; }));
  const waiting = queue.run('b', 'waiting', async () => { started++; return 'ok'; },
    { maxQueued: 1, waitMs: 5, deferOnTimeout: true, onDeferred: () => { deferred++; } }).catch(error => error);
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(deferred, 1); assert.equal(started, 0); assert.equal(queue.state().queued, 0);
  assert.equal((await waiting).code, 'RESOURCE_DEFERRED');
  release(); await active; assert.equal(started, 0);
  await queue.run('b', 'explicit-new', async () => { started++; }); assert.equal(started, 1);
  await queue.shutdown();
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
