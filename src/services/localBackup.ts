import { z } from 'zod';
import type { Repository, Release, AIConfig, WebDAVConfig, Category, AssetFilter, DiscoveryRepo, SubscriptionRepo, SubscriptionChannel, SearchFilters, ProxyConfig, RpcDownloadConfig, ReleaseSourceSettings } from '../types';
import type { DiscoveryWorkspaceBackup } from './discoveryWorkspaceBackup';
import type { AppLanguage } from '../i18n/languages';
import type { RepositorySubcategory } from '../types/repositoryOrganization';
import type { ThemeTokens } from '../types/themeTokens';
import type { RepositoryCardFields } from '../types/repositoryCardFields';
import type { ThemePresetId } from '../constants/themePresets';
import { validateCustomCategorySnapshot } from '../store/helpers/repositoryOrganization';
export interface BackupIdentity { githubUserId: string | null; workspaceId: string | null }
export interface LocalBackup {
  version: string;
  exportDate: string;
  appVersion: string;
  identity?: BackupIdentity;
  included?: string[];
  data: {
    repositories?: Repository[];
    releases?: Release[];
    aiConfigs?: AIConfig[];
    webdavConfigs?: WebDAVConfig[];
    customCategories?: Category[];
    subcategories?: RepositorySubcategory[];
    subcategoryOrder?: string[];
    repositoryOrder?: number[];
    assetFilters?: AssetFilter[];
    discoveryRepos?: Record<string, DiscoveryRepo[]>;
    discoveryWorkspace?: DiscoveryWorkspaceBackup;
    discoveryTotalCount?: Record<string, number>;
    discoveryHasMore?: Record<string, boolean>;
    discoveryNextPage?: Record<string, number>;
    subscriptionRepos?: Record<string, SubscriptionRepo[]>;
    subscriptionLastRefresh?: Record<string, string | null>;
    subscriptionChannels?: SubscriptionChannel[];
    releaseSubscriptions?: number[];
    releaseSourceSettings?: ReleaseSourceSettings;
    readReleases?: number[];
    searchFilters?: SearchFilters;
    hiddenDefaultCategoryIds?: string[];
    defaultCategoryOverrides?: Record<string, Partial<Category>>;
    categoryOrder?: string[];
    theme?: 'light' | 'dark';
    themePreset?: ThemePresetId;
    themeTokens?: ThemeTokens;
    repositoryCardFields?: RepositoryCardFields;
    repositoryViewMode?: 'list' | 'grid';
    language?: AppLanguage;
    isSidebarCollapsed?: boolean;
    releaseViewMode?: 'timeline' | 'repository';
    releaseSelectedFilters?: string[];
    releaseSearchQuery?: string;
    releaseExpandedRepositories?: number[];
    proxyConfig?: ProxyConfig;
    rpcDownloadConfig?: RpcDownloadConfig;
    backendApiSecret?: string | null;
    includeKeysInBackup?: boolean;
  };
}

const identitySchema = z.object({ githubUserId: z.string().regex(/^[1-9]\d*$/).nullable(), workspaceId: z.string().min(1).nullable() }).strict();
const object = z.record(z.string(), z.unknown());
const idList = z.array(z.number().int().positive().safe());
const strings = z.array(z.string());
const dataSchema = z.object({
  repositories: z.array(z.object({ id: z.number().int().positive().safe(), full_name: z.string().regex(/^[^/\\\s]+\/[^/\\\s]+$/) }).passthrough()).optional(),
  releases: z.array(object).optional(), aiConfigs: z.array(object).optional(), webdavConfigs: z.array(object).optional(),
  customCategories: z.array(object).optional(), subcategories: z.array(z.object({ id: z.string().min(1), parentId: z.string().min(1), name: z.string().min(1), icon: z.string() })).optional(),
  subcategoryOrder: strings.optional(), repositoryOrder: idList.optional(), categoryOrder: strings.optional(),
  hiddenDefaultCategoryIds: strings.optional(), defaultCategoryOverrides: object.optional(),
  theme: z.enum(['light', 'dark']).optional(), themePreset: z.string().optional(), themeTokens: object.optional(),
  repositoryCardFields: z.record(z.string(), z.boolean()).optional(), repositoryViewMode: z.enum(['list', 'grid']).optional(),
  language: z.string().optional(), isSidebarCollapsed: z.boolean().optional(),
  releaseViewMode: z.enum(['timeline', 'repository']).optional(), releaseSelectedFilters: strings.optional(),
  releaseSearchQuery: z.string().optional(), releaseExpandedRepositories: idList.optional(),
  releaseSubscriptions: idList.optional(), readReleases: idList.optional(), includeKeysInBackup: z.boolean().optional(),
  assetFilters: z.array(object).optional(), subscriptionChannels: z.array(object).optional(),
  discoveryRepos: object.optional(), discoveryTotalCount: object.optional(), discoveryHasMore: object.optional(), discoveryNextPage: object.optional(),
  discoveryWorkspace: object.optional(), subscriptionRepos: object.optional(), subscriptionLastRefresh: object.optional(),
  proxyConfig: object.optional(), rpcDownloadConfig: object.optional(), searchFilters: object.optional(), releaseSourceSettings: object.optional(), backendApiSecret: z.string().nullable().optional(),
}).passthrough();

