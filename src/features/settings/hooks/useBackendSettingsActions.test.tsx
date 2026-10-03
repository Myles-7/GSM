import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '../../../store/useAppStore';
import { useBackendSettingsActions } from './useBackendSettingsActions';

const mocks = vi.hoisted(() => ({
  backendInit: vi.fn(),
  backendCheckHealth: vi.fn(),
  backendVerifyAuth: vi.fn(),
  backendRememberActiveUrl: vi.fn(),
  setBackendApiSecret: vi.fn(),
  toast: vi.fn(),
  confirm: vi.fn(),
  syncLocalGitHubTokenToBackend: vi.fn(),
  tryRestoreAuthFromBackend: vi.fn(),
  flushDesktopHome: vi.fn(),
  useAppStore: Object.assign(vi.fn(), { setState: vi.fn() }),
}));

vi.mock('../../../store/useAppStore', () => ({ useAppStore: mocks.useAppStore }));
vi.mock('../../../services/backendAdapter', () => ({
  backend: {
    configuredUrl: 'https://stored.example/api',
    backendUrl: 'https://stored.example/api',
    isAvailable: false,
    init: mocks.backendInit,
    checkHealth: mocks.backendCheckHealth,
    verifyAuth: mocks.backendVerifyAuth,
    rememberActiveUrl: mocks.backendRememberActiveUrl,
  },
}));
vi.mock('../../../services/autoSync', () => ({
  syncLocalGitHubTokenToBackend: mocks.syncLocalGitHubTokenToBackend,
  tryRestoreAuthFromBackend: mocks.tryRestoreAuthFromBackend,
}));
vi.mock('../../../hooks/useDialog', () => ({
  useDialog: () => ({ toast: mocks.toast, confirm: mocks.confirm }),
}));
vi.mock('../../../home/desktop', () => ({ flushDesktopHome: mocks.flushDesktopHome }));

const storeState = {
  language: 'zh',
  repositories: [],
  releases: [],
  aiConfigs: [],
  webdavConfigs: [],
  activeAIConfig: null,
  activeWebDAVConfig: null,
  hiddenDefaultCategoryIds: [] as string[],
  categoryOrder: [] as string[],
  customCategories: [],
  assetFilters: [],
  defaultCategoryOverrides: {},
  collapsedSidebarCategoryCount: 0,
  backendApiSecret: null as string | null,
  setBackendApiSecret: mocks.setBackendApiSecret,
  setRepositories: vi.fn(),
  setReleases: vi.fn(),
  setAIConfigs: vi.fn(),
  setWebDAVConfigs: vi.fn(),
  showDefaultCategory: vi.fn(),
  hideDefaultCategory: vi.fn(),
};

const mockUseAppStore = vi.mocked(useAppStore);

describe('useBackendSettingsActions 后端地址配置', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storeState.backendApiSecret = null;
    mocks.backendInit.mockResolvedValue(undefined);
    mocks.backendCheckHealth.mockResolvedValue({ version: '1.0.0', timestamp: '2026-09-05T00:00:00Z' });
    mocks.backendVerifyAuth.mockResolvedValue(true);
    mocks.flushDesktopHome.mockResolvedValue(false);
    mockUseAppStore.mockImplementation(((selector?: (state: typeof storeState) => unknown) => (
      selector ? selector(storeState) : storeState
    )) as never);
  });

  const render = () => renderHook(() => useBackendSettingsActions());

  it('urlInput 预填记住的后端地址并自动去掉 /api', () => {
    const { result } = render();
    expect(result.current.urlInput).toBe('https://stored.example');
  });

  it('无效地址直接提示，不向该地址发起探测也不提交密钥', async () => {
    const { result } = render();
    act(() => result.current.setUrlInput('http://127.example.com'));

    await act(async () => {
      await result.current.testConnection();
    });

    expect(mocks.toast).toHaveBeenCalledWith(expect.stringContaining('后端地址无效'), 'error');
    expect(mocks.backendInit.mock.calls.every((call) => call[0] === undefined)).toBe(true);
    expect(mocks.setBackendApiSecret).not.toHaveBeenCalled();
  });

  it('有效地址按输入探测，成功后记住并提示连接成功', async () => {
    const { result } = render();
    act(() => {
      result.current.setUrlInput('https://new.example.com');
      result.current.setSecretInput('secret-1');
    });

    await act(async () => {
      await result.current.testConnection();
    });

    expect(mocks.backendInit).toHaveBeenCalledWith('https://new.example.com');
    expect(mocks.setBackendApiSecret).toHaveBeenCalledWith('secret-1');
    expect(mocks.backendVerifyAuth).toHaveBeenCalledOnce();
    expect(mocks.backendRememberActiveUrl).toHaveBeenCalledOnce();
    expect(mocks.toast).toHaveBeenCalledWith('后端连接成功！', 'success');
  });

  it('认证失败时恢复先前的后端连接且不记住候选地址', async () => {
    storeState.backendApiSecret = 'original-key';
    const { result } = render();
    act(() => {
      result.current.setUrlInput('https://new.example.com');
      result.current.setSecretInput('wrong-key');
    });
    mocks.backendVerifyAuth.mockResolvedValue(false);

    await act(async () => {
      await result.current.testConnection();
    });

    expect(mocks.toast).toHaveBeenCalledWith(expect.stringContaining('后端连接失败'), 'error');
    expect(mocks.backendInit).toHaveBeenLastCalledWith('https://stored.example/api');
    expect(mocks.setBackendApiSecret).toHaveBeenLastCalledWith('original-key');
    expect(mocks.backendRememberActiveUrl).not.toHaveBeenCalled();
  });

  it('地址留空时保持自动探测（不指定 preferredUrl）', async () => {
    const { result } = render();
    act(() => result.current.setUrlInput('  '));

    await act(async () => {
      await result.current.testConnection();
    });

    expect(mocks.backendInit.mock.calls.every((call) => call[0] === undefined)).toBe(true);
    expect(mocks.toast).toHaveBeenCalledWith('后端连接成功！', 'success');
  });
  it('同步异常会提示并释放锁，之后仍可重试', async () => {
    const { result } = render();
    mocks.flushDesktopHome.mockRejectedValueOnce(new Error('fixture sync failure'));
    await act(async () => { await result.current.syncToBackend(); });
    expect(mocks.toast).toHaveBeenCalledWith(expect.stringContaining('fixture sync failure'), 'error');
    expect(result.current.isSyncingToBackend).toBe(false);
    mocks.flushDesktopHome.mockResolvedValueOnce(true);
    await act(async () => { await result.current.syncToBackend(); });
    expect(mocks.flushDesktopHome).toHaveBeenCalledTimes(2);
  });
  it('同步期间拒绝重复提交和反方向同步', async () => {
    const { result } = render();
    let finish!: (value: boolean) => void;
    mocks.flushDesktopHome.mockReturnValueOnce(new Promise<boolean>(resolve => { finish = resolve; }));
    let first!: Promise<void>;
    act(() => { first = result.current.syncToBackend(); });
    expect(result.current.isSyncingToBackend).toBe(true);
    await act(async () => { await result.current.syncToBackend(); await result.current.syncFromBackend(); });
    expect(mocks.flushDesktopHome).toHaveBeenCalledOnce();
    await act(async () => { finish(true); await first; });
    expect(result.current.isSyncingToBackend).toBe(false);
  });
});
