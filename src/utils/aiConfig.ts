import type { AIConfig, AgyAIConfig, HttpAIConfig } from '../types';

export const AGY_CONFIG_ID = 'agy-cli-local';
export const isAgyConfig = (config: AIConfig | null | undefined): config is AgyAIConfig => config?.provider === 'agy-cli';
export const isHttpAIConfig = (config: AIConfig): config is HttpAIConfig => !isAgyConfig(config);

export function isAIConfigAvailable(config: AIConfig | null | undefined): config is AIConfig {
  if (!config) return false;
  if (isAgyConfig(config)) return config.deviceBound && config.isActive && typeof window !== 'undefined' && !!window.electronAPI?.agy;
  if (config.credentialSource === 'backend') return !!(config.model && config.backendAvailable);
  return !!(config.baseUrl && config.apiKey && config.model && config.apiKeyStatus !== 'decrypt_failed' && config.apiKeyStatus !== 'empty');
}

export const httpAIConfigs = (configs: AIConfig[]): HttpAIConfig[] => configs.filter(isHttpAIConfig);
export const httpActiveAIConfig = (configs: AIConfig[], active: string | null): string | null =>
  configs.some(config => config.id === active && isAgyConfig(config)) ? null : active;

export function mergeRemoteAIConfigs(local: AIConfig[], remote: AIConfig[]): AIConfig[] {
  const device = local.filter(isAgyConfig);
  return [...httpAIConfigs(remote).filter(config => config.id !== AGY_CONFIG_ID && !device.some(item => item.id === config.id)), ...device];
}

export function inertAgyDescriptor(config: AgyAIConfig): AgyAIConfig {
  return { id: config.id.endsWith('-unbound') ? config.id : `${config.id}-unbound`, name: config.name, provider: 'agy-cli', model: config.model,
    agyEffort: config.agyEffort, agyMode: config.agyMode, deviceBound: false, isActive: false };
}

export function backupAIConfig(config: AIConfig, includeKeys: boolean): AIConfig {
  return isAgyConfig(config) ? inertAgyDescriptor(config)
    : { ...config, apiKey: includeKeys ? config.apiKey : (config.apiKey ? '***' : '') };
}

/** Backups restore portable settings; device-bound AGY credentials stay local. */
export function restoreAIConfigs(local: AIConfig[], incoming: AIConfig[], includeKeys: boolean): AIConfig[] {
  const device = local.filter(config => isAgyConfig(config) && config.deviceBound);
  const restored = incoming.map(config => {
    if (isAgyConfig(config)) return inertAgyDescriptor(config);
    const existing = local.find(item => item.id === config.id && isHttpAIConfig(item));
    const hasKey = includeKeys && !!config.apiKey && config.apiKey !== '***';
    return { ...config, apiKey: hasKey ? config.apiKey : existing?.apiKey ?? '',
      apiKeyStatus: hasKey ? 'ok' as const : existing?.apiKeyStatus };
  }).filter(config => config.id !== AGY_CONFIG_ID && !device.some(item => item.id === config.id));
  return [...new Map(restored.map(config => [config.id, config])).values(), ...device];
}
