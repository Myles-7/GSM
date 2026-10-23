import React, { Suspense, useEffect, useMemo } from 'react';
import { LoginScreen } from './components/LoginScreen';
import { Header } from './components/Header';
import { AITaskPanel } from './components/AITaskPanel';
import { usePageTranslationLifecycle } from './hooks/usePageTranslation';
import { useWorkbenchLifecycle } from './features/ai-workbench/hooks/useWorkbenchLifecycle';
import { useCustomDiscoveryLifecycle } from './features/discovery/hooks/useCustomDiscoveryLifecycle';
import { useHtmlReadingLifecycle } from './features/lifecycle/hooks/useHtmlReadingLifecycle';

import { DebugModeIndicator } from './components/DebugModeIndicator';

import { BackToTop } from './components/BackToTop';
import { ErrorBoundary } from './components/ErrorBoundary';
import { SyncModeChoiceModal } from './components/SyncModeChoiceModal';
import { useAppStore } from './store/useAppStore';
import { selectAppShellState } from './store/selectors';
import { useShallow } from 'zustand/react/shallow';
import { applyThemePreset } from './lib/themePresets';
import { applyThemeTokens } from './utils/themeTokens';
import { changeAppLanguage } from './i18n';
import { useAutoUpdateCheck } from './hooks/useAutoUpdateCheck';
import { logger } from './services/logger';
import { UpdateNotificationBanner } from './components/UpdateNotificationBanner';
import { ListsPushIndicator } from './components/ListsPushIndicator';
import { PluginPageHost } from './components/PluginPageHost';
import { useBackendLifecycle } from './features/lifecycle/hooks/useBackendLifecycle';
import { isElectron, loadEncryptedXAuthViaDesktop } from './services/electronProxy';
import { RepositoriesView } from './features/repositories/components/RepositoriesView';
import { useT } from './i18n/useT';
import { useAIClassificationBootstrap } from './features/lifecycle/hooks/useAIClassificationBootstrap';

const LazyReleaseTimeline = React.lazy(() =>
  import('./components/ReleaseTimeline').then((module) => ({ default: module.ReleaseTimeline }))
);
const LazyForkTimeline = React.lazy(() =>
  import('./components/ForkTimeline').then((module) => ({ default: module.ForkTimeline }))
);
const LazySettingsPanel = React.lazy(() =>
  import('./components/SettingsPanel').then((module) => ({ default: module.SettingsPanel }))
);
const LazyDiscoveryView = React.lazy(() =>
  import('./components/DiscoveryView').then((module) => ({ default: module.DiscoveryView }))
);
const LazyGistView = React.lazy(() =>
  import('./components/GistView').then((module) => ({ default: module.GistView }))
);
const LazyAIWorkbench = React.lazy(() =>
  import('./features/ai-workbench/components/AIWorkbench').then((module) => ({ default: module.AIWorkbench }))
);
const LazyDailyReading = React.lazy(() =>
  import('./components/reading/DailyReadingView').then((module) => ({ default: module.DailyReadingView }))
);

const ViewLoadingFallback: React.FC = () => {
  const t = useT('app');
  return (
    <div className="flex min-h-[12rem] items-center justify-center bg-background text-foreground" role="status" aria-live="polite">
      <div className="animate-pulse text-lg font-medium text-foreground">{t('shell.loading')}</div>
    </div>
  );
};

const LazyViewBoundary: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <ErrorBoundary>
    <Suspense fallback={<ViewLoadingFallback />}>{children}</Suspense>
  </ErrorBoundary>
);

const ReleasesView = React.memo(() => (
  <LazyViewBoundary>
    <LazyReleaseTimeline />
  </LazyViewBoundary>
));
ReleasesView.displayName = 'ReleasesView';

const GistsView = React.memo(() => (
  <LazyViewBoundary>
    <LazyGistView />
  </LazyViewBoundary>
));
GistsView.displayName = 'GistsView';

const ForksView = React.memo(() => (
  <LazyViewBoundary>
    <LazyForkTimeline />
  </LazyViewBoundary>
));
ForksView.displayName = 'ForksView';

const SettingsView = React.memo(() => (
  <LazyViewBoundary>
    <LazySettingsPanel />
  </LazyViewBoundary>
));
SettingsView.displayName = 'SettingsView';

const DiscoverySubscriptionView = React.memo(() => (
  <Suspense fallback={<ViewLoadingFallback />}>
    <LazyDiscoveryView />
  </Suspense>
));
DiscoverySubscriptionView.displayName = 'DiscoverySubscriptionView';

