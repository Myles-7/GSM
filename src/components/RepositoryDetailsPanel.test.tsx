import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Repository } from '../types';
import { RepositoryDetailsPanel } from './RepositoryDetailsPanel';

vi.mock('../i18n/useT', () => ({ useT: () => (key: string) => key, makeT: () => (key: string) => key }));
vi.mock('../store/useAppStore', () => ({
  useAppStore: (select: (state: unknown) => unknown) => select({ language: 'en', releases: [], aiConfigs: [] }),
}));
vi.mock('./RepositoryHealthPanel', () => ({ RepositoryHealthPanel: () => <div>health-facts</div> }));
vi.mock('./RepositoryDetailAnalysisAction', () => ({ RepositoryDetailAnalysisAction: () => <button>opt-in-analysis</button> }));
vi.mock('../features/repositories/hooks/useRepositoryDetailAnalysisJob', () => ({ useRepositoryDetailAnalysisJob: () => ({}) }));
vi.mock('./ReadmeModal', () => ({ ReadmeModal: () => <div data-testid="in-app-readme" /> }));
vi.mock('../services/aiService', () => ({ AIService: vi.fn() }));
vi.mock('../services/githubApiFactory', () => ({ createGitHubApiService: vi.fn() }));
vi.mock('../services/backendAdapter', () => ({ backend: {} }));
vi.mock('../services/routeMode', () => ({ shouldBypassBackend: () => true }));

const repository = {
  id: 1, full_name: 'owner/repo', html_url: 'https://github.com/owner/repo',
  description: 'Original', ai_summary: 'AI summary', custom_description: 'Custom summary',
  pushed_at: '2026-09-02T00:00:00Z',
} as Repository;
describe('RepositoryDetailsPanel', () => {
  it('supports an injected analysis action and docks by default without using the saved-repository action', async () => {
    render(<RepositoryDetailsPanel repository={repository} onClose={vi.fn()} defaultDocked analysisAction={() => <button>discovery-analysis</button>} />);
    expect(await screen.findByRole('complementary')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'discovery-analysis' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'opt-in-analysis' })).not.toBeInTheDocument();
  });
  it('preserves an intentionally blank personal description', () => {
    render(<RepositoryDetailsPanel repository={{ ...repository, custom_description: '' }} onClose={vi.fn()} />);
    expect(screen.queryByText('AI summary')).not.toBeInTheDocument();
    expect(screen.queryByText('Original')).not.toBeInTheDocument();
  });
  beforeEach(() => {
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true });
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 1200 } as DOMRect);
  });
  afterEach(() => vi.restoreAllMocks());
  it('opens without AI details and uses custom description plus existing health facts', () => {
    render(<RepositoryDetailsPanel repository={repository} onClose={vi.fn()} />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Custom summary')).toBeInTheDocument();
    expect(screen.queryByText('AI summary')).not.toBeInTheDocument();
    expect(screen.getByText('details.notAnalyzed')).toBeInTheDocument();
    expect(screen.getByText('health-facts')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'details.readme' })).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toHaveClass('left-0', 'h-dvh', 'w-screen', 'sm:max-w-[480px]');
  });
  it('opens the lazy in-app README instead of navigating externally', async () => {
    render(<RepositoryDetailsPanel repository={repository} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'details.readme' }));
    expect(await screen.findByTestId('in-app-readme')).toBeInTheDocument();
  });
  it('pins with sufficient content width and resets to a modal on narrow screens', async () => {
    const onPinnedChange = vi.fn();
    render(<RepositoryDetailsPanel repository={repository} onClose={vi.fn()} onPinnedChange={onPinnedChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'details.pin' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('complementary')).toHaveClass('w-[440px]', 'h-[calc(100dvh-4rem)]');
    expect(onPinnedChange).toHaveBeenLastCalledWith(true);
    act(() => { Object.defineProperty(window, 'innerWidth', { value: 1000 }); window.dispatchEvent(new Event('resize')); });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await waitFor(() => expect(onPinnedChange).toHaveBeenLastCalledWith(false));
  });
  it('does not allow pinning when sidebar leaves insufficient content width', () => {
    vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockReturnValue({ width: 900 } as DOMRect);
    render(<RepositoryDetailsPanel repository={repository} onClose={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'details.pin' })).toBeDisabled();
  });
  it('keeps per-repository scroll position while switching repositories', () => {
    const { rerender } = render(<RepositoryDetailsPanel repository={repository} onClose={vi.fn()} />);
    const scroller = screen.getByText('Custom summary').closest('.overflow-y-auto')!;
    expect(scroller).toHaveClass('overscroll-contain');
    const toolbar = screen.getByTestId('repository-details-toolbar');
    expect(scroller.contains(toolbar)).toBe(false);
    expect(toolbar).toHaveClass('shrink-0');
    expect(toolbar.contains(screen.getByRole('button', { name: 'details.readme' }))).toBe(true);
    expect(toolbar.contains(screen.getByRole('button', { name: 'opt-in-analysis' }))).toBe(true);
    fireEvent.scroll(scroller, { target: { scrollTop: 180 } });
    rerender(<RepositoryDetailsPanel repository={{ ...repository, id: 2 }} onClose={vi.fn()} />);
    expect(scroller.scrollTop).toBe(0);
    rerender(<RepositoryDetailsPanel repository={repository} onClose={vi.fn()} />);
    expect(scroller.scrollTop).toBe(180);
  });
  it('restores opener focus after closing', async () => {
    const onClose = vi.fn();
    const trigger = document.createElement('button');
    document.body.append(trigger);
    trigger.focus();
    const { rerender } = render(<RepositoryDetailsPanel repository={repository} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'details.close' }));
    expect(onClose).toHaveBeenCalledOnce();
    rerender(<RepositoryDetailsPanel repository={null} onClose={onClose} />);
    await waitFor(() => expect(document.activeElement).toBe(trigger));
    trigger.remove();
  });
  it('shows sourced, stale details and copies commands without executing them', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    render(<RepositoryDetailsPanel repository={{ ...repository, ai_details: {
      version: 1, generated_at: '2026-09-01T00:00:00Z', repository_pushed_at: '2026-08-01T00:00:00Z',
      model: 'mock-model', sources: [{ label: 'README source', url: 'https://github.com/owner/repo#readme', retrieved_at: '2026-09-01T00:00:00Z' }],
      problem: 'Documented problem', features: [], scenarios: [], architecture: null,
      deployment: null, cost: null, maintenance: null,
      quickstart: [{ description: 'Install', command: 'npm install' }],
    } }} onClose={vi.fn()} />);
    expect(screen.getByRole('img', { name: /Saved analysis may be stale/ })).toBeInTheDocument();
    expect(screen.getByText('Documented problem')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'README source' })).toHaveAttribute('href', 'https://github.com/owner/repo#readme');
    expect(writeText).not.toHaveBeenCalled();
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'details.usageTab' }), { button: 0, ctrlKey: false });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'details.copy' })));
    expect(writeText).toHaveBeenCalledWith('npm install');
  });
});
