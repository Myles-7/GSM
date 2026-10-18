import type {
  AccountWorkspace,
  Category,
  ForkRepo,
  Gist,
  GistCategoryId,
  GitHubUser,
  Release,
  ReleaseSourceSettings,
  Repository,
  SyncMode,
  DiscoveryChannel,
} from '../../types';
import type {
  ClassificationNavigation,
  ClassificationScheme,
  ClassificationSchemeId,
  ClassificationSchemes,
} from '../../types/classification';
import { classificationSchemesSchema } from '../../services/classificationSchema';
import { normalizeExternalDiscoveryChannels } from '../../services/externalFeedConfig';
import { defaultReleaseSourceSettings } from '../../types';
import { normalizeReleaseSourceSettings } from '../../utils/releaseSources';
import type { RepositoryOrganization } from '../../types/repositoryOrganization';
import { normalizeOrder, normalizeRepositoryOrganization, recoverLocalCategorySnapshot } from './repositoryOrganization';
import { getAllCategories } from './categoryHelpers';

export type { AccountWorkspace };

export interface AccountWorkspaceRuntime extends RepositoryOrganization {
  classificationSchemes?: AccountWorkspace['classificationSchemes'];
  classificationNavigation?: AccountWorkspace['classificationNavigation'];
  repositories: Repository[];
  lastSync: string | null;
  gists: Gist[];
  starredGists: Gist[];
  gistSearchResults: Gist[];
  selectedGistCategory: GistCategoryId;
  searchResults: Repository[];
  similarView: null;
  analyzingGistIds: Set<string>;
  analyzingRepositoryIds: Set<number>;
  releases: Release[];
  releaseSubscriptions: Set<number>;
  releaseSourceSettings: ReleaseSourceSettings;
  readReleases: Set<number>;
  forks: ForkRepo[];
  readForks: Set<number>;
  customCategories: Category[];
  hiddenDefaultCategoryIds: string[];
  categoryOrder: string[];
  defaultCategoryOverrides: Record<string, Partial<Category>>;
  categoryListIdMap: Record<string, string>;
  syncMode: SyncMode;
  syncModeConfigured: boolean;
}

export interface AccountWorkspaceSource extends Partial<RepositoryOrganization> {
  classificationSchemes?: AccountWorkspace['classificationSchemes'];
  classificationNavigation?: AccountWorkspace['classificationNavigation'];
  externalDiscoveryChannels?: AccountWorkspace['externalDiscoveryChannels'];
  discoveryChannels?: DiscoveryChannel[];
  repositories: Repository[];
  lastSync: string | null;
  gists: Gist[];
  starredGists: Gist[];
  selectedGistCategory: GistCategoryId;
  releases: Release[];
  releaseSubscriptions: Set<number>;
  releaseSourceSettings: ReleaseSourceSettings;
  readReleases: Set<number>;
  forks: ForkRepo[];
  readForks: Set<number>;
  customCategories: Category[];
  hiddenDefaultCategoryIds: string[];
  categoryOrder: string[];
  defaultCategoryOverrides: Record<string, Partial<Category>>;
  categoryListIdMap: Record<string, string>;
  syncMode: SyncMode;
  syncModeConfigured: boolean;
}

export { ACCOUNT_WORKSPACE_REFERENCE_FIELDS, ACCOUNT_WORKSPACE_VALUE_FIELDS, ACCOUNT_WORKSPACE_PERSISTED_FIELDS, ACCOUNT_WORKSPACE_FIELDS_COMPLETE } from './accountWorkspaceFields';

const CLASSIFICATION_SCHEME_IDS: readonly ClassificationSchemeId[] = ['purpose', 'technology'];

const isRecord = (value: unknown): value is Record<string, unknown> => (
  !!value && typeof value === 'object' && !Array.isArray(value)
);

const normalizeStringList = (value: unknown): string[] => (
  Array.from(new Set(
    (Array.isArray(value) ? value : [])
      .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      .map(item => item.trim()),
  ))
);

const normalizeNumberList = (value: unknown): number[] => (
  Array.from(new Set(
    (Array.isArray(value) ? value : [])
      .filter((item): item is number => Number.isSafeInteger(item) && item > 0),
  ))
);

const normalizeStringMap = (value: unknown): Record<string, string> => (
  isRecord(value)
    ? Object.fromEntries(Object.entries(value).filter(([, item]) => typeof item === 'string')) as Record<string, string>
    : {}
);

