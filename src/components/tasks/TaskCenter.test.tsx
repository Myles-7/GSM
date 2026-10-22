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
  it('counts active batches and distinguishes partial timeout failures from the running task', () => {
    render(<TaskCenter tasks={[record('超时核查','running',{providerOutcome:'unknown',items:[
      {id:'1',label:'first batch',state:'failed',error:'AGY_TIMEOUT',providerOutcome:'unknown'},
      {id:'2',label:'second batch',state:'running'},
      {id:'3',label:'third batch',state:'pending'},
    ]})]} chinese retry={vi.fn()} onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByRole('button',{name:'仓库摘要 · 超时核查'}));
    const detail=screen.getByRole('complementary',{name:'任务详情'});
    expect(within(detail).getByText('完成／失败／执行中／未执行／取消: 0 / 1 / 1 / 1 / 0')).toBeVisible();
    expect(within(detail).getByText(/进行中 · 1 个子项超时/)).toBeVisible();
    expect(within(detail).getAllByText('模型响应超时，结果待核对').length).toBeGreaterThan(0);
  });
  it('shows failure diagnostics only after opening task details', () => {
    render(<TaskCenter tasks={[record('diagnostics', 'failed', { error:'Private provider diagnostic', failureCode:'PROVIDER_ERROR' })]} chinese={false} retry={vi.fn()} onNavigate={vi.fn()} />);
    expect(screen.queryByText(/Private provider diagnostic|PROVIDER_ERROR/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name:'Repository summaries · diagnostics' }));
    const details = screen.getByRole('complementary', { name:'Task details' });
    expect(within(details).getByText('Private provider diagnostic')).toBeVisible();
    expect(within(details).getByText('Failure: PROVIDER_ERROR')).toBeVisible();
  });
  it('presents provider and save outcomes in the selected language', () => {
    render(<TaskCenter tasks={[record('状态', 'failed', { items: [{ id: 'a', label: 'owner/repo', state: 'complete', providerOutcome: 'succeeded', commitStatus: 'saved' }] })]} chinese retry={vi.fn()} onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '仓库摘要 · 状态' }));
    expect(screen.getByText('模型结果: 已成功 · 保存: 已保存')).toBeVisible();
    expect(screen.queryByText(/succeeded|not_started/)).not.toBeInTheDocument();
  });
  it('shows phase request totals separately from overall elapsed time', () => {
    render(<TaskCenter tasks={[record('timings', 'complete', { usage: { phase_queue_wait_ms: 1200, phase_generating_ms: 3400 } })]} chinese={false} retry={vi.fn()} onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /^All$/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Repository summaries · timings' }));
    fireEvent.click(screen.getByText('Model configuration and execution metadata'));
    expect(screen.getByText('Waiting for execution slot · Request total')).toBeVisible();
    expect(screen.getByText('1.20s')).toBeVisible(); expect(screen.getByText('3.40s')).toBeVisible();
  });
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
    fireEvent.click(within(detail).getByText('Model configuration and execution metadata'));
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
    fireEvent.click(screen.getByText('模型配置与执行元数据'));
    expect(screen.getAllByText('未记录').length).toBeGreaterThan(0);
  });
  it('replaces the desktop list with full task content and keeps drawer diagnostic-free', () => {
    const open = vi.fn();
    const { unmount } = render(<TaskCenter tasks={[record('whole-page', 'failed', { error: 'diagnostic body' }), record('another', 'running')]} chinese={false} retry={vi.fn()} onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Repository summaries · whole-page' }));
    expect(screen.queryByRole('article')).toBeNull();
    expect(screen.getByRole('tab', { name: 'Execution process' })).toBeVisible();
    expect(screen.getByRole('complementary')).not.toHaveClass('lg:sticky');
    unmount();
    render(<TaskCenter compact tasks={[record('drawer', 'failed', { error: 'secret diagnostics' })]} chinese={false} retry={vi.fn()} onNavigate={vi.fn()} onOpenCenter={open} />);
    fireEvent.click(screen.getByRole('button', { name: 'Repository summaries · drawer' }));
    expect(open).toHaveBeenCalledWith('drawer');
    expect(screen.queryByRole('complementary')).toBeNull();
    expect(screen.queryByText('secret diagnostics')).toBeNull();
  });
  it('protects unknown provider outcomes from history deletion', () => {
    render(<TaskCenter tasks={[record('unknown-history', 'failed', { providerOutcome: 'unknown' })]} chinese={false} retry={vi.fn()} onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Repository summaries · unknown-history' }));
    expect(screen.getByRole('button', { name: 'Delete finished records' })).toBeDisabled();
  });

});
