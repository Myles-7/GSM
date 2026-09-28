import type Database from 'better-sqlite3';

export function repositoryOrganizationDto(row: Record<string, unknown>): Record<string, unknown> {
  const parse = (value: unknown): unknown => {
    if (typeof value !== 'string') return undefined;
    try { return JSON.parse(value); } catch { return undefined; }
  };
  return {
    category_id: row.category_id_defined ? row.category_id ?? null : undefined,
    subcategory_id: row.category_id_defined ? row.subcategory_id ?? null : undefined,
    category_candidates: parse(row.category_candidates),
    category_legacy: parse(row.category_legacy),
    ai_details: parse(row.ai_details),
  };
}

/** Also used after legacy INSERT OR REPLACE, with the previous row captured first. */
export function writeRepositoryOrganization(
  db: Database.Database,
  input: Record<string, unknown>,
  previous: Record<string, unknown> = {},
): void {
  const provided = input.category_id !== undefined && input.category_id_defined !== 0;
  const categoryId = provided ? input.category_id : previous.category_id;
  const categoryChanged = provided && categoryId !== previous.category_id;
  const json = (key: string): unknown => {
    if (input[key] === undefined) return previous[key] ?? null;
    return typeof input[key] === 'string' ? input[key] : JSON.stringify(input[key]);
  };
  db.prepare(`UPDATE repositories SET category_id = ?, category_id_defined = ?,
    subcategory_id = ?, category_candidates = ?, category_legacy = ?, ai_details = ? WHERE id = ?`).run(
    typeof categoryId === 'string' ? categoryId : null,
    provided ? 1 : previous.category_id_defined ? 1 : 0,
    categoryId === null ? null : input.subcategory_id !== undefined && input.category_id_defined !== 0 ? input.subcategory_id
      : categoryChanged ? null : previous.subcategory_id ?? null,
    json('category_candidates'), json('category_legacy'), json('ai_details'), input.id,
  );
  if (previous.id && input.category_locked === undefined) {
    db.prepare('UPDATE repositories SET category_locked = ? WHERE id = ?').run(previous.category_locked ?? 0, input.id);
  }
  if (previous.id && input.custom_category === undefined) {
    db.prepare('UPDATE repositories SET custom_category = ? WHERE id = ?').run(previous.custom_category ?? null, input.id);
  }
}
