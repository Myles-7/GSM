const { AgyError } = require('./agyProtocol');

class AgyQueue {
  constructor(limit = 1, { suspectTimeoutMs = 15000 } = {}) {
    this.running = new Set(); this.pending = []; this.closed = false;
    this.limit = limit; this.effective = limit; this.featureLimits = {};
    this.cooldownUntil = 0; this.lastLimited = 0; this.successes = 0; this.interactiveStreak = 0;
    this.quarantined = false;
    this.suspects = new Set();
    this.timeouts = 0;
    this.suspectTimeoutMs = suspectTimeoutMs;
    this.producerTurns = new Map(); this.turn = 0;
    this.onTaskFailure = null;
  }
  get active() { return this.running.values().next().value || null; }
  configure(limit, featureLimits = {}) {
    const previous = this.limit;
    this.limit = Math.max(1, Math.min(5, limit));
    this.effective = this.effective === previous ? this.limit : Math.min(this.effective, this.limit);
    this.featureLimits = featureLimits;
    this.drain();
  }
  recover() {
    if (this.closed || this.running.size || this.pending.length) throw new AgyError('BUSY');
    if (this.suspects.size) throw new AgyError('RECOVERY_REQUIRED');
    this.quarantined = false; this.effective = this.limit; this.timeouts = 0; this.successes = 0;
    this.drain();
  }
  addSuspect(task, cleanupSettled) {
    const suspect = { owner: task.owner, id: task.id };
    this.suspects.add(suspect);
    let settled = false;
    let timer;
    const release = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (this.suspects.delete(suspect)) this.drain();
    };
    timer = setTimeout(release, this.suspectTimeoutMs);
    if (typeof timer.unref === 'function') timer.unref();
    if (cleanupSettled && typeof cleanupSettled.then === 'function') {
      void cleanupSettled.then(release, release);
    }
  }
  state() {
    const features = {};
    for (const task of [...this.running, ...this.pending]) {
      const entry = features[task.feature] ||= { running: 0, queued: 0, limit: Math.min(this.limit, this.featureLimits[task.feature] || this.limit) };
      entry[this.running.has(task) ? 'running' : 'queued']++;
    }
    return { running: this.running.size, queued: this.pending.length, suspect: this.suspects.size, limit: this.limit, effective: this.quarantined ? 0 : Math.max(0, this.effective - this.suspects.size), cooldownUntil: this.cooldownUntil, features, quarantined: this.quarantined };
  }
  eligible(task) {
    return [...this.running].filter(item => item.feature === task.feature).length < (this.featureLimits[task.feature] || this.limit);
  }
  choose(available, turns = this.producerTurns) {
    const foreground = available.filter(task => task.priority === 'interactive');
    return foreground.reduce((best, task) => !best || (turns.get(task.producer) || 0) < (turns.get(best.producer) || 0) ? task : best, null)
      || available[0];
  }
  drain() {
    if (this.closed || this.quarantined || Date.now() < this.cooldownUntil) { this.notifyPositions(); return; }
    while (this.running.size + this.suspects.size < this.effective) {
      const available = this.pending.filter(task => this.eligible(task));
      const task = this.choose(available);
      if (!task) break;
      this.interactiveStreak = task.priority === 'interactive' ? this.interactiveStreak + 1 : 0;
      this.pending.splice(this.pending.indexOf(task), 1);
      this.producerTurns.set(task.producer, ++this.turn);
      void this.execute(task);
    }
    this.notifyPositions();
  }

  notifyPositions() {
    const remaining = [...this.pending];
    let turn = this.turn, position = 1;
    const turns = new Map(this.producerTurns);
    while (remaining.length) {
      const eligible = remaining.filter(task => this.eligible(task));
      const candidates = eligible.length ? eligible : remaining;
      const task = this.choose(candidates, turns);
      remaining.splice(remaining.indexOf(task), 1);
      task.onQueued(position++);
      turns.set(task.producer, ++turn);
    }
    this.onChange?.(this.state());
  }

  run(owner, id, work, { maxQueued = 0, maxFeatureQueued = Infinity, waitMs = 180000, onQueued = () => {}, onDeferred = () => {}, deferOnTimeout = false, feature = 'other', priority = 'background', producer = id } = {}) {
    if (this.closed) return Promise.reject(new AgyError('CANCELED'));
    if (this.quarantined) return Promise.reject(new AgyError('CLEANUP_TIMEOUT'));
    if (typeof id !== 'string' || !/^[\w-]{1,80}$/.test(id)) return Promise.reject(new AgyError('INVALID_REQUEST'));
    if ([...this.running, ...this.pending].some(task => task.owner === owner && task.id === id)) return Promise.reject(new AgyError('DUPLICATE_REQUEST'));
    const immediate = this.running.size + this.suspects.size < this.effective && this.eligible({ feature }) && Date.now() >= this.cooldownUntil;
    if (!immediate && (this.pending.length >= maxQueued || this.pending.filter(t => t.feature === feature).length >= maxFeatureQueued)) return Promise.reject(new AgyError(deferOnTimeout ? 'RESOURCE_DEFERRED' : 'BUSY', { sent: false, retryAfterMs: 500 }));
    return new Promise((resolve, reject) => {
      const task = { owner, id, work, resolve, reject, feature, priority, producer: `${owner}:${producer}`, controller: new AbortController(), timer: null, onQueued };
      {
        task.timer = setTimeout(() => {
          if (!this.pending.includes(task)) return;
          this.pending = this.pending.filter(item => item !== task);
          if (deferOnTimeout) onDeferred();
          this.notifyPositions();
          reject(new AgyError(deferOnTimeout ? 'RESOURCE_DEFERRED' : 'QUEUE_TIMEOUT', { sent: false, retryAfterMs: 1000 }));
        }, waitMs);
        this.pending.push(task);
        this.drain();
        if (this.pending.includes(task)) this.notifyPositions();
      }
    });
  }

  async execute(task) {
    this.running.add(task);
    clearTimeout(task.timer);
    try {
      const result = await task.work(task.controller.signal);
      if (result?.cleanupSettled) {
        this.addSuspect(task, result.cleanupSettled);

      }
      if (task.controller.signal.aborted) throw new AgyError('CANCELED');
      if (++this.successes >= 5 && Date.now() - this.lastLimited >= 60000 && this.effective < this.limit) {
        this.effective++; this.successes = 0;
      }
      this.timeouts = 0;
      task.resolve(result);
    } catch (error) {
      if (['TIMEOUT', 'INIT_TIMEOUT'].includes(error.code) && ++this.timeouts >= 2) {
        this.effective = Math.max(1, this.effective - 1); this.lastLimited = Date.now(); this.successes = 0; this.timeouts = 0;
      }
      // A cleanup failure belongs to this request/worker. Do not turn one
      // uncertain child into a generation-wide outage or abort healthy siblings.
      if (error.code === 'CLEANUP_TIMEOUT' || error.cleanupSettled) {
        this.addSuspect(task, error.cleanupSettled);

        this.onTaskFailure?.(task, error);
      }
      if (error.code === 'RATE_LIMIT') {
        this.effective = Math.max(1, Math.floor(this.effective / 2));
        this.lastLimited = Date.now(); this.successes = 0;
        this.cooldownUntil = Date.now() + Math.max(30000, Number(error.details?.retryAfterMs) || 0);
        clearTimeout(this.cooldownTimer);
        this.cooldownTimer = setTimeout(() => this.drain(), this.cooldownUntil - Date.now());
      }
      task.reject(error);
    }
    finally {
      this.running.delete(task);
      if (![...this.running, ...this.pending].some(item => item.producer === task.producer)) this.producerTurns.delete(task.producer);
      this.drain();
    }
  }

  cancel(owner, id) {
    for (const task of this.running) if (task.owner === owner && (id === undefined || task.id === id)) task.controller.abort();
    this.pending = this.pending.filter(task => {
      if (task.owner !== owner || (id !== undefined && task.id !== id)) return true;
      clearTimeout(task.timer);
      task.reject(new AgyError('CANCELED'));
      return false;
    });
    this.notifyPositions();
  }

  async shutdown() {
    this.closed = true;
    clearTimeout(this.cooldownTimer);
    for (const task of [...this.pending]) this.cancel(task.owner, task.id);
    for (const task of this.running) task.controller.abort();
    while (this.running.size) await new Promise(resolve => setTimeout(resolve, 10));
  }
}

module.exports = { AgyQueue };
