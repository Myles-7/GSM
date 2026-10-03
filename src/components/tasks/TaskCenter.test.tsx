import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TaskCenter } from './TaskCenter';
import type { AITaskRecord } from '../../services/aiTaskJournal';

const mocks = vi.hoisted(() => ({ control: vi.fn(), archive: vi.fn(), remove: vi.fn(), supports: vi.fn(() => false), live: vi.fn(() => false) }));
vi.mock('../../services/aiTaskJournal', async original => ({
  ...await original<typeof import('../../services/aiTaskJournal')>(),
  aiTaskJournal: { ...mocks, storageError: () => '' },
}));
vi.mock('../../store/useAppStore', () => ({ useAppStore: (select: (state: unknown) => unknown) => select({ aiConfigs: [
  { id: 'original', name: 'Original', model: 'model-one', provider: 'agy-cli', agyEffort: 'medium', agyTimeoutSeconds: 180 },
  { id: 'other', name: 'Other', model: 'model-two', provider: 'agy-cli', agyEffort: 'high', agyTimeoutSeconds: 220 },
] }) }));
const record = (id: string, state: AITaskRecord['state'], extra: Partial<AITaskRecord> = {}): AITaskRecord => ({
  id, owner: 'owner', kind: 'summary', state, configId: 'original', createdAt: '2026-10-02T08:00:00.000Z', updatedAt: '2026-10-02T08:00:00.000Z',
  title: id, config: { model: 'saved-model', provider: 'agy-cli', effort: 'max', timeoutSeconds: 90 },
  items: [{ id: 'a', label: 'owner/repo', state: state === 'failed' ? 'failed' : state === 'complete' ? 'complete' : 'running', error: state === 'failed' ? 'Rate limit' : undefined }], ...extra,
});
beforeEach(() => vi.clearAllMocks());

describe('unified task center', () => {
  it('shows active and failures by default, with completed history behind its filter', () => {
    render(<TaskCenter tasks={[record('Active', 'running'), record('Failure', 'failed'), record('Done', 'complete')]} chinese={false} retry={vi.fn()} onNavigate={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Repository summaries · Active' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Repository summaries · Failure' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Repository summaries · Done' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'History' }));
    expect(screen.getByRole('button', { name: 'Repository summaries · Done' })).toBeVisible();
  });
  it('filters names without reordering records when progress changes', () => {
    const tasks = [record('one', 'running'), record('two', 'running')];
    const { rerender } = render(<TaskCenter tasks={tasks} chinese={false} retry={vi.fn()} onNavigate={vi.fn()} />);
    rerender(<TaskCenter tasks={[{ ...tasks[0], updatedAt: '2026-10-02T09:00:00.000Z' }, tasks[1]]} chinese={false} retry={vi.fn()} onNavigate={vi.fn()} />);
    expect(screen.getAllByRole('article').map(element => element.textContent)).toEqual([expect.stringContaining('one'), expect.stringContaining('two')]);
    fireEvent.change(screen.getByRole('textbox', { name: 'Search tasks' }), { target: { value: 'two' } });
    expect(screen.getAllByRole('article')).toHaveLength(1);
  });
  it('passes only failed retry intent, original parameters and explicit changes', async () => {
    const retry = vi.fn().mockResolvedValue(undefined);
    render(<TaskCenter tasks={[record('failure', 'failed')]} chinese={false} retry={retry} onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Repository summaries · failure' }));
    const detail = screen.getByRole('complementary', { name: 'Task details' });
    expect(within(detail).getByText('saved-model')).toBeVisible();
    fireEvent.change(within(detail).getByRole('combobox', { name: 'Retry configuration' }), { target: { value: 'other' } });
    expect(within(detail).getByRole('textbox', { name: 'Model' })).toHaveValue('model-two');
    fireEvent.change(within(detail).getByRole('textbox', { name: 'Model' }), { target: { value: 'custom-model' } });
    fireEvent.click(within(detail).getByRole('button', { name: 'Retry failed' }));
    await waitFor(() => expect(retry).toHaveBeenCalledWith(expect.objectContaining({ id: 'failure' }), true, 'other', { model: 'custom-model' }));
  });
  it('batches failed retries without submitting successful tasks', async () => {
    const retry = vi.fn().mockResolvedValue(undefined);
    render(<TaskCenter tasks={[record('failure', 'failed'), record('active', 'running')]} chinese={false} retry={retry} onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Repository summaries · failure' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Repository summaries · active' }));
    fireEvent.click(screen.getByRole('button', { name: 'Retry failed items in selected tasks' }));
    await waitFor(() => expect(retry).toHaveBeenCalledTimes(1));
  });
  it('does not advertise a local retry or configuration for server tasks', () => {
    render(<TaskCenter tasks={[record('server', 'failed', { location: 'server' })]} chinese={false} retry={vi.fn()} onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Repository summaries · server' }));
    expect(screen.queryByRole('button', { name: 'Retry failed' })).toBeNull();
    expect(screen.queryByRole('combobox', { name: 'Retry configuration' })).toBeNull();
  });

  it('does not advertise retry while a task is still running without registered controls', () => {
    render(<TaskCenter tasks={[record('active', 'running', { items: [{ id: 'a', label: 'A', state: 'failed' }] })]} chinese={false} retry={vi.fn()} onNavigate={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Retry failed' })).toBeNull();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Repository summaries · active' }));
    expect(screen.getByRole('button', { name: 'Retry failed items in selected tasks' })).toBeDisabled();
  });
  it('localizes stages and gives truthful commit and missing metadata information', () => {
    render(<TaskCenter tasks={[record('提交', 'committing', { phase: 'verification', config: undefined, startedAt: undefined })]} chinese retry={vi.fn()} onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '仓库摘要 · 提交' }));
    expect(screen.getByText('正在提交已完成结果，此阶段无法取消。')).toBeVisible();
    expect(screen.getAllByText('复核回答').length).toBeGreaterThan(0);
    expect(screen.getAllByText('未记录').length).toBeGreaterThan(0);
  });
});
