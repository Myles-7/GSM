import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { assertWorkspace, bootstrapWorkspace, getRecord, getWorkspace, initializeSyncV2, pruneSyncHistory, pullChanges, pushOperations, snapshotPage, type Operation } from '../../src/services/syncV2.js';
import { initializeSchema } from '../../src/db/schema.js';

describe('account-bound sync v2', () => {
  let db: Database.Database;
  beforeEach(() => { db = new Database(':memory:'); initializeSyncV2(db); });
  afterEach(() => db.close());
  const seed = () => {
    const input = { githubUserId: 42, source: 'desktop', records: [{ collection: 'repositories' as const, id: '1', data: { name: 'one' } }] };
    const preview = bootstrapWorkspace(db, input);
    bootstrapWorkspace(db, { ...input, confirm: true, previewToken: 'previewToken' in preview ? preview.previewToken : '' });
    return getWorkspace(db)!;
  };
  const put = (overrides: Partial<Operation> = {}): Operation => ({ opId: 'edit', collection: 'repositories', id: '1', kind: 'put', baseVersion: 1, data: { name: 'edited' }, ...overrides });
  const push = (operations: Operation[], clientId = 'phone') => { const w = getWorkspace(db)!; return pushOperations(db, { workspaceId: w.id, githubUserId: w.githubUserId, clientId, operations }); };
  it('requires a nonempty desktop snapshot and digest-bound confirmation', () => {
    expect(() => bootstrapWorkspace(db, { githubUserId: 42, source: 'phone', records: [] })).toThrow('DESKTOP_NONEMPTY');
    const records = [{ collection: 'repositories' as const, id: '1', data: { name: 'one' } }];
    const preview = bootstrapWorkspace(db, { githubUserId: 42, source: 'desktop', records });
    expect(getWorkspace(db)).toBeNull();
    expect(() => bootstrapWorkspace(db, { githubUserId: 42, source: 'desktop', records: [{ ...records[0], data: { name: 'tampered' } }], confirm: true, previewToken: 'previewToken' in preview ? preview.previewToken : '' })).toThrow('PREVIEW_EXPIRED');
    seed();
    expect(() => assertWorkspace(db, getWorkspace(db)!.id, 43)).toThrow('ACCOUNT_MISMATCH');
  });
  it('deduplicates retries and atomically rolls back an operation ID collision', () => {
    seed();
    const first = push([put()]);
    expect(push([put()])).toEqual(first);
    expect(() => push([put({ opId: 'first-new', id: '2', baseVersion: 0 }), put({ data: { name: 'changed replay' } })])).toThrow('OPERATION_ID_REUSED');
    expect(getRecord(db, 'repositories', '2')).toBeNull();
    expect(pullChanges(db, 0).records).toHaveLength(2);
  });
  it('preserves both conflict versions and blocks late AI on locked data', () => {
    seed();
    push([put({ data: { name: 'mine', category_locked: true } })]);
    const stale = push([put({ opId: 'stale', data: { name: 'theirs' } })]);
    expect(stale.results[0].conflict.current.data.name).toBe('mine');
    expect(stale.results[0].conflict.incoming.data.name).toBe('theirs');
    const ai = push([put({ opId: 'ai', baseVersion: 2, source: 'ai', data: { name: 'late' } })]);
    expect(ai.results[0].conflict.reason).toBe('USER_LOCKED');
    expect(getRecord(db, 'repositories', '1')?.data?.name).toBe('mine');
    expect((db.prepare('SELECT COUNT(*) AS n FROM sync_v2_conflicts').get() as { n: number }).n).toBe(2);
  });
  it('materializes a fixed snapshot while writes and deletes continue', () => {
    const w = seed();
    push([put({ id: '2', baseVersion: 0, opId: 'new' })]);
    const page1 = snapshotPage(db, w.id, undefined, 0, 1);
    push([put({ id: '2', baseVersion: 1, opId: 'delete', kind: 'delete', data: undefined })]);
    const page2 = snapshotPage(db, w.id, page1.snapshotId, page1.nextOffset, 1);
    expect(page2.boundary).toBe(page1.boundary);
    expect(page2.records[0].deleted).toBe(false);
    expect(pullChanges(db, page1.boundary).records[0].deleted).toBe(true);
    expect(push([put({ id: '2', opId: 'stale-resurrect', baseVersion: 0 })]).results[0].status).toBe('conflict');
  });
  it('expires old cursors but retains a tombstone graveyard and retry receipts', () => {
    seed(); push([put({ kind: 'delete', data: undefined })]);
    db.prepare('UPDATE sync_v2_changes SET created_at=0').run();
    pruneSyncHistory(db);
    expect(() => pullChanges(db, 0)).toThrow('CURSOR_EXPIRED');
    expect(getRecord(db, 'repositories', '1')?.deleted).toBe(true);
    expect(push([put({ kind: 'delete', data: undefined })]).results[0].status).toBe('applied');
  });
  it('rejects secrets, local paths and malformed records before any write', () => {
    seed();
    for (const data of [{ apiKey: 'secret' }, { nested: { github_token: 'x' } }, { attachment: 'C:\\Users\\me\\private.txt' }, { text: 'ghp_abcdefghijklmnopqrstuvwxyz' }]) expect(() => push([put({ data })])).toThrow('PRIVATE_DATA_NOT_SYNCABLE');
    expect(() => push([put({ collection: 'arbitrary' as Operation['collection'] })])).toThrow('INVALID_OPERATION');
    expect(getRecord(db, 'repositories', '1')?.version).toBe(1);
  });
  it('projects canonical repositories, read markers and organization for legacy API/MCP reads', () => {
    initializeSchema(db);
    const input = { githubUserId: 42, source: 'desktop', records: [{ collection: 'repositories' as const, id: '1', data: { name: 'one', full_name: 'owner/one', html_url: 'https://github.com/owner/one', owner: { login: 'owner' }, category_id: 'cat' } }] };
    const preview = bootstrapWorkspace(db, input);
    bootstrapWorkspace(db, { ...input, confirm: true, previewToken: 'previewToken' in preview ? preview.previewToken : '' });
    expect(db.prepare('SELECT owner_login, category_id, category_id_defined FROM repositories WHERE id=1').get()).toEqual({ owner_login: 'owner', category_id: 'cat', category_id_defined: 1 });
    push([put({ collection: 'subscriptions', opId: 'subscribe', baseVersion: 0, data: { subscribed: true } })]);
    expect((db.prepare('SELECT subscribed_to_releases AS subscribed FROM repositories WHERE id=1').get() as { subscribed: number }).subscribed).toBe(1);
    push([put({ collection: 'organization', id: 'default', opId: 'org', baseVersion: 0, data: { customCategories: [{ id: 'cat', name: 'Category' }], subcategories: [], repositoryOrder: [1] } })]);
    expect((db.prepare("SELECT name FROM categories WHERE id='cat'").get() as { name: string }).name).toBe('Category');
    push([put({ opId: 'remove', kind: 'delete', data: undefined })]);
    expect(db.prepare('SELECT * FROM repositories WHERE id=1').get()).toBeUndefined();
  });
});
