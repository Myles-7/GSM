import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AddExternalFeed } from './AddExternalFeed';

const mocks = vi.hoisted(() => ({ add: vi.fn(), checking: false, error: '' }));
vi.mock('../i18n/useT', () => ({
  useT: () => (key: string, params?: Record<string, unknown>) => String(params?.defaultValue ?? key),
}));
vi.mock('../features/discovery/hooks/useExternalFeed', () => ({
  useExternalFeed: () => ({ add: mocks.add, isChecking: mocks.checking, error: mocks.error, clearError: vi.fn() }),
}));
beforeEach(() => { vi.clearAllMocks(); mocks.checking = false; mocks.error = ''; mocks.add.mockResolvedValue(true); });
describe('AddExternalFeed', () => {
  it('adds JSON by default with English fallback labels and closes only after success', async () => {
    const close = vi.fn();
    render(<AddExternalFeed onClose={close} />);
    fireEvent.change(screen.getByLabelText('Feed name'), { target: { value: 'JSON Feed' } });
    fireEvent.change(screen.getByLabelText('Public HTTPS URL'), { target: { value: 'https://example.com/feed' } });
    await userEvent.click(screen.getByRole('button', { name: 'Add External Feed' }));
    expect(mocks.add).toHaveBeenCalledWith('JSON Feed', 'https://example.com/feed', 'json');
    await waitFor(() => expect(close).toHaveBeenCalledOnce());
  });
  it('switches to RSS/Atom, keeps the dialog after failure, and renders a readable error', async () => {
    mocks.add.mockResolvedValue(false);
    mocks.error = 'The feed is unreadable.';
    const close = vi.fn();
    render(<AddExternalFeed onClose={close} />);
    await userEvent.click(screen.getByRole('button', { name: 'RSS / Atom' }));
    fireEvent.change(screen.getByLabelText('Feed name'), { target: { value: 'RSS Feed' } });
    fireEvent.change(screen.getByLabelText('Public HTTPS URL'), { target: { value: 'https://example.com/feed.xml' } });
    await userEvent.click(screen.getByRole('button', { name: 'Add External Feed' }));
    expect(mocks.add).toHaveBeenCalledWith('RSS Feed', 'https://example.com/feed.xml', 'rss');
    expect(screen.getByRole('alert')).toHaveTextContent('The feed is unreadable.');
    expect(close).not.toHaveBeenCalled();
  });
  it('disables repeat submissions while checking but allows closing to cancel', async () => {
    mocks.checking = true;
    const close = vi.fn();
    render(<AddExternalFeed onClose={close} />);
    expect(screen.getByRole('button', { name: 'Checking feed...' })).toBeDisabled();
    expect(screen.getByLabelText('Feed name')).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(close).toHaveBeenCalledOnce();
    expect(mocks.add).not.toHaveBeenCalled();
  });
});
