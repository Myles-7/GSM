import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { openTaskDetails } from '../../services/taskDetailsNavigation';
import { TaskObservationView } from './TaskObservationView';
import type { TaskObservations, TaskRequestObservation } from '../../types/taskObservation';
import type { AITaskRecord } from '../../services/aiTaskJournal';
const mocks = vi.hoisted(() => ({ patch: vi.fn(), snapshot: vi.fn(), load: vi.fn().mockResolvedValue(undefined), pin: vi.fn().mockResolvedValue(true), subscribe: () => () => {} }));
vi.mock('../../services/aiTaskJournal', async importOriginal => ({ ...await importOriginal<typeof import('../../services/aiTaskJournal')>(), aiTaskJournal: { patch: mocks.patch } }));
vi.mock('../../services/taskObservability', () => ({ taskObservability: mocks }));
const task = { id: 'ui-observation-task', owner: 'owner', kind: 'summary', state: 'running', updatedAt: '2026-10-22T01:00:00Z', items: [{ id: '1', label: 'a/repo', state: 'running', phase: 'generating' }, { id: '2', label: 'b/repo', state: 'pending' }] } as AITaskRecord;
const request = (id: string, answer: string): TaskRequestObservation => ({ owner: task.owner, taskId: task.id, requestId: id, label: id, source: 'agy', attempt: 1, mode: 'final', phase: 'generating', startedAt: '2026-10-22T01:00:00Z', phaseStartedAt: '2026-10-22T01:00:00Z', lastActivityAt: '2026-10-22T01:01:00Z', answer, reasoning: '', receivedChars: answer.length, truncated: false });
let data: TaskObservations;
beforeEach(() => { data = { loaded: true, pinned: false, truncated: false, requests: [request('req-1', '<script>alert(1)</script> answer one'), request('req-2', 'answer two')], results: [], events: [] }; mocks.snapshot.mockImplementation(() => data); vi.clearAllMocks(); });
describe('task observation tabs', () => {
  it('shows the blocking cause above requests and distinguishes saved checkpoints from current batches', () => {
    const blocked = { ...task, id: 'blocked-exploration', kind: 'exploration' as const, state: 'failed' as const,
      units: { items: 'batches' as const, repositories: 131 }, progress: { done: 10, total: 131 }, error: 'AGY_RECOVERY_STORAGE_FULL' };
    data.requests = [{ ...request('blocked-request', ''), error: 'AGY_RECOVERY_STORAGE_FULL', endedAt: '2026-10-22T01:01:00Z', outcome: 'failed' }];
    render(<TaskObservationView task={blocked} chinese />);
    expect(screen.getByText('累计项目已保存（含此前检查点）: 10/131')).toBeVisible();
    expect(screen.getAllByText(/本机恢复区额度不足/)).toHaveLength(2);
    expect(screen.getByRole('status')).toHaveTextContent('已有模型结果仍保留');
  });
  it('freezes request clocks when an interrupted task has no end timestamp', () => {
    const interrupted = { ...task, id: 'interrupted-clock', state: 'interrupted' as const, updatedAt: '2026-10-22T01:01:10Z' };
    render(<TaskObservationView task={interrupted} chinese={false} />);
    expect(screen.getAllByText(/Request elapsed 70.0s · Current phase elapsed 70.0s/)).toHaveLength(2);
  });
  it('opens a map checkpoint directly in its read-only results tab',()=>{
    openTaskDetails(task.owner,'checkpoint-test','results');
    render(<TaskObservationView task={{...task,id:'checkpoint-test'}} chinese={false}/>);
    expect(screen.getByRole('tab',{name:'Analysis results'})).toHaveAttribute('aria-selected','true');
  });
  it('honors an explicit checkpoint result link after this task was previously viewed on another tab',()=>{
    const local={...task,id:'checkpoint-revisit'};
    const first=render(<TaskObservationView task={local} chinese={false}/>);
    fireEvent.click(screen.getByRole('tab',{name:'Returned content'}));first.unmount();
    openTaskDetails(task.owner,local.id,'results');
    render(<TaskObservationView task={local} chinese={false}/>);
    expect(screen.getByRole('tab',{name:'Analysis results'})).toHaveAttribute('aria-selected','true');
  });
  it('defaults to actual process counts and separates requests from repositories', () => {
    render(<TaskObservationView task={task} chinese>{<p>Existing controls</p>}</TaskObservationView>);
    expect(screen.getByRole('tab', { name: '执行过程' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('仓库: 2')).toBeVisible();
    expect(screen.getByText('请求: 2 · 批次: 未记录')).toBeVisible();
    expect(screen.getByText('生成回答: 1')).toBeVisible();
    expect(screen.getByText('Existing controls')).toBeVisible();
  });
  it('selects concurrent request bodies safely and discloses missing reasoning and final-only mode', () => {
    render(<TaskObservationView task={{ ...task, id: 'content-test' }} chinese={false} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Returned content' }));
    const panel = screen.getByRole('tabpanel');
    expect(within(panel).getByText('<script>alert(1)</script> answer one')).toBeVisible();
    expect(panel.querySelector('script')).toBeNull();
    expect(screen.getByText('Final response only; no incremental output was recorded.')).toBeVisible();
    expect(screen.getByText('Native reasoning was not provided or recorded.')).toBeVisible();
    fireEvent.change(screen.getByRole('combobox', { name: 'Select request' }), { target: { value: 'req-2' } });
    expect(screen.getByText('answer two')).toBeVisible();
  });
  it('renders structured result fields, saved status, evidence and collapsed JSON', () => {
    data.results = [{ id: 'r1', label: 'a/repo', repositoryId: 1, commitStatus: 'saved', data: { summary: 'Useful repository', topics: ['tooling'], evidence: [{ text: 'README evidence' }], relations: [{ target: 'b/repo', reason: 'same topic' }] } }];
    render(<TaskObservationView task={{ ...task, id: 'result-test' }} chinese={false} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Analysis results' }));
    expect(screen.getByText('Useful repository')).toBeVisible();
    expect(screen.getByText('README evidence')).toBeVisible();
    expect(screen.getByText('Saved')).toBeVisible();
    expect(screen.getByText('Raw JSON').closest('details')).not.toHaveAttribute('open');
  });
  it('does not expose request content in process diagnostics and reports storage gaps', () => {
    data.storageError = 'disk full'; data.truncated = true;
    render(<TaskObservationView task={{ ...task, id: 'storage-test' }} chinese={false} />);
    expect(screen.queryByText('answer two')).toBeNull();
    expect(screen.getByRole('alert')).toHaveTextContent('disk full');
    expect(screen.getByText(/retention limit/i)).toBeVisible();
  });
  it('remembers tab and request per task and account without mixing owners', () => {
    const memoryTask = { ...task, id: 'memory-test' };
    const first = render(<TaskObservationView task={memoryTask} chinese={false} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Returned content' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Select request' }), { target: { value: 'req-2' } });
    first.unmount();
    const second = render(<TaskObservationView task={memoryTask} chinese={false} />);
    expect(screen.getByRole('tab', { name: 'Returned content' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('combobox', { name: 'Select request' })).toHaveValue('req-2');
    second.unmount();
    render(<TaskObservationView task={{ ...memoryTask, owner: 'another-account' }} chinese={false} />);
    expect(screen.getByRole('tab', { name: 'Execution process' })).toHaveAttribute('aria-selected', 'true');
  });
  it('records the history pin in both journal and body retention metadata', async () => {
    render(<TaskObservationView task={{ ...task, id: 'pin-test' }} chinese={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'Pin history' }));
    await waitFor(()=>expect(mocks.patch).toHaveBeenCalledWith('pin-test', { pinned: true }));
    expect(mocks.pin).toHaveBeenCalledWith('owner', 'pin-test', true);
  });
  it('stops auto-follow after scrolling upward and resumes on explicit latest action', () => {
    const localTask = { ...task, id: 'scroll-test' };
    const { rerender } = render(<TaskObservationView task={localTask} chinese={false} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Returned content' }));
    const scroll = screen.getByTestId('task-answer-scroll');
    Object.defineProperties(scroll, { scrollHeight: { configurable: true, value: 1000 }, clientHeight: { configurable: true, value: 200 } });
    scroll.scrollTop = 100; fireEvent.scroll(scroll);
    data = { ...data, requests: [{ ...data.requests[0], answer: 'new answer' }, data.requests[1]] };
    rerender(<TaskObservationView task={localTask} chinese={false} />);
    expect(scroll.scrollTop).toBe(100);
    fireEvent.click(screen.getByRole('button', { name: 'Back to latest' }));
    expect(scroll.scrollTop).toBe(1000);
  });
  it('keeps real native reasoning separate and collapsed', () => {
    data.requests[0] = { ...data.requests[0], reasoning: 'Source-provided reasoning' };
    render(<TaskObservationView task={{ ...task, id: 'reasoning-test' }} chinese={false} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Returned content' }));
    expect(screen.getByText('Native reasoning from source').closest('details')).not.toHaveAttribute('open');
    expect(screen.getByText('Source-provided reasoning')).not.toBeVisible();
    expect(screen.getByLabelText('Answer')).not.toHaveTextContent('Source-provided reasoning');
  });

  it('uses reliable repository units and excludes topic consolidation from map batch counts', () => {
    const mapTask: AITaskRecord = { ...task, id: 'batch-count-test', kind: 'exploration', units: { items: 'batches', repositories: 10 }, items: [
      { id: 'batch:1', label: 'first five repositories', state: 'running' },
      { id: 'batch:2', label: 'second five repositories', state: 'pending' },
      { id: 'topics', label: 'Consolidate equivalent topics', state: 'pending' },
    ] };
    render(<TaskObservationView task={mapTask} chinese={false} />);
    expect(screen.getByText('Repositories: 10')).toBeVisible();
    expect(screen.getByText('Requests: 2 · Batches: 2')).toBeVisible();
    expect(screen.getByText('Phase counts include topic consolidation; batch counts exclude that step.')).toBeVisible();
  });

  it('copies only the selected answer body and surfaces clipboard failure', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    render(<TaskObservationView task={{ ...task, id: 'copy-test' }} chinese={false} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Returned content' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Select request' }), { target: { value: 'req-2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Copy answer' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Copied'));
    expect(writeText).toHaveBeenCalledWith('answer two');
    writeText.mockRejectedValueOnce(new Error('denied'));
    fireEvent.click(screen.getByRole('button', { name: 'Copy answer' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Copy failed; select the text manually'));
  });

});
