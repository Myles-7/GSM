import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GeneralPanel } from './GeneralPanel';
import { ensureLanguageLoaded } from '../../i18n';
import { makeT } from '../../i18n/useT';

const mocks = vi.hoisted(() => ({ user: { login: 'reader' } as { login: string } | null }));
vi.mock('../../store/useAppStore', () => ({ useAppStore: (select: (state: unknown) => unknown) => select({ user: mocks.user }) }));
vi.mock('../../features/settings/hooks/useDesktopActions', () => ({ useDesktopActions: () => ({ supported: false }) }));
vi.mock('../../features/settings/hooks/useGitHubTokenActions', () => ({ useGitHubTokenActions: () => ({ tokenInput: '', isSaving: false }) }));
vi.mock('../UpdateChecker', () => ({ UpdateChecker: () => <button>Check upstream</button> }));
vi.mock('../GitHubTokenPermissions', () => ({ GitHubTokenPermissions: () => null }));

beforeEach(async () => {
  mocks.user = { login: 'reader' };
  await Promise.all([ensureLanguageLoaded('zh'), ensureLanguageLoaded('en')]);
});

describe('General settings translations with the actual parent namespace', () => {
  it.each(['zh', 'en'])('resolves the account hint in %s', language => {
    render(<GeneralPanel t={makeT(language, 'app')} />);
    expect(screen.getByText(makeT(language, 'settings')('generalPanel.account-token-hint', { login: 'reader' }))).toBeVisible();
    expect(screen.queryByText('generalPanel.account-token-hint')).toBeNull();
  });
  it('resolves the signed-out token hint', () => {
    mocks.user = null;
    render(<GeneralPanel t={makeT('en', 'app')} />);
    expect(screen.getByText('Update an expired token here without logging out.')).toBeVisible();
  });
});
