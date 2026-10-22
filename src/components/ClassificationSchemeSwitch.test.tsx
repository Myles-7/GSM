import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
const mocks = vi.hoisted(() => ({
  state: { activeClassificationScheme: 'purpose', language: 'zh-CN', user: { id: 42 }, repositories: [{ id: 1 }, { id: 2 }], classificationSchemes: { generation: { status: 'ready', generation: 2, syncPending: true, queuedRepositoryIds: Array.from({ length: 1000 }, (_, i) => i + 1) } }, setClassificationScheme: vi.fn() },
  read: vi.fn(), retry: vi.fn(), rebuild: vi.fn(), confirm: vi.fn(), toast: vi.fn(),
}));
vi.mock('../store/useAppStore', () => ({ useAppStore: Object.assign((selector: (state: typeof mocks.state) => unknown) => selector(mocks.state), { getState: () => mocks.state }) }));
vi.mock('../hooks/useDialog', () => ({ useDialog: () => ({ confirm: mocks.confirm, toast: mocks.toast }) }));
vi.mock('../i18n/useT', () => ({ useT: () => (key: string) => key }));
vi.mock('../services/aiClassificationRebuild', () => ({ enqueueAIClassificationRebuild: mocks.rebuild }));
vi.mock('../services/classificationSync', () => ({ readClassificationSyncView: mocks.read, subscribeClassificationSync: () => () => {}, syncAIClassification: mocks.retry }));
import { ClassificationSchemeSwitch } from './ClassificationSchemeSwitch';
beforeEach(() => { mocks.state.user = { id: 42 }; mocks.read.mockReset().mockResolvedValue({ status: 'pending', pending: 2 }); mocks.retry.mockReset().mockResolvedValue(undefined); mocks.rebuild.mockClear(); mocks.confirm.mockReset().mockResolvedValue(false); });
describe('classification generation and delivery UI', () => {
  it('requires explicit confirmation before replacing saved classifications', async () => {
    render(<ClassificationSchemeSwitch />);
    fireEvent.click(screen.getByRole('button', { name: '立即重建 AI 分类' }));
    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledOnce());
    expect(mocks.rebuild).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole('button', { name: '立即重建 AI 分类' })).toBeEnabled());
    mocks.confirm.mockResolvedValue(true);
    fireEvent.click(screen.getByRole('button', { name: '立即重建 AI 分类' }));
    await waitFor(() => expect(mocks.rebuild).toHaveBeenCalledWith([1, 2], { force: true, overwriteLocks: true }));
  });
  it('does not rebuild after the account changes while confirmation is open', async () => {
    mocks.confirm.mockImplementation(async () => { mocks.state = { ...mocks.state, user: { id: 99 } }; return true; });
    render(<ClassificationSchemeSwitch />);
    fireEvent.click(screen.getByRole('button', { name: '立即重建 AI 分类' }));
    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledOnce());
    expect(mocks.rebuild).not.toHaveBeenCalled();
  });
  it('renders generation and real pending operations separately; retry only delivers classification', async () => {
    render(<ClassificationSchemeSwitch />);
    expect(screen.getByText('分类已更新')).toBeInTheDocument();
    await screen.findByText('等待同步 · 2 项待同步');
    expect(screen.queryByText(/1000/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '重试分类同步' }));
    await waitFor(() => expect(mocks.retry).toHaveBeenCalledOnce());
    expect(mocks.rebuild).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '立即重建 AI 分类' })).toHaveAttribute('title', '重新生成 AI 分类，可能覆盖手动调整。');
    expect(screen.queryByText('下次 AI 分析重建可能覆盖手动调整。')).not.toBeInTheDocument();
  });
  it('keeps sync failure details off the repository page', async () => {
    mocks.read.mockResolvedValue({ status: 'error', pending: 2, error: 'Server rejected membership version 7' });
    render(<ClassificationSchemeSwitch />);
    await screen.findByText('等待同步 · 2 项待同步');
    expect(screen.queryByLabelText(/Server rejected/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '任务记录' })).toBeInTheDocument();
  });
});
