import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BackupPanel } from './BackupPanel';
import { makeT } from '../../i18n/useT';
import { ensureLanguageLoaded } from '../../i18n';

const mocks = vi.hoisted(() => ({ backup: vi.fn(), restore: vi.fn() }));
vi.mock('../../store/useAppStore', () => ({ useAppStore: (select: (state: unknown) => unknown) => select({ language: 'en', lastBackup: null }) }));
vi.mock('../../features/settings/hooks/useBackupActions', () => ({ useBackupActions: () => ({ activeConfig: null, isBackingUp: false, isRestoring: false, ...mocks }) }));
vi.mock('./IncludeKeysToggle', () => ({ IncludeKeysToggle: () => null }));

describe('Backup entry points', () => {
  it('offers local backup without WebDAV and only navigates when clicked', async () => {
    await ensureLanguageLoaded('en');
    const navigate = vi.fn();
    window.addEventListener('gsm:navigate-to-settings-tab', navigate);
    try {
      render(<BackupPanel t={makeT('en', 'app')} />);
      fireEvent.click(screen.getByRole('button', { name: 'Open local import / export' }));
      expect(navigate).toHaveBeenCalledOnce();
      expect((navigate.mock.calls[0][0] as CustomEvent).detail).toEqual({ tab: 'data' });
      expect(mocks.backup).not.toHaveBeenCalled();
      expect(mocks.restore).not.toHaveBeenCalled();
      expect(screen.getByRole('button', { name: 'Start Backup' })).toBeDisabled();
    } finally { window.removeEventListener('gsm:navigate-to-settings-tab', navigate); }
  });
});
