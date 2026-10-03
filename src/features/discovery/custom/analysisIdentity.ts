import type { AIConfig, Repository } from '../../../types';

// Identity only, not a security digest. Keys must not expose endpoints or prompts.
const fingerprint = (value: string) => {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
  return (hash >>> 0).toString(16);
};

export const discoveryAnalysisIdentity = (repo: Repository, language: string, config?: AIConfig) =>
  JSON.stringify([repo.id, repo.pushed_at || repo.updated_at, language, 'detail-prompt-v2',
    config?.id, config?.model, fingerprint(JSON.stringify([config?.apiType || 'openai', config?.baseUrl,
      config?.reasoningEffort, config?.mimoPlan, config?.provider,
      config?.provider === 'agy-cli' ? [config.agyEffort, config.agyFeatureOverrides?.['repository-details']?.model, config.agyFeatureOverrides?.['repository-details']?.effort] : null,
      config?.useCustomPrompt ? config.customPrompt : null]))]);
