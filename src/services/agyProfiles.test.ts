import { describe, expect, it } from 'vitest';
import type { AIConfig } from '../types';
import { AGY_FEATURES } from '../types/agy';
import { agyFeatureConcurrency, agyProfileIdentity, forAgyFeature } from './agyProfiles';
import { backupAIConfig, httpAIConfigs, mergeRemoteAIConfigs } from '../utils/aiConfig';

const config: AIConfig = { id: 'agy-cli-local', provider: 'agy-cli', name: 'AGY', isActive: true, deviceBound: true,
  model: 'global', agyEffort: 'high', agyMode: 'model', concurrency: 5, agyRevision: 9,
  agyFeatureOverrides: { 'repository-summary': { model: '', effort: 'low', concurrency: 2 }, 'repository-details': { model: 'detail', concurrency: 5 } } };
describe('AGY feature configuration', () => {
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
