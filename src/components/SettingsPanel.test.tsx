import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsPanel } from './SettingsPanel';

const mocks = vi.hoisted(() => ({
  pending: 120, electron: true, setCurrentView: vi.fn(),
}));
vi.mock('../store/useAppStore', () => ({
  useAppStore: (selector: (state: unknown) => unknown) => selector({ language: 'en', setCurrentView: mocks.setCurrentView }),
}));
vi.mock('../services/electronProxy', () => ({ isElectron: () => mocks.electron }));
vi.mock('../features/settings/hooks/useBackendAvailability', () => ({ useBackendAvailability: () => false }));
vi.mock('../features/settings/hooks/useLocalVectorPendingCount', () => ({ useLocalVectorPendingCount: () => mocks.pending }));
vi.mock('./settings/AppearancePanel', () => ({ AppearancePanel: () => <div>Appearance controls</div> }));
vi.mock('./settings', () => ({
  GeneralPanel: () => <div>General controls</div>,
  VectorSearchSettings: () => <div>Vector operations</div>,
  HtmlReadingPanel: () => <div>HTML reading controls</div>,
  PluginSettingsPanel: () => <div>Plugin controls</div>,
  AIConfigPanel: () => <div>AI and AGY controls</div>,
  StarSyncPanel: () => null, WebDAVPanel: () => null, BackupPanel: () => null,
  BackendPanel: () => null, CategoryPanel: () => null, DataManagementPanel: () => null,
  NetworkPanel: () => null, DiagnosticLogsPanel: () => null, MenuManagementPanel: () => null,
  McpSettingsPanel: () => null,
}));
beforeEach(() => {
  vi.useFakeTimers();
  mocks.pending = 120;
  mocks.electron = true;
  sessionStorage.clear();
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: vi.fn() });
});
afterEach(() => { vi.useRealTimers(); });
const changeTab = (tab: string) => {
  act(() => {
    window.dispatchEvent(new CustomEvent('gsm:navigate-to-settings-tab', { detail: { tab } }));
    vi.advanceTimersByTime(250);
  });
};

describe('Settings navigation', () => {
  it('keeps the last click when tabs are switched rapidly', () => {
    render(<SettingsPanel />);
    fireEvent.click(screen.getAllByRole('tab', { name: 'Appearance' })[0]);
    fireEvent.click(screen.getAllByRole('tab', { name: /AI/ })[0]);
    expect(screen.getByRole('tabpanel')).toHaveTextContent('AI and AGY controls');
  });
  it('filters the grouped sidebar and restores it when search is cleared', () => {
    render(<SettingsPanel />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Search settings' }), { target: { value: 'Appearance' } });
    expect(screen.getAllByRole('tab', { name: 'Appearance' })).toHaveLength(2);
    expect(screen.getAllByRole('tab', { name: 'Plugin Management' })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(screen.getAllByRole('tab', { name: 'Plugin Management' })).toHaveLength(2);
  });
  it('adds Appearance without removing HTML Reading or AI/AGY and renames plugin management', () => {
    render(<SettingsPanel />);
    expect(screen.getAllByRole('tab', { name: 'Appearance' })).toHaveLength(2);
    expect(screen.getAllByRole('tab', { name: '每日 HTML' })).toHaveLength(2);
    expect(screen.getAllByRole('tab', { name: 'Plugin Management' })).toHaveLength(2);
    changeTab('appearance');
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Appearance controls');
    changeTab('htmlReading');
    expect(screen.getByRole('tabpanel')).toHaveTextContent('HTML reading controls');
    changeTab('ai');
    expect(screen.getByRole('tabpanel')).toHaveTextContent('AI and AGY controls');
  });

  it.each([false, true])('caps pending badges across mobile and desktop for modal=%s', (isModal) => {
    render(<SettingsPanel isModal={isModal} />);
    expect(screen.getAllByText('99+')).toHaveLength(2);
    for (const badge of screen.getAllByText('99+')) {
      expect(badge).toHaveAttribute('aria-label', '120 locally known pending');
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it('does not render a zero badge and hides desktop-only plugins on web', () => {
    mocks.pending = 0;
    mocks.electron = false;
    render(<SettingsPanel />);
    expect(screen.queryByText('99+')).toBeNull();
    expect(screen.queryByRole('tab', { name: 'Plugin Management' })).toBeNull();
  });

  it('honors pre-mount Appearance navigation and ignores invalid requests', () => {
    sessionStorage.setItem('gsm:pending-settings-tab', 'appearance');
    render(<SettingsPanel />);
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Appearance controls');
    expect(sessionStorage.getItem('gsm:pending-settings-tab')).toBeNull();
    changeTab('invalid');
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Appearance controls');
  });

  it('supports clicking the desktop Appearance tab', () => {
    render(<SettingsPanel />);
    fireEvent.click(screen.getAllByRole('tab', { name: 'Appearance' })[0]);
    act(() => vi.advanceTimersByTime(250));
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Appearance controls');
  });
});
