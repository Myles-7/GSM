import { useCallback, useEffect, useRef, useState } from 'react';
import type { AgyDesktopAPI, AgyDevicePrefs, AgyDeviceState, AgyModel, AgyResult } from '../../../types/agy';
import type { AgyFeature } from '../../../types/agy';
import { useAppStore } from '../../../store/useAppStore';
import '../../../services/electronProxy';
import { applyAgyDeviceState } from '../../../services/agyClient';
import { AGY_CONFIG_ID } from '../../../utils/aiConfig';

export function useAgySettings() {
  const api = typeof window !== 'undefined' ? window.electronAPI?.agy : undefined;
  const [state, setState] = useState<AgyDeviceState | null>(null);
  const [draft, setDraft] = useState<AgyDevicePrefs | null>(null);
  const [models, setModels] = useState<AgyModel[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const alive = useRef(false);
  const current = useRef<string | null>(null);
  const canceled = useRef<string | null>(null);
  const detectedOnce = useRef(false);

  const cancel = useCallback(() => {
    const id = current.current;
    if (id) canceled.current = id;
    if (id) void api?.cancel(id).catch(() => {});
    // Keep the slot occupied until the process has actually stopped.
  }, [api]);

  useEffect(() => {
    let live = true;
    alive.current = true;
    void api?.getState().then(value => {
      if (live) { setState(value); setDraft(value.prefs); applyAgyDeviceState(value); }
    }).catch(() => { if (live) setNotice('IO_FAILED'); });
    const timer = api ? setInterval(() => {
      void api.getState().then(value => { if (live) { setState(value); applyAgyDeviceState(value); } }).catch(() => {});
    }, 2000) : undefined;
    const unsubscribe = useAppStore.subscribe((next, previous) => {
      if (next.user?.id !== previous.user?.id || next.githubToken !== previous.githubToken) {
        cancel();
        current.current = null;
        setBusy(false);
        setNotice(null);
        setModels([]);
      }
    });
    return () => { live = false; alive.current = false; clearInterval(timer); cancel(); current.current = null; unsubscribe(); };
  }, [api, cancel]);

  useEffect(() => {
    if (!state?.supported || state.executable || busy || detectedOnce.current) return;
    detectedOnce.current = true;
    void run((bridge, id) => bridge.detect(id), value => { setState(value); setDraft(value.prefs); applyAgyDeviceState(value); });
  // The attempt is once per panel mount; failures remain available for manual retry.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, busy]);

  const run = useCallback(async <T,>(
    action: (bridge: AgyDesktopAPI, id: string) => Promise<AgyResult<T>>,
    apply: (value: T) => void,
    saved = false,
  ) => {
    if (!api || current.current) return;
    const id = crypto.randomUUID();
    current.current = id;
    setBusy(true);
    setNotice(null);
    try {
      const result = await action(api, id);
      if (!alive.current || current.current !== id) return;
      if (canceled.current === id) { setNotice('CANCELED'); return; }
      if (result.ok) { apply(result.value); if (saved) setNotice('SAVED'); }
      else setNotice(result.code);
    } catch {
      if (alive.current && current.current === id) setNotice('IO_FAILED');
    } finally {
      if (alive.current && current.current === id) { current.current = null; setBusy(false); }
    }
  }, [api]);

  const apply = (value: AgyDeviceState) => { setState(value); applyAgyDeviceState(value); };
  const update = (patch: Partial<AgyDevicePrefs>) => {
    setDraft(previous => previous ? { ...previous, ...patch } : null);
    setNotice(null);
  };
  return {
    available: !!api, state, draft, models, busy, notice, update, cancel,
    detect: () => run((bridge, id) => bridge.detect(id), value => { apply(value); setDraft(value.prefs); setModels([]); }),
    choose: () => run((bridge, id) => bridge.choose(id), value => { apply(value); setDraft(value.prefs); setModels([]); }),
    refreshModels: () => run((bridge, id) => bridge.listModels(id), setModels),
    probe: () => run((bridge, id) => bridge.probe(id), value => { apply(value); setDraft(value.prefs); }),
    testFeature: (feature: AgyFeature) => run((bridge, id) => bridge.probe(id, feature), value => { apply(value); setDraft(value.prefs); }),
    save: () => draft && run((bridge, id) => bridge.save(id, draft), value => { apply(value); setDraft(value.prefs); }, true),
    saveAndProbe: () => draft && run(async (bridge, id) => {
      // A stale enabled flag must not prevent testing a changed executable/model.
      const saved = await bridge.save(id, { ...draft, enabled: false });
      if (!saved.ok) return saved;
      if (current.current !== id || canceled.current === id) return { ok: false as const, code: 'CANCELED' };
      const tested = await bridge.probe(id);
      if (!tested.ok || tested.value.lastProbe?.code !== 'SUCCESS' || !draft.enabled) return tested;
      if (current.current !== id || canceled.current === id) return { ok: false as const, code: 'CANCELED' };
      return bridge.save(id, { ...draft, enabled: true });
    }, value => { apply(value); setDraft(value.prefs); }),
    enableAndActivate: () => draft && run((bridge, id) => bridge.save(id, { ...draft, enabled: true }), value => {
      apply(value); setDraft(value.prefs);
      if (value.enabled) useAppStore.getState().setActiveAIConfig(AGY_CONFIG_ID);
    }, true),
    activate: () => {
      if (state?.enabled) useAppStore.getState().setActiveAIConfig(AGY_CONFIG_ID);
    },
    active: useAppStore(store => store.activeAIConfig) === AGY_CONFIG_ID,
  };
}
