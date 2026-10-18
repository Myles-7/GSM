import Database from 'better-sqlite3';
import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ db: undefined as unknown as Database.Database }));
vi.mock('../../src/db/connection.js', () => ({ getDb: () => mocks.db }));
vi.mock('../../src/config.js', () => ({ config: { encryptionKey: 'fixture-key' } }));
import repositories from '../../src/routes/repositories.js';
import settings from '../../src/routes/configs.js';
import categories from '../../src/routes/categories.js';
import sync from '../../src/routes/sync.js';
import { initializeSchema } from '../../src/db/schema.js';
import { bootstrapWorkspace, getRecord, getWorkspace, initializeSyncV2, pushOperations } from '../../src/services/syncV2.js';
const tree = { initialized: true, customCategories: [{ id: 'tech', name: 'Frameworks', icon: 'folder', keywords: [] }], defaultCategoryOverrides: {}, hiddenDefaultCategoryIds: [], categoryOrder: ['tech'], subcategories: [], subcategoryOrder: [], repositoryOrder: [1], categoryListIdMap: {} };
const schemes = { purpose: { ...tree, customCategories: [], categoryOrder: [] }, technology: tree };
const member = { categoryId: 'tech', subcategoryId: null, locked: false };
const repo = { id: 1, name: 'tool', full_name: 'fixture/tool', html_url: 'https://github.com/fixture/tool', stargazers_count: 1, owner: { login: 'fixture', avatar_url: '' }, category_id: 'devtools', category_locked: false, custom_category: 'Development Tools', classifications: { technology: member } };
const app = () => express().use(express.json()).use(repositories).use(settings).use(categories).use(sync);
beforeEach(async () => {
  mocks.db = new Database(':memory:'); initializeSchema(mocks.db);
  await request(app()).put('/api/settings').send({ classificationSchemes: schemes }).expect(200);
  await request(app()).put('/api/repositories').send({ repositories: [repo], classificationSchemaVersion: 2 }).expect(200);
});
afterEach(() => mocks.db.close());
describe('dual classification compatibility API', () => {
  it('rejects memberships without a persisted taxonomy, including a spoofed PUT taxonomy', async () => {
    mocks.db.prepare('DELETE FROM repositories').run();
    mocks.db.prepare("DELETE FROM settings WHERE key='classificationSchemes'").run();
    const result = await request(app()).put('/api/repositories').send({ repositories: [repo], classificationSchemes: schemes });
    expect(result.status).toBe(400);
    expect(result.body.code).toBe('INVALID_CLASSIFICATION_REFERENCE');
    expect(mocks.db.prepare('SELECT COUNT(*) AS n FROM repositories').get()).toEqual({ n: 0 });
    expect(mocks.db.prepare("SELECT value FROM settings WHERE key='classificationSchemes'").get()).toBeUndefined();
  });
  it('rolls back taxonomy-only removal and unrelated settings when a repository still refers to it', async () => {
    const result = await request(app()).put('/api/settings').send({ activeAIConfig: 'must-not-write', classificationSchemes: { technology: { ...tree, customCategories: [], categoryOrder: [] } } });
    expect(result.status).toBe(400);
    expect(result.body.code).toBe('INVALID_CLASSIFICATION_REFERENCE');
    expect(mocks.db.prepare("SELECT value FROM settings WHERE key='activeAIConfig'").get()).toBeUndefined();
    expect(mocks.db.prepare("SELECT value FROM settings WHERE key='classificationSchemes'").get()).toEqual({ value: JSON.stringify(schemes) });
  });
  it('rejects a missing child or a child of a different technology category without changing metadata', async () => {
    const technology = { ...tree, customCategories: [...tree.customCategories, { id: 'second', name: 'Second', icon: '', keywords: [] }], subcategories: [{ id: 'child', parentId: 'second', name: 'Child', icon: '' }] };
    await request(app()).put('/api/settings').send({ classificationSchemes: { technology } }).expect(200);
    for (const subcategoryId of ['missing', 'child']) {
      const result = await request(app()).patch('/api/repositories/1').send({ classifications: { technology: { ...member, subcategoryId } }, custom_description: 'must-not-write' });
      expect(result.status).toBe(400);
      expect(result.body.code).toBe('INVALID_CLASSIFICATION_REFERENCE');
    }
    expect(mocks.db.prepare('SELECT custom_description FROM repositories WHERE id=1').get()).toEqual({ custom_description: null });
  });
  it('checks the merged persisted membership when PUT updates only purpose', async () => {
    await request(app()).put('/api/repositories').send({ repositories: [{ ...repo, classifications: { purpose: { categoryId: null, subcategoryId: null, locked: false } } }] }).expect(200);
    const result = await request(app()).get('/api/repositories');
    expect(result.body.repositories[0].classifications.technology).toEqual(member);
  });
  it('imports a valid repository and taxonomy replacement atomically and rejects an invalid replacement', async () => {
    const technology = { ...tree, customCategories: [{ id: 'new-tech', name: 'New', icon: '', keywords: [] }], categoryOrder: ['new-tech'] };
    const updatedRepo = { ...repo, classifications: { technology: { ...member, categoryId: 'new-tech' } } };
    await request(app()).post('/api/sync/import').send({ repositories: [updatedRepo], settings: { classificationSchemes: { technology } } }).expect(200);
    const before = mocks.db.prepare('SELECT * FROM repositories').all();
    const result = await request(app()).post('/api/sync/import').send({ repositories: [{ ...updatedRepo, description: 'must-not-write' }], settings: { activeAIConfig: 'must-not-write', classificationSchemes: schemes } });
    expect(result.status).toBe(400);
    expect(result.body.code).toBe('INVALID_CLASSIFICATION_REFERENCE');
    expect(mocks.db.prepare('SELECT * FROM repositories').all()).toEqual(before);
    expect(mocks.db.prepare("SELECT value FROM settings WHERE key='activeAIConfig'").get()).toBeUndefined();
  });
  it('rejects a legacy classification edit before any local fields are written', async () => {
    const result = await request(app()).patch('/api/repositories/1').send({ category_id: 'other', custom_description: 'Do not write' });
    expect(result.status).toBe(409); expect(result.body.code).toBe('CLASSIFICATION_UPGRADE_REQUIRED');
    const row = mocks.db.prepare('SELECT category_id,custom_description FROM repositories WHERE id=1').get();
    expect(row).toEqual({ category_id: 'devtools', custom_description: null });
  });
  it('preserves upgraded fields on an old-client metadata update', async () => {
    await request(app()).patch('/api/repositories/1').send({ custom_description: 'Edited description' }).expect(200);
    const result = await request(app()).get('/api/repositories');
    expect(result.body.repositories[0].classifications.technology).toEqual(member);
    expect(result.body.repositories[0].custom_description).toBe('Edited description');
  });
  it('rolls back an entire legacy bulk write when one category conflicts', async () => {
    const unchanged = { ...repo, classifications: undefined, description: 'Do not write' };
    const changed = { ...unchanged, category_id: null };
    await request(app()).put('/api/repositories').send({ repositories: [unchanged, changed], isFullSync: true }).expect(409);
    expect((mocks.db.prepare('SELECT description FROM repositories WHERE id=1').get() as { description: string | null }).description).toBeNull();
  });
  it('allows an upgraded client purpose edit without wiping technology', async () => {
    await request(app()).put('/api/repositories').send({ repositories: [{ ...repo, category_id: null, classifications: undefined }], classificationSchemaVersion: 2 }).expect(200);
    const result = await request(app()).get('/api/repositories');
    expect(result.body.repositories[0].category_id).toBeNull();
    expect(result.body.repositories[0].classifications.technology).toEqual(member);
  });
  it('blocks legacy structure mutations while allowing ordinary settings', async () => {
    await request(app()).put('/api/settings').send({ customCategories: [{ id: 'x', name: 'Unsafe' }] }).expect(409);
    await request(app()).post('/api/categories').send({ name: 'Unsafe' }).expect(409);
    await request(app()).put('/api/settings').send({ activeAIConfig: 'model' }).expect(200);
    expect((mocks.db.prepare("SELECT value FROM settings WHERE key='classificationSchemes'").get() as { value: string }).value).toBe(JSON.stringify(schemes));
  });
  it('rejects nested schemes, duplicate IDs and an invalid subgroup parent', async () => {
    for (const technology of [{ ...tree, classificationSchemes: {} }, { ...tree, subcategories: [{ id: 'child', parentId: 'absent', name: 'Child', icon: '' }] }, { ...tree, subcategories: [{ id: 'tech', parentId: 'tech', name: 'Child', icon: '' }] }]) {
      await request(app()).put('/api/settings').send({ classificationSchemes: { technology } }).expect(400);
    }
  });
  it('preserves technology when settings upload only the purpose scheme', async () => {
    const purpose = { ...schemes.purpose, repositoryOrder: [2, 1] };
    await request(app()).put('/api/settings').send({ classificationSchemes: { purpose } }).expect(200);
    const row = mocks.db.prepare("SELECT value FROM settings WHERE key='classificationSchemes'").get() as { value: string };
    expect(JSON.parse(row.value)).toEqual({ purpose, technology: tree });
  });
  it('reports invalid classification payloads as client errors and rolls back metadata', async () => {
    const classifications = { technology: { categoryId: null, subcategoryId: 'orphan', locked: false } };
    await request(app()).patch('/api/repositories/1').send({ classifications, custom_description: 'Do not write' }).expect(400);
    await request(app()).put('/api/repositories').send({ repositories: [{ ...repo, classifications }], classificationSchemaVersion: 2 }).expect(400);
    await request(app()).post('/api/sync/import').send({ repositories: [{ ...repo, classifications }], settings: { classificationSchemes: schemes } }).expect(400);
    await request(app()).post('/api/sync/import').send({ settings: { classificationSchemes: { technology: { ...tree, subcategories: [{ id: 'orphan', parentId: 'missing', name: 'Invalid', icon: '' }] } } } }).expect(400);
    expect(mocks.db.prepare('SELECT custom_description FROM repositories WHERE id=1').get()).toEqual({ custom_description: null });
  });
  it('preserves technology when importing a partial, string-encoded settings snapshot', async () => {
    const purpose = { ...schemes.purpose, repositoryOrder: [2, 1] };
    await request(app()).post('/api/sync/import').send({ settings: { classificationSchemes: JSON.stringify({ purpose }) } }).expect(200);
    const row = mocks.db.prepare("SELECT value FROM settings WHERE key='classificationSchemes'").get() as { value: string };
    expect(JSON.parse(row.value)).toEqual({ purpose, technology: tree });
  });
  it('returns an explicit upgrade conflict in sync v2 and preserves technology on metadata puts', () => {
    initializeSyncV2(mocks.db);
    const input = { githubUserId: 42, source: 'desktop', records: [{ collection: 'repositories' as const, id: '1', data: repo }, { collection: 'organization' as const, id: 'default', data: { classificationSchemes: schemes } }] };
    const preview = bootstrapWorkspace(mocks.db, input);
    bootstrapWorkspace(mocks.db, { ...input, confirm: true, previewToken: 'previewToken' in preview ? preview.previewToken : '' });
    const workspace = getWorkspace(mocks.db)!;
    const push = (opId: string, data: Record<string, unknown>) => pushOperations(mocks.db, { workspaceId: workspace.id, githubUserId: 42, clientId: 'old', operations: [{ opId, collection: 'repositories', id: '1', kind: 'put', baseVersion: 1, data }] });
    expect(push('bad-edit', { category_id: null }).results[0].conflict.reason).toBe('CLASSIFICATION_UPGRADE_REQUIRED');
    expect(push('metadata', { name: 'Updated' }).results[0].status).toBe('applied');
    expect(getRecord(mocks.db, 'repositories', '1')?.data?.classifications).toEqual(repo.classifications);
  });
});
