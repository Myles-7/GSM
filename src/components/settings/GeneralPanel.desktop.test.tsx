import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Desktop section (#345) lives in Settings-General and must only appear in
 * the Electron client. Web builds (no bridge) hide it entirely.
 */
const mocks = vi.hoisted(() => {
  const state: Record<string, unknown> = {};
  const useAppStore = (selector?: (s: Record<string, unknown>) => unknown) =>
    selector ? selector(state) : state;
  return {
    state,
    useAppStore,
    isSupported: vi.fn(),
    getPrefs: vi.fn(),
  };
});

vi.mock('../../store/useAppStore', () => ({ useAppStore: mocks.useAppStore }));
vi.mock('../../services/electronProxy', () => ({
  DEFAULT_DESKTOP_PREFS: { autoLaunch: false, closeToTray: true, minimizeToTray: true },
  desktopBridge: {
    isSupported: mocks.isSupported,
    getPrefs: mocks.getPrefs,
    setAutoLaunch: vi.fn(),
    setCloseToTray: vi.fn(),
    setMinimizeToTray: vi.fn(),
  },
}));
vi.mock('../UpdateChecker', () => ({ UpdateChecker: () => null }));
vi.mock('./ThemeSettingsCard', () => ({ ThemeSettingsCard: () => null }));
vi.mock('./RepositoryIdentityMigrationPanel', () => ({
  RepositoryIdentityMigrationPanel: () => (
    <section aria-label="Identity migration">
      <button>Dry Run</button><button>Apply Confirmed Mappings</button><button>Resume Migration</button>
    </section>
  ),
}));
vi.mock('../../features/settings/hooks/useGitHubTokenActions', () => ({
  useGitHubTokenActions: () => ({
    tokenInput: '',
    isSaving: false,
    setTokenInput: vi.fn(),
    updateToken: vi.fn(),
  }),
}));

import { makeT } from '../../i18n/useT';
import { GeneralPanel } from './GeneralPanel';

const t = makeT('zh', 'app');
const loginT = makeT('zh', 'login');

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(mocks.state, { language: 'zh', setLanguage: vi.fn(), user: null });
});

describe('GeneralPanel desktop section', () => {
  it('hides the desktop section on web (no Electron bridge)', () => {
    mocks.isSupported.mockReturnValue(false);
    render(<GeneralPanel t={t} />);
    expect(screen.queryByText('桌面选项')).toBeNull();
    expect(screen.queryByLabelText('开机自动启动')).toBeNull();
  });

  it('keeps appearance and language controls out of General', () => {
    mocks.isSupported.mockReturnValue(false);
    const { container } = render(<GeneralPanel t={t} />);
    expect(container.querySelector('[aria-labelledby="language-settings-title"]')).toBeNull();
    expect(screen.queryByRole('radiogroup')).toBeNull();
  });

  it('shows auto-launch and tray toggles in the Electron client', async () => {
    mocks.isSupported.mockReturnValue(true);
    mocks.getPrefs.mockResolvedValue({ autoLaunch: false, closeToTray: true, minimizeToTray: true });
    render(<GeneralPanel t={t} />);
    expect(await screen.findByText('桌面选项')).toBeTruthy();
    expect(screen.getByLabelText('开机自动启动')).toBeTruthy();
    expect(screen.getByLabelText('关闭时最小化到托盘')).toBeTruthy();
    expect(screen.getByLabelText('最小化时隐藏到托盘')).toBeTruthy();
  });

  it('reuses the shared token permissions guide without exposing tokens', () => {
    mocks.isSupported.mockReturnValue(false);
    render(<GeneralPanel t={t} />);
    fireEvent.click(screen.getByRole('button', {
      name: t('generalPanel.token-permission-guide', { defaultValue: 'Token setup guide' }),
    }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('tab', {
      name: loginT('loginScreen.token-permissions-tab-finegrained', { defaultValue: 'Fine-grained' }),
    })).toBeTruthy();
    expect(within(dialog).getByRole('tab', {
      name: loginT('loginScreen.token-permissions-tab-classic', { defaultValue: 'Classic' }),
    })).toBeTruthy();
    expect(within(dialog).queryByRole('textbox')).toBeNull();
  });

  it('embeds the main-owned migration section independently of Token and Appearance', () => {
    mocks.isSupported.mockReturnValue(false);
    render(<GeneralPanel t={t} />);
    const section = screen.getByRole('region', { name: 'Identity migration' });
    expect(within(section).getByRole('button', { name: 'Dry Run' })).toBeTruthy();
    expect(within(section).getByRole('button', { name: 'Apply Confirmed Mappings' })).toBeTruthy();
    expect(within(section).getByRole('button', { name: 'Resume Migration' })).toBeTruthy();
    expect(within(section).queryByLabelText('GitHub Personal Access Token')).toBeNull();
  });
});
