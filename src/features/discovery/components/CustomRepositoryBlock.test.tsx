import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { makeAssessment, makeChannel } from '../custom/fixtures.test-support';
import { emptyData } from '../custom/model';
vi.mock('../../../store/useAppStore', () => ({
  useAppStore: (selector: (state: unknown) => unknown) => selector({ language: 'zh', repositories: [], aiConfigs: [] }),
}));
vi.mock('../custom/store', () => ({
  useCustomDiscovery: (selector: (state: unknown) => unknown) => selector({ data: emptyData() }),
  updateCustomData: vi.fn(), reportCustomError: vi.fn(),
}));
vi.mock('../custom/analysis', () => ({ analysisKey: () => 'key', useCustomAnalysis: (selector: (state: unknown) => unknown) => selector({ items: [] }) }));
const mockStar = vi.fn();
vi.mock('../hooks/useCustomChannelActions', () => ({ useCustomChannelActions: () => ({ star: mockStar }) }));
vi.mock('../../../components/ReadmeModal', () => ({ ReadmeModal: () => null }));
import { CustomRepositoryBlock } from './CustomRepositoryBlock';
afterEach(cleanup);
it('shows a list text block and keeps selection, questions and evidence separate from opening details', () => {
  const item = makeAssessment();
  const open = vi.fn(), select = vi.fn(), ask = vi.fn();
  render(<CustomRepositoryBlock item={item} repo={{ ...item.repo, ai_summary: 'AI overview' }} channel={makeChannel()}
    active={false} selected={false} onSelect={select} onDetails={open} onAsk={ask} onAnalyze={vi.fn()} />);
  expect(screen.getByText('AI overview')).toHaveClass('line-clamp-4');
  fireEvent.click(screen.getByRole('checkbox', { name: '选择 owner/tool1' }));
  expect(select).toHaveBeenCalledOnce();
  expect(open).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '问答此仓库' }));
  expect(ask).toHaveBeenCalledOnce();
  expect(open).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText('判断证据'));
  expect(open).not.toHaveBeenCalled();
  fireEvent.keyDown(screen.getByRole('article'), { key: 'Enter' });
  expect(open).toHaveBeenCalledOnce();
  expect(screen.queryByText('取消 Star')).not.toBeInTheDocument();
});

it('stars repository directly from card star button', async () => {
  const item = makeAssessment();
  render(<CustomRepositoryBlock item={item} repo={item.repo} channel={makeChannel()}
    active={false} selected={false} onSelect={vi.fn()} onDetails={vi.fn()} onAsk={vi.fn()} onAnalyze={vi.fn()} />);
  const starBtn = screen.getByRole('button', { name: 'Star' });
  await act(async () => {
    fireEvent.click(starBtn);
  });
  expect(mockStar).toHaveBeenCalledWith(item.repo);
});

it('renders unverified triage actions and triggers approve/block callbacks', () => {
  const item = { ...makeAssessment(), verdict: 'unknown' as const };
  const approve = vi.fn(), block = vi.fn();
  render(<CustomRepositoryBlock item={item} repo={item.repo} channel={makeChannel()}
    active={false} selected={false} onSelect={vi.fn()} onDetails={vi.fn()} onAsk={vi.fn()} onAnalyze={vi.fn()}
    onApprove={approve} onBlock={block} />);
  expect(screen.getByText('规则核实建议：此项目待人工确认')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '采纳并推荐' }));
  expect(approve).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole('button', { name: '排除不再推' }));
  expect(block).toHaveBeenCalledOnce();
});