const normalizeCategoryRows = (value: unknown): Category[] => {
  const result: Category[] = [];
  const ids = new Set<string>();
  for (const item of Array.isArray(value) ? value : []) {
    if (!isRecord(item) || typeof item.id !== 'string' || typeof item.name !== 'string' ||
      typeof item.icon !== 'string' || !Array.isArray(item.keywords)) continue;
    const id = item.id.trim();
    const name = item.name.trim();
    if (!id || !name || id === 'all' || id === 'pending' || id.length > 160 || name.length > 120 ||
      item.icon.length > 100 || item.keywords.length > 500 || ids.has(id) ||
      !item.keywords.every(keyword => typeof keyword === 'string')) continue;
    if (item.isCustom !== undefined && typeof item.isCustom !== 'boolean') continue;
    if (item.isHidden !== undefined && typeof item.isHidden !== 'boolean') continue;
    if (item.mergedInto !== undefined && (typeof item.mergedInto !== 'string' || !item.mergedInto.trim())) continue;
    ids.add(id);
    result.push({
      ...item,
      id,
      name,
      keywords: item.keywords as string[],
    } as Category);
  }
  return result;
};

const normalizeClassificationSchemeInput = (
  value: unknown,
  id: ClassificationSchemeId,
): Record<string, unknown> | null => {
  if (!isRecord(value)) return null;
  const customCategories = normalizeCategoryRows(value.customCategories);
  const defaultCategoryOverrides = id === 'technology'
    ? {}
    : isRecord(value.defaultCategoryOverrides)
      ? Object.fromEntries(Object.entries(value.defaultCategoryOverrides).filter(([, item]) => isRecord(item)))
      : {};
  const hiddenDefaultCategoryIds = id === 'technology'
    ? []
    : normalizeStringList(value.hiddenDefaultCategoryIds);
  const categoryListIdMap = id === 'technology' ? {} : normalizeStringMap(value.categoryListIdMap);
  const parentIds = new Set(customCategories.map(category => category.id));
  if (id === 'purpose') {
    for (const category of getAllCategories(customCategories, 'zh', [], defaultCategoryOverrides as unknown as Record<string, Partial<Category>>)) {
      parentIds.add(category.id);
    }
  }
  const subcategoryIds = new Set<string>();
  const subcategories = (Array.isArray(value.subcategories) ? value.subcategories : []).flatMap(item => {
    if (!isRecord(item) || typeof item.id !== 'string' || typeof item.parentId !== 'string' ||
      typeof item.name !== 'string' || typeof item.icon !== 'string') return [];
    const subcategory = {
      id: item.id.trim(),
      parentId: item.parentId.trim(),
      name: item.name.trim(),
      icon: item.icon,
    };
    if (!subcategory.id || !subcategory.parentId || !subcategory.name || subcategory.id.length > 160 ||
      subcategory.name.length > 120 || subcategory.icon.length > 100 || !parentIds.has(subcategory.parentId) ||
      subcategoryIds.has(subcategory.id) || parentIds.has(subcategory.id)) return [];
    subcategoryIds.add(subcategory.id);
    return [subcategory];
  });
  return {
    initialized: value.initialized === true,
    customCategories,
    defaultCategoryOverrides,
    hiddenDefaultCategoryIds,
    categoryOrder: normalizeStringList(value.categoryOrder),
    subcategories,
    subcategoryOrder: normalizeStringList(value.subcategoryOrder),
    repositoryOrder: normalizeNumberList(value.repositoryOrder),
    categoryListIdMap,
  };
};

const normalizeNavigation = (value: unknown): Partial<Record<ClassificationSchemeId, ClassificationNavigation>> => {
  if (!isRecord(value)) return {};
  const result: Partial<Record<ClassificationSchemeId, ClassificationNavigation>> = {};
  for (const id of CLASSIFICATION_SCHEME_IDS) {
    const row = value[id];
    if (!isRecord(row)) continue;
    const navigation: ClassificationNavigation = {
      selected: typeof row.selected === 'string' && row.selected.trim() ? row.selected.trim() : 'all',
      expanded: normalizeStringList(row.expanded),
    };
    if (Array.isArray(row.collapsedGroups)) {
      navigation.collapsedGroups = normalizeStringList(row.collapsedGroups);
    }
    result[id] = navigation;
  }
  return result;
};

/**
 * Parse and normalize the two parked classification structures. The schema
 * parser rejects malformed records; the organization normalizer then removes
 * orphan subcategories and stale order entries against the parked repository
 * set. This keeps parked data safe to apply without trusting a type assertion.
 */
