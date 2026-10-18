import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AITaskRecord } from './aiTaskJournal';
import type { AgyRecoveryRecord } from '../types/agy';
import { confirmTaskRecovery, reconcileAgyTask, taskRecoveryNeedsConfirmation } from './agyRecoveryPolicy';

const task = (patch: Partial<AITaskRecord> = {}): AITaskRecord => ({ id: 'task', owner: '7', kind: 'details', executor: 'agy-device',
  state: 'running', updatedAt: '2026-10-17T00:00:00Z', items: [{ id: 'repo', label: 'repo', state: 'running', requestId: 'request', providerOutcome: 'in_flight' }], ...patch });
const call = (patch: Partial<AgyRecoveryRecord> = {}): AgyRecoveryRecord => ({ requestId: 'request', taskId: 'task', itemId: 'repo',
  createdAt: '2026-10-17T00:00:00Z', inputDigest: 'input', profile: 'profile', dispatch: 'sent', providerOutcome: 'unknown', recoverable: false, ...patch });
afterEach(() => vi.restoreAllMocks());
describe('shared AGY crash and retry policy', () => {
  it('conservatively restores legacy running calls, including stale not_started journals', () => {
    for (const providerOutcome of [undefined, 'not_started', 'in_flight'] as const) {
      const recovered = reconcileAgyTask(task({ items: [{ id: 'repo', label: 'repo', state: 'running', providerOutcome }] }));
      expect(recovered.items[0].providerOutcome).toBe('unknown');
      expect(taskRecoveryNeedsConfirmation(recovered)).toBe(true);
    }
  });
  it('uses durable prepared/success receipts over stale renderer uncertainty', () => {
    const prepared = reconcileAgyTask(task(), [call({ dispatch: 'prepared', providerOutcome: 'not_started' })]);
    expect(prepared.providerOutcome).toBe('not_started');
    expect(taskRecoveryNeedsConfirmation(prepared)).toBe(false);
    const consumed = reconcileAgyTask(task({ providerOutcome: 'unknown', capabilities: { pause: false, cancel: false, resume: 'new-provider-call' } }),
      [call({ providerOutcome: 'succeeded', receipt: 'consumed' })]);
    expect(consumed.items[0]).toMatchObject({ state: 'complete', commitStatus: 'saved', providerOutcome: 'succeeded' });
    expect(consumed.providerOutcome).toBe('succeeded');
    expect(consumed.capabilities?.resume).toBe('safe');
  });
  it('only confirms selected unknown calls and retains successful siblings for save only', () => {
    const recovered = reconcileAgyTask(task({ items: [
      { id: 'repo', label: 'repo', state: 'running', requestId: 'request' },
      { id: 'other', label: 'other', state: 'failed', providerOutcome: 'failed' },
      { id: 'ready', label: 'ready', state: 'failed', requestId: 'saved' },
    ] }), [call(), call({ requestId: 'saved', itemId: 'ready', providerOutcome: 'succeeded', recoverable: true, resultDigest: 'digest' })]);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    expect(confirmTaskRecovery(recovered, true, ['other', 'ready'])).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
    expect(confirmTaskRecovery(recovered, true, ['repo'])).toBe(false);
    expect(confirm).toHaveBeenCalledOnce();
    expect(recovered.items[2].recovery).toEqual({ requestId: 'saved', digest: 'digest' });
  });
  it('matches exact request lineage before another retry with the same item id', () => {
    const recovered = reconcileAgyTask(task(), [call({ requestId: 'later', createdAt: '2026-10-17T01:00:00Z', providerOutcome: 'failed' }), call()]);
    expect(recovered.items[0].providerOutcome).toBe('unknown');
  });
  it('leaves server executor recovery to its own protocol', () => {
    const remote = task({ location: 'server', executor: 'server-provider' });
    expect(reconcileAgyTask(remote)).toBe(remote);
  });
});
