import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useBackupActions } from './useBackupActions';

const mocks = vi.hoisted(() => ({ state: {} as Record<string, unknown>, setState: vi.fn(), upload: vi.fn(), download: vi.fn(),
  toast: vi.fn(), confirm: vi.fn(), exportBackup: vi.fn(), prepare: vi.fn(), execute: vi.fn() }));
vi.mock('../../../store/useAppStore', () => ({ useAppStore: Object.assign(
  (selector: (state: unknown) => unknown) => selector(mocks.state), { getState: () => mocks.state, setState: mocks.setState }),
}));
vi.mock('../../../hooks/useDialog', () => ({ useDialog: () => ({ toast: mocks.toast, confirm: mocks.confirm }) }));
vi.mock('../../../i18n/useT', () => ({ useT: () => (key: string) => key }));
vi.mock('../../../services/aiTaskJournal', () => ({ aiTaskJournal: { begin: () => ({ item: vi.fn(), error: vi.fn(), state: vi.fn(), finish: vi.fn() }) } }));
vi.mock('../../../services/webdavService', () => ({ WebDAVService: class {
  uploadFile = mocks.upload; downloadFile = mocks.download; listFiles = async () => ['github-stars-backup-2026-10-02.json'];
} }));
vi.mock('../../../services/discoveryWorkspaceBackup', () => ({ exportDiscoveryWorkspaceBackup: mocks.exportBackup }));
vi.mock('../../../services/cloudBackupRestore', async original => ({ ...await original<typeof import('../../../services/cloudBackupRestore')>(), planCloudBackupRestore: mocks.prepare }));
vi.mock('../../../services/localBackupRestore', () => ({ executeLocalBackupRestore: mocks.execute }));
vi.mock('../../../services/localBackupScope', () => ({ getLocalBackupIdentity: () => ({ githubUserId: '42', workspaceId: null }) }));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.state = { user: { id: 42 }, language: 'zh', repositories: [], releases: [], customCategories: [], hiddenDefaultCategoryIds: [], categoryOrder: [], subcategories: [], subcategoryOrder: [], repositoryOrder: [], defaultCategoryOverrides: {},
    aiConfigs: [], webdavConfigs: [{ id: 'dav', name: 'Backup', password: 'secret' }], activeWebDAVConfig: 'dav',
    proxyConfig: {}, rpcDownloadConfig: {}, releaseSubscriptions: new Set(), readReleases: new Set(), routeMode: 'auto', setRouteMode: vi.fn(),
    includeKeysInBackup: false, setLastBackup: vi.fn(), setReleases: vi.fn() };
  mocks.confirm.mockReset().mockResolvedValue(true);
  mocks.prepare.mockReset().mockResolvedValue({ plan: { summary: 'complete preview' }, configuration: undefined });
  mocks.execute.mockReset().mockResolvedValue({ homePending: false });
  mocks.upload.mockResolvedValue(true);
  mocks.exportBackup.mockResolvedValue({ version: 1, accountId: '42' });
});
describe('WebDAV restore orchestration', () => {
  it('uploads an account-bound backup with credential masking', async () => {
    const { result } = renderHook(useBackupActions);
    await act(async () => result.current.backup());
    expect(mocks.exportBackup).toHaveBeenCalledWith('42');
    const data = JSON.parse(mocks.upload.mock.calls[0][1]);
    expect(data.discoveryWorkspace.accountId).toBe('42');
    expect(data.identity).toEqual({ githubUserId: '42', workspaceId: null });
    expect(data.webdavConfigs[0].password).toBe('***');
    expect(data).not.toHaveProperty('githubToken');
  });
  it('requires legacy ownership and a complete preview before executing the shared engine', async () => {
    mocks.download.mockResolvedValue(JSON.stringify({ discoveryWorkspace: { version: 1, accountId: '42' } }));
    const warnings = vi.spyOn(console, 'warn');
    const { result } = renderHook(useBackupActions);
    await act(async () => result.current.restore());
    expect(mocks.confirm).toHaveBeenCalledTimes(3);
    expect(mocks.confirm.mock.calls[1][1]).toContain('账户身份');
    expect(mocks.confirm.mock.calls[2][1]).toBe('complete preview');
    expect(mocks.execute).toHaveBeenCalledWith({ summary: 'complete preview' }, { configuration: undefined, compensateOnFailure: true });
    expect(mocks.prepare.mock.invocationCallOrder[0]).toBeLessThan(mocks.execute.mock.invocationCallOrder[0]);
    expect(mocks.setState).not.toHaveBeenCalled();
    expect(mocks.state.setReleases).not.toHaveBeenCalled();
    expect(warnings).not.toHaveBeenCalled(); warnings.mockRestore();
    expect(mocks.toast).toHaveBeenLastCalledWith(expect.any(String), 'success');
  });
  it('does not infer legacy confirmation from the generic overwrite dialog', async () => {
    mocks.download.mockResolvedValue('{"readReleases":[]}');
    mocks.confirm.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const { result } = renderHook(useBackupActions);
    await act(async () => result.current.restore());
    expect(mocks.prepare).not.toHaveBeenCalled();
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(mocks.toast).not.toHaveBeenCalled();
  });
  it.each(['ACCOUNT_CONFLICT', 'INVALID_RECORD'])('reports preflight %s without mutation or false success', async error => {
    mocks.download.mockResolvedValue('{"readReleases":[]}');
    mocks.prepare.mockRejectedValue(new Error(error));
    const { result } = renderHook(useBackupActions);
    await act(async () => result.current.restore());
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(mocks.setState).not.toHaveBeenCalled();
    expect(mocks.state.setReleases).not.toHaveBeenCalled();
    expect(result.current.isRestoring).toBe(false);
    expect(mocks.toast).toHaveBeenLastCalledWith(expect.stringContaining(error), 'error');
  });
  it('rejects malformed unversioned data before planning', async () => {
    mocks.download.mockResolvedValue('{"readReleases":["invalid"]}');
    const { result } = renderHook(useBackupActions);
    await act(async () => result.current.restore());
    expect(mocks.prepare).not.toHaveBeenCalled();
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(mocks.toast).toHaveBeenLastCalledWith(expect.any(String), 'error');
  });
  it('rejects an account switch during asynchronous preview preparation', async () => {
    mocks.download.mockResolvedValue('{"readReleases":[]}');
    mocks.prepare.mockImplementation(async () => { mocks.state.user = { id: 43 }; return { plan: { summary: 'preview' } }; });
    const { result } = renderHook(useBackupActions);
    await act(async () => result.current.restore());
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(mocks.toast).toHaveBeenLastCalledWith(expect.stringContaining('ACCOUNT_CHANGED'), 'error');
  });
  it('reports incomplete compensation without success', async () => {
    mocks.download.mockResolvedValue('{"identity":{"githubUserId":"42","workspaceId":null},"readReleases":[]}');
    mocks.execute.mockRejectedValue(new Error('BACKUP_RESTORE_PARTIAL_RECOVERY_REQUIRED'));
    const { result } = renderHook(useBackupActions);
    await act(async () => result.current.restore());
    expect(mocks.toast).toHaveBeenLastCalledWith(expect.stringContaining('PARTIAL_RECOVERY_REQUIRED'), 'error');
    expect(mocks.confirm).toHaveBeenCalledTimes(2);
  });
});