const normalizeClassificationSchemes = (
  value: unknown,
  repositories: Repository[],
): ClassificationSchemes => {
  if (!isRecord(value)) return {};
  const result: ClassificationSchemes = {};
  for (const id of CLASSIFICATION_SCHEME_IDS) {
    const input = normalizeClassificationSchemeInput(value[id], id);
    if (!input) continue;
    const parsed = classificationSchemesSchema.shape[id].safeParse(input);
    if (!parsed.success) continue;
    const scheme = parsed.data as ClassificationScheme;
    const categories = id === 'technology'
      ? scheme.customCategories
      : getAllCategories(scheme.customCategories, 'zh', [], scheme.defaultCategoryOverrides)
        .filter(category => category.id !== 'all');
    const normalized = normalizeRepositoryOrganization({
      repositories,
      subcategories: scheme.subcategories,
      subcategoryOrder: scheme.subcategoryOrder,
      repositoryOrder: scheme.repositoryOrder,
    }, categories);
    result[id] = {
      ...scheme,
      subcategories: normalized.subcategories,
      subcategoryOrder: normalized.subcategoryOrder,
      // Keep the scheme order tied to the parked repository set. The helper
      // also removes duplicate and unknown ids while retaining all live ids.
      repositoryOrder: normalizeOrder(scheme.repositoryOrder, repositories.map(repository => repository.id)),
    };
  }
  return result;
};

const normalizeAccountWorkspaceRecord = (
  record: Record<string, unknown>,
  empty: AccountWorkspace,
): AccountWorkspace => {
  const repositories = Array.isArray(record.repositories) ? record.repositories as Repository[] : [];
  return {
    ...empty,
    classificationSchemes: normalizeClassificationSchemes(record.classificationSchemes, repositories),
    classificationNavigation: normalizeNavigation(record.classificationNavigation),
    externalDiscoveryChannels: normalizeExternalDiscoveryChannels(record.externalDiscoveryChannels),
    repositories,
    lastSync: typeof record.lastSync === 'string' ? record.lastSync : null,
    gists: Array.isArray(record.gists) ? record.gists : [],
    starredGists: Array.isArray(record.starredGists) ? record.starredGists : [],
    selectedGistCategory: record.selectedGistCategory === 'starred' || record.selectedGistCategory === 'mine'
      ? record.selectedGistCategory
      : 'all',
    releases: Array.isArray(record.releases) ? record.releases : [],
    releaseSubscriptions: Array.isArray(record.releaseSubscriptions)
      ? record.releaseSubscriptions.filter((item): item is number => typeof item === 'number')
      : [],
    releaseSourceSettings: normalizeReleaseSourceSettings(record.releaseSourceSettings),
    readReleases: Array.isArray(record.readReleases)
      ? record.readReleases.filter((item): item is number => typeof item === 'number')
      : [],
    forks: Array.isArray(record.forks) ? record.forks : [],
    readForks: Array.isArray(record.readForks)
      ? record.readForks.filter((item): item is number => typeof item === 'number')
      : [],
    customCategories: Array.isArray(record.customCategories) ? record.customCategories as Category[] : [],
    hiddenDefaultCategoryIds: Array.isArray(record.hiddenDefaultCategoryIds)
      ? record.hiddenDefaultCategoryIds.filter((item): item is string => typeof item === 'string')
      : [],
    categoryOrder: Array.isArray(record.categoryOrder)
      ? record.categoryOrder.filter((item): item is string => typeof item === 'string')
      : [],
    subcategories: Array.isArray(record.subcategories) ? record.subcategories : [],
    subcategoryOrder: Array.isArray(record.subcategoryOrder) ? record.subcategoryOrder : [],
    repositoryOrder: Array.isArray(record.repositoryOrder) ? record.repositoryOrder : [],
    defaultCategoryOverrides: isRecord(record.defaultCategoryOverrides)
      ? record.defaultCategoryOverrides as unknown as AccountWorkspace['defaultCategoryOverrides']
      : {},
    categoryListIdMap: isRecord(record.categoryListIdMap)
      ? Object.fromEntries(
          Object.entries(record.categoryListIdMap).filter(
            ([mapKey, mapValue]) => typeof mapKey === 'string' && typeof mapValue === 'string',
          ),
        ) as Record<string, string>
      : {},
    syncMode: record.syncMode === 'stars-and-lists' ? 'stars-and-lists' : 'stars',
    syncModeConfigured: record.syncModeConfigured === true,
  };
};

const numberSetToArray = (value: Set<number> | unknown): number[] => (
  value instanceof Set
    ? Array.from(value)
    : Array.isArray(value)
      ? value.filter((item): item is number => typeof item === 'number')
      : []
);

export const shouldPreserveExisting = <T>(
  incoming: T[] | undefined,
  existing: T[],
  allowEmpty = false,
): boolean => incoming !== undefined && incoming.length === 0 && existing.length > 0 && !allowEmpty;

