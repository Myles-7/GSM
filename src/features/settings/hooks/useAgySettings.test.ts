import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ apply: vi.fn(), api: { getState: vi.fn(), save: vi.fn(), probe: vi.fn(), cancel: vi.fn() } }));
vi.mock('../../../store/useAppStore', () => ({ useAppStore: Object.assign(() => 'agy-cli-local', { subscribe: () => () => {}, getState: () => ({ setActiveAIConfig: vi.fn() }) }) }));
vi.mock('../../../services/agyClient', () => ({ applyAgyDeviceState: mock.apply }));
vi.mock('../../../services/electronProxy', () => ({}));
import { useAgySettings } from './useAgySettings';
const original = window.electronAPI;
const prefs = { enabled: true, model: 'fixture', effort: 'high', timeoutSeconds: 180, concurrency: 5, featureOverrides: {} };
const state = { supported: true, enabled: true, prefs, executable: { fingerprint: 'fixture' }, lastProbe: { code: 'SUCCESS', fingerprint: 'fixture' }, featureProbes: {} };
beforeEach(() => {
  vi.clearAllMocks(); window.electronAPI = { agy: mock.api } as never;
  mock.api.getState.mockResolvedValue(state);
  mock.api.save.mockImplementation(async (_id, value) => ({ ok: true, value: { ...state, enabled: value.enabled, prefs: value } }));
  mock.api.probe.mockResolvedValue({ ok: true, value: state });
});
afterEach(() => { window.electronAPI = original; });
it('retesting the active organization model does not disable it', async () => {
  const h = renderHook(useAgySettings);
  await waitFor(() => expect(h.result.current.draft).not.toBeNull());
  await act(async () => { await h.result.current.testOrganizationBeforeEnable(); });
  expect(mock.api.save).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ enabled: true }));
  expect(mock.api.probe).toHaveBeenCalledTimes(2);
  expect(h.result.current.state?.enabled).toBe(true);
});
it('testing a different organization model preserves old healthy in-flight calls', async () => {
  const h = renderHook(useAgySettings);
  await waitFor(() => expect(h.result.current.draft).not.toBeNull());
  act(() => h.result.current.update({ featureOverrides: { organization: { model: 'changed' } } }));
  await act(async () => { await h.result.current.testOrganizationBeforeEnable(); });
  expect(mock.api.save).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ enabled: true }));
});
