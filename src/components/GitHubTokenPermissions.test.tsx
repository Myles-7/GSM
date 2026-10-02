import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GitHubTokenPermissions } from './GitHubTokenPermissions';

const storeState = vi.hoisted(() => ({ language: 'en' }));
vi.mock('../store/useAppStore', () => ({
  useAppStore: (selector: (state: typeof storeState) => unknown) => selector(storeState),
}));

describe('shared GitHub token permission guide', () => {
  beforeEach(() => { storeState.language = 'en'; });

  it('shows fine-grained permissions by default, switches using accessible tabs, and never probes APIs', () => {
    render(<GitHubTokenPermissions />);
    expect(screen.getByRole('tab', { name: 'Fine-grained' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Starring')).toHaveAttribute('translate', 'no');
    expect(screen.getByText('Metadata')).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Classic' }), { button: 0, ctrlKey: false });
    expect(screen.getByRole('tab', { name: 'Classic' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('public_repo')).toHaveAttribute('translate', 'no');
    expect(screen.getByRole('link')).toHaveAttribute('href', 'https://github.com/settings/tokens');
    expect(screen.getByText(/Signing in checks your identity/)).toBeInTheDocument();
  });
  it('can be embedded without a duplicate settings heading', () => {
    render(<GitHubTokenPermissions heading={false} />);
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
    expect(screen.getByRole('tablist')).toBeInTheDocument();
  });
});
