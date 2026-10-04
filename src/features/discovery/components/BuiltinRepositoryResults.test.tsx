import type { ComponentProps } from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AIConfig, DiscoveryRepo, Repository } from '../../../types';
import type { AnalysisItem } from '../custom/analysis';
import { emptyData } from '../custom/model';
import { makeRepo } from '../custom/fixtures.test-support';
import { discoveryAnalysisIdentity } from '../custom/analysisIdentity';
import type { SubscriptionRepoCard } from '../../../components/SubscriptionRepoCard';
import type { RepositoryDetailsPanel } from '../../../components/RepositoryDetailsPanel';

const mocks = vi.hoisted(() => ({
  app: { language: 'zh', aiConfigs: [] as AIConfig[], activeAIConfig: null as string | null },
  enqueue: vi.fn(), cancel: vi.fn(), pause: vi.fn(),
}));
vi.mock('../../../store/useAppStore', () => ({
  useAppStore: (selector: (state: typeof mocks.app) => unknown) => selector(mocks.app),
}));
vi.mock('../custom/store', () => ({
  useCustomDiscovery: (selector: (state: { data: ReturnType<typeof emptyData> }) => unknown) => selector({ data: emptyData() }),
}));
vi.mock('../../../services/repositoryAnalysisAssets', () => ({ useRepositoryAnalysisAssets: () => undefined }));
vi.mock('../custom/analysis', async () => {
  const { create } = await import('zustand');
  const { discoveryAnalysisIdentity: identity } = await import('../custom/analysisIdentity');
  return {
    analysisKey: vi.fn((repo: Repository, language: string, config?: AIConfig) => identity(repo, language, config)),
    analyzedRepository: (repo: Repository) => repo,
    useCustomAnalysis: create(() => ({ account: '123', running: false, paused: false, issue: null,
      items: [] as AnalysisItem[], pausedChannels: {} as Record<string, boolean>, issuesByChannel: {} })),
    enqueueAnalysis: mocks.enqueue, cancelAnalysis: mocks.cancel, setAnalysisPaused: mocks.pause,
  };
});
// Keep the parent contract observable without mounting unrelated card/overlay stores.
vi.mock('../../../components/SubscriptionRepoCard', () => ({
  SubscriptionRepoCard: (props: ComponentProps<typeof SubscriptionRepoCard>) => (
    <article data-testid={`card-${props.repo.id}`}>
      <input type="checkbox" aria-label={`select ${props.repo.id}`} checked={props.selected} onChange={props.onSelect} />
      <button onClick={props.onDetails}>details {props.repo.id}</button>
      <button onClick={props.onAsk}>ask {props.repo.id}</button>
      <button onClick={props.onRequestAnalysis}>analyze {props.repo.id}</button>
      {props.analysisStatus}
    </article>
  ),
}));
vi.mock('../../../components/RepositoryDetailsPanel', () => ({
  RepositoryDetailsPanel: (props: ComponentProps<typeof RepositoryDetailsPanel>) => props.repository && (
    <aside data-testid="details">
      {props.repository.full_name}
      <span>{String(props.analysisStatus?.running)}:{props.analysisStatus?.stage}</span>
      <button onClick={props.onPrevious}>previous</button><button onClick={props.onNext}>next</button>
      <button onClick={props.onClose}>close details</button>
      {props.analysisAction?.(props.repository)}
    </aside>
  ),
}));
vi.mock('../../../components/RepositoryChatSheet', () => ({
  default: ({ repository, onClose }: { repository: Repository; onClose: () => void }) => (
    <div data-testid="chat">{repository.full_name}<button onClick={onClose}>close chat</button></div>
  ),
}));

import { analysisKey, useCustomAnalysis } from '../custom/analysis';
import { BuiltinRepositoryResults } from './BuiltinRepositoryResults';

const repo = (id = 1, changes: Partial<DiscoveryRepo> = {}): DiscoveryRepo => ({
  ...makeRepo(id), rank: id, channel: 'trending', platform: 'All', ...changes,
});
const task = (repository: DiscoveryRepo, status: AnalysisItem['status'], changes: Partial<AnalysisItem> = {}): AnalysisItem => ({
  repo: repository, channelId: 'builtin:trending', revision: 1,
  key: discoveryAnalysisIdentity(repository, mocks.app.language, mocks.app.aiConfigs[0]), status, ...changes,
});
const card = (id = 1) => within(screen.getByTestId(`card-${id}`));
const setTasks = (items: AnalysisItem[]) => act(() => useCustomAnalysis.setState({ items }));

