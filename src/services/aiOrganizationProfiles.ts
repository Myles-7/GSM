import type { AIConfig } from '../types';
import { agyProfileIdentity } from './agyProfiles';

/** Derived profiles only use explicit user connection-test receipts. Never probe implicitly. */
export async function organizationLightProfile(config: AIConfig, _ownerId: string,
  _request: (key: string, user: unknown, ids: number[], maxTokens: number, override: AIConfig) => Promise<string>, signal: AbortSignal, _proposalId?: string): Promise<AIConfig> {
  void _proposalId;
  if (config.provider !== 'agy-cli') return config;
  signal.throwIfAborted();
  const identity = agyProfileIdentity(config, 'organization');
  if (!['high', 'max', 'medium'].includes(identity.effort ?? '') || /^gemini-.*-(low|medium|high)$/.test(identity.model)) return config;
  const effort: 'low' | 'medium' = identity.effort === 'medium' ? 'low' : 'medium';
  const state = await window.electronAPI?.agy?.getState?.();
  signal.throwIfAborted();
  if (!state?.testedProfiles?.includes(`${state.executable?.fingerprint}:${identity.model}:${effort}:text-v1`)) return config;
  return { ...config, agyRequestProfile: { model: identity.model, effort,
    timeoutSeconds: config.agyRequestProfile?.timeoutSeconds ?? config.agyTimeoutSeconds ?? 180 } };
}
