import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useBackupActions } from './useBackupActions';

const mocks = vi.hoisted(() => ({ state: {} as Record<string, unknown>, setState: vi.fn(), upload: vi.fn(), download: vi.fn(),
  toast: vi.fn(), confirm: vi.fn(), exportBackup: vi.fn(), importBackup: vi.fn(), validate: vi.fn() }));
vi.mock('../../../store/useAppStore', () => ({ useAppStore: Object.assign(
  (selector: (state: unknown) => unknown) => selector(mocks.state), { getState: () => mocks.state, setState: mocks.setState }),
}));
vi.mock('../../../hooks/useDialog', () => ({ useDialog: () => ({ toast: mocks.toast, confirm: mocks.confirm }) }));
vi.mock('../../../i18n/useT', () => ({ useT: () => (key: string) => key }));
vi.mock('../../../services/aiTaskJournal', () => ({ aiTaskJournal: { begin: () => ({ item: vi.fn(), error: vi.fn(), state: vi.fn(), finish: vi.fn() }) } }));
vi.mock('../../../services/webdavService', () => ({ WebDAVService: class {
  uploadFile = mocks.upload; downloadFile = mocks.download; listFiles = async () => ['github-stars-backup-2026-10-02.json'];
} }));
vi.mock('../../../services/discoveryWorkspaceBackup', () => ({ exportDiscoveryWorkspaceBackup: mocks.exportBackup,
  importDiscoveryWorkspaceBackup: mocks.importBackup, validateDiscoveryWorkspaceBackup: mocks.validate }));
vi.mock('../../../store/helpers/repositoryOrganization', () => ({ incomingOrganizationSnapshot: () => ({}) }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.state = { user: { id: 42 }, repositories: [], releases: [], customCategories: [], hiddenDefaultCategoryIds: [],
    aiConfigs: [], webdavConfigs: [{ id: 'dav', name: 'Backup', password: 'secret' }], activeWebDAVConfig: 'dav',
    proxyConfig: {}, rpcDownloadConfig: {}, releaseSubscriptions: new Set(), readReleases: new Set(),
    includeKeysInBackup: false, setLastBackup: vi.fn(), setReleases: vi.fn() };
  mocks.confirm.mockResolvedValue(true);
  mocks.upload.mockResolvedValue(true);
  mocks.exportBackup.mockResolvedValue({ version: 1, accountId: '42', workspace: {}, analyses: {} });
  mocks.validate.mockImplementation(() => undefined);
  mocks.importBackup.mockResolvedValue(undefined);
});

describe('WebDAV discovery workspace integration', () => {
  it('uploads the same shared optional block with existing secret masking', async () => {
    const { result } = renderHook(useBackupActions);
    await act(async () => result.current.backup());
    expect(mocks.exportBackup).toHaveBeenCalledWith('42');
    const data = JSON.parse(mocks.upload.mock.calls[0][1]);
    expect(data.discoveryWorkspace.accountId).toBe('42');
    expect(data.webdavConfigs[0].password).toBe('***');
    expect(data).not.toHaveProperty('githubToken');
  });
  it('restores the shared block with replace semantics after preflight', async () => {
    const block = { version: 1, accountId: '42' };
    mocks.download.mockResolvedValue(JSON.stringify({ discoveryWorkspace: block }));
    const { result } = renderHook(useBackupActions);
    await act(async () => result.current.restore());
    expect(mocks.validate).toHaveBeenCalledWith('42', block);
    expect(mocks.importBackup).toHaveBeenCalledWith('42', block, 'replace');
    expect(mocks.validate.mock.invocationCallOrder[0]).toBeLessThan(mocks.setState.mock.invocationCallOrder[0]);
  });
  it.each(['ACCOUNT_CONFLICT', 'INVALID_RECORD'])('refuses %s before any discovery or app mutation', async error => {
    mocks.download.mockResolvedValue(JSON.stringify({ discoveryWorkspace: { accountId: 'foreign' }, releases: [] }));
    mocks.validate.mockImplementation(() => { throw new Error(error); });
    const { result } = renderHook(useBackupActions);
    await act(async () => result.current.restore());
    expect(mocks.importBackup).not.toHaveBeenCalled();
    expect(mocks.setState).not.toHaveBeenCalled();
    expect(mocks.state.setReleases).not.toHaveBeenCalled();
    expect(result.current.isRestoring).toBe(false);
    expect(mocks.toast).toHaveBeenCalledWith(expect.stringContaining(error), 'error');
  });
  it('passes absent old fields through the shared no-op restore path', async () => {
    mocks.download.mockResolvedValue('{}');
    const { result } = renderHook(useBackupActions);
    await act(async () => result.current.restore());
    expect(mocks.importBackup).toHaveBeenCalledWith('42', undefined, 'replace');
  });
  it('stops account-scoped app writes when the account switches during asynchronous discovery restore', async () => {
    mocks.download.mockResolvedValue(JSON.stringify({ discoveryWorkspace: { version: 1, accountId: '42' }, releases: [] }));
    mocks.importBackup.mockImplementation(async () => { mocks.state.user = { id: 43 }; });
    const { result } = renderHook(useBackupActions);
    await act(async () => result.current.restore());
    expect(mocks.setState).not.toHaveBeenCalled();
    expect(mocks.state.setReleases).not.toHaveBeenCalled();
    expect(mocks.toast).toHaveBeenCalledWith(expect.stringContaining('ACCOUNT_CHANGED'), 'error');
  });
});
