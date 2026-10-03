import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TranslateFn } from '../../i18n/useT';
import { DataManagementPanel } from './DataManagementPanel';

const mocks = vi.hoisted(() => ({ state: {} as Record<string, unknown>, setState: vi.fn(), exportBackup: vi.fn(),
  importBackup: vi.fn(), validate: vi.fn(), objectURL: vi.fn(), imported: {} as unknown }));
vi.mock('../../store/useAppStore', () => ({ useAppStore: Object.assign(
  (selector: (state: unknown) => unknown) => selector(mocks.state), { getState: () => mocks.state, setState: mocks.setState }),
}));
vi.mock('../../services/discoveryWorkspaceBackup', () => ({ exportDiscoveryWorkspaceBackup: mocks.exportBackup,
  importDiscoveryWorkspaceBackup: mocks.importBackup, validateDiscoveryWorkspaceBackup: mocks.validate }));
vi.mock('../../services/aiTaskJournal', () => ({ aiTaskJournal: { begin: () => ({ item: vi.fn(), state: vi.fn(), finish: vi.fn() }) } }));
vi.mock('../../services/weeklyIssuesStorage', () => ({ weeklyIssuesStorage: {} }));
vi.mock('../../services/xTweetStorage', () => ({ xTweetStorage: {} }));
vi.mock('../../services/telegramStorage', () => ({ telegramStorage: {} }));
vi.mock('../../services/xTweetService', () => ({ abortXTweetSync: vi.fn() }));
vi.mock('../../services/telegramService', () => ({ abortTelegramSync: vi.fn() }));
vi.mock('../../services/electronProxy', () => ({ clearEncryptedXAuthViaDesktop: vi.fn() }));
vi.mock('../../services/indexedDbStorage', () => ({ indexedDBStorage: {} }));
vi.mock('./IncludeKeysToggle', () => ({ IncludeKeysToggle: () => null }));
vi.mock('./RepositoryIdentityMigrationPanel', () => ({ RepositoryIdentityMigrationPanel: () => null }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.state = { user: { id: 42, login: 'alice' }, repositories: [], releases: [], aiConfigs: [], webdavConfigs: [],
    customCategories: [], defaultCategoryOverrides: {}, hiddenDefaultCategoryIds: [], assetFilters: [], discoveryRepos: {},
    discoveryTotalCount: {}, discoveryHasMore: {}, discoveryNextPage: {}, subscriptionRepos: {}, subscriptionChannels: [],
    releaseSubscriptions: new Set(), readReleases: new Set(), releaseExpandedRepositories: new Set(), language: 'en',
    releaseSourceSettings: { enabledSourceIds: [], watchCustomReleaseRepos: [], customReleaseRepos: [] },
    proxyConfig: {}, rpcDownloadConfig: {}, includeKeysInBackup: false, setRepositories: vi.fn(), setReleases: vi.fn() };
  mocks.exportBackup.mockResolvedValue({ version: 1, accountId: '42' });
  mocks.validate.mockImplementation(() => undefined);
  mocks.importBackup.mockResolvedValue(undefined);
  vi.stubGlobal('FileReader', class {
    onload?: (event: unknown) => void;
    readAsText() { this.onload?.({ target: { result: JSON.stringify(mocks.imported) } }); }
  });
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: mocks.objectURL, revokeObjectURL: vi.fn() }));
  mocks.objectURL.mockReturnValue('blob:test');
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const renderPanel = () => render(<DataManagementPanel t={((key: string) => key) as TranslateFn} />);
async function upload(payload: unknown) {
  mocks.imported = { version: '1.0', exportDate: '2026-10-02', appVersion: 'test', data: payload };
  const { container } = renderPanel();
  await act(async () => fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [new File(['{}'], 'backup.json')] } }));
}

describe('JSON discovery backup integration', () => {
  it('includes the shared block when discovery data is selected', async () => {
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'dataManagementPanel.export-selected' }));
    await waitFor(() => expect(mocks.objectURL).toHaveBeenCalled());
    expect(mocks.exportBackup).toHaveBeenCalledWith('42');
    const blob = mocks.objectURL.mock.calls[0][0];
    const content = await new Promise<string>(resolve => {
      const reader = new RealFileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.readAsText(blob);
    });
    expect(JSON.parse(content).data.discoveryWorkspace).toEqual({ version: 1, accountId: '42' });
  });
  it('does not export new stores when discovery data is deselected', async () => {
    renderPanel();
    fireEvent.click(screen.getByRole('checkbox', { name: 'dataManagementPanel.discovery-data' }));
    fireEvent.click(screen.getByRole('button', { name: 'dataManagementPanel.export-selected' }));
    await waitFor(() => expect(mocks.objectURL).toHaveBeenCalled());
    expect(mocks.exportBackup).not.toHaveBeenCalled();
  });
  it.each(['merge', 'replace'] as const)('recognizes a workspace-only payload and imports using %s', async mode => {
    const block = { version: 1, accountId: '42' };
    await upload({ discoveryWorkspace: block });
    fireEvent.click(screen.getByRole('button', { name: `dataManagementPanel.${mode}-import` }));
    await waitFor(() => expect(mocks.importBackup).toHaveBeenCalledWith('42', block, mode));
    expect(mocks.validate).toHaveBeenCalledWith('42', block);
  });
  it.each(['ACCOUNT_CONFLICT', 'INVALID_RECORD'])('rejects %s before discovery or repository writes', async error => {
    mocks.validate.mockImplementation(() => { throw new Error(error); });
    await upload({ discoveryWorkspace: { version: 1, accountId: 'other' }, repositories: [], discoveryRepos: {} });
    fireEvent.click(screen.getByRole('button', { name: 'dataManagementPanel.replace-import' }));
    await waitFor(() => expect(mocks.validate).toHaveBeenCalled());
    expect(mocks.importBackup).not.toHaveBeenCalled();
    expect(mocks.setState).not.toHaveBeenCalled();
    expect(mocks.state.setRepositories).not.toHaveBeenCalled();
  });
  it('imports old discovery payloads without clearing new stores', async () => {
    await upload({ discoveryRepos: {} });
    fireEvent.click(screen.getByRole('button', { name: 'dataManagementPanel.replace-import' }));
    await waitFor(() => expect(mocks.setState).toHaveBeenCalledWith({ discoveryRepos: {} }));
    expect(mocks.importBackup).not.toHaveBeenCalled();
  });
  it('stops legacy discovery mutations after an account switch during workspace restore', async () => {
    mocks.importBackup.mockImplementation(async () => { mocks.state.user = { id: 43 }; });
    await upload({ discoveryWorkspace: { version: 1, accountId: '42' }, discoveryRepos: {} });
    fireEvent.click(screen.getByRole('button', { name: 'dataManagementPanel.replace-import' }));
    await waitFor(() => expect(mocks.importBackup).toHaveBeenCalled());
    expect(mocks.setState).not.toHaveBeenCalled();
  });
});

const RealFileReader = FileReader;
