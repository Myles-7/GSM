import { FACET_GROUPS, type FacetGroup, type RepositoryFacet } from '../../../utils/classificationFacets';

export const FILTER_GROUPS = FACET_GROUPS.filter((group): group is Exclude<FacetGroup, 'confidence'> => group !== 'confidence');
export type FilterGroup = typeof FILTER_GROUPS[number];
export interface FilterPosition { x: number; y: number }
export interface FilterPreferences {
  position: FilterPosition | null;
  groups: FilterGroup[];
  hidden: FilterGroup[];
  favorites: RepositoryFacet[];
}
export const defaultFilterPreferences = (): FilterPreferences => ({ position: null, groups: [...FILTER_GROUPS], hidden: [], favorites: [] });
export const filterPreferencesKey = (account: string) => `gsm:facet-window:v1:${encodeURIComponent(account)}`;
export function parseFilterPreferences(raw: string | null): FilterPreferences {
  const defaults = defaultFilterPreferences();
  try {
    const row: unknown = JSON.parse(raw ?? 'null');
    if (!row || typeof row !== 'object') return defaults;
    const value = row as Record<string, unknown>;
    const groups = Array.isArray(value.groups) ? value.groups.filter((group): group is FilterGroup => FILTER_GROUPS.includes(group as FilterGroup)) : [];
    const hidden = Array.isArray(value.hidden) ? value.hidden.filter((group): group is FilterGroup => FILTER_GROUPS.includes(group as FilterGroup)) : [];
    const favorites: RepositoryFacet[] = [];
    if (Array.isArray(value.favorites)) for (const candidate of value.favorites.slice(0, 300)) {
      if (!candidate || typeof candidate !== 'object') continue;
      const item = candidate as RepositoryFacet;
      if (FILTER_GROUPS.includes(item.group as FilterGroup) && typeof item.id === 'string' && item.id.startsWith(`${item.group}:`) && item.id.length <= 150 && typeof item.label === 'string' && item.label.trim() && item.label.length <= 55 && !favorites.some(saved => saved.id === item.id)) favorites.push({ id: item.id, group: item.group, label: item.label });
    }
    const position = value.position as FilterPosition | undefined;
    return { position: position && Number.isFinite(position.x) && Number.isFinite(position.y) ? { x: position.x, y: position.y } : null, groups: [...new Set([...groups, ...FILTER_GROUPS])], hidden: [...new Set(hidden)], favorites };
  } catch { return defaults; }
}
export function readFilterPreferences(account: string): FilterPreferences {
  try { return parseFilterPreferences(localStorage.getItem(filterPreferencesKey(account))); } catch { return defaultFilterPreferences(); }
}
export function saveFilterPreferences(account: string, preferences: FilterPreferences) {
  try { localStorage.setItem(filterPreferencesKey(account), JSON.stringify(preferences)); } catch { /* Storage can be unavailable or full; filtering remains usable. */ }
}
export function clampFilterPosition(position: FilterPosition, viewport: { width: number; height: number }, size: { width: number; height: number }): FilterPosition {
  const margin = 12;
  return { x: Math.max(margin, Math.min(position.x, Math.max(margin, viewport.width - size.width - margin))), y: Math.max(margin, Math.min(position.y, Math.max(margin, viewport.height - size.height - margin))) };
}
