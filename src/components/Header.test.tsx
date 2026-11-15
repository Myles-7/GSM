import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Header } from './Header';
import { TooltipProvider } from './ui/tooltip';
import { useAppStore } from '../store/useAppStore';

const fixtures = vi.hoisted(() => ({
  setCurrentView: vi.fn(),
  labels: {
    'header.menu': 'Menu',
    'header.menu-repositories': 'Repositories',
    'header.menu-releases': 'Releases',
    'header.menu-settings': 'A very long translated settings label',
  } as Record<string, string>,
}));

vi.mock('../store/useAppStore', () => ({ useAppStore: vi.fn() }));
vi.mock('../i18n/useT', () => ({ useT: () => (key: string) => fixtures.labels[key] ?? key }));
vi.mock('../hooks/useDialog', () => ({ useDialog: () => ({ confirm: vi.fn() }) }));
vi.mock('./PageTranslationButton', () => ({ PageTranslationButton: () => null }));

const state = {
  user: null,
  theme: 'light',
  language: 'en',
  currentView: 'repositories',
  headerMenuConfig: [
    { id: 'settings', visible: true, order: 2 },
    { id: 'repositories', visible: true, order: 0 },
    { id: 'releases', visible: true, order: 1 },
  ],
  setTheme: vi.fn(),
  setCurrentView: fixtures.setCurrentView,
  logout: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useAppStore).mockImplementation(((selector: (value: typeof state) => unknown) => selector(state)) as typeof useAppStore);
});

describe('Header navigation', () => {
  it('keeps the active destination and direct navigation available', async () => {
    const user = userEvent.setup();
    render(<TooltipProvider><Header /></TooltipProvider>);
    const navigation = screen.getByRole('navigation', { name: 'Menu' });

    expect(within(navigation).getByRole('button', { name: 'Repositories' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(within(navigation).getByRole('button', { name: 'Releases' }));
    expect(fixtures.setCurrentView).toHaveBeenCalledWith('releases');
  });

  it('exposes every destination through the overflow menu when labels do not fit', async () => {
    const user = userEvent.setup();
    render(<TooltipProvider><Header /></TooltipProvider>);
    const navigation = screen.getByRole('navigation', { name: 'Menu' });
    const items = within(navigation).getByRole('button', { name: 'Repositories' }).parentElement!;
    let availableWidth = 160;
    Object.defineProperty(navigation, 'clientWidth', { configurable: true, get: () => availableWidth });
    Object.defineProperty(items, 'scrollWidth', { configurable: true, value: 700 });
    act(() => window.dispatchEvent(new Event('resize')));

    await user.click(within(navigation).getByRole('button', { name: 'Menu' }));
    await user.click(screen.getByRole('menuitem', { name: 'A very long translated settings label' }));
    expect(fixtures.setCurrentView).toHaveBeenCalledWith('settings');

    availableWidth = 800;
    act(() => window.dispatchEvent(new Event('resize')));
    expect(within(navigation).queryByRole('button', { name: 'Menu' })).not.toBeInTheDocument();
  });
});
