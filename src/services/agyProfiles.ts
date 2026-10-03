import type { AIConfig } from '../types';
import type { AgyFeature } from '../types/agy';

export function forAgyFeature(config: AIConfig, feature: AgyFeature, priority: 'interactive' | 'background' = 'interactive'): AIConfig {
  return config.provider === 'agy-cli' ? { ...config, agyFeature: feature, agyPriority: priority } : config;
}
export function agyFeatureConcurrency(config: AIConfig, feature: AgyFeature): number {
  return config.provider === 'agy-cli'
    ? Math.min(config.concurrency ?? 5, config.agyFeatureOverrides?.[feature]?.concurrency ?? config.concurrency ?? 5)
    : Math.max(1, Math.min(10, Number.isFinite(config.concurrency) ? Math.trunc(config.concurrency!) : 1));
}

export function agyProfileIdentity(config: AIConfig, feature: AgyFeature) {
  if (config.provider !== 'agy-cli') return { model: config.model, effort: config.reasoningEffort };
  if (config.agyRequestProfile) return { model: config.agyRequestProfile.model, effort: config.agyRequestProfile.effort };
  const profile = config.agyFeatureOverrides?.[feature];
  return { model: profile?.model ?? config.model, effort: profile?.effort ?? config.agyEffort };
}

export function agyFeatureTimeoutSeconds(config: AIConfig, feature: AgyFeature): number {
  return config.provider === 'agy-cli'
    ? config.agyRequestProfile?.timeoutSeconds ?? config.agyFeatureOverrides?.[feature]?.timeoutSeconds ?? config.agyTimeoutSeconds ?? 180
    : 60;
}
