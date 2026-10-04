
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { createInitialState } from './initialState';
import { appPersistenceOptions } from './persistence/options';
import { createAuthSlice } from './slices/authSlice';
import { createCategorySlice } from './slices/categorySlice';
import { createConfigurationSlice } from './slices/configurationSlice';
import { createDiscoverySlice } from './slices/discoverySlice';
import { createGistSlice } from './slices/gistSlice';
import { createPreferenceSlice } from './slices/preferenceSlice';
import { createRepositorySlice } from './slices/repositorySlice';
import { createTimelineSlice } from './slices/timelineSlice';
import type { AppStoreState } from './types';
import { assertRepositoryIdentityWritable, assertRepositoryMaintenanceOwner } from '../services/repositoryIdentityGate';

export { getAllCategories, sortCategoriesByOrder } from './helpers/categoryHelpers';
export { normalizePersistedState } from './normalizers/persistedState';
export {
  defaultCategories,
  defaultMcpConfig,
  isKnownEmbeddingFormatVersion,
  LEGACY_EMBEDDING_FORMAT_VERSION,
} from './schema';

/**
 * The application has exactly one Zustand Store and one persistence shell.
 * Domain slices only contribute state actions; hydration and persistence remain
 * centralized here through appPersistenceOptions.
 */
export const useAppStore = create<AppStoreState>()(
  persist(
    (set, get) => {
      const guardedSet: typeof set = (...args) => { assertRepositoryIdentityWritable(); return set(...args); };
      return ({
      ...createInitialState(),
      ...createAuthSlice(guardedSet, get),
      ...createRepositorySlice(guardedSet, get),
      ...createGistSlice(guardedSet, get),
      ...createConfigurationSlice(guardedSet, get),
      ...createTimelineSlice(guardedSet, get),
      ...createCategorySlice(guardedSet, get),
      ...createPreferenceSlice(guardedSet, get),
      ...createDiscoverySlice(guardedSet, get),
      setHasHydrated: hasHydrated => set({ hasHydrated }),
    }); },
    appPersistenceOptions,
  ),
);
const identityInternalSetState = useAppStore.setState;
useAppStore.setState = (...args) => {
  assertRepositoryIdentityWritable();
  return identityInternalSetState(...args);
};
/** Restricted synchronous checkpoint path; never an async global writer bypass. */
export const setIdentityMigrationStoreState = (patch: Partial<AppStoreState>) => identityInternalSetState(patch);
/** Backup checkpoints cannot bypass another maintenance operation or switch accounts. */
export function setLocalBackupRestoreStoreState(account: string, journalId: string, patch: Partial<AppStoreState>): void {
  assertRepositoryMaintenanceOwner(account, journalId);
  if ((useAppStore.getState().user?.id?.toString() ?? 'global') !== account || !journalId.startsWith('local-backup:')) throw new Error('BACKUP_ACCOUNT_CHANGED');
  identityInternalSetState(patch);
}
