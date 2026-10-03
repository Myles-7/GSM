import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgyConfigPanel } from './AgyConfigPanel';
import type { AgyDesktopAPI, AgyDeviceState } from '../../types/agy';
import { useAppStore } from '../../store/useAppStore';

vi.mock('../../i18n/useT', () => ({ useT: () => (key: string) => ({ 'settingsUx.globalConcurrency': '全局并发上限', 'settingsUx.concurrency': '并发上限', 'settingsUx.features.repository-summary': '仓库摘要' }[key] ?? key) }));
vi.mock('../../store/useAppStore', async () => {
  const { create } = await import('zustand');
  return { useAppStore: create(set => ({ githubToken: null, user: null, aiConfigs: [], activeAIConfig: null,
    setAIConfigs: (aiConfigs: unknown[]) => set({ aiConfigs }), setActiveAIConfig: (activeAIConfig: string) => set({ activeAIConfig }) })) };
});
const initial: AgyDeviceState = {
  prefs: { model: '', effort: 'medium', mode: 'model', timeoutSeconds: 180, maxQueued: 10, enabled: false },
  supported: true, enabled: false, executable: null, lastProbe: null, busy: false,
};
const detected: AgyDeviceState = { ...initial, executable: { name: 'agy.exe', fingerprint: 'abc' } };
let api: AgyDesktopAPI;
beforeEach(() => {
  useAppStore.setState({ activeAIConfig: null, aiConfigs: [] });
  api = {
    chooseProject: vi.fn(), readProject: vi.fn(), revokeProject: vi.fn(),
    getState: vi.fn().mockResolvedValue(initial),
    detect: vi.fn().mockResolvedValue({ ok: true, value: detected }),
    choose: vi.fn().mockResolvedValue({ ok: false, code: 'CANCELED' }),
    save: vi.fn().mockImplementation((_id, prefs) => Promise.resolve({ ok: true, value: { ...detected, prefs, enabled: prefs.enabled } })),
    listModels: vi.fn().mockResolvedValue({ ok: true, value: [{ id: 'synthetic-model', label: 'Synthetic model' }] }),
    probe: vi.fn().mockResolvedValue({ ok: true, value: { ...detected, lastProbe: {
      code: 'SUCCESS', toolCount: 58, at: new Date().toISOString(), fingerprint: 'abc', promptsSent: 1,
    } } }),
    cancel: vi.fn().mockResolvedValue(undefined),
    setSession: vi.fn().mockResolvedValue(undefined),
    start: vi.fn(),
    onEvent: vi.fn().mockReturnValue(() => {}),
  };
  Object.defineProperty(window, 'electronAPI', { configurable: true, value: { agy: api } });
});
afterEach(() => { Object.defineProperty(window, 'electronAPI', { configurable: true, value: undefined }); });

