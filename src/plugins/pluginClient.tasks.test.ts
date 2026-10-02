import { beforeEach, describe, expect, it, vi } from 'vitest';
import { pluginClient } from './pluginClient';
import { useAppStore } from '../store/useAppStore';
import { aiTaskJournal } from '../services/aiTaskJournal';
vi.unmock('../store/useAppStore');
beforeEach(() => {
  useAppStore.setState({ user: { id: 91, login: 'fixture' } as never, githubToken: 'fixture' });
});
describe('plugin task projection', () => {
  it('records failed actions without granting replay or unsupported cancellation', async () => {
    const runAction = vi.fn().mockResolvedValue({ success: false, error: { code: 'FAIL', message: 'failure' } });
    Object.defineProperty(window, 'electronAPI', { configurable: true, value: { plugins: { runAction } } });
    await pluginClient.runAction({ pluginId: 'test', actionId: 'fail', repositories: [] });
    const task = aiTaskJournal.snapshot().filter(t => t.kind === 'plugins').slice(-1)[0];
    expect(task.items[0].state).toBe('failed');
    expect(aiTaskJournal.supports(task.id, 'stop')).toBe(false);
    expect(runAction).toHaveBeenCalledOnce();
  });
  it('rejects a late result after A-B-A account changes', async () => {
    let finish!: (value: unknown) => void;
    Object.defineProperty(window, 'electronAPI', { configurable: true, value: { plugins: {
      runAction: () => new Promise(resolve => { finish = resolve; }),
    } } });
    const task = pluginClient.runAction({ pluginId: 'test', actionId: 'late', repositories: [] });
    useAppStore.setState({ githubToken: 'other' }); useAppStore.setState({ githubToken: 'fixture' });
    finish({ success: true, result: {} });
    await expect(task).rejects.toMatchObject({ name: 'AbortError' });
  });
});
