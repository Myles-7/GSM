import { z } from 'zod';
const id = z.string().trim().min(1).max(160).refine(value => !['all', 'pending'].includes(value));
export const classificationMembershipSchema = z.object({ categoryId: id.nullable(), subcategoryId: id.nullable(), locked: z.boolean() }).strict().refine(member => member.categoryId !== null || member.subcategoryId === null, 'Subcategory requires a main category');
const category = z.object({ id, name: z.string().trim().min(1).max(120), icon: z.string().max(100), keywords: z.array(z.string()).max(500), isCustom: z.boolean().optional(), isHidden: z.boolean().optional(), mergedInto: id.optional() }).passthrough();
export const classificationSchemeSchema = z.object({
  initialized: z.boolean(), customCategories: z.array(category).max(2000),
  defaultCategoryOverrides: z.record(z.string(), z.object({ name: z.string().optional(), icon: z.string().optional(), keywords: z.array(z.string()).optional(), mergedInto: id.optional() }).passthrough()),
  hiddenDefaultCategoryIds: z.array(id), categoryOrder: z.array(z.string()),
  subcategories: z.array(z.object({ id, parentId: id, name: z.string().trim().min(1).max(120), icon: z.string().max(100) }).strict()).max(2000),
  subcategoryOrder: z.array(id), repositoryOrder: z.array(z.number().int().positive().safe()), categoryListIdMap: z.record(z.string(), z.string()),
}).strict().superRefine((scheme, ctx) => {
  for (const rows of [scheme.customCategories, scheme.subcategories]) if (new Set(rows.map(row => row.id)).size !== rows.length) ctx.addIssue({ code: 'custom', message: 'Duplicate classification identity' });
  const ids = [...scheme.customCategories, ...scheme.subcategories].map(row => row.id);
  if (new Set(ids).size !== ids.length) ctx.addIssue({ code: 'custom', message: 'Main and subgroup IDs collide' });
  for (const order of [scheme.categoryOrder, scheme.subcategoryOrder, scheme.repositoryOrder]) if (new Set<string | number>(order).size !== order.length) ctx.addIssue({ code: 'custom', message: 'Duplicate classification order' });
});
export const classificationSchemesSchema = z.object({ purpose: classificationSchemeSchema.optional(), technology: classificationSchemeSchema.optional() }).strict().superRefine((schemes, ctx) => {
  const tech = schemes.technology;
  if (!tech) return;
  const parents = new Set(tech.customCategories.map(category => category.id));
  if (tech.subcategories.some(group => !parents.has(group.parentId))) ctx.addIssue({ code: 'custom', message: 'Invalid technology category parent' });
  if (Object.keys(tech.defaultCategoryOverrides).length || tech.hiddenDefaultCategoryIds.length || Object.keys(tech.categoryListIdMap).length) ctx.addIssue({ code: 'custom', message: 'Technology cannot reference builtin categories or GitHub Lists' });
});
