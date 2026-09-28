import { z } from 'zod';
const id = z.string().trim().min(1).max(160);
const membership = z.object({ categoryId: id.nullable(), subcategoryId: id.nullable(), locked: z.boolean() }).strict();
export const organizationDraftSchema = z.object({
  version: z.literal(1), revision: z.number().int().positive(),
  scope: z.object({ name: z.string().max(200), repositoryIds: z.array(z.number().int().positive()).max(10000) }).strict(),
  instruction: z.string().max(10000), configId: id, maxNewSubcategories: z.number().int().min(1).max(20), structureReady: z.boolean(),
  categories: z.array(z.object({ id, name: z.string().trim().min(1).max(120), icon: z.string().max(100), parentId: id.nullable(), isNew: z.boolean() }).strict()).max(2000),
  entries: z.array(z.object({ repositoryId: z.number().int().positive(), before: membership,
    categoryId: id.nullable(), subcategoryId: id.nullable(), reason: z.string().max(2000),
    disposition: z.enum(['move', 'unchanged', 'insufficient']), selected: z.boolean(), overrideLocked: z.boolean(), manual: z.boolean(),
    status: z.enum(['pending', 'success', 'conflict', 'restored']), error: z.string().max(2000).optional(),
  }).strict()).max(10000),
  batches: z.array(z.object({ repositoryIds: z.array(z.number().int().positive()).max(20), status: z.enum(['pending', 'complete', 'failed']), error: z.string().max(2000).optional() }).strict()).max(10000),
  status: z.enum(['generating', 'ready', 'interrupted', 'applying', 'applied', 'restoring', 'restored', 'imported']),
  createdCategoryIds: z.array(id).max(2000),
}).strict().superRefine((draft, ctx) => {
  const fail = (message: string) => ctx.addIssue({ code: 'custom', message });
  const ids = new Set(draft.scope.repositoryIds);
  if (ids.size !== draft.scope.repositoryIds.length) fail('Duplicate scope repository');
  if (new Set(draft.entries.map(e => e.repositoryId)).size !== draft.entries.length
    || draft.entries.length !== ids.size || draft.entries.some(e => !ids.has(e.repositoryId))) fail('Incomplete or duplicate assignment coverage');
  const categories = new Map(draft.categories.map(c => [c.id, c]));
  if (categories.size !== draft.categories.length) fail('Duplicate category identity');
  for (const category of draft.categories) {
    if (['all', 'pending'].includes(category.id)) fail('Reserved category identity');
    if (category.parentId && (!categories.has(category.parentId) || categories.get(category.parentId)?.parentId)) fail('Invalid category parent');
  }
  for (const entry of draft.entries) {
    if (entry.categoryId && (!categories.has(entry.categoryId) || categories.get(entry.categoryId)?.parentId)) fail('Invalid main category');
    if (entry.subcategoryId && (!categories.has(entry.subcategoryId) || categories.get(entry.subcategoryId)?.parentId !== entry.categoryId)) fail('Invalid subgroup');
    if (entry.selected && entry.disposition === 'insufficient') fail('Insufficient evidence cannot be selected');
  }
  const batchIds = draft.batches.flatMap(b => b.repositoryIds);
  if (new Set(batchIds).size !== batchIds.length || batchIds.length !== ids.size || batchIds.some(i => !ids.has(i))) fail('Incomplete batch coverage');
  if (draft.createdCategoryIds.some(i => !categories.get(i)?.isNew)) fail('Invalid created category journal');
});
