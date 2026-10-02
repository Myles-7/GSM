import { useEffect } from 'react';
import { useAppStore } from '../../../store/useAppStore';
import { emptyData, isDue } from '../custom/model';
import { reloadCustomData, reportCustomError, startCustomRun, stopCustomRun, useCustomDiscovery } from '../custom/store';
import { cancelAnalysis, invalidateAnalysis, useCustomAnalysis } from '../custom/analysis';

export function useCustomDiscoveryLifecycle(): void {
  const identity = useAppStore(s => s.user && s.githubToken ? `${s.user.id}\u0000${s.githubToken}` : '');
  useEffect(() => {
    let alive = true;
    let checking = false;
    let lastAttempt = 0;
    const account = identity ? identity.split('\u0000')[0] : null;
    stopCustomRun();
    cancelAnalysis();
    useCustomAnalysis.setState({ account, items: [], issue: null });
    useCustomDiscovery.setState({ account, data: emptyData(), selected: null, progress: {}, busy: false, error: null, candidates: {} });
    const unsubscribe = useCustomDiscovery.subscribe(invalidateAnalysis);
    const check = async () => {
      if (!alive || checking || !account || !navigator.onLine || useCustomDiscovery.getState().busy) return;
      checking = true;
      try {
        await reloadCustomData();
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
    const wake = () => { if (document.visibilityState === 'visible') void check(); };
    window.addEventListener('online', wake);
    window.addEventListener('focus', wake);
    document.addEventListener('visibilitychange', wake);
    return () => {
      alive = false;
      stopCustomRun();
      cancelAnalysis();
      unsubscribe();
      clearInterval(timer);
      window.removeEventListener('online', wake);
      window.removeEventListener('focus', wake);
      document.removeEventListener('visibilitychange', wake);
    };
  }, [identity]);
}
