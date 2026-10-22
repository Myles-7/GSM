import { describe, expect, it, vi } from 'vitest';
const generate = vi.hoisted(() => vi.fn());
vi.mock('./aiService', async original => ({ ...await original<typeof import('./aiService')>(), AIService: class { generateChatText = generate; } }));
import { OrganizationRequestExecutor } from './aiOrganizationExecutor';
import { organizationRunEvents } from './aiOrganizationRunEvents';
import { OrganizationBudgetError } from './aiOrganizationReliability';
import { organizationFatalError } from './aiOrganizationReadiness';
import type { OrganizationRunProgress } from '../types/aiOrganization';

function executor(limit = 20, publish: () => Promise<void> = async () => {}) {
  const proposalId = crypto.randomUUID();
  const progress: OrganizationRunProgress = { startedAt: Date.now(), concurrency: 5, effectiveConcurrency: 5, running: 0, queued: 0, reading: 0, requests: 0, completedRequests: 0, reused: 0, readMs: 0, queueMs: 0, modelMs: 0, parseMs: 0, saveMs: 0, successfulBatches: 0, batchMs: 0 };
  return { proposalId, progress, value: new OrganizationRequestExecutor({ proposalId, ownerId: 'test', runId: 'run', config: { id: 'test', name: 'Test', model: 'fixture', apiKey: 'secret-key', baseUrl: 'https://fixture.invalid', isActive: true },
    language: 'en', dual: { requests: {} } as never, progress, timeout: 100, secrets: ['secret-key'], system: 'Return JSON', requestLimit: limit,
    acquire: async () => () => {}, check: () => {}, publish }) };
}
describe('shared organization executor', () => {
  it('does not count cleanup as model generation and retains the original failure', async () => {
    vi.useFakeTimers();
    try {
    const { value, progress, proposalId } = executor(1);
    generate.mockReset().mockImplementation(async options => {
      options.onLifecycle('cleanup'); expect(progress.running).toBe(0);
      await new Promise(resolve => setTimeout(resolve, 5));
      throw Object.assign(new Error('AGY_CLEANUP_TIMEOUT'), { details: { originalCode: 'TIMEOUT', operation: 'terminate-process' } });
    });
    const result = expect(value.request('structure:purpose', {}, [], new AbortController().signal)).rejects.toThrow('AGY_CLEANUP_TIMEOUT');
    await vi.advanceTimersByTimeAsync(5); await result;
    expect(progress.running).toBe(0);
    expect(organizationRunEvents.snapshot(proposalId)[0]).toMatchObject({ state: 'failed', originalCode: 'TIMEOUT', modelMs: 0 });
    expect(organizationRunEvents.snapshot(proposalId)[0].cleanupMs).toBeGreaterThan(0);
    } finally { vi.useRealTimers(); }
  });
  it('settles counters and diagnostics when checkpoint publishing fails before dispatch', async () => {
    generate.mockReset(); const { value, progress, proposalId } = executor(1, async () => { throw new Error('Checkpoint rejected'); });
    await expect(value.request('structure:purpose', {}, [], new AbortController().signal)).rejects.toThrow('Checkpoint rejected');
    expect(progress.running).toBe(0); expect(progress.queued).toBe(0); expect(generate).not.toHaveBeenCalled();
    expect(organizationRunEvents.snapshot(proposalId)[0]).toMatchObject({ state: 'failed', error: 'Checkpoint rejected' });
    expect(organizationRunEvents.snapshot(proposalId)[0].endedAt).toBeDefined();
  });
  it('counts format repairs and split branches in one bounded root budget', async () => {
    generate.mockReset().mockResolvedValue('invalid JSON'); const { value } = executor(); const signal = new AbortController().signal;
    for (let i = 0; i < 10; i++) await value.request('assignments:both:0', {}, [i + 1], signal);
    await expect(value.request('assignments:both:0', {}, [11], signal)).rejects.toBeInstanceOf(OrganizationBudgetError);
    expect(generate).toHaveBeenCalledTimes(10);
  });
  it('keeps public output separate and redacts streamed credentials', async () => {
    generate.mockReset().mockImplementation(async options => { options.onChunk('Public secret-key'); return 'validated artifact'; });
    const { value, proposalId } = executor(1);
    await value.request('assignments:both:0', {}, [1], new AbortController().signal);
    expect(organizationRunEvents.snapshot(proposalId)[0]).toMatchObject({ state: 'received', output: 'validated artifact' });
    await expect(value.request('structure:purpose', {}, [], new AbortController().signal)).rejects.toBeInstanceOf(OrganizationBudgetError);
    expect(generate).toHaveBeenCalledOnce();
  });
  it('pauses the whole task on its shared budget instead of failing every remaining batch', async () => {
    generate.mockReset().mockResolvedValue('{}'); const { value } = executor(1);
    await value.request('assignments:both:0', {}, [1], new AbortController().signal);
    try {
      await value.request('assignments:both:1', {}, [2], new AbortController().signal);
      throw new Error('Expected budget pause');
    } catch (error) {
      expect(error).toMatchObject({code:'TASK_REQUEST_BUDGET'});
      expect(organizationFatalError(error)).toBe(true);
    }
    expect(generate).toHaveBeenCalledOnce();
  });
  it('never probes or replays an HTTP 503 with an unknown outcome', async () => {
    generate.mockReset().mockRejectedValue(Object.assign(new Error('upstream failure'),{status:503,providerOutcome:'unknown'}));
    const {value}=executor();
    await expect(value.request('assignments:both:0',{},[1],new AbortController().signal)).rejects.toMatchObject({code:'UNKNOWN_PROVIDER_OUTCOME'});
    expect(generate).toHaveBeenCalledOnce();
  });
  it('never probes or replays a sent call with an unknown outcome', async () => {
    vi.useFakeTimers();
    try {
      generate.mockReset().mockRejectedValue(new Error('AGY_TIMEOUT'));
      const { value, progress } = executor();
      const result = expect(value.request('assignments:both:0', {}, [1], new AbortController().signal)).rejects.toMatchObject({code:'UNKNOWN_PROVIDER_OUTCOME'});
      await vi.runAllTimersAsync(); await result;
      expect(generate).toHaveBeenCalledTimes(1);
      expect(progress.running).toBe(0); expect(progress.queued).toBe(0);
    } finally { vi.useRealTimers(); }
  });
});
