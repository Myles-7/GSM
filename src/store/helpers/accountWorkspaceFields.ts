import type { AccountWorkspace } from '../../types';

/**
 * AccountWorkspace is persisted as a single value today and will be split into
 * shards later. Keep the field policy next to the snapshot helpers so a new
 * field cannot silently fall outside the dirty-check contract.
 */
export const ACCOUNT_WORKSPACE_REFERENCE_FIELDS = [
  'repositories',
  'gists',
  'starredGists',
  'releases',
  'forks',
  'customCategories',
  'categoryOrder',
  'readReleases',
  'readForks',
  'releaseSubscriptions',
  'hiddenDefaultCategoryIds',
  'classificationSchemes',
  'classificationNavigation',
  'externalDiscoveryChannels',
  'subcategories',
  'subcategoryOrder',
  'repositoryOrder',
] as const satisfies readonly (keyof AccountWorkspace)[];

export const ACCOUNT_WORKSPACE_VALUE_FIELDS = [
  'lastSync',
  'selectedGistCategory',
  'releaseSourceSettings',
  'defaultCategoryOverrides',
  'categoryListIdMap',
  'syncMode',
  'syncModeConfigured',
] as const satisfies readonly (keyof AccountWorkspace)[];

export const ACCOUNT_WORKSPACE_PERSISTED_FIELDS = [
  ...ACCOUNT_WORKSPACE_REFERENCE_FIELDS,
  ...ACCOUNT_WORKSPACE_VALUE_FIELDS,
] as const;

// Compile-time guard: adding a persisted AccountWorkspace field without
// adding it to one of the two dirty policies is a type error.
export const ACCOUNT_WORKSPACE_FIELDS_COMPLETE: Exclude<
  keyof AccountWorkspace,
  typeof ACCOUNT_WORKSPACE_PERSISTED_FIELDS[number]
> extends never ? true : never = true;

