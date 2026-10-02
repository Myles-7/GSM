import type { TranslateFn } from '../i18n/useT';
import React, { useEffect, useRef, useState } from 'react';
import { pluginClient } from '../plugins/pluginClient';
import { pluginRegistry } from '../plugins/pluginRegistry';
import { pluginPageArgsBudget, pluginPageArgsBytes, validatePluginPageMessage } from '../plugins/pluginPageMessages';
import { usePluginAI } from '../plugins/usePluginPageAI';
import { usePluginWebSearch } from '../plugins/usePluginPageWebSearch';
import { useAppStore } from '../store/useAppStore';

interface PluginPageViewerProps {
  pluginId: string;
  pluginName: string;
  pageId: string;
  pageTitle: string;
  onClose: () => void;
  t: TranslateFn;
  variant?: 'panel' | 'modal';
  initContext?: Record<string, unknown>;
}

export const PluginPageViewer: React.FC<PluginPageViewerProps> = ({
  pluginId, pluginName, pageId, pageTitle, onClose, t, variant = 'panel', initContext,
}) => {
  const generateAI = usePluginAI();
  const searchWeb = usePluginWebSearch();
  const frameRef = useRef<HTMLIFrameElement>(null);
  const contextRef = useRef(initContext);
  contextRef.current = initContext;
  const tokenRef = useRef('');
  const loadedRef = useRef(false);
  const seenRef = useRef(new Set<string>());
  const pendingRef = useRef(new Set<string>());
  const timesRef = useRef<number[]>([]);
  const aiRef = useRef(new Set<AbortController>());
  const lifecycleRef = useRef<{
    current(): boolean; revoke(): void; load(): Promise<void>; init(): void;
  } | null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const origin = `plugin-page://${pluginId}`;

  useEffect(() => {
    let disposed = false;
    let generation = 0;
    let hasLoaded = false;
    setUrl(null);
    setError(null);
    function closeToken(token: string) {
      if (token) void pluginClient.requestPageCapability({
        pluginId, pageId, sessionToken: token, requestId: `close_${crypto.randomUUID()}`,
        method: 'page.close', args: {},
      }).catch(() => {});
    }
    function revoke() {
      generation++;
      const token = tokenRef.current;
      tokenRef.current = '';
      loadedRef.current = false;
      for (const controller of aiRef.current) controller.abort();
      closeToken(token);
    }
    function init() {
      if (disposed || !loadedRef.current || !tokenRef.current) return;
      frameRef.current?.contentWindow?.postMessage({
        type: 'plugin-page:init', pluginId, pageId, token: tokenRef.current,
        ...(contextRef.current ? { context: contextRef.current } : {}),
      }, origin);
    }
    async function getSession() {
      const version = ++generation;
      try {
        const result = await pluginClient.getPage(pluginId, pageId);
        if (disposed || version !== generation) {
          if (result.success) closeToken(result.sessionToken);
          return false;
        }
        if (!result.success) { setError(result.error.message); return false; }
        if (!result.sessionToken || result.url !== `${origin}/${pageId}/index.html`) {
          closeToken(result.sessionToken);
          setError(t('pluginPageViewer.failed-to-load-plugin-page'));
          return false;
        }
        tokenRef.current = result.sessionToken;
        seenRef.current.clear();
        pendingRef.current.clear();
        timesRef.current = [];
        setUrl(result.url);
        return true;
      } catch {
        if (!disposed && version === generation) setError(t('pluginPageViewer.failed-to-load-plugin-page'));
        return false;
      }
    }
    lifecycleRef.current = {
      current: () => !disposed,
      revoke,
      init,
      async load() {
        if (disposed) return;
        // Subsequent document loads revoke the old token before reauthorization.
        if (hasLoaded) {
          revoke();
          if (!await getSession()) return;
        }
        hasLoaded = true;
        loadedRef.current = true;
        init();
      },
    };
    const invalidate = () => {
      if (disposed) return;
      disposed = true;
      revoke();
      setUrl(null);
      closeRef.current();
    };
    const offAccount = useAppStore.subscribe((next, previous) => {
      if (next.user?.id !== previous.user?.id || next.githubToken !== previous.githubToken) invalidate();
    });
    const offRegistry = pluginRegistry.subscribe(() => {
      const plugin = pluginRegistry.getSnapshot().plugins.find((item) => item.manifest.id === pluginId);
      if (!plugin || !plugin.enabled || plugin.status !== 'active') invalidate();
    });
    const onRevoke = (event: Event) => {
      if ((event as CustomEvent<string>).detail === pluginId) invalidate();
    };
    window.addEventListener('plugin-page:revoke', onRevoke);
    void getSession();
    return () => {
      disposed = true;
      revoke();
      offAccount();
      offRegistry();
      window.removeEventListener('plugin-page:revoke', onRevoke);
    };
  }, [pluginId, pageId, origin, t]);

  const contextSignature = JSON.stringify(initContext ?? null);
  useEffect(() => { lifecycleRef.current?.init(); }, [contextSignature]);

  useEffect(() => {
    const onMessage = async (event: MessageEvent) => {
      const lifecycle = lifecycleRef.current;
      if (!lifecycle?.current() || !loadedRef.current) return;
      const frameWindow = frameRef.current?.contentWindow ?? null;
      const token = tokenRef.current;
      const request = validatePluginPageMessage(event, frameWindow, pluginId, pageId, token);
      if (!request) return;
      const isCurrent = () => lifecycle.current() && loadedRef.current && tokenRef.current === token &&
        frameRef.current?.contentWindow === frameWindow;
      const respond = (result: object) => {
        if (isCurrent()) frameWindow?.postMessage({
          type: 'plugin-page:response', pluginId, pageId, requestId: request.requestId, token, ...result,
        }, origin);
      };
      const reject = (code: string) => respond({ success: false, error: { code, message: 'Plugin page request rejected' } });
      const now = Date.now();
      timesRef.current = timesRef.current.filter((time) => now - time < 60_000);
      if (seenRef.current.has(request.requestId) || seenRef.current.size >= 10_000 ||
        pendingRef.current.size >= 8 || timesRef.current.length >= 120) {
        reject('PLUGIN_PAGE_RATE_LIMITED');
        return;
      }
      seenRef.current.add(request.requestId);
      timesRef.current.push(now);
      try {
        if (pluginPageArgsBytes(request.args) > pluginPageArgsBudget(request.method)) {
          reject('PLUGIN_PAGE_REQUEST_TOO_LARGE'); return;
        }
      } catch { reject('PLUGIN_PAGE_REQUEST_INVALID'); return; }
      pendingRef.current.add(request.requestId);
      const session = { pluginId, pageId, sessionToken: token, requestId: request.requestId };
      const controller = request.method === 'ai.generate' ? new AbortController() : null;
      if (controller) aiRef.current.add(controller);
      try {
        if (request.method === 'page.close') { lifecycle.revoke(); closeRef.current(); return; }
        const result = controller
          ? await generateAI(session, pluginName, request.args, isCurrent, controller.signal)
          : request.method === 'web.search'
            ? await searchWeb(session, pluginName, request.args, isCurrent)
            : await pluginClient.requestPageCapability({ ...session, method: request.method, args: request.args });
        respond(result);
      } catch {
        reject('PLUGIN_PAGE_REQUEST_FAILED');
      } finally {
        if (tokenRef.current === token) pendingRef.current.delete(request.requestId);
        if (controller) aiRef.current.delete(controller);
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [pluginId, pageId, pluginName, origin, generateAI, searchWeb]);

  return (
    <section className="space-y-3" aria-label={`${pluginName}: ${pageTitle}`}>
      {variant === 'panel' && <div className="flex items-center justify-between gap-3">
        <h3 className="font-semibold">{pluginName} · {pageTitle}</h3>
        <button type="button" onClick={() => { lifecycleRef.current?.revoke(); onClose(); }}
          className="rounded border border-border px-3 py-1.5 text-sm">
          {t('pluginPageViewer.back-to-plugins')}
        </button>
      </div>}
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> :
        url ? <iframe ref={frameRef} title={`${pluginName}: ${pageTitle}`} src={url}
          sandbox="allow-scripts allow-same-origin" referrerPolicy="no-referrer"
          className="h-[min(70vh,800px)] min-h-[320px] w-full rounded-lg border border-border bg-white"
          onLoad={() => { void lifecycleRef.current?.load(); }} />
          : <p role="status">{t('pluginPageViewer.loading-plugin-page')}</p>}
    </section>
  );
};
