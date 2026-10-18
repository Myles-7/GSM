import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createInitialState } from '../store/initialState';
import type { AppStoreState } from '../store/types';
import { decodeCloudBackup, planCloudBackupRestore } from './cloudBackupRestore';

const f = vi.hoisted(() => ({ exportBackup: vi.fn() }));
vi.mock('./discoveryWorkspaceBackup', async original => ({ ...await original<typeof import('./discoveryWorkspaceBackup')>(), exportDiscoveryWorkspaceBackup: f.exportBackup }));
const identity = { githubUserId: '42', workspaceId: null };
let state: AppStoreState;
const decode = (data: Record<string, unknown>) => decodeCloudBackup(JSON.stringify({ version: '1.2', identity, ...data }));
beforeEach(() => {
  vi.clearAllMocks();
  state = { ...createInitialState(), user: { id: 42 } } as AppStoreState;
  f.exportBackup.mockResolvedValue({ version: 1, accountId: '42', customDiscovery: { channels: [], editions: [] } });
});

describe('cloud restore complete preflight', () => {
  it('validates unversioned cloud files through the shared schema and demands explicit ownership confirmation', async () => {
    expect(() => decodeCloudBackup('{"readReleases":["bad"]}')).toThrow();
    expect(() => decodeCloudBackup('[]')).toThrow();
    const backup = decodeCloudBackup('{"readReleases":[7]}');
    await expect(planCloudBackupRestore(state, backup, identity, false)).rejects.toThrow('LEGACY_IDENTITY_CONFIRMATION');
    expect((await planCloudBackupRestore(state, backup, identity, true)).plan.after.readReleases).toEqual([7]);
  });
  it('rejects foreign identity before reading a discovery pre-image', async () => {
    const backup = decode({ identity: { githubUserId: '43', workspaceId: null }, readReleases: [] });
    await expect(planCloudBackupRestore(state, backup, identity, true)).rejects.toThrow('IDENTITY_MISMATCH');
    expect(f.exportBackup).not.toHaveBeenCalled();
  });
  it.each([
    { aiConfigs: [{ id: 'invalid' }] },
    { webdavConfigs: [{ id: 'invalid' }] },
    { proxyConfig: { enabled: true, type: 'http', host: 'localhost', port: -1 } },
    { rpcDownloadConfig: { enabled: true, host: 'localhost', port: '6800' } },
    { releases: [{ id: 3 }] },
    { releaseSourceSettings: {} },
  ])('preflights every lane before any discovery read/write: %j', async invalid => {
    const backup = decode({ discoveryWorkspace: { version: 1, accountId: '42', customDiscovery: { channels: [], editions: [] } }, ...invalid });
    await expect(planCloudBackupRestore(state, backup, identity, true)).rejects.toThrow();
    expect(f.exportBackup).not.toHaveBeenCalled();
    expect(state.readReleases.size).toBe(0);
  });
  it('plans Release state and route preferences in the journal while absent fields retain current values', async () => {
    state.readReleases = new Set([1]);
    const { plan, configuration } = await planCloudBackupRestore(state, decode({ releases: [], releaseSubscriptions: [7], readReleases: [2], routeMode: 'browser' }), identity, false);
    expect(plan.keys).toEqual(['releases', 'releaseSubscriptions', 'readReleases', 'routeMode']);
    expect(plan.before.readReleases).toEqual([1]);
    expect(plan.after).toEqual({ releases: [], releaseSubscriptions: [7], readReleases: [2], routeMode: 'browser' });
    expect(configuration).toBeUndefined();
    expect(state.readReleases).toEqual(new Set([1]));
    expect(plan.after).not.toHaveProperty('releaseSourceSettings');
  });
  it('keeps credentials out of plan/preview and preserves masked passwords and local AGY binding', async () => {
    state.aiConfigs = [{ id: 'agy-cli-local', provider: 'agy-cli', name: 'local', model: 'm', agyEffort: 'max', agyMode: 'model', deviceBound: true, isActive: true }];
    state.proxyConfig.password = 'device-private';
    const { plan, configuration } = await planCloudBackupRestore(state, decode({ proxyConfig: { ...state.proxyConfig, password: '***' }, backendApiSecret: 'cloud-private', aiConfigs: [], includeKeysInBackup: true }), identity, false);
    expect(JSON.stringify(plan)).not.toMatch(/device-private|cloud-private|password|backendApiSecret/);
    expect(configuration?.after.proxyConfig?.password).toBe('device-private');
    expect(configuration?.after.backendApiSecret).toBe('cloud-private');
    expect(configuration?.after.aiConfigs).toEqual(state.aiConfigs);
  });
  it('captures only discovery blocks selected by the backup for compensation', async () => {
    const incoming = { version: 1, accountId: '42', customDiscovery: { channels: [], editions: [] } };
    const { plan } = await planCloudBackupRestore(state, decode({ discoveryWorkspace: incoming }), identity, false);
    expect(plan.discovery).toEqual({ before: incoming, after: incoming });
    expect(plan.keys).toEqual([]);
  });
});
