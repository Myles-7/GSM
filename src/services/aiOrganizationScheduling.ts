import { AIRateLimiter } from './aiRequestLimiter';
import { waitForRequest } from '../utils/requestDeadline';
import { getRetryAfterMsFromError, isRateLimitedError } from './aiService';
import { OrganizationBlockedError } from './aiOrganizationReadiness';

/** Backpressure only: native AGY still owns execution slots and cooldowns. */
export class OrganizationAgyAdmission {
  active = 0;
  waiting = 0;
  constructor(readonly limit: number, private pool: () => { effective: number; running: number; cooldownUntil: number; quarantined?: boolean } | undefined) {}
  get effective() { return Math.min(this.limit, this.pool()?.effective ?? this.limit); }
  async acquire(signal: AbortSignal): Promise<() => void> {
    signal.throwIfAborted();
    if (this.pool()?.quarantined) throw new OrganizationBlockedError('AGY_CLEANUP_TIMEOUT');
    // Observation only. Native AgyQueue owns the sole admission deadline,
    // feature capacity, cooldown and queue position; never wait twice here.
    this.active++; let released = false;
    return () => { if (!released) { released = true; this.active--; } };
  }
  success() { /* The native queue owns capacity recovery. */ }
  failure() { /* A request failure must not reset unrelated queue capacity. */ }
}

export async function organizationWorkers<T>(items: T[], concurrency: number, signal: AbortSignal, work: (item: T) => Promise<void>, onFailure?: (error: unknown) => void): Promise<void> {
  let next = 0; let failure: unknown;
  await Promise.all(Array.from({ length: Math.min(Math.max(1, concurrency), items.length) }, async () => {
    while (next < items.length && !failure) {
      try { signal.throwIfAborted(); const item = items[next++]; await work(item); }
      catch (error) { failure ??= error; onFailure?.(error); }
    }
  }));
  if (failure) throw failure;
  signal.throwIfAborted();
}

export class OrganizationModelScheduler {
  active = 0;
  waiting = 0;
  effective: number;
  private successes = 0;
  private lastLimited = 0;
  private readonly limiter: AIRateLimiter;
  constructor(readonly limit: number) {
    this.effective = limit;
    this.limiter = new AIRateLimiter({ maxConcurrency: limit, backoffCapMs: 3600000, maxRetryAfterMs: 3600000 });
  }
  async acquire(signal: AbortSignal): Promise<() => void> {
    this.waiting++;
    try {
      while (this.active >= this.effective) await waitForRequest(50, signal);
      this.active++;
      let release: () => void;
      try { release = await this.limiter.acquire(signal); } catch (error) { this.active--; throw error; }
      let released = false;
      return () => { if (!released) { released = true; release(); this.active--; } };
    } finally { this.waiting--; }
  }
  success(): void {
    this.limiter.notifySuccess();
    if (++this.successes >= 5 && Date.now() - this.lastLimited >= 60000 && this.effective < this.limit) { this.effective++; this.successes = 0; }
  }
  async waitForCooldown(signal: AbortSignal): Promise<void> {
    while (this.limiter.getStatus().cooldownRemainingMs > 0) await waitForRequest(this.limiter.getStatus().cooldownRemainingMs, signal);
  }
  failure(error: unknown): void {
    if (isRateLimitedError(error) || error instanceof Error && error.message === 'AGY_RATE_LIMIT') {
      this.effective = Math.max(1, Math.floor(this.effective / 2)); this.lastLimited = Date.now(); this.successes = 0;
      this.limiter.notifyRateLimit(getRetryAfterMsFromError(error));
    }
  }
}