export const accountIdKey = (user: Pick<GitHubUser, 'id'> | number | null | undefined): string | null => {
  const id = typeof user === 'number' ? user : user?.id;
  return typeof id === 'number' && Number.isFinite(id) ? String(id) : null;
};

export const normalizeAccountWorkspaces = (value: unknown): Record<string, AccountWorkspace> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const empty = emptyAccountWorkspace();
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).flatMap(([key, workspace]) => {
      if (!key || !workspace || typeof workspace !== 'object' || Array.isArray(workspace)) return [];
      return [[key, normalizeAccountWorkspaceRecord(workspace as Record<string, unknown>, empty)]];
    }),
  );
};

export const emptyAccountWorkspace = (): AccountWorkspace => ({
  classificationSchemes: {},
  classificationNavigation: {},
  externalDiscoveryChannels: [],
  repositories: [],
  lastSync: null,
  gists: [],
  starredGists: [],
  selectedGistCategory: 'all',
  releases: [],
  releaseSubscriptions: [],
  releaseSourceSettings: defaultReleaseSourceSettings,
  readReleases: [],
  forks: [],
  readForks: [],
  customCategories: [],
  hiddenDefaultCategoryIds: [],
  categoryOrder: [],
  subcategories: [],
  subcategoryOrder: [],
  repositoryOrder: [],
  defaultCategoryOverrides: {},
  categoryListIdMap: {},
  syncMode: 'stars',
  syncModeConfigured: false,
});

export const captureAccountWorkspace = (state: AccountWorkspaceSource): AccountWorkspace => ({
  classificationSchemes: normalizeClassificationSchemes(state.classificationSchemes, state.repositories),
  classificationNavigation: normalizeNavigation(state.classificationNavigation),
  externalDiscoveryChannels: normalizeExternalDiscoveryChannels(state.discoveryChannels ?? state.externalDiscoveryChannels),
  repositories: state.repositories,
  lastSync: state.lastSync,
  gists: state.gists,
  starredGists: state.starredGists,
  selectedGistCategory: state.selectedGistCategory,
  releases: state.releases,
  releaseSubscriptions: numberSetToArray(state.releaseSubscriptions),
  releaseSourceSettings: state.releaseSourceSettings,
  readReleases: numberSetToArray(state.readReleases),
  forks: state.forks,
  readForks: numberSetToArray(state.readForks),
  customCategories: state.customCategories,
  hiddenDefaultCategoryIds: state.hiddenDefaultCategoryIds,
  categoryOrder: state.categoryOrder,
  subcategories: state.subcategories ?? [],
  subcategoryOrder: state.subcategoryOrder ?? [],
  repositoryOrder: state.repositoryOrder ?? [],
  defaultCategoryOverrides: state.defaultCategoryOverrides,
  categoryListIdMap: state.categoryListIdMap,
  syncMode: state.syncMode,
  syncModeConfigured: state.syncModeConfigured,
});

export const applyAccountWorkspace = (workspace: AccountWorkspace | undefined): AccountWorkspaceRuntime => {
  const snapshot = normalizeAccountWorkspaceRecord(
    (workspace ?? emptyAccountWorkspace()) as unknown as Record<string, unknown>,
    emptyAccountWorkspace(),
  );
  const recovered = recoverLocalCategorySnapshot(snapshot.customCategories, snapshot.repositories);
  const organization = normalizeRepositoryOrganization({ ...snapshot, repositories: recovered.repositories },
    getAllCategories(recovered.customCategories, 'zh', [], snapshot.defaultCategoryOverrides).filter(category => category.id !== 'all'));
  return {
    ...organization,
    classificationSchemes: normalizeClassificationSchemes(snapshot.classificationSchemes, recovered.repositories),
    classificationNavigation: normalizeNavigation(snapshot.classificationNavigation),
    lastSync: snapshot.lastSync,
    gists: snapshot.gists,
    starredGists: snapshot.starredGists,
    gistSearchResults: snapshot.gists,
    selectedGistCategory: snapshot.selectedGistCategory,
    searchResults: organization.repositories,
    similarView: null,
    analyzingGistIds: new Set<string>(),
    analyzingRepositoryIds: new Set<number>(),
    releases: snapshot.releases,
    releaseSubscriptions: new Set(snapshot.releaseSubscriptions),
    releaseSourceSettings: snapshot.releaseSourceSettings,
    readReleases: new Set(snapshot.readReleases),
    forks: snapshot.forks,
    readForks: new Set(snapshot.readForks),
    customCategories: recovered.customCategories,
    hiddenDefaultCategoryIds: snapshot.hiddenDefaultCategoryIds,
    categoryOrder: snapshot.categoryOrder,
    defaultCategoryOverrides: snapshot.defaultCategoryOverrides,
    categoryListIdMap: snapshot.categoryListIdMap,
    syncMode: snapshot.syncMode,
    syncModeConfigured: snapshot.syncModeConfigured,
  };
};

