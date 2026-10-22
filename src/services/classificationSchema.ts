import { z } from 'zod';
const id = z.string().trim().min(1).max(160).refine(value => !['all', 'pending'].includes(value));
export const classificationMembershipSchema = z.object({ categoryId: id.nullable(), subcategoryId: id.nullable(), locked: z.boolean() }).strict().refine(member => member.categoryId !== null || member.subcategoryId === null, 'Subcategory requires a main category');
const category = z.object({ id, name: z.string().trim().min(1).max(120), icon: z.string().max(100), keywords: z.array(z.string()).max(500), isCustom: z.boolean().optional(), isHidden: z.boolean().optional(), mergedInto: id.optional() }).passthrough();
export const classificationSchemeSchema = z.object({
  initialized: z.boolean(), customCategories: z.array(category).max(2000),
  defaultCategoryOverrides: z.record(z.string(), z.object({ name: z.string().optional(), icon: z.string().optional(), keywords: z.array(z.string()).optional(), mergedInto: id.optional() }).passthrough()),
  hiddenDefaultCategoryIds: z.array(z.string()).transform(ids => ids.filter(id => id !== 'all' && id !== 'pending')), categoryOrder: z.array(z.string()).transform(ids => ids.filter(id => id !== 'all' && id !== 'pending')),
  subcategories: z.array(z.object({ id, parentId: id, name: z.string().trim().min(1).max(120), icon: z.string().max(100) }).strict()).max(2000),
  subcategoryOrder: z.array(id), repositoryOrder: z.array(z.number().int().positive().safe()), categoryListIdMap: z.record(z.string(), z.string()),
}).strict().superRefine((scheme, ctx) => {
  for (const rows of [scheme.customCategories, scheme.subcategories]) if (new Set(rows.map(row => row.id)).size !== rows.length) ctx.addIssue({ code: 'custom', message: 'Duplicate classification identity' });
  const ids = [...scheme.customCategories, ...scheme.subcategories].map(row => row.id);
  if (new Set(ids).size !== ids.length) ctx.addIssue({ code: 'custom', message: 'Main and subgroup IDs collide' });
  for (const order of [scheme.categoryOrder, scheme.subcategoryOrder, scheme.repositoryOrder]) if (new Set<string | number>(order).size !== order.length) ctx.addIssue({ code: 'custom', message: 'Duplicate classification order' });
});
const generation = z.object({
  status: z.enum(['idle', 'stale', 'running', 'ready', 'failed']),
  generation: z.number().int().nonnegative(),
  queuedRepositoryIds: z.array(z.number().int().positive()).max(10000),
  repositoryIds: z.array(z.number().int().positive().safe()).max(10000).optional(),
  lastGeneratedAt: z.string().optional(),
  sourceFingerprint: z.string().optional(),
  error: z.string().max(240).optional(),
  syncPending: z.boolean().optional(),
  algorithmVersion: z.string().max(120).optional(),
  lastChange: z.object({ purpose: z.object({ beforeGroups: z.number().int().nonnegative(), afterGroups: z.number().int().nonnegative(), beforeOversized: z.number().int().nonnegative(), afterOversized: z.number().int().nonnegative(), changedMemberships: z.number().int().nonnegative() }).strict().optional(),
    technology: z.object({ beforeGroups: z.number().int().nonnegative(), afterGroups: z.number().int().nonnegative(), beforeOversized: z.number().int().nonnegative(), afterOversized: z.number().int().nonnegative(), changedMemberships: z.number().int().nonnegative() }).strict().optional(),
  }).strict().optional(),
}).strict();
export const classificationSchemesSchema = z.object({ purpose: classificationSchemeSchema.optional(), technology: classificationSchemeSchema.optional(), generation: generation.optional() }).strict().superRefine((schemes, ctx) => {
  const tech = schemes.technology;
  if (!tech) return;
  const parents = new Set(tech.customCategories.map(category => category.id));
  if (tech.subcategories.some(group => !parents.has(group.parentId))) ctx.addIssue({ code: 'custom', message: 'Invalid technology category parent' });
  if (Object.keys(tech.defaultCategoryOverrides).length || tech.hiddenDefaultCategoryIds.length || Object.keys(tech.categoryListIdMap).length) ctx.addIssue({ code: 'custom', message: 'Technology cannot reference builtin categories or GitHub Lists' });
});

/** Stored classifier evidence is shared across transports; generation state stays local. */
const classificationInsightSchema = z.object({
  confidence: z.enum(['high', 'medium', 'low']),
  evidence: z.array(z.string().max(2000)).max(100),
  facets: z.array(z.object({ id: z.string().min(1).max(160), label: z.string().min(1).max(200),
    score: z.number().finite().nonnegative(), evidence: z.array(z.string().max(2000)).max(100),
    group: z.enum(['technology', 'platform', 'scenario']).optional(),
  }).strict()).max(100),
  categoryId: id.optional(), subcategoryId: id.optional(), refinementReason: z.string().max(2000).optional(),
}).strict();
export const repositoryClassificationInsightsSchema = z.object({ purpose: classificationInsightSchema.optional(), technology: classificationInsightSchema.optional() }).strict();
