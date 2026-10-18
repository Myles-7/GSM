import { describe, expect, it, vi } from 'vitest';
import { OrganizationAgyAdmission } from './aiOrganizationScheduling';

describe('organization native-capacity backpressure', () => {
  it('maps configured concurrency directly to native capacity', async () => {
    const native = { effective: 5, running: 0, cooldownUntil: 0 };
    const gate = new OrganizationAgyAdmission(5, () => native);
    expect(gate.effective).toBe(5);
    for (let n = 0; n < 5; n++) gate.success();
    expect(gate.effective).toBe(5); native.effective = 1; expect(gate.effective).toBe(1);
    const release = await gate.acquire(new AbortController().signal); release(); release(); expect(gate.active).toBe(0);
  });
  it('delegates busy admission to the native queue but rejects quarantine', async () => {
    vi.useFakeTimers();
    try {
      const pool = { effective: 1, running: 1, cooldownUntil: 0, quarantined: false };
      const gate = new OrganizationAgyAdmission(5, () => pool); let started = false;
      const controller = new AbortController();
      const pending = gate.acquire(controller.signal).then(release => { started = true; release(); });
      await pending; expect(started).toBe(true);
      pool.running = 0; await vi.advanceTimersByTimeAsync(100); await pending; expect(started).toBe(true);
      pool.quarantined = true; await expect(gate.acquire(controller.signal)).rejects.toMatchObject({ code: 'AGY_CLEANUP_TIMEOUT' });
    } finally { vi.useRealTimers(); }
  });
});
