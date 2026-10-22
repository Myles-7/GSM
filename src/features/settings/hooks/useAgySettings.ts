import { useCallback, useEffect, useRef, useState } from 'react';
import type { AgyDesktopAPI, AgyDevicePrefs, AgyDeviceState, AgyModel, AgyRecoveryIssue, AgyResult } from '../../../types/agy';
import type { AgyFeature } from '../../../types/agy';
import { useAppStore } from '../../../store/useAppStore';
import '../../../services/electronProxy';
import { applyAgyDeviceState, inspectAgyRecovery, repairAgyRecovery } from '../../../services/agyClient';
import { AGY_CONFIG_ID } from '../../../utils/aiConfig';
import { agyConcurrencyDirty, concurrencyPreferences, mergeAgyDraft } from './agySettingsState';

export function useAgySettings() {
  const api = typeof window !== 'undefined' ? window.electronAPI?.agy : undefined;
  const [state, setState] = useState<AgyDeviceState | null>(null);
  const [draft, setDraft] = useState<AgyDevicePrefs | null>(null);
  const [models, setModels] = useState<AgyModel[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [recoveryIssues, setRecoveryIssues] = useState<AgyRecoveryIssue[]>([]);
  const [recoveryBusy, setRecoveryBusy] = useState<string | null>(null);
  const alive = useRef(false);
  const current = useRef<string | null>(null);
  const canceled = useRef<string | null>(null);
  const detectedOnce = useRef(false);
  const savedState = useRef<AgyDeviceState | null>(null);
  const readEpoch = useRef(0), readSequence = useRef(0), acceptedRead = useRef(0);
  const accept = useCallback((value: AgyDeviceState, resetDraft = false) => {
    if (value.revision !== undefined && savedState.current?.revision !== undefined && value.revision < savedState.current.revision) return;
    if (applyAgyDeviceState(value) === false) return;
    const previous = savedState.current; savedState.current = value;
    setState(value); setDraft(local => resetDraft ? value.prefs : mergeAgyDraft(previous?.prefs ?? null, local, value.prefs));
  }, []);

  const cancel = useCallback(() => {
    const id = current.current;
    if (id) canceled.current = id;
    if (id) void api?.cancel(id).catch(() => {});
    // Keep the slot occupied until the process has actually stopped.
  }, [api]);

  const refreshRecoveryIssues = useCallback(async () => {
    const owner = String(useAppStore.getState().user?.id ?? '');
    if (!api || !owner) { if (alive.current) setRecoveryIssues([]); return; }
    try {
      const result = await inspectAgyRecovery(owner);
      if (alive.current && String(useAppStore.getState().user?.id ?? '') === owner) setRecoveryIssues(result.errors);
    } catch {
      // Recovery listing can fail for unrelated I/O reasons. New provider work
      // remains fail-closed in agyClient; Settings should not hide the provider UI.
    }
  }, [api]);

  useEffect(() => {
    let live = true;
    alive.current = true;
    savedState.current = null;
    const read = (initial = false) => {
      const epoch = readEpoch.current, sequence = ++readSequence.current;
      void api?.getState().then(value => {
        if (live && epoch === readEpoch.current && sequence >= acceptedRead.current) { acceptedRead.current = sequence; accept(value); }
      }).catch(() => { if (live && initial && epoch === readEpoch.current) setNotice('IO_FAILED'); });
    };
    read(true);
    void refreshRecoveryIssues();
    const timer = api ? setInterval(() => {
      if (!current.current) read();
    }, 2000) : undefined;
    const unsubscribe = useAppStore.subscribe((next, previous) => {
      if (next.user?.id !== previous.user?.id || next.githubToken !== previous.githubToken) {
        cancel();
        readEpoch.current++;
        current.current = null;
        setBusy(false);
        setNotice(null);
        setModels([]);
        setRecoveryIssues([]);
        setRecoveryBusy(null);
        void refreshRecoveryIssues();
      }
    });
    return () => { live = false; alive.current = false; clearInterval(timer); cancel(); current.current = null; unsubscribe(); };
  }, [api, cancel, refreshRecoveryIssues, accept]);

  useEffect(() => {
    if (!state?.supported || state.executable || busy || detectedOnce.current) return;
    detectedOnce.current = true;
    void run((bridge, id) => bridge.detect(id), value => accept(value, true));
  // The attempt is once per panel mount; failures remain available for manual retry.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, busy]);

  const run = useCallback(async <T,>(
    action: (bridge: AgyDesktopAPI, id: string) => Promise<AgyResult<T>>,
    apply: (value: T) => void,
    saved: boolean | 'CONCURRENCY_SAVED' = false,
  ) => {
    if (!api || current.current) return;
    const id = crypto.randomUUID();
    current.current = id;
    readEpoch.current++;
    setBusy(true);
    setNotice(null);
    try {
      const result = await action(api, id);
      if (!alive.current || current.current !== id) return;
      if (canceled.current === id) { setNotice('CANCELED'); return; }
      if (result.ok) { apply(result.value); if (saved) setNotice(saved === true ? 'SAVED' : saved); }
      else setNotice(result.code);
    } catch {
      if (alive.current && current.current === id) setNotice('IO_FAILED');
    } finally {
      if (alive.current && current.current === id) { readEpoch.current++; current.current = null; setBusy(false); }
    }
  }, [api]);

  const apply = (value: AgyDeviceState) => accept(value);
  const update = (patch: Partial<AgyDevicePrefs>) => {
    setDraft(previous => previous ? { ...previous, ...patch } : null);
    setNotice(null);
  };
  const repairRecovery = useCallback(async (issue: AgyRecoveryIssue) => {
    const owner = String(useAppStore.getState().user?.id ?? '');
    if (!api || !owner || recoveryBusy) return;
    const action = issue.certainty === 'definitely-unsent' ? 'discard-unsent' : 'abandon-unknown';
    const chinese = (useAppStore.getState().language ?? 'zh').startsWith('zh');
    const confirmed = window.confirm(issue.certainty === 'definitely-unsent'
      ? chinese
        ? '该损坏记录仍能证明模型请求从未发送。确认安全丢弃这条恢复记录并解除阻断？原始损坏记录会保留为本地审计文件。'
        : 'This corrupt record still proves the provider request was never sent. Safely discard it and unblock AGY? The original corrupt record will be retained locally for audit.'
      : chinese
        ? '无法证明这次模型请求未发送，可能已经调用并计费。确认放弃未知结果并解除阻断？原始损坏记录会保留为本地审计文件。'
        : 'This request cannot be proven unsent and may already have been billed. Abandon the unknown outcome and unblock AGY? The original corrupt record will be retained locally for audit.');
    if (!confirmed) return;
    setRecoveryBusy(issue.requestId); setNotice(null);
    try {
      await repairAgyRecovery(owner, issue.requestId, action);
      if (alive.current) setNotice('RECOVERY_REPAIRED');
      await refreshRecoveryIssues();
    } catch (error) {
      if (alive.current) setNotice(error instanceof Error ? error.message.replace(/^AGY_/, '') : 'RECOVERY_IO_FAILED');
    } finally {
      if (alive.current) setRecoveryBusy(null);
    }
  }, [api, recoveryBusy, refreshRecoveryIssues]);
  return {
    available: !!api, state, draft, models, busy, notice, update, cancel, recoveryIssues, recoveryBusy, repairRecovery,
    recover: () => run((bridge, id) => bridge.recover(id), apply),
    detect: () => run((bridge, id) => bridge.detect(id), value => { accept(value,true); setModels([]); }),
    choose: () => run((bridge, id) => bridge.choose(id), value => { accept(value,true); setModels([]); }),
    refreshModels: () => run((bridge, id) => bridge.listModels(id), setModels),
    concurrencyDirty: agyConcurrencyDirty(state?.prefs ?? null, draft),
    saveConcurrency: () => {
      const base = savedState.current?.prefs;
      if (!base || !draft) return;
      const local = structuredClone(draft);
      return run(async (bridge,id) => {
        const latest = await bridge.getState();
        if (current.current !== id || canceled.current === id) return {ok:false as const,code:'CANCELED'};
        return bridge.save(id,concurrencyPreferences(base,local,latest.prefs));
      },apply,'CONCURRENCY_SAVED');
    },
    probe: () => run((bridge, id) => bridge.probe(id), value => accept(value,true)),
    testFeature: (feature: AgyFeature) => draft && run(async (bridge, id) => {
      const saved = await bridge.save(id, { ...draft, enabled: !!state?.enabled && draft.enabled });
      if (!saved.ok) return saved;
      if (current.current !== id || canceled.current === id) return { ok: false as const, code: 'CANCELED' };
      if (alive.current) accept(saved.value);
      return bridge.probe(id, feature);
    }, value => accept(value,true)),
    save: () => draft && run((bridge, id) => bridge.save(id, draft), value => accept(value,true), true),
    testOrganizationBeforeEnable: () => draft && run(async (bridge, id) => {
      const saved = await bridge.save(id, { ...draft, enabled: !!state?.enabled && draft.enabled });
      if (!saved.ok) return saved;
      if (current.current !== id || canceled.current === id) return { ok: false as const, code: 'CANCELED' };
      if (alive.current) accept(saved.value);
      const base = await bridge.probe(id);
      if (!base.ok || base.value.lastProbe?.code !== 'SUCCESS') return base;
      if (current.current !== id || canceled.current === id) return { ok: false as const, code: 'CANCELED' };
      return bridge.probe(id, 'organization');
    }, value => accept(value,true)),
    saveAndProbe: () => draft && run(async (bridge, id) => {
      // A stale enabled flag must not prevent testing a changed executable/model.
      const saved = await bridge.save(id, { ...draft, enabled: !!state?.enabled && draft.enabled });
      if (!saved.ok) return saved;
      if (current.current !== id || canceled.current === id) return { ok: false as const, code: 'CANCELED' };
      // Publish the pending profile without canceling healthy requests from older revisions.
      if (alive.current) accept(saved.value);
      const tested = await bridge.probe(id);
      if (!tested.ok || tested.value.lastProbe?.code !== 'SUCCESS' || !draft.enabled) return tested;
      if (current.current !== id || canceled.current === id) return { ok: false as const, code: 'CANCELED' };
      return bridge.save(id, { ...draft, enabled: true });
    }, value => accept(value,true)),
    enableAndActivate: () => draft && run((bridge, id) => bridge.save(id, { ...draft, enabled: true }), value => {
      accept(value,true);
      if (value.enabled) useAppStore.getState().setActiveAIConfig(AGY_CONFIG_ID);
    }, true),
    activate: () => {
      if (state?.enabled) useAppStore.getState().setActiveAIConfig(AGY_CONFIG_ID);
    },
    active: useAppStore(store => store.activeAIConfig) === AGY_CONFIG_ID,
    probeMatches: !!(state?.executable && state.lastProbe?.code === 'SUCCESS' &&
      state.lastProbe.fingerprint === state.executable.fingerprint &&
      (!state.lastProbe.identity || state.lastProbe.identity === `${state.executable.fingerprint}:${state.prefs.model}:${state.prefs.effort}:text-v1`)),
  };
}