export type WorkspaceDataCandidate =
  (Omit<Partial<AccountWorkspaceSource>, 'externalDiscoveryChannels'>
    | Omit<Partial<AccountWorkspace>, 'externalDiscoveryChannels'>) & {
      externalDiscoveryChannels?: DiscoveryChannel[];
      discoveryChannels?: DiscoveryChannel[];
    };

const classificationSchemesHaveData = (value: unknown): boolean => {
  if (!isRecord(value)) return false;
  return CLASSIFICATION_SCHEME_IDS.some(id => {
    const scheme = value[id];
    if (!isRecord(scheme)) return false;
    // `purpose.initialized` is also emitted for a clean workspace as a schema
    // marker, so only structure/configuration counts as user data.
    return (Array.isArray(scheme.customCategories) && scheme.customCategories.length > 0)
      || (Array.isArray(scheme.hiddenDefaultCategoryIds) && scheme.hiddenDefaultCategoryIds.length > 0)
      || (Array.isArray(scheme.categoryOrder) && scheme.categoryOrder.length > 0)
      || (Array.isArray(scheme.subcategories) && scheme.subcategories.length > 0)
      || (Array.isArray(scheme.subcategoryOrder) && scheme.subcategoryOrder.length > 0)
      || (Array.isArray(scheme.repositoryOrder) && scheme.repositoryOrder.length > 0)
      || (isRecord(scheme.defaultCategoryOverrides) && Object.keys(scheme.defaultCategoryOverrides).length > 0)
      || (isRecord(scheme.categoryListIdMap) && Object.keys(scheme.categoryListIdMap).length > 0);
  });
};

const classificationNavigationHasData = (value: unknown): boolean => (
  isRecord(value) && Object.keys(value).length > 0
);

/**
 * Predicate checking whether a workspace (live or parked snapshot) holds any
 * persisted user content or user-defined category configuration.
 * Excludes syncMode alone, adhering to the account-switching contract.
 */
export const workspaceHasData = (workspace: WorkspaceDataCandidate | null | undefined): boolean => {
  if (!workspace) return false;
  return (
    (workspace.repositories?.length ?? 0) > 0
    || (workspace.gists?.length ?? 0) > 0
    || (workspace.starredGists?.length ?? 0) > 0
    || (workspace.releases?.length ?? 0) > 0
    || (workspace.forks?.length ?? 0) > 0
    || (workspace.customCategories?.length ?? 0) > 0
    || (workspace.categoryOrder?.length ?? 0) > 0
    || (workspace.hiddenDefaultCategoryIds?.length ?? 0) > 0
    || (workspace.externalDiscoveryChannels?.length ?? 0) > 0
    || (workspace.discoveryChannels?.some(channel => channel.id.startsWith('external:')) ?? false)
    || (workspace.subcategories?.length ?? 0) > 0
    || (workspace.subcategoryOrder?.length ?? 0) > 0
    || (workspace.repositoryOrder?.length ?? 0) > 0
    || classificationSchemesHaveData(workspace.classificationSchemes)
    || classificationNavigationHasData(workspace.classificationNavigation)
    || Object.keys(workspace.defaultCategoryOverrides ?? {}).length > 0
    || Object.keys(workspace.categoryListIdMap ?? {}).length > 0
  );
};

export const switchAccountWorkspace = (
  current: AccountWorkspaceSource & { accountWorkspaces: Record<string, AccountWorkspace> },
  previousAccountId: string | null,
  nextAccountId: string,
): { accountWorkspaces: Record<string, AccountWorkspace>; workspace: AccountWorkspaceRuntime | null } => {
  const accountWorkspaces = { ...current.accountWorkspaces };
  if (previousAccountId && previousAccountId !== nextAccountId) {
    accountWorkspaces[previousAccountId] = captureAccountWorkspace(current);
  }
  if (previousAccountId === nextAccountId) {
    return { accountWorkspaces, workspace: null };
  }
  // Logged-out login: keep live lists if they already hold data (backend
  // restore wrote first). Otherwise restore a parked snapshot for this id.
  if (!previousAccountId && workspaceHasData(current)) {
    return { accountWorkspaces, workspace: null };
  }
  return {
    accountWorkspaces,
    workspace: applyAccountWorkspace(accountWorkspaces[nextAccountId]),
  };
};

