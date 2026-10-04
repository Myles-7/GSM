import { z } from 'zod';
import type { AppStoreState } from '../store/types';
import type { LocalBackup, BackupIdentity } from './localBackup';
import { assertLocalBackupIdentity, ORGANIZATION_BACKUP_KEYS, PREFERENCE_BACKUP_KEYS } from './localBackup';
import { incomingOrganizationSnapshot, organizationCategories } from '../store/helpers/repositoryOrganization';
import { inspectRepositoryIdentities, preserveUnconfirmedLegacyRepositories } from '../utils/repositoryIdentity';
import { normalizeThemeTokens } from '../utils/themeTokens';
import { normalizeRepositoryCardFields } from '../utils/repositoryCardFields';
import { isThemePresetId } from '../constants/themePresets';
import { isAppLanguage } from '../i18n/languages';

export type SafeBackupType = 'repositories' | 'customCategories' | 'uiSettings';
export interface LocalRestorePlan {
  identity: BackupIdentity;
  mode: 'merge' | 'replace';
  keys: string[];
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  summary: string;
}
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
export function restoreScopeSnapshot(state: Partial<AppStoreState>, keys: readonly string[]): Record<string, unknown> {
  return clone(Object.fromEntries(keys.map(key => {
    const value = state[key as keyof AppStoreState];
    return [key, value instanceof Set ? [...value] : value];
  })));
}
export function restoreStorePatch(value: Record<string, unknown>): Partial<AppStoreState> {
  return { ...value, ...('releaseExpandedRepositories' in value ? { releaseExpandedRepositories: new Set(value.releaseExpandedRepositories as number[]) } : {}) } as Partial<AppStoreState>;
}
export function compatibilityBackupData(data: LocalBackup['data']): LocalBackup['data'] {
  const omit = new Set<string>(['repositories', ...ORGANIZATION_BACKUP_KEYS, ...PREFERENCE_BACKUP_KEYS]);
  return Object.fromEntries(Object.entries(data).filter(([key]) => !omit.has(key))) as LocalBackup['data'];
}
export function safeBackupTypes(data: LocalBackup['data']): SafeBackupType[] {
  return [data.repositories !== undefined && 'repositories', ORGANIZATION_BACKUP_KEYS.some(key => data[key] !== undefined) && 'customCategories', PREFERENCE_BACKUP_KEYS.some(key => data[key] !== undefined) && 'uiSettings'].filter(Boolean) as SafeBackupType[];
}
const repositoryShape = z.object({ id: z.number().int().positive().safe(), name: z.string().min(1), full_name: z.string().regex(/^[^/\\\s]+\/[^/\\\s]+$/), description: z.string().nullable(), html_url: z.string(), stargazers_count: z.number().nonnegative(), forks_count: z.number().nonnegative(), forks: z.number().nonnegative(), language: z.string().nullable(), created_at: z.string(), updated_at: z.string(), pushed_at: z.string(), owner: z.object({ login: z.string().min(1), avatar_url: z.string() }), topics: z.array(z.string()), category_id: z.string().nullable().optional(), subcategory_id: z.string().nullable().optional() }).passthrough();
const themeTokensShape = z.object({ accentColor: z.string().regex(/^#[0-9a-f]{6}$/i).nullable(), fontScale: z.number().min(0.75).max(1.5), radius: z.enum(['default', 'none', 'small', 'medium', 'large']), animation: z.enum(['normal', 'reduced']) });
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
function validateReferences(state: AppStoreState) {
  const categories = new Set(organizationCategories(state).map(row => row.id));
  const groups = new Map(state.subcategories.map(row => [row.id, row]));
  if (groups.size !== state.subcategories.length) throw new Error('BACKUP_DUPLICATE_GROUP');
  for (const id of [...state.hiddenDefaultCategoryIds, ...Object.keys(state.defaultCategoryOverrides)]) {
    if (!categories.has(id)) throw new Error('BACKUP_INVALID_CATEGORY_REFERENCE');
  }
  for (const group of groups.values()) if (!categories.has(group.parentId)) throw new Error('BACKUP_INVALID_GROUP_PARENT');
  for (const repo of state.repositories) {
    if (repo.category_id && !categories.has(repo.category_id)) throw new Error('BACKUP_INVALID_CATEGORY_REFERENCE');
    if (repo.subcategory_id && groups.get(repo.subcategory_id)?.parentId !== repo.category_id) throw new Error('BACKUP_INVALID_GROUP_REFERENCE');
  }
  for (const [order, valid] of [[state.repositoryOrder, new Set(state.repositories.map(row => row.id))], [state.subcategoryOrder, new Set(groups.keys())], [state.categoryOrder, new Set([...categories, 'all'])]] as const) {
    if (new Set<string | number>(order).size !== order.length || order.some(id => !(valid as Set<string | number>).has(id))) throw new Error('BACKUP_INVALID_ORDER_REFERENCE');
  }
  for (const categoryId of Object.keys(state.categoryListIdMap)) if (!categories.has(categoryId)) throw new Error('BACKUP_UNSELECTED_LIST_MAPPING_DEPENDENCY');
}

/** Plan all changes before a writer, including explicit empty snapshots. */
export function planLocalBackupRestore(state: AppStoreState, backup: LocalBackup, selected: readonly SafeBackupType[], mode: 'merge' | 'replace', identity: BackupIdentity, legacyConfirmed: boolean): LocalRestorePlan {
  if (!backup.identity && !legacyConfirmed) throw new Error('BACKUP_LEGACY_IDENTITY_CONFIRMATION_REQUIRED');
  assertLocalBackupIdentity(backup, identity);
  if (selected.some(type => type !== 'uiSettings') && !identity.githubUserId) throw new Error('BACKUP_ACCOUNT_REQUIRED');
  const data = backup.data;
  if (selected.some(type => !safeBackupTypes(data).includes(type))) throw new Error('BACKUP_SECTION_ABSENT');
  const patch: Record<string, unknown> = {};
  if (selected.includes('repositories')) {
    const incoming = data.repositories!;
    z.array(repositoryShape).parse(incoming); inspectRepositoryIdentities(state.repositories, incoming);
    const existing = new Map(state.repositories.map(repo => [repo.id, repo]));
    for (const repo of incoming) if (existing.has(repo.id) && existing.get(repo.id)!.full_name.toLowerCase() !== repo.full_name.toLowerCase()) throw new Error('BACKUP_REPOSITORY_IDENTITY_CONFLICT');
    const incomingNames = new Map(incoming.map(repo => [repo.full_name.toLowerCase(), repo.id]));
    if (state.repositories.some(repo => incomingNames.has(repo.full_name.toLowerCase()) && incomingNames.get(repo.full_name.toLowerCase()) !== repo.id)) throw new Error('BACKUP_REPOSITORY_IDENTITY_CONFLICT');
    patch.repositories = mode === 'merge' ? [...state.repositories, ...incoming.filter(repo => !existing.has(repo.id))] : preserveUnconfirmedLegacyRepositories(incoming, state.repositories);
  }
  if (selected.includes('customCategories')) {
    for (const key of ORGANIZATION_BACKUP_KEYS) {
      const input = data[key]; if (input === undefined) continue;
      if (mode === 'replace') patch[key] = input;
      else if (key === 'customCategories' || key === 'subcategories') {
        const rows = state[key]; const ids = new Set(rows.map(row => row.id));
        patch[key] = [...rows, ...(input as typeof rows).filter(row => !ids.has(row.id))];
      } else if (key === 'defaultCategoryOverrides') patch[key] = { ...input, ...state.defaultCategoryOverrides };
      else patch[key] = [...new Set([...(state[key] as Array<string | number>), ...(input as Array<string | number>)])];
    }
  }
  if (selected.includes('uiSettings')) {
    for (const key of PREFERENCE_BACKUP_KEYS) if (data[key] !== undefined) patch[key] = data[key];
    if (data.themePreset !== undefined && !isThemePresetId(data.themePreset)) throw new Error('BACKUP_INVALID_THEME');
    if (data.language !== undefined && !isAppLanguage(data.language)) throw new Error('BACKUP_INVALID_LANGUAGE');
    if (data.themeTokens !== undefined) patch.themeTokens = normalizeThemeTokens(themeTokensShape.parse(data.themeTokens));
    if (data.repositoryCardFields !== undefined) {
      if (Object.keys(data.repositoryCardFields).some(key => !(key in state.repositoryCardFields))) throw new Error('BACKUP_INVALID_CARD_FIELD');
      patch.repositoryCardFields = normalizeRepositoryCardFields(data.repositoryCardFields);
    }
  }
  const keys = Object.keys(patch);
  if (selected.some(type => type !== 'uiSettings')) {
    // Membership changes are dependent repository writes, visible in the preview.
    const next = { ...state, ...restoreStorePatch(patch) };
    validateReferences(next);
    const organization = incomingOrganizationSnapshot(state, patch, next.repositories);
    for (const key of ['repositories', ...ORGANIZATION_BACKUP_KEYS] as const) {
      if (organization[key] !== undefined && (key === 'repositories' || key in patch || !same(state[key], organization[key]))) {
        patch[key] = organization[key]; if (!keys.includes(key)) keys.push(key);
      }
    }
  }
  if (!keys.length) throw new Error('BACKUP_NOTHING_SELECTED');
  const before = restoreScopeSnapshot(state, keys), after = clone(patch);
  const changes = keys.filter(key => !same(before[key], after[key]));
  const repoBefore = (before.repositories ?? []) as AppStoreState['repositories'];
  const repoAfter = (after.repositories ?? []) as AppStoreState['repositories'];
  const ids = new Set(repoAfter.map(repo => repo.id));
  const previousIds = new Set(repoBefore.map(repo => repo.id));
  const summary = JSON.stringify({ mode, changedFields: changes, repositories: 'repositories' in after ? { before: repoBefore.length, after: repoAfter.length, removed: repoBefore.filter(repo => !ids.has(repo.id)).map(repo => repo.full_name), added: repoAfter.filter(repo => !previousIds.has(repo.id)).map(repo => repo.full_name) } : undefined, subcategories: 'subcategories' in after ? after.subcategories : undefined }, null, 2);
  return { identity, mode, keys, before, after, summary };
}
