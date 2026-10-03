import { describe, expect, it } from 'vitest';
import type { AIConfig, AgyAIConfig } from '../types';
import { AGY_FEATURES } from '../types/agy';
import { agyFeatureConcurrency, agyFeatureTimeoutSeconds, agyProfileIdentity, forAgyFeature } from './agyProfiles';
import { backupAIConfig, httpAIConfigs, mergeRemoteAIConfigs } from '../utils/aiConfig';

const config: AgyAIConfig = { id: 'agy-cli-local', provider: 'agy-cli', name: 'AGY', isActive: true, deviceBound: true,
  model: 'global', agyEffort: 'high', agyMode: 'model', concurrency: 5, agyRevision: 9,
  agyFeatureOverrides: { 'repository-summary': { model: '', effort: 'low', concurrency: 2 }, 'repository-details': { model: 'detail', concurrency: 5 } } };
describe('AGY feature configuration', () => {
  it('uses retry model, effort and timeout ahead of saved feature overrides', () => {
    const retry: AgyAIConfig = { ...config, agyTimeoutSeconds: 180,
      agyFeatureOverrides: { 'repository-details': { model: 'old-model', effort: 'high', timeoutSeconds: 40 } },
      agyRequestProfile: { model: 'retry-model', effort: 'low', timeoutSeconds: 300 } };
    expect(agyProfileIdentity(retry, 'repository-details')).toEqual({ model: 'retry-model', effort: 'low' });
    expect(agyFeatureTimeoutSeconds(retry, 'repository-details')).toBe(300);
    expect(agyFeatureTimeoutSeconds({ ...retry, agyRequestProfile: undefined }, 'repository-details')).toBe(40);
  });
  it.each([[undefined, 1], [4, 4], [50, 10], [0, 1], [2.8, 2], [NaN, 1]])('uses the HTTP batch limit %s safely', (concurrency, expected) => {
    const http: AIConfig = { id: 'http', name: 'http', baseUrl: 'https://example.com', apiKey: 'fixture', model: 'fixture', isActive: true, concurrency };
    expect(agyFeatureConcurrency(http, 'repository-details')).toBe(expected);
    expect(agyFeatureConcurrency(http, 'discovery')).toBe(expected);
  });
  it('distinguishes CLI default from inheritance and enforces global limits', () => {
    expect(agyProfileIdentity(config, 'repository-summary')).toEqual({ model: '', effort: 'low' });
    expect(agyProfileIdentity(config, 'other')).toEqual({ model: 'global', effort: 'high' });
    expect(agyFeatureConcurrency(config, 'repository-summary')).toBe(2);
    expect(agyFeatureConcurrency({ ...config, concurrency: 3 }, 'repository-details')).toBe(3);
  });
  it.each(AGY_FEATURES)('preserves configuration version and explicit task ownership for %s', feature => {
    expect(forAgyFeature(config, feature, 'background')).toEqual({ ...config, agyFeature: feature, agyPriority: 'background' });
  });
  it('does not alter HTTP settings or export device profiles', () => {
    const http: AIConfig = { id: 'http', name: 'http', provider: 'http', baseUrl: 'https://example.com', apiKey: 'test', model: 'test', isActive: true };
    expect(forAgyFeature(http, 'workbench')).toBe(http);
    expect(httpAIConfigs([config, http])).toEqual([http]);
    expect(mergeRemoteAIConfigs([config], [http])).toEqual([http, config]);
    const backup = backupAIConfig(config, true);
    expect(backup).not.toHaveProperty('agyFeatureOverrides');
    expect(backup).not.toHaveProperty('agyRevision');
    expect(backup.isActive).toBe(false);
  });
});
