import Database from 'better-sqlite3';
import express from 'express';
import request from 'supertest';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { initializeSchema } from '../../src/db/schema.js';
import { runMigrations } from '../../src/db/migrations.js';

const holder = vi.hoisted(() => ({ db: null as unknown }));
vi.mock('../../src/db/connection.js', () => ({ getDb: () => holder.db }));
vi.mock('../../src/config.js', () => ({ config: { encryptionKey: 'test' } }));
vi.mock('../../src/services/crypto.js', () => ({ encrypt: (v: string) => v, decrypt: (v: string) => v }));
const { default: repositories } = await import('../../src/routes/repositories.js');
const { default: sync } = await import('../../src/routes/sync.js');
const app = express().use(express.json()).use(repositories).use(sync);
const repo = { id: 1, name: 'sample', full_name: 'owner/sample', html_url: 'https://github.com/owner/sample', stargazers_count: 1, owner: { login: 'owner', avatar_url: '' } };

describe('repository organization SQLite roundtrip', () => {
  let db: Database.Database;
  beforeEach(() => { db = new Database(':memory:'); holder.db = db; initializeSchema(db); });
  afterEach(() => db.close());

  it('distinguishes missing legacy membership from explicit pending and stores optional details', async () => {
    await request(app).put('/api/repositories').send({ repositories: [repo] }).expect(200);
    let result = await request(app).get('/api/repositories').expect(200);
    expect(result.body.repositories[0]).not.toHaveProperty('category_id');
    await request(app).patch('/api/repositories/1').send({ category_id: null, category_candidates: ['one'], ai_details: { summary: 'details' } }).expect(200);
    result = await request(app).get('/api/repositories').expect(200);
    expect(result.body.repositories[0]).toMatchObject({ category_id: null, subcategory_id: null, category_candidates: ['one'], ai_details: { summary: 'details' } });
  });

  it('preserves omitted new fields on old-client upserts and old backup imports', async () => {
    await request(app).put('/api/repositories').send({ repositories: [{
      ...repo, category_id: 'one', subcategory_id: 'group', category_locked: true, custom_category: 'First',
      category_legacy: { custom_category: 'Original', category_locked: true }, ai_details: { summary: 'details' },
    }] }).expect(200);
    await request(app).put('/api/repositories').send({ repositories: [repo] }).expect(200);
    await request(app).post('/api/sync/import').send({ repositories: [repo] }).expect(200);
    const result = await request(app).get('/api/repositories').expect(200);
    expect(result.body.repositories[0]).toMatchObject({
      category_id: 'one', subcategory_id: 'group', category_locked: true, custom_category: 'First',
      category_legacy: { custom_category: 'Original', category_locked: true }, ai_details: { summary: 'details' },
    });
  });

  it('clears the group on a parent change and roundtrips exported snapshots', async () => {
    await request(app).put('/api/repositories').send({ repositories: [{ ...repo, category_id: 'one', subcategory_id: 'group', ai_details: { summary: 'details' } }] }).expect(200);
    const exported = await request(app).post('/api/sync/export').expect(200);
    await request(app).patch('/api/repositories/1').send({ category_id: 'two' }).expect(200);
    let result = await request(app).get('/api/repositories').expect(200);
    expect(result.body.repositories[0].subcategory_id).toBeNull();
    db.prepare('DELETE FROM repositories').run();
    await request(app).post('/api/sync/import').send(exported.body).expect(200);
    result = await request(app).get('/api/repositories').expect(200);
    expect(result.body.repositories[0]).toMatchObject({ category_id: 'one', subcategory_id: 'group', ai_details: { summary: 'details' } });
  });

  it('migrates an existing schema and accepts structured group/order backup settings', async () => {
    runMigrations(db);
    runMigrations(db);
    const columns = db.prepare('PRAGMA table_info(repositories)').all() as { name: string }[];
    expect(columns.filter(column => column.name === 'ai_details')).toHaveLength(1);
    const settings = { subcategories: [{ id: 'group', parentId: 'one', name: 'Group', icon: 'folder' }], subcategoryOrder: ['group'], repositoryOrder: [1] };
    await request(app).post('/api/sync/import').send({ settings }).expect(200);
    const result = await request(app).post('/api/sync/export').expect(200);
    expect(JSON.parse(result.body.settings.subcategories)).toEqual(settings.subcategories);
    expect(JSON.parse(result.body.settings.repositoryOrder)).toEqual([1]);
  });
});