beforeEach(() => {
  mocks.app.language = 'zh'; mocks.app.aiConfigs = []; mocks.app.activeAIConfig = null;
  vi.clearAllMocks();
  useCustomAnalysis.setState({ account: '123', running: false, paused: false, issue: null,
    items: [], pausedChannels: {}, issuesByChannel: {} });
});
afterEach(cleanup);

describe('BuiltinRepositoryResults task matching', () => {
  it.each(['issue', 'pause', 'task-add', 'task-update', 'task-array', 'global-runtime'] as const)(
    'does not render current results after an unrelated %s update', update => {
      const items = [repo(1), repo(2)];
      const current = task(items[0], 'running');
      const other = task(items[1], 'queued', { channelId: 'builtin:most-popular' });
      setTasks([current, other]);
      render(<BuiltinRepositoryResults items={items} channelId="trending" />);
      fireEvent.click(card(2).getByRole('checkbox'));
      fireEvent.click(card(1).getByText('details 1'));
      const keyCalls = vi.mocked(analysisKey).mock.calls.length;
      act(() => {
        switch (update) {
          case 'issue': useCustomAnalysis.setState({ issuesByChannel: { 'builtin:most-popular': { kind: 'network' } } }); break;
          case 'pause': useCustomAnalysis.setState({ pausedChannels: { 'builtin:most-popular': true } }); break;
          case 'task-add': useCustomAnalysis.setState({ items: [current, other, task(repo(3), 'queued', { channelId: 'custom:other' })] }); break;
          case 'task-update': useCustomAnalysis.setState({ items: [current, { ...other, status: 'running' }] }); break;
          case 'task-array': useCustomAnalysis.setState({ items: [current, other] }); break;
          case 'global-runtime': useCustomAnalysis.setState({ running: true, paused: true, issue: { kind: 'network' } }); break;
        }
      });
      // One key is computed per card on every parent render, so unchanged calls
      // prove the result batch did not render, beyond unchanged visible text.
      expect(analysisKey).toHaveBeenCalledTimes(keyCalls);
      expect(card(1).getByRole('status')).toHaveTextContent('分析中');
      expect(card(2).getByRole('checkbox')).toBeChecked();
      expect(screen.getByTestId('details')).toHaveTextContent('owner/tool1');
      expect(screen.queryByRole('alert')).toBeNull();
    },
  );

  it('keeps an empty channel stable when tasks in another channel change', () => {
    const item = repo();
    render(<BuiltinRepositoryResults items={[item]} channelId="trending" />);
    const keyCalls = vi.mocked(analysisKey).mock.calls.length;
    setTasks([task(item, 'running', { channelId: 'builtin:most-popular' })]);
    expect(analysisKey).toHaveBeenCalledTimes(keyCalls);
    expect(card().queryByRole('status')).toBeNull();
  });

  it('updates current-channel pause, issue and stage without losing selection or details', () => {
    const item = repo();
    setTasks([task(item, 'running', { stage: 'readme' })]);
    render(<BuiltinRepositoryResults items={[item]} channelId="trending" />);
    fireEvent.click(card().getByRole('checkbox'));
    fireEvent.click(card().getByText('details 1'));
    expect(screen.getByTestId('details')).toHaveTextContent('true:readme');
    act(() => useCustomAnalysis.setState({ pausedChannels: { 'builtin:trending': true } }));
    fireEvent.click(screen.getByRole('button', { name: '继续分析' }));
    expect(mocks.pause).toHaveBeenCalledWith('builtin:trending', false);
    act(() => useCustomAnalysis.setState({ pausedChannels: { 'builtin:trending': false } }));
    expect(screen.getByRole('button', { name: '暂停分析' })).toBeInTheDocument();
    act(() => useCustomAnalysis.setState({ issuesByChannel: { 'builtin:trending': { kind: 'auth' } } }));
    expect(screen.getByRole('alert')).toHaveTextContent('请检查 GitHub 登录和当前 AI 配置');
    const keyCalls = vi.mocked(analysisKey).mock.calls.length;
    act(() => useCustomAnalysis.setState(s => ({ issuesByChannel: { ...s.issuesByChannel, other: { kind: 'network' } } })));
    expect(analysisKey).toHaveBeenCalledTimes(keyCalls);
    setTasks([task(item, 'running', { stage: 'model' })]);
    expect(screen.getByTestId('details')).toHaveTextContent('true:model');
    act(() => useCustomAnalysis.setState({ issuesByChannel: { 'builtin:trending': null } }));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(card().getByRole('checkbox')).toBeChecked();
  });

  it('observes task order changes and current-channel resets', () => {
    const item = repo();
    const queued = task(item, 'queued');
    const running = task(item, 'running');
    setTasks([queued, running]);
    const view = render(<BuiltinRepositoryResults items={[item]} channelId="trending" />);
    expect(card().getByRole('status')).toHaveTextContent('排队中');
    setTasks([running, queued]);
    expect(card().getByRole('status')).toHaveTextContent('分析中');
    view.rerender(<BuiltinRepositoryResults items={[item]} channelId="most-popular" />);
    expect(card().queryByRole('status')).toBeNull();
    act(() => useCustomAnalysis.setState({ issuesByChannel: { 'builtin:most-popular': { kind: 'network' } } }));
    expect(screen.getByRole('alert')).toHaveTextContent('网络请求失败');
    act(() => useCustomAnalysis.setState({ account: '456', items: [], pausedChannels: {}, issuesByChannel: {}, issue: null }));
    expect(screen.queryByRole('alert')).toBeNull();
    view.rerender(<BuiltinRepositoryResults items={[item]} channelId="trending" />);
    expect(card().queryByRole('status')).toBeNull();
  });

  it('keeps the first matching task in the current channel and computes one key per repository', () => {
    const items = [repo(1), repo(2), repo(3)];
    setTasks([
      task(items[0], 'failed', { channelId: 'builtin:most-popular' }),
      task(items[0], 'queued'), task(items[0], 'running'), task(items[1], 'running'),
    ]);
    render(<BuiltinRepositoryResults items={items} channelId="trending" />);
    expect(card(1).getByRole('status')).toHaveTextContent('排队中');
    expect(card(2).getByRole('status')).toHaveTextContent('分析中');
    expect(card(3).queryByRole('status')).toBeNull();
    expect(analysisKey).toHaveBeenCalledTimes(items.length);
    expect(mocks.enqueue).not.toHaveBeenCalled();
    expect(screen.getByTestId('card-1').parentElement).toHaveAttribute('data-reading-key', 'repo:1');
    expect(screen.getByTestId('card-3').parentElement).toHaveAttribute('data-repo-index', '2');
  });

  it.each([
    ['queued', '排队中'], ['running', '分析中'], ['failed', '分析失败'],
    ['waiting', null], ['done', null], ['cancelled', null],
  ] as const)('preserves the existing %s card status', (status, label) => {
    const item = repo(); setTasks([task(item, status)]);
    render(<BuiltinRepositoryResults items={[item]} channelId="trending" />);
    if (label) expect(card().getByRole('status')).toHaveTextContent(label);
    else expect(card().queryByRole('status')).toBeNull();
  });

  it('uses updated task records and drops old lookup entries after the account runtime resets', () => {
    const item = repo(); setTasks([task(item, 'queued')]);
    render(<BuiltinRepositoryResults items={[item]} channelId="trending" />);
    setTasks([task(item, 'running')]);
    expect(card().getByRole('status')).toHaveTextContent('分析中');
    act(() => useCustomAnalysis.setState({ issuesByChannel: { other: { kind: 'cancelled' } } }));
    expect(card().getByRole('status')).toHaveTextContent('分析中');
    // The existing account lifecycle resets items; the derived lookup must not retain them.
    act(() => useCustomAnalysis.setState({ account: '456', items: [], issuesByChannel: {} }));
    expect(card().queryByRole('status')).toBeNull();
    setTasks([task(item, 'failed')]);
    expect(card().getByRole('status')).toHaveTextContent('分析失败');
  });

  it('rebuilds channel matching when the channel changes', () => {
    const item = repo();
    setTasks([task(item, 'queued'), task(item, 'running', { channelId: 'builtin:most-popular' })]);
    const view = render(<BuiltinRepositoryResults items={[item]} channelId="trending" />);
    view.rerender(<BuiltinRepositoryResults items={[item]} channelId="most-popular" />);
    expect(card().getByRole('status')).toHaveTextContent('分析中');
  });

  it('matches the real key after language, model configuration and repository revision changes', () => {
    const item = repo();
    const config: AIConfig = { id: 'fixture', name: 'fixture', model: 'a', isActive: true, baseUrl: 'https://example.invalid', apiKey: '' };
    mocks.app.aiConfigs = [config]; mocks.app.activeAIConfig = config.id;
    setTasks([task(item, 'queued')]);
    const view = render(<BuiltinRepositoryResults items={[item]} channelId="trending" />);
    expect(card().getByRole('status')).toHaveTextContent('排队中');
    mocks.app.language = 'en';
    view.rerender(<BuiltinRepositoryResults items={[item]} channelId="trending" />);
    expect(card().queryByRole('status')).toBeNull();
    setTasks([task(item, 'running')]);
    expect(card().getByRole('status')).toHaveTextContent('Analyzing');
    mocks.app.aiConfigs = [{ ...config, model: 'b', useCustomPrompt: true, customPrompt: 'fixture' }];
    view.rerender(<BuiltinRepositoryResults items={[item]} channelId="trending" />);
    expect(card().queryByRole('status')).toBeNull();
    setTasks([task(item, 'failed')]);
    expect(card().getByRole('status')).toHaveTextContent('Analysis failed');
    view.rerender(<BuiltinRepositoryResults items={[{ ...item, pushed_at: '2026-10-02T00:00:00Z' }]} channelId="trending" />);
    expect(card().queryByRole('status')).toBeNull();
  });

  it('preserves selection, analysis requests, detail navigation and chat callbacks', async () => {
    const items = [repo(1), repo(2)]; setTasks([task(items[0], 'running', { stage: 'model' })]);
    render(<BuiltinRepositoryResults items={items} channelId="trending" />);
    fireEvent.click(card(2).getByRole('checkbox'));
    expect(card(2).getByRole('checkbox')).toBeChecked();
    fireEvent.click(card(1).getByText('details 1'));
    expect(screen.getByTestId('details')).toHaveTextContent('owner/tool1');
    expect(screen.getByTestId('details')).toHaveTextContent('true:model');
    fireEvent.click(screen.getByText('next'));
    expect(screen.getByTestId('details')).toHaveTextContent('owner/tool2');
    fireEvent.click(screen.getByText('previous'));
    expect(screen.getByTestId('details')).toHaveTextContent('owner/tool1');
    fireEvent.click(screen.getByText('close details'));
    expect(screen.queryByTestId('details')).toBeNull();
    fireEvent.click(card(2).getByText('ask 2'));
    expect(await screen.findByTestId('chat')).toHaveTextContent('owner/tool2');
    fireEvent.click(screen.getByText('close chat'));
    expect(screen.queryByTestId('chat')).toBeNull();
    setTasks([]);
    fireEvent.click(screen.getByRole('button', { name: '分析所选' }));
    expect(mocks.enqueue).toHaveBeenCalledWith({ id: 'builtin:trending', revision: 1 }, [items[1]]);
    fireEvent.click(card(1).getByText('analyze 1'));
    expect(mocks.enqueue).toHaveBeenLastCalledWith({ id: 'builtin:trending', revision: 1 }, [items[0]]);
  });

  it('preserves analyzed status and explicit confirmation before reanalysis', () => {
    const details = {
      version: 1 as const, generated_at: '2026-10-03', repository_pushed_at: '2026-09-01',
      model: 'fixture', sources: [], summary: 'fixture', problem: null, features: [], scenarios: [],
      architecture: null, quickstart: [], deployment: null, cost: null, maintenance: null,
      software_forms: [], platforms: [], tags: [], deployment_modes: [],
    };
    const item = repo(1, { ai_details: details }); setTasks([task(item, 'done')]);
    render(<BuiltinRepositoryResults items={[item]} channelId="trending" />);
    expect(card().getByRole('status')).toHaveTextContent('已分析');
    fireEvent.click(card().getByText('analyze 1'));
    expect(mocks.enqueue).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toHaveTextContent('重新分析所选项目？');
    fireEvent.click(screen.getByRole('button', { name: '开始分析' }));
    expect(mocks.enqueue).toHaveBeenCalledWith({ id: 'builtin:trending', revision: 1 }, [item], { force: true });
  });
});
