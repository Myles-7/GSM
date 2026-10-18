import { describe, expect, it, vi } from 'vitest';
import { collectOrganizationRows, organizationRequest, OrganizationBudgetError, OrganizationDeferredError } from './aiOrganizationReliability';
import { AIRequestError } from './aiService';
import { OrganizationBlockedError } from './aiOrganizationReadiness';
describe('bounded organization recovery', () => {
  it('returns deferred admission once without stacking another queue or spending model budget', async () => {
    const work=vi.fn().mockRejectedValue(new OrganizationDeferredError('AGY_QUEUE_TIMEOUT'));
    const budget={used:0,limit:1},rollback=vi.fn();
    await expect(organizationRequest(work,budget,new AbortController().signal,120000,undefined,undefined,1,rollback)).rejects.toMatchObject({code:'RESOURCE_DEFERRED'});
    expect(work).toHaveBeenCalledOnce();expect(budget.used).toBe(0);expect(rollback).toHaveBeenCalledOnce();
  });
  it('honors a single-attempt deadline for a slow tail without retrying it', async () => {
    const call = vi.fn().mockRejectedValue(new Error('AGY_TIMEOUT'));
    await expect(organizationRequest(call, { used: 0, limit: 10 }, new AbortController().signal, 120000, undefined, undefined, 1)).rejects.toMatchObject({ code: 'UNKNOWN_PROVIDER_OUTCOME' });
    expect(call).toHaveBeenCalledOnce();
  });
  it('reports exhausted model timeouts distinctly from connection failures', async () => {
    vi.useFakeTimers();
    try {
      const call = vi.fn().mockRejectedValue(new Error('AGY_TIMEOUT'));
      const pending = organizationRequest(call, { used: 0, limit: 10 }, new AbortController().signal, 120000).catch(error => error);
      await vi.runAllTimersAsync();
      expect(await pending).toMatchObject({ code: 'UNKNOWN_PROVIDER_OUTCOME', message: 'AGY_TIMEOUT' });
      expect(call).toHaveBeenCalledTimes(1);
    } finally { vi.useRealTimers(); }
  });
  it('uses at most 3 network attempts and honors Retry-After', async () => {
    vi.useFakeTimers();
    const call = vi.fn().mockRejectedValue(new AIRequestError('429', 429, 2000));
    const budget = { used: 0, limit: 10 }; const pending = organizationRequest(call, budget, new AbortController().signal, 120000).catch(error => error);
    await vi.advanceTimersByTimeAsync(1999); expect(call).toHaveBeenCalledTimes(1);
    await vi.runAllTimersAsync(); expect(await pending).toBeInstanceOf(OrganizationBlockedError); expect(call).toHaveBeenCalledTimes(3); expect(budget.used).toBe(3); vi.useRealTimers();
  });
  it('keeps valid IDs, rejects duplicate rows and never accepts invented IDs', async () => {
    const request = vi.fn().mockResolvedValue(JSON.stringify({ results: [{ id: 1 }, { id: 2 }, { id: 2 }, { id: 999 }] }));
    const result = await collectOrganizationRows({ ids: [1, 2, 3], signal: new AbortController().signal, request, parse: row => ({ id: (row as { id: number }).id, value: row }) });
    expect([...result.rows.keys()]).toEqual([1]); expect(result.errors.has(2)).toBe(true); expect(result.errors.has(3)).toBe(true); expect(result.rows.has(999)).toBe(false);
  });
  it('does not retry exhausted transport failures as format repairs or split batches', async () => {
    const request = vi.fn().mockRejectedValue(new TypeError('Network fetch failed'));
    const result = await collectOrganizationRows({ ids: [1, 2, 3], signal: new AbortController().signal, request, parse: row => ({ id: Number(row), value: row }) });
    expect(request).toHaveBeenCalledTimes(1);
    expect([...result.errors.values()]).toEqual(Array(3).fill('Network fetch failed'));
  });
  it('halts recursion when the request budget is exhausted and retains the earlier cause', async () => {
    const request = vi.fn().mockResolvedValueOnce('not json').mockRejectedValue(new OrganizationBudgetError('Limit reached'));
    const result = await collectOrganizationRows({ ids: [1, 2, 3], signal: new AbortController().signal, request, parse: row => ({ id: Number(row), value: row }) });
    expect(request).toHaveBeenCalledTimes(2);
    expect([...result.errors.values()].every(message => !message.includes('Limit reached'))).toBe(true);
  });
});
