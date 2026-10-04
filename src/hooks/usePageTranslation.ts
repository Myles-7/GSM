import { useEffect, useSyncExternalStore } from 'react';
import { pageTranslation } from '../services/pageTranslation';
import { useAppStore } from '../store/useAppStore';

const CONSENT_KEY = 'gsm:page-translation-consent-v1';
let consentGranted = false;
const hasConsent = () => {
  try { return consentGranted || localStorage.getItem(CONSENT_KEY) === 'accepted'; } catch { return consentGranted; }
};

export function usePageTranslationLifecycle() {
  const enabled = useAppStore((state) => state.pageTranslationEnabled);
  useEffect(() => {
    if (enabled && hasConsent()) pageTranslation.start(document.body);
    else if (enabled) useAppStore.getState().setPageTranslationEnabled(false);
    else pageTranslation.stop();
    return () => pageTranslation.stop();
  }, [enabled]);
}

export function usePageTranslation() {
  const enabled = useAppStore((state) => state.pageTranslationEnabled);
  const applyEnabled = useAppStore((state) => state.setPageTranslationEnabled);
  const acceptConsent = () => {
    consentGranted = true;
    try { localStorage.setItem(CONSENT_KEY, 'accepted'); } catch { /* Session consent remains valid. */ }
  };
  const setEnabled = (value: boolean) => {
    if (value && !hasConsent()) return;
    applyEnabled(value);
  };
  const status = useSyncExternalStore(pageTranslation.subscribe, pageTranslation.getSnapshot);
  return { enabled, setEnabled, needsConsent: !hasConsent(), acceptConsent, status, retry: () => pageTranslation.retry() };
}
