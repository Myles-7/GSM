import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PendingOperation } from '../../home/types';
import { HomeBackendPanel } from './HomeBackendPanel';

const mocks = vi.hoisted(() => ({ current: null as unknown, pending: vi.fn(), resolve: vi.fn(), sync: vi.fn() }));
vi.mock('../../home/desktop', () => ({ getDesktopHomeSync: () => mocks.current, subscribeDesktopHome: () => () => {} }));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.pending.mockResolvedValue([]); mocks.resolve.mockResolvedValue(undefined); mocks.sync.mockResolvedValue(undefined);
  mocks.current = { db: { pending: mocks.pending, resolve: mocks.resolve }, sync: mocks.sync, view: { pending: 1, conflicts: 0 } };
});

describe('desktop incremental sync settings', () => {
  it('hides workspace tools when no desktop workspace is attached', () => {
    mocks.current = null; const view = render(<HomeBackendPanel />);
    expect(view.container).toBeEmptyDOMElement();
  });
  it('keeps desktop sync without retired mobile migration or task tools', async () => {
    render(<HomeBackendPanel />);
    fireEvent.click(screen.getByRole('button', { name: '立即同步' }));
    await waitFor(() => expect(mocks.sync).toHaveBeenCalledOnce());
    expect(screen.queryByText(/Tailscale|Android|迁移快照|任务与提案/)).toBeNull();
  });
  it('resolves a conflict with the user-selected version before syncing', async () => {
    mocks.pending.mockResolvedValue([{ key: 'fixture-key', collection: 'repositories', id: 'fixture-id',
      data: { title: 'local' }, conflict: { data: { title: 'server' } } } as unknown as PendingOperation]);
    render(<HomeBackendPanel />);
    fireEvent.click(await screen.findByRole('button', { name: '使用服务器版本' }));
    await waitFor(() => expect(mocks.resolve).toHaveBeenCalledWith('fixture-key', false));
    expect(mocks.resolve.mock.invocationCallOrder[0]).toBeLessThan(mocks.sync.mock.invocationCallOrder[0]);
  });
  it('reports sync failure and allows retry', async () => {
    mocks.sync.mockRejectedValueOnce(new Error('fixture error'));
    render(<HomeBackendPanel />);
    fireEvent.click(screen.getByRole('button', { name: '立即同步' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('fixture error');
    fireEvent.click(screen.getByRole('button', { name: '立即同步' }));
    await waitFor(() => expect(mocks.sync).toHaveBeenCalledTimes(2));
  });
});
