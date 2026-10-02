import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from './ui/tooltip';
import { RepositoryCard } from './RepositoryCard';
import { repository, repositoryCardActions, storeState } from './RepositoryCard.lazyReadme.fixture';

const mocks = vi.hoisted(() => ({
  useAppStore: vi.fn(), consoleError: vi.fn(), readmeLoads: vi.fn(),
}));

vi.mock('../store/useAppStore', () => ({ useAppStore: mocks.useAppStore }));
vi.mock('../features/repositories/hooks/useRepositoryCardActions', () => ({
  useRepositoryCardActions: () => repositoryCardActions,
}));
vi.mock('./RepositoryEditModal', () => ({ RepositoryEditModal: () => null }));
vi.mock('../plugins/hooks/usePluginActions', () => ({
  usePluginActions: () => ({ actions: [], runAction: vi.fn() }),
}));
vi.mock('../plugins/pluginClient', () => ({ pluginClient: { runAction: vi.fn() } }));

// Separate file/module graph gives React.lazy a fresh rejection without a
// whole-Card reset/import inside a timed test or a late render after timeout.
vi.mock('./ReadmeModal', () => {
  mocks.readmeLoads();
  throw new Error('README lazy chunk failed');
});

describe('RepositoryCard README lazy boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(mocks.consoleError);
    mocks.useAppStore.mockImplementation((selector?: (state: typeof storeState) => unknown) => (
      selector ? selector(storeState) : storeState
    ));
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders the existing error boundary when the README lazy chunk cannot load', async () => {
    expect(mocks.readmeLoads).not.toHaveBeenCalled();
    const user = userEvent.setup({ delay: null });
    render(
      <TooltipProvider>
        <RepositoryCard repository={repository} allCategories={[]} />
      </TooltipProvider>,
    );
    await user.click(screen.getByRole('button', { name: /owner\/example-repository/i }));
    expect(await screen.findByRole('heading', { name: 'Application Error' }, { timeout: 10_000 })).toBeInTheDocument();
    expect(mocks.readmeLoads).toHaveBeenCalledOnce();
  }, 15_000);
});
