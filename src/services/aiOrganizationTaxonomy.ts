import { z } from 'zod';
import type { OrganizationCategory } from '../types/aiOrganization';
import type { ClassificationSchemeId } from '../types/classification';
import type { OrganizationSchemeDraft } from '../types/aiOrganization';
import { parseOrganizationJSON } from './aiOrganizationService';

const category = z.object({ ref: z.string().trim().min(1).max(160), name: z.string().trim().min(1).max(120), parentRef: z.string().nullable() }).strict();
export function parseOrganizationTaxonomy(raw: string, scheme: OrganizationSchemeDraft, maxChildren: number): OrganizationCategory[] {
  const parsed = z.object({ categories: z.array(category).min(1).max(500) }).strict().parse(parseOrganizationJSON(raw));
  const refs = new Map<string, string>(); const result: OrganizationCategory[] = []; const names = new Set<string>();
  for (const row of [...parsed.categories.filter(c => c.parentRef === null), ...parsed.categories.filter(c => c.parentRef !== null)]) {
    if (refs.has(row.ref) || ['all', 'pending'].includes(row.ref)) throw new Error('Duplicate category ref');
    const parentId = row.parentRef === null ? null : refs.get(row.parentRef);
    if (row.parentRef !== null && (!parentId || !result.some(c => c.id === parentId && !c.parentId))) throw new Error('Invalid category parent');
    const key = `${parentId}:${row.name.toLocaleLowerCase()}`; if (names.has(key)) throw new Error('Duplicate category name'); names.add(key);
    const existing = scheme.categories.find(c => c.name === row.name && c.parentId === parentId);
    if (scheme.categories.some(c => c.id === row.ref) && existing?.id !== row.ref) throw new Error('Existing category ID cannot be renamed implicitly');
    const id = existing?.id ?? crypto.randomUUID(); refs.set(row.ref, id);
    if (parentId && result.filter(c => c.parentId === parentId && c.isNew).length >= maxChildren) throw new Error('Too many subcategories');
    result.push({ id, name: row.name, parentId: parentId ?? null, icon: existing?.icon ?? '\u{1F4C1}', isNew: existing?.isNew ?? true });
  }
  return result;
}
export const ORGANIZATION_SCHEMES: ClassificationSchemeId[] = ['purpose', 'technology'];
