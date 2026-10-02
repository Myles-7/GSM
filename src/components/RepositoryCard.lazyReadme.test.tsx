import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TooltipProvider } from './ui/tooltip';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RepositoryCard } from './RepositoryCard';
import { repository, repositoryCardActions, storeState } from './RepositoryCard.lazyReadme.fixture';

const mocks = vi.hoisted(() => ({
  useAppStore: vi.fn(),
  consoleError: vi.fn(),
  readmeLoads: vi.fn(),
}));

vi.mock('../store/useAppStore', () => ({
  useAppStore: mocks.useAppStore,
}));

vi.mock('../features/repositories/hooks/useRepositoryCardActions', () => ({
  useRepositoryCardActions: () => repositoryCardActions,
}));

vi.mock('./RepositoryEditModal', () => ({
  RepositoryEditModal: () => null,
}));

// This boundary fixture has no plugin menu.
vi.mock('../plugins/hooks/usePluginActions', () => ({
  usePluginActions: () => ({ actions: [], runAction: vi.fn() }),
}));
vi.mock('../plugins/pluginClient', () => ({
  pluginClient: { runAction: vi.fn() },
}));

type ReadmeModalMockProps = {
  onClose: () => void;
  onCloseAutoFocus?: () => void;
};

vi.mock('./ReadmeModal', () => {
  mocks.readmeLoads();
  return {
    ReadmeModal: ({ onClose, onCloseAutoFocus }: ReadmeModalMockProps) => (
      <button type="button" onClick={() => { onClose(); onCloseAutoFocus?.(); }}>
        Close README
      </button>
    ),
  };
});

describe('RepositoryCard README lazy boundary', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(mocks.consoleError);
    mocks.useAppStore.mockImplementation((selector?: (state: typeof storeState) => unknown) => (
      selector ? selector(storeState) : storeState
    ));
  });

  it('restores focus to the keyboard trigger after the README modal closes', async () => {
    expect(mocks.readmeLoads).not.toHaveBeenCalled();
    // delay: null removes artificial keystroke/click delays so the test does not
    // depend on wall-clock timing when the suite runs 60+ files in parallel.
    const user = userEvent.setup({ delay: null });

    render(
      <TooltipProvider>
        <RepositoryCard repository={repository} allCategories={[]} />
      </TooltipProvider>,
    );

    const trigger = screen.getByRole('button', { name: /owner\/example-repository/i });
    trigger.focus();
    await user.keyboard('{Enter}');

    // The README modal is React.lazy-loaded; under parallel load the chunk can
    // take longer than findBy's default 1s timeout to resolve.
    await user.click(await screen.findByRole('button', { name: 'Close README' }, { timeout: 10_000 }));

    expect(trigger).toHaveFocus();
    expect(mocks.readmeLoads).toHaveBeenCalledOnce();
  }, 15_000);
});
