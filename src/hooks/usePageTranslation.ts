import { useEffect, useSyncExternalStore } from 'react';
import { pageTranslation } from '../services/pageTranslation';
import { useAppStore } from '../store/useAppStore';

export function usePageTranslationLifecycle() {
  const enabled = useAppStore((state) => state.pageTranslationEnabled);
  useEffect(() => {
    if (enabled) pageTranslation.start(document.body);
    else pageTranslation.stop();
    return () => pageTranslation.stop();
  }, [enabled]);
}

export function usePageTranslation() {
  const enabled = useAppStore((state) => state.pageTranslationEnabled);
  const setEnabled = useAppStore((state) => state.setPageTranslationEnabled);
  const status = useSyncExternalStore(pageTranslation.subscribe, pageTranslation.getSnapshot);
  return { enabled, setEnabled, status, retry: () => pageTranslation.retry() };
}
