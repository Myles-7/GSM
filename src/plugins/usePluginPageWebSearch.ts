import { useCallback } from 'react';
import { useT } from '../i18n/useT';
import { useDialog } from '../hooks/useDialog';
import { pluginClient } from './pluginClient';
import type { PluginPageCapabilitySession } from './types';

export function usePluginWebSearch() {
  const t = useT('plugins');
  const { confirm } = useDialog();
  return useCallback(async (
    session: PluginPageCapabilitySession, pluginName: string, args: Record<string, unknown>, isCurrent: () => boolean,
  ) => {
    const authorization = await pluginClient.requestPageCapability({ ...session, method: 'web.search', args });
    if (!authorization.success || !isCurrent()) return authorization;
    const { endpoint } = await pluginClient.getSearchEndpoint();
    if (!endpoint) return { success: false as const, error: { code: 'PLUGIN_SEARCH_NOT_CONFIGURED', message: 'Web search service is not configured' } };
    if (!isCurrent()) return { success: false as const, error: { code: 'PLUGIN_PAGE_CLOSED', message: 'Plugin page closed' } };
    const approved = await confirm(t('usePluginWebSearch.allow-plugin-web-search'),
      `${pluginName}\n${endpoint}\n\n${t('usePluginWebSearch.search-query')}\n${args.query}`,
      { confirmText: t('usePluginWebSearch.send-search-query'), type: 'warning' });
    if (!approved) return { success: false as const, error: { code: 'PLUGIN_SEARCH_CANCELLED', message: 'Web search was not approved' } };
    if (!isCurrent() || (await pluginClient.getSearchEndpoint()).endpoint !== endpoint) {
      return { success: false as const, error: { code: 'PLUGIN_PAGE_CLOSED', message: 'Plugin page closed or endpoint changed' } };
    }
    return pluginClient.searchWeb({ ...session, requestId: `host_${crypto.randomUUID()}`, args: args as { query: string; limit?: number } });
  }, [confirm, t]);
}
