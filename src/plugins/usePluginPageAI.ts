import { useCallback } from 'react';
import { useT } from '../i18n/useT';
import { useDialog } from '../hooks/useDialog';
import { AIService } from '../services/aiService';
import { forAgyFeature } from '../services/agyProfiles';
import { useAppStore } from '../store/useAppStore';
import { pluginClient } from './pluginClient';
import type { PluginPageCapabilitySession } from './types';

const closed = () => ({ success: false as const, error: { code: 'PLUGIN_PAGE_CLOSED', message: 'Plugin page closed' } });

// Session-bound adaptation of usePluginAI, preserving the exact per-request consent flow.
export function usePluginAI() {
  const { confirm } = useDialog();
  const t = useT('plugins');
  return useCallback(async (
    session: PluginPageCapabilitySession, pluginName: string, args: Record<string, unknown>,
    isCurrent: () => boolean, signal: AbortSignal,
  ) => pluginClient.trackPageAI(session, pluginName, signal, isCurrent, async (taskSignal) => {
    const authorize = (requestId: string) => pluginClient.requestPageCapability({
      ...session, requestId, method: 'ai.generate', args,
    });
    let result = await authorize(session.requestId);
    if (!result.success) return result;
    if (!isCurrent() || taskSignal.aborted) return closed();
    const initial = useAppStore.getState();
    const config = initial.aiConfigs.find((item) => item.id === initial.activeAIConfig);
    if (!config) return { success: false as const, error: { code: 'PLUGIN_AI_NOT_CONFIGURED', message: 'No active AI provider is configured' } };
    const signature = JSON.stringify(config);
    const { system, user, maxTokens } = args as { system: string; user: string; maxTokens?: number };
    let destination = t('usePluginAI.custom-endpoint');
    try { destination = config.provider === 'agy-cli' ? 'AGY CLI' : new URL(config.baseUrl).origin; } catch { /* Keep the provider label. */ }
    const approved = await confirm(t('usePluginAI.allow-plugin-ai-request'),
      t('usePluginAI.allow-plugin-ai-body', {
        pluginName, configName: config.name, model: config.model, destination,
        relayNote: t('usePluginAI.the-host-may-relay-this-through-its-configured-b'), system, user,
      }), { confirmText: t('usePluginAI.send-to-ai'), type: 'warning' });
    if (!approved) return { success: false as const, error: { code: 'PLUGIN_AI_CANCELLED', message: 'AI request was not approved' } };
    const current = useAppStore.getState();
    if (!isCurrent() || taskSignal.aborted || current.activeAIConfig !== config.id ||
      JSON.stringify(current.aiConfigs.find((item) => item.id === config.id)) !== signature) return closed();
    result = await authorize(`host_${crypto.randomUUID()}`);
    if (!result.success) return result;
    if (!isCurrent() || taskSignal.aborted) return closed();
    const text = await new AIService(forAgyFeature(config, 'plugin'), initial.language, true)
      .generateChatText({ system, user, maxTokens, signal: taskSignal });
    if (!isCurrent() || taskSignal.aborted) return closed();
    return text.length <= 65536 ? { success: true as const, value: text }
      : { success: false as const, error: { code: 'PLUGIN_AI_RESULT_TOO_LARGE', message: 'AI response is too large' } };
  }), [confirm, t]);
}