describe('AGY device settings', () => {
  it('allows disabling an enabled provider even after its probe expires', async () => {
    api.getState = vi.fn().mockResolvedValue({ ...detected, enabled: true, prefs: { ...initial.prefs, enabled: true } });
    render(<AgyConfigPanel />);
    const toggle = await screen.findByLabelText('agy.enable');
    expect(toggle).not.toBeDisabled();
    fireEvent.click(toggle);
    fireEvent.click(screen.getByText('agy.save'));
    await screen.findByText('agy.saved');
    expect(api.save).toHaveBeenLastCalledWith(expect.any(String), expect.objectContaining({ enabled: false }));
    expect(api.probe).not.toHaveBeenCalled();
  });
  it('saves only batch limits while other features inherit global defaults, without making test calls', async () => {
    render(<AgyConfigPanel />);
    fireEvent.change(await screen.findByLabelText('全局并发上限'), { target: { value: '3' } });
    fireEvent.change(screen.getByLabelText('仓库摘要 并发上限'), { target: { value: '2' } });
    expect(document.querySelectorAll('select[id^="agy-batch-"]')).toHaveLength(5);
    expect(screen.queryByLabelText('仓库摘要 模型')).toBeNull();
    fireEvent.click(screen.getByText('agy.save'));
    await screen.findByText('agy.saved');
    expect(api.save).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ concurrency: 3,
      featureOverrides: { 'repository-summary': { concurrency: 2 } } }));
    expect(api.probe).not.toHaveBeenCalled();
    expect(api.start).not.toHaveBeenCalled();
  });

  it('retains historical model overrides until explicitly reset and preserves batch limits', async () => {
    api.getState = vi.fn().mockResolvedValue({ ...detected, prefs: { ...initial.prefs,
      featureOverrides: { 'repository-summary': { model: 'legacy-model', effort: 'max', concurrency: 2 }, workbench: { timeoutSeconds: 300 } } } });
    render(<AgyConfigPanel />);
    await screen.findByText(/legacy-model/);
    fireEvent.click(screen.getAllByText('settingsUx.resetDefaults')[0]);
    fireEvent.click(screen.getByText('agy.save'));
    await screen.findByText('agy.saved');
    expect(api.save).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      featureOverrides: { 'repository-summary': { concurrency: 2 }, workbench: { timeoutSeconds: 300 } } }));
    expect(api.probe).not.toHaveBeenCalled();
  });
  it('allows tested disabled current configuration to be enabled after checking its toggle', async () => {
    useAppStore.setState({ activeAIConfig: 'agy-cli-local' });
    render(<AgyConfigPanel />);
    await screen.findByText('agy.exe');
    fireEvent.click(screen.getByText('agy.saveAndTest'));
    await screen.findByText(/agy.success/);
    expect(screen.queryByText('agy.active')).toBeNull();
    fireEvent.click(screen.getByLabelText('agy.enable'));
    expect(screen.getByText('agy.enableAndActivate')).not.toBeDisabled();
    fireEvent.click(screen.getByText('agy.enableAndActivate'));
    await screen.findByText('agy.active');
    expect(api.save).toHaveBeenLastCalledWith(expect.any(String), expect.objectContaining({ enabled: true }));
  });

  it('saves inactive preferences before retesting an already enabled configuration', async () => {
    api.getState = vi.fn().mockResolvedValue({ ...detected, enabled: true, prefs: { ...initial.prefs, enabled: true } });
    render(<AgyConfigPanel />);
    await screen.findByText('agy.exe');
    fireEvent.click(screen.getByText('agy.saveAndTest'));
    await waitFor(() => expect(api.save).toHaveBeenCalledTimes(2));
    expect(api.save).toHaveBeenLastCalledWith(expect.any(String), expect.objectContaining({ enabled: true }));
    expect(api.save).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ enabled: false }));
    expect(api.probe).toHaveBeenCalledOnce();
  });
  it.each(['AUTH_REQUIRED', 'RATE_LIMIT', 'QUEUE_TIMEOUT', 'TIMEOUT', 'PERMISSION_DENIED'])(
    'provides an actionable %s error and allows recovery without changing the model', async code => {
      api.probe = vi.fn().mockResolvedValueOnce({ ok: false, code })
        .mockResolvedValueOnce({ ok: true, value: { ...detected, lastProbe: {
          code: 'SUCCESS', toolCount: 2, at: new Date().toISOString(), fingerprint: 'abc', promptsSent: 1,
        } } });
      render(<AgyConfigPanel />);
      await screen.findByText('agy.exe');
      fireEvent.click(screen.getByText('agy.saveAndTest'));
      await screen.findByText(`agy.errors.${code} (${code})`);
      expect(api.start).not.toHaveBeenCalled();
      fireEvent.click(screen.getByText('agy.saveAndTest'));
      await screen.findByText(/agy.success/);
      expect(api.probe).toHaveBeenCalledTimes(2);
      expect(screen.getByLabelText('agy.model')).toHaveValue('');
    });
  it('does not start generation after canceling the save part of save-and-test', async () => {
    let finish!: (value: unknown) => void;
    api.save = vi.fn().mockReturnValue(new Promise(resolve => { finish = resolve; }));
    render(<AgyConfigPanel />);
    await screen.findByText('agy.exe');
    fireEvent.click(screen.getByText('agy.saveAndTest'));
    await waitFor(() => expect(api.save).toHaveBeenCalled());
    fireEvent.click(screen.getByText('agy.cancel'));
    await act(async () => { finish({ ok: true, value: detected }); });
    expect(api.probe).not.toHaveBeenCalled();
    expect(screen.getByText(/CANCELED/)).toBeInTheDocument();
  });

  it('detects the executable without generating automatically and saves inactive preferences', async () => {
    render(<AgyConfigPanel />);
    const timeout = await screen.findByLabelText('agy.timeout');
    await screen.findByText('agy.exe');
    expect(api.detect).toHaveBeenCalledTimes(1);
    expect(api.probe).not.toHaveBeenCalled();
    fireEvent.change(timeout, { target: { value: '240' } });
    fireEvent.change(screen.getByLabelText('agy.mode'), { target: { value: 'research' } });
    fireEvent.click(screen.getByText('agy.save'));
    await screen.findByText('agy.saved');
    expect(api.save).toHaveBeenCalledWith(expect.any(String), { ...initial.prefs, timeoutSeconds: 240, mode: 'research' });
    expect(screen.queryByLabelText(/API Key|Base URL/)).toBeNull();
    expect(screen.queryByText('agy.blocked')).toBeNull();
  });

  it('detects, loads models, and tests before enabling', async () => {
    render(<AgyConfigPanel />);
    await screen.findByLabelText('agy.model');
    fireEvent.click(screen.getByText('agy.detect'));
    await screen.findByText('agy.exe');
    fireEvent.click(screen.getByLabelText('agy.refreshModels'));
    await screen.findAllByText('Synthetic model');
    fireEvent.click(screen.getByText('agy.saveAndTest'));
    await screen.findByText(/agy.success/);
    expect(screen.getByLabelText('agy.enable')).not.toBeDisabled();
    fireEvent.click(screen.getByLabelText('agy.enable'));
    fireEvent.click(screen.getByText('agy.save'));
    await screen.findByText('agy.saved');
    fireEvent.click(screen.getByText('agy.activate'));
    expect(useAppStore.getState().activeAIConfig).toBe('agy-cli-local');
    expect(screen.queryByText('agy.blocked')).toBeNull();
  });

  it('validates numbers and shows browser-only limitation', async () => {
    const view = render(<AgyConfigPanel />);
    fireEvent.change(await screen.findByLabelText('agy.timeout'), { target: { value: '0' } });
    expect(screen.getByText('agy.save')).toBeDisabled();
    view.unmount();
    Object.defineProperty(window, 'electronAPI', { configurable: true, value: undefined });
    render(<AgyConfigPanel />);
    expect(screen.getByText('agy.desktopOnly')).toBeInTheDocument();
    expect(screen.queryByText('agy.save')).toBeNull();
  });

  it('cancels on account change and ignores a late result', async () => {
    let resolve!: (value: unknown) => void;
    api.detect = vi.fn().mockReturnValue(new Promise(done => { resolve = done; }));
    render(<AgyConfigPanel />);
    await screen.findByLabelText('agy.model');
    fireEvent.click(screen.getByText('agy.detect'));
    const previous = useAppStore.getState().githubToken;
    act(() => useAppStore.setState({ githubToken: 'synthetic-switch' }));
    await waitFor(() => expect(api.cancel).toHaveBeenCalledWith(expect.any(String)));
    await act(async () => { resolve({ ok: true, value: detected }); });
    expect(screen.queryByText('agy.exe')).toBeNull();
    act(() => useAppStore.setState({ githubToken: previous }));
  });

  it('cancels pending diagnostics on unmount', async () => {
    api.detect = vi.fn().mockReturnValue(new Promise(() => {}));
    const view = render(<AgyConfigPanel />);
    await screen.findByLabelText('agy.model');
    fireEvent.click(screen.getByText('agy.detect'));
    view.unmount();
    expect(api.cancel).toHaveBeenCalledWith(expect.any(String));
  });
});
