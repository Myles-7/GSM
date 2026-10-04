import { describe, expect, it } from 'vitest';
import { assertLocalBackupIdentity, decodeLocalBackup, type LocalBackup } from './localBackup';

const current: LocalBackup = { version: '1.1', exportDate: '2026-10-03', appVersion: 'test', identity: { githubUserId: '42', workspaceId: 'home' }, included: ['repositories', 'customCategories', 'uiSettings'], data: { repositories: [], customCategories: [], subcategories: [], repositoryOrder: [], subcategoryOrder: [], theme: 'dark', releaseSearchQuery: '', backendApiSecret: '***', includeKeysInBackup: false } };
describe('local backup codec', () => {
  it('roundtrips current identity, empty arrays, masked values and empty text without injecting absent fields', () => {
    const restored = decodeLocalBackup(JSON.stringify(current));
    expect(restored).toEqual(current); expect(restored.data).not.toHaveProperty('categoryOrder');
    expect(() => assertLocalBackupIdentity(restored, current.identity!)).not.toThrow();
  });
  it.each(['1.0', '1.2'])('adapts legacy %s without inventing identity', version => {
    const legacy = version === '1.0' ? { version, data: { repositories: [] } } : { version, exportedAt: 'date', repositories: [] };
    const result = decodeLocalBackup(JSON.stringify(legacy));
    expect(result.identity).toBeUndefined(); expect(result.data.repositories).toEqual([]); expect(result.included).toEqual(['repositories']);
  });
  it.each([{ githubUserId: '43', workspaceId: 'home' }, { githubUserId: '42', workspaceId: 'other' }])('rejects mismatch %j', identity => {
    expect(() => assertLocalBackupIdentity(current, identity)).toThrow('IDENTITY_MISMATCH');
  });
  it.each([{ ...current, version: '99' }, { ...current, identity: undefined }, { ...current, included: [] }, { ...current, data: { repositories: null } }, { ...current, data: { subcategories: null } }])('rejects malformed envelope', value => {
    expect(() => decodeLocalBackup(JSON.stringify(value))).toThrow();
  });
});
