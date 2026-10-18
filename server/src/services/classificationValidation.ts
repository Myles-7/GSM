import { z } from 'zod';
import type Database from 'better-sqlite3';
const id = z.string().trim().min(1).max(160).refine(value => !['all', 'pending'].includes(value));
const member = z.object({ categoryId: id.nullable(), subcategoryId: id.nullable(), locked: z.boolean() }).strict()
  .refine(row => row.categoryId !== null || row.subcategoryId === null);
export const repositoryClassificationsSchema = z.object({ purpose: member.optional(), technology: member.optional() }).strict();
const category = z.object({ id, name: z.string().trim().min(1).max(120), icon: z.string().max(100), keywords: z.array(z.string()).max(500),
  isCustom: z.boolean().optional(), isHidden: z.boolean().optional(), mergedInto: id.optional(), retired: z.boolean().optional(), retirementTargets: z.array(id).optional() }).passthrough();
const scheme = z.object({ initialized: z.boolean(), customCategories: z.array(category).max(2000),
  defaultCategoryOverrides: z.record(z.string(), z.object({ name: z.string().optional(), icon: z.string().optional(), keywords: z.array(z.string()).optional(), mergedInto: id.optional(), retired: z.boolean().optional(), retirementTargets: z.array(id).optional() }).passthrough()),
  hiddenDefaultCategoryIds: z.array(id), categoryOrder: z.array(z.string()),
  subcategories: z.array(z.object({ id, parentId: id, name: z.string().trim().min(1).max(120), icon: z.string().max(100) }).strict()).max(2000),
  subcategoryOrder: z.array(id), repositoryOrder: z.array(z.number().int().positive().safe()), categoryListIdMap: z.record(z.string(), z.string()),
}).strict().superRefine((value, ctx) => {
  const identities = [...value.customCategories, ...value.subcategories].map(row => row.id);
  if (new Set(identities).size !== identities.length) ctx.addIssue({ code: 'custom', message: 'Duplicate classification ID' });
  for (const order of [value.categoryOrder, value.subcategoryOrder, value.repositoryOrder]) if (new Set<string | number>(order).size !== order.length) ctx.addIssue({ code: 'custom', message: 'Duplicate order' });
});
export const classificationSchemesSchema = z.object({ purpose: scheme.optional(), technology: scheme.optional() }).strict().superRefine((value, ctx) => {
  const tech = value.technology;
  if (!tech) return;
  const ids = new Set(tech.customCategories.map(row => row.id));
  if (tech.subcategories.some(row => !ids.has(row.parentId)) || tech.hiddenDefaultCategoryIds.length || Object.keys(tech.defaultCategoryOverrides).length || Object.keys(tech.categoryListIdMap).length) ctx.addIssue({ code: 'custom', message: 'Invalid technology parent or builtin/List reference' });
});

/** A structurally valid technology membership must also point at the final taxonomy. */
export class ClassificationReferenceError extends Error {
  readonly status = 400;
  readonly code = 'INVALID_CLASSIFICATION_REFERENCE';
  constructor(message = 'Technology membership references a missing category or subcategory') { super(message); }
}

function parseJson(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return value; }
}

/**
 * Validate references against one complete, effective organization snapshot.
 * The caller is responsible for merging same-batch repository and organization
 * updates before calling this helper.
 */
export function assertTechnologyMembershipReferences(
  schemes: unknown,
  repositories: readonly Record<string, unknown>[],
): void {
  // An absent taxonomy has no valid technology targets. Bootstrap validates
  // after the entire snapshot is applied in its transaction, never per chunk.
  const parsed = classificationSchemesSchema.safeParse(schemes == null ? {} : parseJson(schemes));
  if (!parsed.success) throw new ClassificationReferenceError('Invalid classification schemes');
  const technology = parsed.data.technology;
  const categories = new Set(technology?.customCategories.map(category => category.id) ?? []);
  const subcategories = new Map(technology?.subcategories.map(subcategory => [subcategory.id, subcategory.parentId]) ?? []);
  for (const repository of repositories) {
    const raw = parseJson(repository.classifications);
    if (raw == null) continue;
    const classifications = repositoryClassificationsSchema.safeParse(raw);
    if (!classifications.success) throw new ClassificationReferenceError('Invalid repository classifications');
    const member = classifications.data.technology;
    if (!member) continue;
    const { categoryId, subcategoryId } = member;
    if (categoryId !== null && categoryId !== undefined && (typeof categoryId !== 'string' || !categories.has(categoryId))) {
      throw new ClassificationReferenceError();
    }
    if (subcategoryId !== null && subcategoryId !== undefined
      && (typeof subcategoryId !== 'string' || subcategories.get(subcategoryId) !== categoryId)) {
      throw new ClassificationReferenceError();
    }
  }
}

/** Call inside the writer transaction, after all repository/taxonomy changes. */
export function assertStoredTechnologyMembershipReferences(db: Database.Database): void {
  const schemes = db.prepare("SELECT value FROM settings WHERE key='classificationSchemes'").get() as { value: unknown } | undefined;
  const repositories = db.prepare('SELECT classifications FROM repositories').all() as Record<string, unknown>[];
  assertTechnologyMembershipReferences(schemes?.value, repositories);
}
