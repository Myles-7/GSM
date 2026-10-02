const { AgyError } = require('./agyProtocol');

class AgyQueue {
  constructor(limit = 1) {
    this.running = new Set(); this.pending = []; this.closed = false;
    this.limit = limit; this.effective = limit; this.featureLimits = {};
    this.cooldownUntil = 0; this.lastLimited = 0; this.successes = 0; this.interactiveStreak = 0;
  }
  get active() { return this.running.values().next().value || null; }
  configure(limit, featureLimits = {}) {
    const previous = this.limit;
    this.limit = Math.max(1, Math.min(5, limit));
    this.effective = this.effective === previous ? this.limit : Math.min(this.effective, this.limit);
    this.featureLimits = featureLimits;
    this.drain();
  }
  state() {
    const features = {};
    for (const task of [...this.running, ...this.pending]) {
      const entry = features[task.feature] ||= { running: 0, queued: 0, limit: Math.min(this.limit, this.featureLimits[task.feature] || this.limit) };
      entry[this.running.has(task) ? 'running' : 'queued']++;
    }
    return { running: this.running.size, queued: this.pending.length, limit: this.limit, effective: this.effective, cooldownUntil: this.cooldownUntil, features };
  }
  eligible(task) {
    return [...this.running].filter(item => item.feature === task.feature).length < (this.featureLimits[task.feature] || this.limit);
  }
  drain() {
    if (this.closed || Date.now() < this.cooldownUntil) { this.notifyPositions(); return; }
    while (this.running.size < this.effective) {
      const available = this.pending.filter(task => this.eligible(task));
      const interactive = available.find(task => task.priority === 'interactive');
      const background = available.find(task => task.priority !== 'interactive');
      const task = this.interactiveStreak >= 3 ? background || interactive : interactive || background;
      if (!task) break;
      this.interactiveStreak = task.priority === 'interactive' ? this.interactiveStreak + 1 : 0;
      this.pending.splice(this.pending.indexOf(task), 1);
      void this.execute(task);
    }
    this.notifyPositions();
  }

  notifyPositions() {
    const remaining = [...this.pending];
    let streak = this.interactiveStreak, position = 1;
    while (remaining.length) {
      const eligible = remaining.filter(task => this.eligible(task));
      const candidates = eligible.length ? eligible : remaining;
      const foreground = candidates.find(task => task.priority === 'interactive');
      const background = candidates.find(task => task.priority !== 'interactive');
      const task = streak >= 3 ? background || foreground : foreground || background;
      remaining.splice(remaining.indexOf(task), 1);
      task.onQueued(position++);
      streak = task.priority === 'interactive' ? streak + 1 : 0;
    }
    this.onChange?.(this.state());
  }

  run(owner, id, work, { maxQueued = 0, waitMs = 180000, onQueued = () => {}, feature = 'other', priority = 'background' } = {}) {
    if (this.closed) return Promise.reject(new AgyError('CANCELED'));
    if (typeof id !== 'string' || !/^[\w-]{1,80}$/.test(id)) return Promise.reject(new AgyError('INVALID_REQUEST'));
    if ([...this.running, ...this.pending].some(task => task.owner === owner && task.id === id)) return Promise.reject(new AgyError('DUPLICATE_REQUEST'));
    const immediate = this.running.size < this.effective && this.eligible({ feature }) && Date.now() >= this.cooldownUntil;
    if (!immediate && this.pending.length >= maxQueued) return Promise.reject(new AgyError('BUSY'));
    return new Promise((resolve, reject) => {
      const task = { owner, id, work, resolve, reject, feature, priority, controller: new AbortController(), timer: null, onQueued };
      {
        task.timer = setTimeout(() => {
          this.pending = this.pending.filter(item => item !== task);
          this.notifyPositions();
          reject(new AgyError('QUEUE_TIMEOUT'));
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
      if (task.controller.signal.aborted) throw new AgyError('CANCELED');
      if (++this.successes >= 5 && Date.now() - this.lastLimited >= 60000 && this.effective < this.limit) {
        this.effective++; this.successes = 0;
      }
      task.resolve(result);
    } catch (error) {
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
