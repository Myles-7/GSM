import { beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyData } from './model';
import { makeChannel } from './fixtures.test-support';
import { aiTaskJournal } from '../../../services/aiTaskJournal';

const mocks = vi.hoisted(() => ({ run: vi.fn(), cancel: vi.fn() }));
vi.mock('./runner', () => ({ runChannels: mocks.run, cancelCustomRun: mocks.cancel }));
vi.mock('../../../store/useAppStore', () => ({ useAppStore: { getState: () => ({ language: 'en' }) } }));
import { startCustomRun, useCustomDiscovery } from './store';

beforeEach(() => {
  mocks.run.mockReset();
  mocks.cancel.mockReset();
  const data = emptyData();
  data.channels = [makeChannel()];
  useCustomDiscovery.setState({ account: 'tasks-owner', data, busy: false, progress: {}, error: null });
});

describe('discovery task projection', () => {
  it('records a failure and releases controls so only failed work can be retried', async () => {
    mocks.run.mockRejectedValueOnce(new Error('offline'));
    await startCustomRun([makeChannel().id]);
    const task = aiTaskJournal.snapshot().slice(-1)[0];
    expect(task).toMatchObject({ kind: 'discovery', state: 'complete', items: [{ state: 'failed' }] });
    expect(aiTaskJournal.live(task.id)).toBe(false);
    expect(useCustomDiscovery.getState().busy).toBe(false);
  });

  it('can stop before the runner is dispatched and keeps work resumable', async () => {
    const pending = startCustomRun([makeChannel().id]);
    const task = aiTaskJournal.snapshot().slice(-1)[0];
    aiTaskJournal.control(task.id, 'stop');
    await pending;
    expect(mocks.run).not.toHaveBeenCalled();
    expect(aiTaskJournal.snapshot().slice(-1)[0]).toMatchObject({ state: 'interrupted', items: [{ state: 'pending' }] });
    expect(aiTaskJournal.live(task.id)).toBe(false);
  });
});
