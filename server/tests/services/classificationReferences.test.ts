import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { initializeSchema } from '../../src/db/schema.js';
import { assertTechnologyMembershipReferences } from '../../src/services/classificationValidation.js';
import { bootstrapWorkspace, getRecord, getWorkspace, initializeSyncV2, pushOperations, type Collection, type Operation } from '../../src/services/syncV2.js';

const tree = (id = 'tech') => ({ initialized: true, customCategories: [{ id, name: 'Category', icon: '', keywords: [] }], defaultCategoryOverrides: {}, hiddenDefaultCategoryIds: [], categoryOrder: [id], subcategories: [], subcategoryOrder: [], repositoryOrder: [], categoryListIdMap: {} });
const membership = (categoryId: string | null = 'tech') => ({ technology: { categoryId, subcategoryId: null, locked: false } });
const repository = (id = 1) => ({ id, name: `repo${id}`, full_name: `fixture/repo${id}`, html_url: `https://github.com/fixture/repo${id}`, owner: { login: 'fixture' }, classifications: membership() });
const organization = { classificationSchemes: { purpose: tree('purpose'), technology: tree() } };
const operation = (overrides: Partial<Operation> = {}): Operation => ({ opId: 'edit', collection: 'repositories', id: '1', kind: 'put', baseVersion: 1, data: repository(), ...overrides });

describe('effective final-state technology references', () => {
  let db: Database.Database;
  beforeEach(() => { db = new Database(':memory:'); initializeSchema(db); initializeSyncV2(db); });
  afterEach(() => db.close());
  const bootstrap = (records: { collection: Collection; id: string; data: Record<string, unknown> }[] = [
    { collection: 'repositories', id: '1', data: repository() },
    { collection: 'organization', id: 'default', data: organization },
  ]) => {
    const input = { githubUserId: 42, source: 'desktop', records };
    const preview = bootstrapWorkspace(db, input);
    return bootstrapWorkspace(db, { ...input, confirm: true, previewToken: 'previewToken' in preview ? preview.previewToken : '' });
  };
  const push = (operations: Operation[], clientId = 'test') => pushOperations(db, { workspaceId: getWorkspace(db)!.id, githubUserId: 42, clientId, operations });
  const snapshot = () => Object.fromEntries(['sync_v2_records', 'sync_v2_changes', 'sync_v2_operations', 'sync_v2_conflicts', 'repositories', 'settings'].map(table => [table, db.prepare(`SELECT * FROM ${table}`).all()]));

  it('treats absent taxonomy as empty, allowing unassigned memberships but rejecting dangling ones', () => {
    expect(() => assertTechnologyMembershipReferences(undefined, [{ classifications: membership(null) }])).not.toThrow();
    for (const schemes of [undefined, null, {}, { purpose: tree('purpose') }]) {
      expect(() => assertTechnologyMembershipReferences(schemes, [{ classifications: membership() }])).toThrow('Technology membership');
    }
  });
  it.each([false, true])('accepts a batch replacement in either operation order (reverse=%s)', reverse => {
    bootstrap();
    const operations = [operation({ data: { ...repository(), classifications: membership('next') } }), operation({ opId: 'taxonomy', collection: 'organization', id: 'default', data: { classificationSchemes: { technology: tree('next') } } })];
    const result = push(reverse ? operations.reverse() : operations);
    expect(result.results.map(r => r.status)).toEqual(['applied', 'applied']);
    expect(getRecord(db, 'organization', 'default')?.data?.classificationSchemes).toEqual({ purpose: tree('purpose'), technology: tree('next') });
  });
  it('rolls back the whole batch, legacy projections, change log and receipts on dangling membership', () => {
    bootstrap();
    const before = snapshot();
    expect(() => push([operation({ opId: 'metadata', data: { ...repository(), description: 'must-not-write' } }), operation({ opId: 'taxonomy', collection: 'organization', id: 'default', data: { classificationSchemes: { technology: tree('missing-old-category') } } })])).toThrow('Technology membership');
    expect(snapshot()).toEqual(before);
  });
  it('does not validate rejected AI/version operations as though they applied', () => {
    bootstrap();
    push([operation({ opId: 'lock', data: { ...repository(), locked: true } })]);
    const result = push([
      operation({ opId: 'locked-invalid', baseVersion: 2, source: 'ai', data: { classifications: membership('absent') } }),
      operation({ opId: 'stale-invalid', baseVersion: 0, data: { classifications: membership('absent') } }),
    ]);
    expect(result.results.map(r => r.conflict.reason)).toEqual(['USER_LOCKED', 'VERSION_MISMATCH']);
    expect(getRecord(db, 'repositories', '1')?.data?.classifications).toEqual(membership());
  });
  it('rolls back a repository when the taxonomy operation needed for it conflicts', () => {
    bootstrap();
    const before = snapshot();
    expect(() => push([
      operation({ data: { ...repository(), classifications: membership('next') } }),
      operation({ opId: 'stale-taxonomy', collection: 'organization', id: 'default', baseVersion: 0, data: { classificationSchemes: { technology: tree('next') } } }),
    ])).toThrow('Technology membership');
    expect(snapshot()).toEqual(before);
  });
  it('does not resurrect a replayed taxonomy to validate a new repository update', () => {
    bootstrap();
    const original = operation({ opId: 'original-taxonomy', collection: 'organization', id: 'default', data: organization });
    push([original]);
    push([
      operation({ opId: 'next-repository', data: { ...repository(), classifications: membership('next') } }),
      operation({ opId: 'next-taxonomy', collection: 'organization', id: 'default', baseVersion: 2, data: { classificationSchemes: { technology: tree('next') } } }),
    ]);
    const before = snapshot();
    expect(() => push([original, operation({ opId: 'new-invalid', baseVersion: 2, data: repository() })])).toThrow('Technology membership');
    expect(snapshot()).toEqual(before);
  });
  it('rejects taxonomy deletion until referring repositories are deleted or unassigned', () => {
    bootstrap();
    const remove = operation({ opId: 'remove-taxonomy', collection: 'organization', id: 'default', kind: 'delete', data: undefined });
    expect(() => push([remove])).toThrow('Technology membership');
    expect(push([remove, operation({ opId: 'unassign', data: { ...repository(), classifications: membership(null) } })]).results.every(r => r.status === 'applied')).toBe(true);
  });
  it('validates after the whole bootstrap, including taxonomy after the first 500 records', () => {
    const records = Array.from({ length: 501 }, (_, i) => ({ collection: 'repositories' as const, id: String(i + 1), data: repository(i + 1) }));
    bootstrap([...records, { collection: 'organization', id: 'default', data: organization }]);
    expect(db.prepare('SELECT COUNT(*) AS n FROM repositories').get()).toEqual({ n: 501 });
  });
  it('rolls back an invalid bootstrap and leaves its preview usable for diagnosis', () => {
    expect(() => bootstrap([{ collection: 'repositories', id: '1', data: repository() }])).toThrow('Technology membership');
    expect(getWorkspace(db)).toBeNull();
    expect(db.prepare('SELECT COUNT(*) AS n FROM sync_v2_records').get()).toEqual({ n: 0 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM repositories').get()).toEqual({ n: 0 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM sync_v2_previews').get()).toEqual({ n: 1 });
  });
});
