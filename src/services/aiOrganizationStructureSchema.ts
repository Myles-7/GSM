import { z } from 'zod';
const id = z.string().trim().min(1).max(160);
const category = z.object({ id, name: z.string().trim().min(1).max(120), icon: z.string().max(100), keywords: z.array(z.string()).max(1000),
  isCustom: z.boolean().optional(), isHidden: z.boolean().optional(), mergedInto: id.optional() }).strict();
export const structureSnapshotSchema = z.object({
  customCategories: z.array(category).max(2000), defaultCategoryOverrides: z.record(id, category.partial()),
  hiddenDefaultCategoryIds: z.array(id), categoryOrder: z.array(id),
  subcategories: z.array(z.object({ id, parentId: id, name: z.string().trim().min(1).max(120), icon: z.string().max(100) }).strict()).max(2000),
  subcategoryOrder: z.array(id), repositoryOrder: z.array(z.number().int().positive()), categoryListIdMap: z.record(id, z.string()),
}).strict();
export const structureOperationsSchema = z.array(z.object({
  id, kind: z.enum(['create', 'rename', 'merge']), sourceIds: z.array(id).max(100), targetId: id,
  name: z.string().trim().min(1).max(120), icon: z.string().max(100), keywords: z.array(z.string()).max(1000), reason: z.string().max(2000),
  selected: z.boolean(), status: z.enum(['pending', 'success', 'conflict', 'restored']), manual: z.boolean().optional(), error: z.string().max(2000).optional(),
  members: z.array(z.object({ repositoryId: z.number().int().positive(), before: z.object({ categoryId: id.nullable(), subcategoryId: id.nullable(), locked: z.boolean() }).strict() }).strict()).max(10000),
  before: structureSnapshotSchema, after: structureSnapshotSchema.optional(),
}).strict()).max(20);
