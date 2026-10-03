import { afterEach, describe, expect, it } from 'vitest';
import type { AIConfig, AgyAIConfig } from '../types';
import { backupAIConfig, httpAIConfigs, httpActiveAIConfig, isAIConfigAvailable, mergeRemoteAIConfigs, restoreAIConfigs } from './aiConfig';

const cli: AgyAIConfig = { id: 'agy-cli-local', name: 'AGY CLI', provider: 'agy-cli',
  model: '', agyEffort: 'medium', agyMode: 'research', deviceBound: true, isActive: true };
const http: AIConfig = { id: 'http-1', name: 'HTTP', apiKey: 'synthetic', baseUrl: 'https://example.com',
  model: 'model', isActive: true };
afterEach(() => { Object.defineProperty(window, 'electronAPI', { configurable: true, value: undefined }); });

describe('AI provider configuration', () => {
  it('keeps old configurations HTTP and makes CLI independent of API credentials', () => {
    expect(isAIConfigAvailable(http)).toBe(true);
    expect(isAIConfigAvailable(cli)).toBe(false);
    Object.defineProperty(window, 'electronAPI', { configurable: true, value: { agy: {} } });
    expect(isAIConfigAvailable(cli)).toBe(true);
    expect(isAIConfigAvailable({ ...cli, deviceBound: false })).toBe(false);
  });
  it('projects only HTTP settings and never leaks the active local provider ID', () => {
    expect(httpAIConfigs([cli, http])).toEqual([http]);
    expect(httpActiveAIConfig([cli, http], cli.id)).toBeNull();
    expect(httpActiveAIConfig([cli, http], http.id)).toBe(http.id);
  });
  it('preserves local providers when pulling and rejects a remote reserved-ID collision', () => {
    expect(mergeRemoteAIConfigs([cli], [{ ...http, id: cli.id }, http, { ...cli, model: 'remote' }]))
      .toEqual([http, cli]);
  });
  it('exports an unbound descriptor that cannot reactivate via the local reserved ID', () => {
    const backup = backupAIConfig(cli, true);
    expect(backup).toMatchObject({ provider: 'agy-cli', deviceBound: false, isActive: false });
    expect(backup.id).not.toBe(cli.id);
    expect(backupAIConfig(backup, true)).toEqual(backup);
    expect(backupAIConfig(http, false).apiKey).toBe('***');
  });
  it('preserves device AGY during replacement and never imports a bound provider', () => {
    const restored = restoreAIConfigs([cli, http], [{ ...cli, model: 'remote' }, { ...http, apiKey: '***' }], false);
    expect(restored.find(config => config.id === cli.id)).toBe(cli);
    expect(restored.find(config => config.id === `${cli.id}-unbound`)).toMatchObject({ deviceBound: false, isActive: false });
    expect(restored.find(config => config.id === http.id)?.apiKey).toBe('synthetic');
    expect(restoreAIConfigs([cli, http], [], false)).toEqual([cli]);
  });
  it('restoring a real API key clears a previous credential decryption failure', () => {
    const restored = restoreAIConfigs([{ ...http, apiKeyStatus: 'decrypt_failed' }], [{ ...http, apiKey: 'replacement' }], true);
    expect(restored[0]).toMatchObject({ apiKey: 'replacement', apiKeyStatus: 'ok' });
    expect(isAIConfigAvailable(restored[0])).toBe(true);
  });
});
