import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startMcpElectronBridge, stopMcpElectronBridge } from './mcpElectronBridge';

const mocks = vi.hoisted(() => ({
  subscribe: vi.fn(), getState: vi.fn(), pushSnapshot: vi.fn(), setConfig: vi.fn(),
  start: vi.fn(), stop: vi.fn(), buildSnapshot: vi.fn(),
}));
vi.mock('../store/useAppStore', () => ({ useAppStore: { subscribe: mocks.subscribe, getState: mocks.getState } }));
vi.mock('./electronProxy', () => ({ isElectron: () => true }));
vi.mock('./backendAdapter', () => ({ backend: { isAvailable: false } }));
vi.mock('./logger', () => ({ logger: { warn: vi.fn() } }));
vi.mock('./mcpSnapshot', () => ({ buildMcpDataSnapshot: mocks.buildSnapshot }));

describe('MCP embedding snapshot refresh', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers();
    vi.stubGlobal('window', { electronAPI: { mcp: {
      pushSnapshot: mocks.pushSnapshot, setConfig: mocks.setConfig, start: mocks.start, stop: mocks.stop,
    } } });
    mocks.subscribe.mockReturnValue(vi.fn());
    mocks.buildSnapshot.mockReturnValue({});
  });
  afterEach(async () => {
    stopMcpElectronBridge();
    await vi.runAllTimersAsync();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });
  it.each(['embeddingConfigs', 'activeEmbeddingConfig', 'vectorSearchConfig'])('refreshes IPC after %s changes', async (field) => {
    const state = {
      mcpConfig: { enabled: true, host: '127.0.0.1', port: 3927, token: 'token' },
      repositories: [], customCategories: [], releases: [],
      embeddingConfigs: [], activeEmbeddingConfig: 'old', vectorSearchConfig: {},
    };
    mocks.getState.mockReturnValue(state);
    startMcpElectronBridge();
    await vi.advanceTimersByTimeAsync(301);
    expect(mocks.pushSnapshot).toHaveBeenCalledOnce();
    const next = { ...state, [field]: field === 'activeEmbeddingConfig' ? 'new' : {} };
    mocks.getState.mockReturnValue(next);
    mocks.subscribe.mock.calls[0][0](next, state);
    await vi.advanceTimersByTimeAsync(301);
    expect(mocks.pushSnapshot).toHaveBeenCalledTimes(2);
    expect(mocks.buildSnapshot).toHaveBeenLastCalledWith(next, expect.any(String));
  });
});
