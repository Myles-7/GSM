import type { AppStoreState } from '../types';
import type { OrganizationStructureSnapshot } from '../../types/aiOrganization';
import { normalizeOrder } from './repositoryOrganization';

export function structureSnapshot(state: AppStoreState): OrganizationStructureSnapshot {
  return JSON.parse(JSON.stringify({ customCategories: state.customCategories, defaultCategoryOverrides: state.defaultCategoryOverrides,
    hiddenDefaultCategoryIds: state.hiddenDefaultCategoryIds.filter(id => id !== 'all' && id !== 'pending'), categoryOrder: state.categoryOrder.filter(id => id !== 'all' && id !== 'pending'),
    subcategories: state.subcategories, subcategoryOrder: state.subcategoryOrder, repositoryOrder: normalizeOrder(state.repositoryOrder, state.repositories.map(r => r.id)), categoryListIdMap: state.categoryListIdMap }));
}
export function stableStructure(value: unknown): string {
  const ordered = (v: unknown): unknown => Array.isArray(v) ? v.map(ordered) : v && typeof v === 'object'
    ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, item]) => [k, ordered(item)])) : v;
  return JSON.stringify(ordered(value));
}
export function affectedStructure(snapshot: OrganizationStructureSnapshot, ids: string[]): string {
  const set = new Set(ids);
  return stableStructure({ customCategories: snapshot.customCategories.filter(c => set.has(c.id)),
    overrides: Object.fromEntries(Object.entries(snapshot.defaultCategoryOverrides).filter(([id]) => set.has(id))),
    hidden: snapshot.hiddenDefaultCategoryIds.filter(id => set.has(id)),
    subcategories: snapshot.subcategories.filter(c => set.has(c.parentId)),
    lists: Object.fromEntries(Object.entries(snapshot.categoryListIdMap).filter(([id]) => set.has(id))) });
}
