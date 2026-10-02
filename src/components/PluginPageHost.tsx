import { Suspense, lazy, useEffect, useSyncExternalStore } from 'react';
import { useT, type TranslateFn } from '../i18n/useT';
import { pluginPageSession } from '../plugins/pluginPageSession';
import { useAppStore } from '../store/useAppStore';
import { ErrorBoundary } from './ErrorBoundary';

const PluginPageModal = lazy(() => import('./PluginPageModal').then((module) => ({ default: module.PluginPageModal })));

export function PluginPageHost({ t: suppliedT, language }: { t?: TranslateFn; language?: string } = {}) {
  const t = useT('app');
  const session = useSyncExternalStore(pluginPageSession.subscribe, pluginPageSession.getSnapshot, pluginPageSession.getSnapshot);
  useEffect(() => useAppStore.subscribe((next, previous) => {
    if (next.user?.id !== previous.user?.id || next.githubToken !== previous.githubToken) pluginPageSession.close();
  }), []);
  if (!session?.repository) return null;
  return (
    <ErrorBoundary>
      <Suspense fallback={null}>
        <PluginPageModal key={session.sessionId} {...session} repository={session.repository}
          onClose={pluginPageSession.close} t={suppliedT ?? t} language={language} />
      </Suspense>
    </ErrorBoundary>
  );
}