function App() {
  useHtmlReadingLifecycle();
  useCustomDiscoveryLifecycle();
  usePageTranslationLifecycle();
  useWorkbenchLifecycle();
  const {
    isAuthenticated,
    currentView,
    theme,
    themePreset,
    themeTokens,
    language,
    hasHydrated,
  } = useAppStore(useShallow(selectAppShellState));

  useAutoUpdateCheck();
  useBackendLifecycle(hasHydrated);
  useAIClassificationBootstrap();

  useEffect(() => {
    if (!hasHydrated) return;
    const frame = requestAnimationFrame(() => performance.mark?.('gsm:first-hydrated-frame'));
    return () => cancelAnimationFrame(frame);
  }, [hasHydrated]);

  // Restore persisted frontend debug level at startup so capture is active
  // app-wide, not only after DiagnosticLogsPanel mounts.
  useEffect(() => {
    if (sessionStorage.getItem('gsm:frontend-debug') === 'true') {
      logger.setLevel('debug');
    }
  }, []);

  // Restore persisted encrypted X auth cookies on desktop startup after hydration completes (#356)
  useEffect(() => {
    if (!hasHydrated || !isElectron()) return;
    loadEncryptedXAuthViaDesktop().then((auth) => {
      if (auth) {
        const current = useAppStore.getState().xTweetAuth;
        if (!current || current.authToken !== auth.authToken || current.ct0 !== auth.ct0) {
          logger.info('xAuth', 'Restoring encrypted X auth from disk');
          useAppStore.getState().setXTweetAuth(auth);
        } else {
          logger.debug('xAuth', 'Encrypted X auth already matches in-memory state; skipping restore');
        }
      } else {
        logger.debug('xAuth', 'No encrypted X auth found on disk');
      }
    }).catch((err: unknown) => {
      logger.errorFromError('xAuth', 'Failed to load encrypted X auth from disk', err);
    });
  }, [hasHydrated]);

  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    // Suppress every color transition for one frame so the theme flip snaps
    // instead of smearing across the whole shell (better-ui recipe).
    const style = document.createElement('style');
    style.textContent = '*,*::before,*::after{transition:none !important}';
    document.head.appendChild(style);
    const raf = requestAnimationFrame(() => requestAnimationFrame(() => style.remove()));
    return () => {
      cancelAnimationFrame(raf);
      style.remove();
    };
  }, [theme]);

  // Theme preset (palette/radius/font/shadow skin) rides on data-theme.
  useEffect(() => {
    applyThemePreset(themePreset);
  }, [themePreset]);

  // Theme token（开发守则 §14）：内联 CSS 变量覆盖预设；恢复默认时删掉内联值，
  // 预设的 --radius / --primary 自然重新生效。排在预设 effect 之后即可。
  useEffect(() => {
    applyThemeTokens(themeTokens);
  }, [themeTokens, theme, themePreset]);

  // Language side effect: zustand 的 language 是唯一事实源，这里只负责装载
  // 语言包、切换 i18next 并同步 <html lang>。
  useEffect(() => {
    void changeAppLanguage(language);
  }, [language]);

  const currentViewContent = useMemo(() => {
    switch (currentView) {
      case 'repositories':
        return <RepositoriesView />;
      case 'gists':
        return <GistsView />;
      case 'releases':
        return <ReleasesView />;
      case 'forks':
        return <ForksView />;
      case 'subscription':
        return (
          <ErrorBoundary>
            <DiscoverySubscriptionView />
          </ErrorBoundary>
        );
      case 'settings':
        return <SettingsView />;
      case 'reading':
        return <LazyViewBoundary><LazyDailyReading /></LazyViewBoundary>;
      case 'ai':
        return <LazyViewBoundary><LazyAIWorkbench /></LazyViewBoundary>;
      default:
        return null;
    }
  }, [currentView]);

  // Show loading state while store is hydrating to ensure correct theme is applied
  if (!hasHydrated) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-foreground">
        <ViewLoadingFallback />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <LoginScreen />;
  }

  return (
    <div className="ui-shell min-h-screen transition-colors duration-200">
      <UpdateNotificationBanner />
      <Header taskPanel={<AITaskPanel />} />
      <main className={currentView === 'repositories' ? 'w-full px-3 sm:px-5 py-3' : currentView === 'ai' ? 'w-full' : currentView === 'reading' ? 'max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 py-3' : 'max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 py-5 sm:py-7'}>
        {currentViewContent}
      </main>
      <BackToTop />
      <DebugModeIndicator />
      <SyncModeChoiceModal />
      <ListsPushIndicator />
      <PluginPageHost />
    </div>
  );
}

export default App;
