import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BatchStarImportReadme } from './BatchStarImportReadme';
import { logger } from '../services/logger';

const mocks = vi.hoisted(() => ({ fail: false, language: 'en' }));
vi.mock('../store/useAppStore', () => ({
  useAppStore: (selector: (state: typeof mocks) => unknown) => selector(mocks),
}));
vi.mock('./ReadmeModal', () => ({
  ReadmeModal: ({ repository, onClose }: { repository: { full_name: string; default_branch?: string }; onClose: () => void }) => {
    if (mocks.fail) throw new Error('fixture README chunk failed');
    return <div role="dialog" aria-label="Full README">
      <p>{repository.full_name}:{repository.default_branch}</p><button onClick={onClose}>Close README</button>
    </div>;
  },
}));
vi.mock('../services/logger', () => ({ logger: { errorFromError: vi.fn() } }));
beforeEach(() => { mocks.language = 'en'; vi.clearAllMocks(); });
afterEach(() => { mocks.fail = false; vi.restoreAllMocks(); });
describe('batch import full README wrapper', () => {
  const repository = { full_name: 'owner/repo', html_url: 'https://github.com/owner/repo', owner: { login: 'owner', avatar_url: '' }, default_branch: 'main' };
  it('loads the existing complete modal with the canonical name and branch', async () => {
    const onClose = vi.fn();
    render(<BatchStarImportReadme repository={repository} onClose={onClose} />);
    expect(await screen.findByRole('dialog', { name: 'Full README' })).toBeInTheDocument();
    expect(screen.getByText('owner/repo:main')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close README' }));
    expect(onClose).toHaveBeenCalledOnce();
  });
  it('keeps a failed lazy README closable without losing the import state', async () => {
    mocks.fail = true;
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const suppressFixtureError = (event: ErrorEvent) => {
      if (event.error?.message === 'fixture README chunk failed') event.preventDefault();
    };
    window.addEventListener('error', suppressFixtureError);
    try {
      const onClose = vi.fn();
      render(<BatchStarImportReadme repository={repository} onClose={onClose} />);
      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Could not load the README. Close this view to return to the batch import.',
      );
      expect(logger.errorFromError).toHaveBeenCalledWith(
        'ui.batchStar', 'Failed to load README preview',
        expect.objectContaining({ message: 'fixture README chunk failed' }),
        expect.objectContaining({ componentStack: expect.any(String) }),
      );
      const closeButtons = screen.getAllByRole('button', { name: 'Close' });
      expect(closeButtons).toHaveLength(2);
      fireEvent.click(closeButtons[0]);
      expect(onClose).toHaveBeenCalledOnce();
      fireEvent.click(closeButtons[1]);
      expect(onClose).toHaveBeenCalledTimes(2);
    } finally {
      window.removeEventListener('error', suppressFixtureError);
    }
  });
});
