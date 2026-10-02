import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { HomeTasksPanel } from './HomeTasksPanel';
import type { HomeSync } from '../../home/sync';

function setup() {
  let version = 3;
  let repositoryVersion = 7;
  let applied = false;
  let listener = () => {};
  const request = vi.fn(async (path: string) => {
    if (path.startsWith('/tasks?')) return { tasks: [{ id: 'task', kind: 'chat', status: 'completed', input: { prompt: '研究仓库' }, result: { content: '已保存的答案' }, updatedAt: '2026-09-29' }] };
    version++; applied = true; return { results: [{ index: 0, status: 'applied' }] };
  });
  const sync = {
    identity: { workspaceId: 'home', githubUserId: 42 }, api: { request }, sync: vi.fn(async () => {}),
    subscribe: vi.fn((callback: () => void) => { listener = callback; return () => {}; }),
    db: { list: vi.fn(async (collection: string) => collection === 'repositories' ? [{ id: '1', version: repositoryVersion, data: { full_name: 'owner/repo' } }] : [{ id: 'proposal', version, data: { status: applied ? 'applied' : 'pending', appliedIndices: applied ? [0] : [], proposal: { title: '整理标签', operations: [{ kind: 'update', repository: 'owner/repo', patch: { custom_tags: ['tool'] } }] } } }]) },
  } as unknown as HomeSync;
  return { sync, request, changeRepository: () => { repositoryVersion++; listener(); } };
}

describe('desktop home tasks and proposals', () => {
  it('requires selection and explicit confirmation, sends reviewed versions, and refreshes the applied proposal', async () => {
    const { sync, request } = setup(); render(<HomeTasksPanel sync={sync} />);
    expect(await screen.findByText('已保存的答案')).toBeInTheDocument();
    const apply = screen.getByRole('button', { name: '执行选中操作' });
    expect(apply).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: /update · owner\/repo/ })); expect(apply).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: /我确认执行/ })); expect(apply).toBeEnabled();
    fireEvent.click(apply);
    await waitFor(() => expect(request).toHaveBeenCalledWith('/proposals/proposal/apply', {
      workspaceId: 'home', githubUserId: 42, proposalVersion: 3, confirm: true, selectedIndices: [0], expectedVersions: { '1': 7 },
    }));
    expect(await screen.findByText('整理标签 · 版本 4 · applied')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '执行选中操作' })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: /update · owner\/repo/ })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('applied');
  });
  it('invalidates approval when reviewed repository versions change', async () => {
    const { sync, request, changeRepository } = setup(); render(<HomeTasksPanel sync={sync} />);
    fireEvent.click(await screen.findByRole('checkbox', { name: /update · owner\/repo/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /我确认执行/ }));
    await act(async () => { changeRepository(); });
    await waitFor(() => expect(screen.getByRole('button', { name: '执行选中操作' })).toBeDisabled());
    expect(screen.getByRole('checkbox', { name: /我确认执行/ })).not.toBeChecked();
    expect(request.mock.calls.every(([path]) => path.startsWith('/tasks?'))).toBe(true);
  });
});
