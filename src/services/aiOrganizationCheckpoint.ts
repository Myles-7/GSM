/** At most one durable write and one pending checkpoint, independent of event rate. */
export class OrganizationCheckpointWriter {
  private requested = 0;
  private saved = 0;
  private running?: Promise<void>;
  private timer?: ReturnType<typeof setTimeout>;
  private waiters: { revision: number; resolve: () => void; reject: (error: unknown) => void }[] = [];
  private failure?: unknown;
  private closed = false;
  constructor(private save: () => Promise<void>, private onError: (error: unknown) => void, private delay = 300) {}
  request(force = true): Promise<void> {
    if (this.closed) return Promise.reject(new Error('Checkpoint writer closed'));
    if (this.failure) return Promise.reject(this.failure);
    const revision = ++this.requested;
    const pending = force ? new Promise<void>((resolve, reject) => this.waiters.push({ revision, resolve, reject })) : Promise.resolve();
    if (force) this.start();
    else this.schedule();
    return pending;
  }
  private schedule() {
    if (this.closed || this.running || this.timer || this.failure) return;
    this.timer = setTimeout(() => { this.timer = undefined; this.start(); }, this.delay);
  }
  private start() {
    clearTimeout(this.timer); this.timer = undefined;
    if (this.closed || this.running || this.failure || this.saved === this.requested) return;
    const revision = this.requested;
    this.running = Promise.resolve().then(this.save).then(() => {
      this.saved = revision;
      const completed = this.waiters.filter(waiter => waiter.revision <= revision);
      this.waiters = this.waiters.filter(waiter => waiter.revision > revision);
      completed.forEach(waiter => waiter.resolve());
    }).catch(error => {
      this.failure = error;
      this.waiters.splice(0).forEach(waiter => waiter.reject(error));
      this.onError(error);
    }).finally(() => {
      this.running = undefined;
      if (this.requested > this.saved) {
        if (this.waiters.length) this.start();
        else this.schedule();
      }
    });
  }
  async close(): Promise<void> {
    this.closed = true; clearTimeout(this.timer); this.timer = undefined;
    // Interruption/final checkpoints are saved separately after all prior I/O settles.
    this.waiters.splice(0).forEach(waiter => waiter.reject(new DOMException('Checkpoint canceled', 'AbortError')));
    await this.running;
  }
}