export const SAFE_BACKUP_TYPES = ['repositories', 'customCategories', 'uiSettings'] as const;
export const ORGANIZATION_BACKUP_KEYS = ['customCategories', 'hiddenDefaultCategoryIds', 'defaultCategoryOverrides', 'categoryOrder', 'subcategories', 'subcategoryOrder', 'repositoryOrder'] as const;
export const PREFERENCE_BACKUP_KEYS = ['theme', 'themePreset', 'themeTokens', 'repositoryCardFields', 'repositoryViewMode', 'language', 'isSidebarCollapsed', 'releaseViewMode', 'releaseSelectedFilters', 'releaseSearchQuery', 'releaseExpandedRepositories'] as const;
const aliases: Record<string, string> = { discoveryWorkspace: 'discoveryRepos', discoveryTotalCount: 'discoveryRepos', discoveryHasMore: 'discoveryRepos', discoveryNextPage: 'discoveryRepos', subscriptionChannels: 'subscriptionRepos', subscriptionLastRefresh: 'subscriptionRepos', releaseSourceSettings: 'releaseSubscriptions', readReleases: 'releaseSubscriptions' };
export function localBackupTypes(data: LocalBackup['data']): string[] {
  const types = ['repositories', 'releases', 'aiConfigs', 'webdavConfigs', 'customCategories', 'assetFilters', 'discoveryRepos', 'subscriptionRepos', 'releaseSubscriptions', 'searchFilters', 'uiSettings'];
  return [...new Set(Object.keys(data).filter(key => data[key as keyof typeof data] !== undefined).map(key =>
    ORGANIZATION_BACKUP_KEYS.includes(key as typeof ORGANIZATION_BACKUP_KEYS[number]) ? 'customCategories'
      : PREFERENCE_BACKUP_KEYS.includes(key as typeof PREFERENCE_BACKUP_KEYS[number]) || ['proxyConfig', 'rpcDownloadConfig', 'backendApiSecret'].includes(key) ? 'uiSettings'
      : aliases[key] ?? key).filter(type => types.includes(type)))];
}

/** Decode only; preview and identity decisions must precede every writer. */
export function decodeLocalBackup(text: string): LocalBackup {
  if (new TextEncoder().encode(text).byteLength > 20 * 1024 * 1024) throw new Error('BACKUP_TOO_LARGE');
  const raw = z.object({ version: z.enum(['1.0', '1.1', '1.2']) }).passthrough().parse(JSON.parse(text));
  const data = dataSchema.parse(raw.version === '1.2' && !('data' in raw) ? raw : raw.data);
  if (data.customCategories !== undefined) validateCustomCategorySnapshot(data.customCategories);
  for (const rows of [data.repositories, data.subcategories]) {
    if (rows && new Set(rows.map(row => row.id)).size !== rows.length) throw new Error('BACKUP_DUPLICATE_ID');
  }
  const identity = raw.identity === undefined && raw.version !== '1.1' ? undefined : identitySchema.parse(raw.identity);
  const included = raw.version === '1.1' ? strings.parse(raw.included) : localBackupTypes(data as LocalBackup['data']);
  const actual = localBackupTypes(data as LocalBackup['data']);
  if (actual.some(type => !included.includes(type))) throw new Error('BACKUP_UNDECLARED_DATA');
  return { version: raw.version, exportDate: String(raw.exportDate ?? raw.exportedAt ?? ''), appVersion: String(raw.appVersion ?? ''), identity, included, data: data as LocalBackup['data'] };
}

export function assertLocalBackupIdentity(backup: LocalBackup, current: BackupIdentity): void {
  if (!backup.identity) return; // Legacy requires explicit UI confirmation, never inferred ownership.
  const business = localBackupTypes(backup.data).some(type => type !== 'uiSettings');
  if (business && (!backup.identity.githubUserId || backup.identity.githubUserId !== current.githubUserId || backup.identity.workspaceId !== current.workspaceId)) throw new Error('BACKUP_IDENTITY_MISMATCH');
  if (!business && backup.identity.githubUserId && backup.identity.githubUserId !== current.githubUserId) throw new Error('BACKUP_IDENTITY_MISMATCH');
}
