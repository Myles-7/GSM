import { useEffect } from 'react';
import { useAppStore } from '../../../store/useAppStore';
import { emptyData, isDue } from '../custom/model';
import { reloadCustomData, reportCustomError, startCustomRun, stopCustomRun, useCustomDiscovery } from '../custom/store';
import { cancelAnalysis, invalidateAnalysis, useCustomAnalysis } from '../custom/analysis';
import { invalidateCustomRun } from '../custom/runner';
import { initializeRepositoryAnalysisAssets, useRepositoryAnalysisAssets } from '../../../services/repositoryAnalysisAssets';

export function useCustomDiscoveryLifecycle(): void {
  const identity = useAppStore(s => s.user && s.githubToken ? `${s.user.id}\u0000${s.githubToken}` : '');
  useEffect(() => {
    let alive = true;
    let checking = false;
    let loading: Promise<void> | undefined;
    let lastAttempt = 0;
    const account = identity ? identity.split('\u0000')[0] : null;
    useRepositoryAnalysisAssets.setState({ account, assets: {} });
    stopCustomRun();
    cancelAnalysis();
    useCustomAnalysis.setState({ account, items: [], issue: null, pausedChannels: {}, issuesByChannel: {} });
    useCustomDiscovery.setState({ account, data: emptyData(), selected: null, progress: {}, busy: false, error: null, candidates: {}, tasks: {} });
    const initializeAssets = async () => {
      if (!alive || !account || String(useAppStore.getState().user?.id) !== account) return;
      await initializeRepositoryAnalysisAssets(account, useAppStore.getState().repositories, useCustomDiscovery.getState().data);
    };
    const unsubscribe = useCustomDiscovery.subscribe(() => { invalidateAnalysis(); invalidateCustomRun(); });
    const unsubscribeRepositories = useAppStore.subscribe((next, previous) => {
      if (next.repositories !== previous.repositories && String(next.user?.id) === account) void load().catch(reportCustomError);
    });
    // Migration only reads local successes; it never enqueues historical AI work.
    const load = () => {
      loading ??= (async () => { await reloadCustomData(); await initializeAssets(); })().finally(() => { loading = undefined; });
      return loading;
    };
    if (account) void load().catch(reportCustomError);
    const check = async () => {
      if (!alive || checking || !account || !navigator.onLine || useCustomDiscovery.getState().busy) return;
      checking = true;
      try {
        await load();
        if (!alive) return;
        const due = useCustomDiscovery.getState().data.channels.filter(c => isDue(c));
        if (due.length && Date.now() - lastAttempt >= 15 * 60000) {
          lastAttempt = Date.now();
          await startCustomRun(due.map(c => c.id));
        }
      } catch (error) { if (alive) reportCustomError(error); }
      finally { checking = false; }
    };
    void check();
    const timer = setInterval(() => void check(), 60000);
    const broadcast = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('gsm-custom-discovery') : null;
    if (broadcast) broadcast.onmessage = event => {
      if (alive && event.data?.account === account) void load().catch(reportCustomError);
    };
    const wake = () => { if (document.visibilityState === 'visible') void check(); };
    window.addEventListener('online', wake);
    window.addEventListener('focus', wake);
    document.addEventListener('visibilitychange', wake);
    return () => {
      alive = false;
      stopCustomRun();
      cancelAnalysis();
      unsubscribe();
      unsubscribeRepositories();
      clearInterval(timer);
      broadcast?.close();
      window.removeEventListener('online', wake);
      window.removeEventListener('focus', wake);
      document.removeEventListener('visibilitychange', wake);
    };
  }, [identity]);
}
