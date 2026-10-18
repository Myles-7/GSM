import { describe, expect, it, vi } from 'vitest';
import { bindTaskSignal, inheritTaskSignal, retryTaskConfig, taskConfigSnapshot, taskForSignal, confirmLocalTaskCommit } from './taskExecution';
import { flushAppStorePersistence } from '../store/persistence/storage';
import { aiTaskJournal, type AITaskRecord } from './aiTaskJournal';
import type { AIConfig } from '../types';
const config = { id: 'agy', model: 'current-model', provider: 'agy-cli', agyEffort: 'medium', agyTimeoutSeconds: 180 } as AIConfig;
const previous = { configId: 'agy', config: { provider: 'agy-cli', model: 'original-model', effort: 'max', timeoutSeconds: 80 } } as AITaskRecord;
vi.mock('../store/persistence/storage', () => ({ flushAppStorePersistence: vi.fn().mockResolvedValue(undefined) }));
describe('task execution configuration', () => {
  it('confirms local durability before saved and preserves provider success on persistence failure', async () => {
    const task = aiTaskJournal.begin('local-commit', 'details', []);
    task.providerOutcome('succeeded'); task.commit('pending');
    let release!: () => void;
    vi.mocked(flushAppStorePersistence).mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const confirmation = confirmLocalTaskCommit(task);
    expect(aiTaskJournal.snapshot().find(item => item.id === task.id)?.commitStatus).toBe('pending');
    release(); expect(await confirmation).toBe(true);
    expect(aiTaskJournal.snapshot().find(item => item.id === task.id)?.commitStatus).toBe('saved');
    vi.mocked(flushAppStorePersistence).mockRejectedValueOnce(new Error('Quota exceeded'));
    expect(await confirmLocalTaskCommit(task)).toBe(false);
    expect(aiTaskJournal.snapshot().find(item => item.id === task.id)).toMatchObject({ commitStatus: 'failed', providerOutcome: 'succeeded', failureCode: 'LOCAL_PERSISTENCE_FAILED' });
    task.finish('partial');
  });
  it('reuses saved model parameters but never saved credentials', () => {
    const retry = retryTaskConfig(config, previous);
    expect(retry).toMatchObject({ agyRequestProfile: { model: 'original-model', effort: 'max', timeoutSeconds: 80 } });
    expect(taskConfigSnapshot(retry, 'workbench')).toEqual({ provider: 'agy-cli', model: 'original-model', effort: 'max', timeoutSeconds: 80 });
  });
  it('uses replacement configuration or explicitly edited parameters', () => {
    expect(retryTaskConfig({ ...config, id: 'replacement' }, previous)).toMatchObject({ agyRequestProfile: { model: 'current-model' } });
    expect(retryTaskConfig(config, previous, { model: 'custom', effort: 'low', timeoutSeconds: 45 })).toMatchObject({ agyRequestProfile: { model: 'custom', effort: 'low', timeoutSeconds: 45 } });
  });
  it('propagates task identity to child signals without duplicating records', () => {
    const parent = new AbortController(), child = new AbortController();
    const task = aiTaskJournal.begin('test', 'research', []);
    bindTaskSignal(parent.signal, task); inheritTaskSignal(parent.signal, child.signal);
    expect(taskForSignal(child.signal)).toBe(task); task.finish();
  });
});
