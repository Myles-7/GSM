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
it('refreshes an untouched draft on polling and keeps unsaved fields when other device values change',async()=>{
  const h=renderHook(useAgySettings);await waitFor(()=>expect(h.result.current.draft).not.toBeNull());
  act(()=>h.result.current.update({concurrency:3}));
  mock.api.getState.mockResolvedValue({...state,prefs:{...prefs,model:'external-model',concurrency:4}});
  await waitFor(()=>expect(h.result.current.draft?.model).toBe('external-model'),{timeout:3500});
  expect(h.result.current.draft?.concurrency).toBe(3);
});
it('saves only concurrency and preserves an unsaved model without a provider test',async()=>{
  const h=renderHook(useAgySettings);await waitFor(()=>expect(h.result.current.draft).not.toBeNull());
  act(()=>h.result.current.update({concurrency:3,model:'unsaved-model'}));
  await act(async()=>{await h.result.current.saveConcurrency();});
  expect(mock.api.save).toHaveBeenCalledWith(expect.any(String),expect.objectContaining({concurrency:3,model:'fixture'}));
  expect(h.result.current.draft?.model).toBe('unsaved-model');expect(h.result.current.state?.prefs.concurrency).toBe(3);
  expect(mock.api.probe).not.toHaveBeenCalled();
});
it('ignores a poll started before saving even if it finishes after the save',async()=>{
  let finish!:(value:unknown)=>void;
  mock.api.getState.mockResolvedValueOnce(state).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;})).mockResolvedValue(state);
  const h=renderHook(useAgySettings);await waitFor(()=>expect(h.result.current.draft).not.toBeNull());
  await waitFor(()=>expect(mock.api.getState).toHaveBeenCalledTimes(2),{timeout:3500});
  act(()=>h.result.current.update({concurrency:3}));await act(async()=>{await h.result.current.saveConcurrency();});
  await act(async()=>{finish(state);});
  expect(h.result.current.draft?.concurrency).toBe(3);expect(h.result.current.state?.prefs.concurrency).toBe(3);
});
