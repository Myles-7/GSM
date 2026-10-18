import type Database from 'better-sqlite3';

export class ClassificationCompatibilityError extends Error {
  readonly status = 409;
  readonly code = 'CLASSIFICATION_UPGRADE_REQUIRED';
  constructor() { super('Classification data has been upgraded. Update the client before editing categories.'); }
}
export const CLASSIFICATION_FIELDS = ['category_id', 'subcategory_id', 'category_locked', 'custom_category', 'customCategories', 'defaultCategoryOverrides', 'subcategories', 'categoryOrder', 'subcategoryOrder', 'repositoryOrder', 'hiddenDefaultCategoryIds', 'categoryListIdMap'];
export function parseClassificationJson(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return value; }
}
export function classificationWasUpgraded(db: Database.Database): boolean {
  const row = db.prepare("SELECT value FROM settings WHERE key='classificationSchemes'").get() as { value: unknown } | undefined;
  const parsed = parseClassificationJson(row?.value);
  return !!parsed && typeof parsed === 'object' && Object.keys(parsed).length > 0;
}
/** A partial scheme upload replaces that scheme, not the other independent tree. */
export function mergeStoredClassificationSchemes(db: Database.Database, value: unknown): Record<string, unknown> {
  const row = db.prepare("SELECT value FROM settings WHERE key='classificationSchemes'").get() as { value: unknown } | undefined;
  const previous = parseClassificationJson(row?.value);
  const incoming = parseClassificationJson(value);
  return { ...(previous && typeof previous === 'object' ? previous : {}), ...(incoming && typeof incoming === 'object' ? incoming : {}) };
}
export function assertLegacyClassificationWrite(input: Record<string, unknown>, previous: Record<string, unknown>, upgraded: boolean, compatible = false) {
  if (compatible || !upgraded || input.classifications || input.classificationSchemes) return;
  const comparable = (key: string, value: unknown) => key === 'category_locked' ? !!value : parseClassificationJson(value) ?? null;
  if (CLASSIFICATION_FIELDS.some(key => key in input && JSON.stringify(comparable(key, input[key])) !== JSON.stringify(comparable(key, previous[key])))) throw new ClassificationCompatibilityError();
}
