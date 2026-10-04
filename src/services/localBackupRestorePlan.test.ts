import { describe, expect, it } from 'vitest';
import { createInitialState } from '../store/initialState';
import type { AppStoreState } from '../store/types';
import type { Repository } from '../types';
import { planLocalBackupRestore, compatibilityBackupData } from './localBackupRestorePlan';
import type { LocalBackup } from './localBackup';

export const fixtureRepo = (id: number): Repository => ({ id, name: `repo-${id}`, full_name: `fixture/repo-${id}`, description: '', html_url: 'https://example.invalid', stargazers_count: 1, forks_count: 0, forks: 0, language: null, created_at: '', updated_at: '', pushed_at: '', owner: { login: 'fixture', avatar_url: '' }, topics: [], category_id: null, subcategory_id: null });
const identity = { githubUserId: '42', workspaceId: null };
const backup = (data: LocalBackup['data']): LocalBackup => ({ version: '1.1', identity, included: ['repositories', 'customCategories', 'uiSettings'], exportDate: '', appVersion: '', data });
const state = () => ({ ...createInitialState(), repositories: [fixtureRepo(1)], repositoryOrder: [1] } as AppStoreState);
describe('selected backup restore planning', () => {
  it.each([0.75, 1.5])('restores the existing normalized font scale boundary %s without narrowing preferences', fontScale => {
    const themeTokens = { accentColor: null, fontScale, radius: 'default', animation: 'normal' } as const;
    const result = planLocalBackupRestore(state(), backup({ themeTokens }), ['uiSettings'], 'replace', identity, false);
    expect(result.after.themeTokens).toEqual(themeTokens);
  });
  it('merge keeps current same-ID records and order, appends new IDs, restores explicitly selected preferences', () => {
    const before = state();
    const result = planLocalBackupRestore(before, backup({ repositories: [{ ...fixtureRepo(1), description: 'incoming' }, fixtureRepo(2)], repositoryOrder: [2, 1], theme: 'dark', backendApiSecret: '***' }), ['repositories', 'customCategories', 'uiSettings'], 'merge', identity, false);
    expect((result.after.repositories as Repository[])[0].description).toBe('');
    expect(result.after.repositoryOrder).toEqual([1, 2]); expect(result.after.theme).toBe('dark'); expect(result.after).not.toHaveProperty('backendApiSecret');
    expect(before.repositories).toHaveLength(1);
  });
  it('installs the complete organization before normalizing memberships', () => {
    const result = planLocalBackupRestore(state(), backup({ repositories: [{ ...fixtureRepo(2), category_id: 'c', subcategory_id: 'g' }], customCategories: [{ id: 'c', name: 'Category', icon: 'C', keywords: [] }], subcategories: [{ id: 'g', parentId: 'c', name: 'Group', icon: 'G' }], repositoryOrder: [2], subcategoryOrder: ['g'] }), ['repositories', 'customCategories'], 'replace', identity, false);
    expect((result.after.repositories as Repository[])[0].subcategory_id).toBe('g');
  });
  it('honors explicit empty replace and refuses absent selections and dangling unselected dependencies', () => {
    expect(planLocalBackupRestore(state(), backup({ repositories: [], repositoryOrder: [] }), ['repositories', 'customCategories'], 'replace', identity, false).after.repositories).toEqual([]);
    expect(() => planLocalBackupRestore(state(), backup({ repositories: [] }), ['repositories'], 'replace', identity, false)).toThrow('ORDER_REFERENCE');
    expect(() => planLocalBackupRestore(state(), backup({}), ['uiSettings'], 'replace', identity, false)).toThrow('SECTION_ABSENT');
    const before = state(); before.customCategories = [{ id: 'c', name: 'C', icon: 'C', keywords: [] }]; before.categoryListIdMap = { c: 'list' };
    expect(() => planLocalBackupRestore(before, backup({ customCategories: [] }), ['customCategories'], 'replace', identity, false)).toThrow('LIST_MAPPING_DEPENDENCY');
  });
  it('rejects collisions and invalid memberships before writers, preserving legacy ownership confirmation', () => {
    expect(() => planLocalBackupRestore(state(), backup({ repositories: [{ ...fixtureRepo(1), full_name: 'another/repo' }] }), ['repositories'], 'merge', identity, false)).toThrow('IDENTITY_CONFLICT');
    expect(() => planLocalBackupRestore(state(), backup({ repositories: [{ ...fixtureRepo(2), category_id: 'missing' }] }), ['repositories'], 'merge', identity, false)).toThrow('CATEGORY_REFERENCE');
    expect(() => planLocalBackupRestore(state(), { ...backup({ theme: 'dark' }), identity: undefined }, ['uiSettings'], 'merge', identity, false)).toThrow('CONFIRMATION_REQUIRED');
    expect(() => planLocalBackupRestore(state(), backup({ theme: 'dark' }), ['uiSettings'], 'merge', { ...identity, githubUserId: '43' }, true)).toThrow('IDENTITY_MISMATCH');
  });
  it('separates the compatibility operation while retaining masked secret choices', () => {
    expect(compatibilityBackupData({ repositories: [], theme: 'dark', subcategories: [], rpcDownloadConfig: { secret: '***' } as never, releases: [] })).toEqual({ rpcDownloadConfig: { secret: '***' }, releases: [] });
  });
});
