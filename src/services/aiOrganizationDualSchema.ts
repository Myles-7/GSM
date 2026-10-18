import { z } from 'zod';
const id = z.string().trim().min(1).max(160);
export const organizationCategorySchema = z.object({ id, name: z.string().trim().min(1).max(120), icon: z.string().max(100), parentId: id.nullable(), isNew: z.boolean() }).strict();
const member = z.object({ categoryId: id.nullable(), subcategoryId: id.nullable(), locked: z.boolean() }).strict();
export const organizationEntrySchema = z.object({ repositoryId: z.number().int().positive(), before: member,
  verification: z.enum(['pending', 'verified', 'failed']).optional(), verificationHash: z.string().max(100).optional(),
  categoryId: id.nullable(), subcategoryId: id.nullable(), reason: z.string().max(2000), disposition: z.enum(['move', 'unchanged', 'insufficient']),
  selected: z.boolean(), overrideLocked: z.boolean(), manual: z.boolean(), preserveMain: z.boolean().optional(),
  status: z.enum(['pending', 'success', 'conflict', 'restored']), error: z.string().max(2000).optional(),
}).strict();
const snapshot = z.object({ customCategories: z.array(z.object({ id, name: z.string(), icon: z.string(), keywords: z.array(z.string()) }).passthrough()),
  defaultCategoryOverrides: z.record(z.string(), z.object({}).passthrough()), hiddenDefaultCategoryIds: z.array(id), categoryOrder: z.array(z.string()),
  subcategories: z.array(z.object({ id, parentId: id, name: z.string(), icon: z.string() }).strict()), subcategoryOrder: z.array(id), repositoryOrder: z.array(z.number().int().positive()), categoryListIdMap: z.record(z.string(), z.string()),
}).strict();
export const organizationUnderstandingSchema = z.object({
  deferred: z.boolean().optional(),
  repositoryId: z.number().int().positive(), fingerprint: z.string().max(50000),
  sourceMetadata: z.object({ name: z.string(), description: z.string(), summary: z.string(), tags: z.array(z.string()), language: z.string(), details: z.string() }).strict(),
  status: z.enum(['pending', 'understood', 'insufficient', 'read-failed', 'failed']), purpose: z.array(z.string().max(2000)).max(12), technology: z.array(z.string().max(2000)).max(12),
  sources: z.array(z.object({ kind: z.enum(['metadata', 'readme', 'analysis', 'document']), url: z.string().url(), retrievedAt: z.string() }).strict()).max(10), error: z.string().max(2000).optional(),
  depth: z.enum(['quick', 'deep']).optional(), understoodAt: z.iso.datetime().optional(), analysisGeneratedAt: z.string().optional(),
  staleAnalysis: z.boolean().optional(), reused: z.boolean().optional(), activity: z.enum(['reading', 'queued', 'understanding']).optional(),
}).strict();
const integratedOperation = z.object({ id, kind: z.enum(['create', 'rename', 'merge']), targetId: id, sourceIds: z.array(id).max(100), parentId: id.nullable(),
  redesigned: z.boolean().optional(),
  name: z.string().trim().min(1).max(120), icon: z.string().max(100), selected: z.boolean(), status: z.enum(['pending', 'success', 'conflict', 'restored']), error: z.string().max(2000).optional(),
  categoriesBefore: z.array(organizationCategorySchema).max(2000), entriesBefore: z.array(organizationEntrySchema).max(10000),
  members: z.array(z.object({ repositoryId: z.number().int().positive(), before: member }).strict()).max(10000),
}).strict();
const scheme = z.object({ selected: z.boolean(), categories: z.array(organizationCategorySchema).max(2000), entries: z.array(organizationEntrySchema).max(10000), before: snapshot,
  structureOperations: z.array(integratedOperation).max(100).optional(),
  createdCategoryIds: z.array(id), ready: z.boolean(), after: snapshot.optional(),
  proposedCategoryIds: z.array(id).optional(), retireCategoryIds: z.array(id).optional(),
  cleanupReplaced: z.boolean().optional(),
  scopeIsFullLibrary: z.boolean().optional(),
  members: z.array(z.object({ repositoryId: z.number().int().positive(), before: member }).strict()).optional(),
  application: z.object({ status: z.enum(['prepared', 'applied', 'restoring', 'restored']), repositoryIds: z.array(z.number().int().positive()), operationIds: z.array(id).optional(), before: snapshot, after: snapshot, createdCategoryIds: z.array(id), membersAfter: z.array(z.object({ repositoryId: z.number().int().positive(), before: member }).strict()) }).strict().optional(),
}).strict();
export const dualOrganizationSchema = z.object({
  execution: z.object({ version: z.literal(2), runId: z.string().max(100), configIdentity: z.string().max(2000), scopeHash: z.string().max(100), promptVersion: z.string().max(100) }).strict().optional(),
  verificationIds: z.array(z.number().int().positive()).max(10000).optional(),
  progress: z.object({ startedAt: z.number(), concurrency: z.number().int().min(1).max(10), effectiveConcurrency: z.number().int().min(0).max(10),
    summaryLevel: z.number().int().nonnegative().optional(), summaryCompleted: z.number().int().nonnegative().optional(), summaryTotal: z.number().int().nonnegative().optional(),
    summaryFallback: z.number().int().nonnegative().optional(),
    running: z.number().int().nonnegative(), queued: z.number().int().nonnegative(), reading: z.number().int().nonnegative(), requests: z.number().int().nonnegative(),
    completedRequests: z.number().int().nonnegative(), reused: z.number().int().nonnegative(), readMs: z.number().nonnegative(), queueMs: z.number().nonnegative(),
    modelMs: z.number().nonnegative(), parseMs: z.number().nonnegative(), saveMs: z.number().nonnegative(), successfulBatches: z.number().int().nonnegative(), batchMs: z.number().nonnegative(),
  }).strict().optional(),
  phase: z.enum(['understanding', 'structure', 'assignments', 'review']), outcome: z.enum(['complete', 'partial', 'empty', 'unchanged']).optional(),
  understanding: z.array(organizationUnderstandingSchema).max(10000), summaries: z.array(z.object({ repositoryIds: z.array(z.number().int().positive()), purpose: z.string().max(6000), technology: z.string().max(6000), inputHash: z.string().regex(/^[a-f0-9]{64}$/).optional(), level: z.number().int().nonnegative().optional(), index: z.number().int().nonnegative().optional() }).strict()).max(10000),
  schemes: z.object({ purpose: scheme, technology: scheme }).strict(), requests: z.record(z.string(), z.number().int().min(0).max(100000)),
  errors: z.array(z.object({ stage: z.string(), repositoryIds: z.array(z.number().int().positive()), message: z.string().max(2000) }).strict()).max(10000),
  blocked: z.object({ code: z.string().max(120), message: z.string().max(2000), phase: z.enum(['understanding', 'structure', 'assignments', 'review']) }).strict().optional(),
}).strict();
export function validateDualCoverage(draft: { scope: { repositoryIds: number[] }; dual?: z.infer<typeof dualOrganizationSchema> }, issue: (message: string) => void) {
  if (!draft.dual) { issue('Version 3 requires dual classification checkpoints'); return; }
  const ids = new Set(draft.scope.repositoryIds);
  const covers = (values: number[]) => values.length === ids.size && new Set(values).size === ids.size && values.every(id => ids.has(id));
  if (!covers(draft.dual.understanding.map(row => row.repositoryId))) issue('Incomplete understanding coverage');
  if (draft.dual.verificationIds && (new Set(draft.dual.verificationIds).size !== draft.dual.verificationIds.length || draft.dual.verificationIds.some(id => !ids.has(id)))) issue('Invalid local verification scope');
  for (const scheme of Object.values(draft.dual.schemes)) {
    if (!covers(scheme.entries.map(row => row.repositoryId))) issue('Incomplete scheme assignment coverage');
    const categories = new Map(scheme.categories.map(row => [row.id, row]));
    if (categories.size !== scheme.categories.length) issue('Duplicate scheme category ID');
    for (const list of [scheme.proposedCategoryIds, scheme.retireCategoryIds]) if (list && (new Set(list).size !== list.length || list.some(id => !categories.has(id)))) issue('Invalid structure selection');
    const names = new Set<string>();
    const merging = new Set(scheme.structureOperations?.filter(op => op.kind === 'merge' && ['pending', 'conflict'].includes(op.status)).map(op => op.targetId) ?? []);
    for (const category of categories.values()) {
      const name = `${category.parentId}:${category.name.trim().toLocaleLowerCase()}`;
      if (names.has(name) && (!category.parentId || !merging.has(category.parentId)) || ['all', 'pending'].includes(category.id)) issue('Duplicate or reserved category');
      names.add(name);
      if (category.parentId && (!categories.has(category.parentId) || categories.get(category.parentId)?.parentId)) issue('Invalid scheme category parent');
    }
    for (const row of scheme.entries) {
      if (row.categoryId && (!categories.has(row.categoryId) || categories.get(row.categoryId)?.parentId)) issue('Invalid scheme main target');
      if (row.subcategoryId && categories.get(row.subcategoryId)?.parentId !== row.categoryId) issue('Invalid scheme subgroup target');
      if (row.disposition === 'insufficient' && row.selected) issue('Insufficient item cannot be selected');
    }
    const operationIds = new Set<string>(); const mergeIds = new Set<string>();
    for (const op of scheme.structureOperations ?? []) {
      if (operationIds.has(op.id) || !categories.has(op.targetId)) issue('Invalid integrated operation identity');
      operationIds.add(op.id);
      if (new Set(op.sourceIds).size !== op.sourceIds.length || new Set(op.members.map(m => m.repositoryId)).size !== op.members.length) issue('Duplicate integrated operation scope');
      if (op.kind !== 'merge' && op.sourceIds.length) issue('Unexpected integrated sources');
      if (op.kind === 'merge' && ['pending', 'conflict'].includes(op.status)) {
        if (!op.sourceIds.length || op.sourceIds.includes(op.targetId)) issue('Invalid integrated merge');
        for (const key of [op.targetId, ...op.sourceIds]) {
          if (mergeIds.has(key) || !categories.has(key) || (categories.get(key)?.parentId ?? null) !== op.parentId) issue('Dependent integrated merges');
          mergeIds.add(key);
        }
        if (op.members.some(m => !ids.has(m.repositoryId))) issue('Incomplete integrated merge coverage');
      }
    }
  }
}
