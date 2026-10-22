import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useAppStore } from '../../../store/useAppStore';
import { explorationRuntime } from '../../../services/explorationRuntime';
import { describeAgyRecoveryError } from '../../../services/agyErrors';
import { refreshAgyDeviceState } from '../../../services/agyClient';
import { explorationFingerprint } from '../exploration/model';
import { emptyExplorationAccount, parseExplorationBackup, serializeExploration } from '../exploration/storage';
import type { ExplorationOverride, SavedExploration } from '../exploration/types';
import { isAIConfigAvailable } from '../../../utils/aiConfig';
import { retainPageTaskFailure } from '../../../services/pageTaskFailure';
import { openTaskDetails, type TaskDetailTab } from '../../../services/taskDetailsNavigation';

export function useExploration() {
  const { ownerId, repositories, configs, activeConfigId } = useAppStore(useShallow(state => ({ ownerId: state.user ? String(state.user.id) : '', repositories: state.repositories, configs: state.aiConfigs, activeConfigId: state.activeAIConfig })));
  const runtime = useSyncExternalStore(explorationRuntime.subscribe, () => explorationRuntime.snapshot(ownerId));
  const [configId, setConfigId] = useState(activeConfigId ?? '');
  const [checking, setChecking] = useState(false);
  const previousOwner = useRef(ownerId);
  useEffect(() => {
    if (previousOwner.current !== ownerId) explorationRuntime.cancel(previousOwner.current);
    previousOwner.current = ownerId; setConfigId(useAppStore.getState().activeAIConfig ?? '');
    void explorationRuntime.load(ownerId);
  }, [ownerId]);
  useEffect(() => {
    if (!configs.some(row => row.id === configId)) setConfigId(configs.find(row => row.id === activeConfigId)?.id ?? configs.find(isAIConfigAvailable)?.id ?? '');
  }, [activeConfigId, configId, configs]);
  useEffect(() => {
    if (!window.electronAPI?.agy) return;
    let current = true; setChecking(true);
    void refreshAgyDeviceState().then(() => { if (current) { explorationRuntime.error(ownerId, ''); setChecking(false); } })
      .catch(reason => { if (current) { explorationRuntime.error(ownerId, reason); setChecking(false); } });
    return () => { current = false; };
  }, [ownerId]);
  const config = configs.find(row => row.id === configId), account = runtime.account;
  const setupCode = config?.provider === 'agy-cli' ? !window.electronAPI?.agy ? 'AGY_DESKTOP_REQUIRED' : !config.deviceBound ? 'AGY_NOT_FOUND' : !config.isActive ? 'AGY_DISABLED' : '' : '';
  const previousError = account?.task?.error ?? '';
  const obsolete = !setupCode && config?.provider === 'agy-cli' && /^AGY_(DISABLED|NOT_FOUND|DESKTOP_REQUIRED|TEST_REQUIRED)$/.test(previousError);
  const currentError = runtime.error || (!obsolete ? previousError : '');
  const changedCount = repositories.filter(repo => account?.index?.profiles[String(repo.id)]?.fingerprint !== explorationFingerprint(repo)).length + Object.keys(account?.index?.profiles ?? {}).filter(id => !repositories.some(repo => String(repo.id) === id)).length;
  const operation = async (action: () => Promise<unknown>) => { try { await action(); return true; } catch (reason) {
    retainPageTaskFailure(ownerId, 'exploration', reason instanceof Error ? reason.message : String(reason), { title:'保存项目探索', target:{view:'repositories',id:'project-map'} });
    explorationRuntime.error(ownerId, new Error('探索更改未保存')); return false;
  } };
  const retry = () => { const task = account?.task; return explorationRuntime.run(ownerId, { type: task?.type ?? 'build', configId, query: task?.query, scope: task?.scope, force: task?.force, savedId: task?.savedId }); };
  return { ownerId, repositories, account, loading: runtime.loading, busy: runtime.busy, activity: runtime.activity, concurrency: runtime.concurrency,
    error: describeAgyRecoveryError(currentError), setupIssue: describeAgyRecoveryError(setupCode), canRun: isAIConfigAvailable(config) && !setupCode, checking, configId, setConfigId, configs, config, changedCount,
    recoveryStorageFull: currentError.includes('AGY_RECOVERY_STORAGE_FULL'),
    refreshStatus: async () => { setChecking(true); try { if (!window.electronAPI?.agy) throw new Error('AGY_DESKTOP_REQUIRED'); await refreshAgyDeviceState(); explorationRuntime.error(ownerId, ''); } catch (reason) { explorationRuntime.error(ownerId, reason); } finally { setChecking(false); } },
    build: (force = false) => explorationRuntime.run(ownerId, { type: 'build', configId, force }),
    deepen: (query: string, scope = '') => explorationRuntime.run(ownerId, { type: 'query', configId, query, scope }), retry,
    updateSaved: (saved: SavedExploration, force = false) => explorationRuntime.run(ownerId, { type: 'query', configId, query: saved.query, scope: JSON.stringify(saved.scope ?? saved.path.at(-1)), savedId: saved.id, force }),
    cancel: () => explorationRuntime.cancel(ownerId),
    addOverride: (input: ExplorationOverride) => operation(() => explorationRuntime.override(ownerId, input)),
    removeOverride: (id: string) => operation(() => explorationRuntime.update(ownerId, current => ({ ...current, overrides: current.overrides.filter(row => row.id !== id) }))),
    saveExploration: (input: SavedExploration) => operation(() => explorationRuntime.update(ownerId, current => ({ ...current, saved: [...(current.saved ?? []).filter(row => row.id !== input.id), input] }))),
    editSaved: (id: string, update: Partial<Pick<SavedExploration, 'name' | 'camera' | 'path' | 'kindFilter' | 'layoutPositions'>>) => operation(() => explorationRuntime.update(ownerId, current => ({ ...current, saved: current.saved?.map(row => row.id === id ? { ...row, ...update } : row) }))),
    reorderSaved: (ids: string[]) => operation(() => explorationRuntime.update(ownerId, current => ({ ...current, saved: ids.flatMap(id => current.saved?.find(row => row.id === id) ?? []) }))),
    deleteSaved: (id: string) => operation(() => explorationRuntime.update(ownerId, current => ({ ...current, saved: current.saved?.filter(row => row.id !== id) }))),
    exportData: () => serializeExploration(account ?? emptyExplorationAccount(ownerId)),
    importData: async (content: string) => { if (runtime.busy) throw new Error('请先取消任务再导入。'); const imported = parseExplorationBackup(content, ownerId); await explorationRuntime.update(ownerId, () => imported); },
    openTaskCenter: (tab: TaskDetailTab = 'process') => {
      if (account?.task?.journalId) openTaskDetails(ownerId, account.task.journalId, tab);
      useAppStore.getState().setCurrentView('tasks');
    },
    configureAI: () => { sessionStorage.setItem('gsm:pending-settings-tab', 'ai'); useAppStore.getState().setCurrentView('settings'); },
  };
}
