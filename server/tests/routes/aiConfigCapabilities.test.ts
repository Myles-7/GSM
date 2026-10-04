import express from 'express';
import request from 'supertest';
import { DatabaseSync } from 'node:sqlite';
import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initializeSchema } from '../../src/db/schema.js';

const getDb = vi.hoisted(() => vi.fn());
vi.mock('../../src/db/connection.js', () => ({ getDb }));
vi.mock('../../src/config.js', () => ({ config: { encryptionKey: 'fixture' } }));
vi.mock('../../src/services/crypto.js', () => ({ encrypt: (s: string) => `fixture:${s}`, decrypt: (s: string) => s.slice(8) }));
const { default: router } = await import('../../src/routes/configs.js');
let db: DatabaseSync;
const app = express(); app.use(express.json()); app.use(router);
const config = { id: 'fixture', name: 'Fixture', baseUrl: 'https://example.com', apiKey: 'test-key', model: 'fixture', supportsToolCalls: true, requestsPerMinute: 90 };

beforeEach(() => {
  db = new DatabaseSync(':memory:');
  const adapter = { prepare: db.prepare.bind(db), exec: db.exec.bind(db), transaction: (fn: () => void) => () => {
    db.exec('BEGIN'); try { fn(); db.exec('COMMIT'); } catch (error) { db.exec('ROLLBACK'); throw error; }
  } };
  initializeSchema(adapter as unknown as Database.Database);
  initializeSchema(adapter as unknown as Database.Database);
  getDb.mockReturnValue(adapter);
});
afterEach(() => db.close());
describe('AI capability persistence', () => {
  it('round trips create, update and bulk sync through a migrated isolated database', async () => {
    const created = await request(app).post('/api/configs/ai').send(config).expect(201);
    expect(created.body).toMatchObject({ supportsToolCalls: true, requestsPerMinute: 90 });
    await request(app).put(`/api/configs/ai/${created.body.id}`).send({ ...config, requestsPerMinute: 120 }).expect(200);
    let fetched = await request(app).get('/api/configs/ai').expect(200);
    expect(fetched.body[0]).toMatchObject({ supportsToolCalls: true, requestsPerMinute: 120 });
    await request(app).put('/api/configs/ai/bulk').send({ configs: [config] }).expect(200);
    fetched = await request(app).get('/api/configs/ai').expect(200);
    expect(fetched.body).toEqual([expect.objectContaining({ id: 'fixture', supportsToolCalls: true, requestsPerMinute: 90 })]);
  });
  it('rejects invalid capability fields before bulk replacement', async () => {
    await request(app).put('/api/configs/ai/bulk').send({ configs: [config] }).expect(200);
    await request(app).put('/api/configs/ai/bulk').send({ configs: [{ ...config, requestsPerMinute: -1 }] }).expect(400);
    await request(app).post('/api/configs/ai').send({ ...config, supportsToolCalls: 'true' }).expect(400);
    expect(db.prepare('SELECT COUNT(*) AS n FROM ai_configs').get()).toMatchObject({ n: 1 });
  });
  it('preserves capabilities omitted by older clients and accepts explicit false/zero', async () => {
    await request(app).post('/api/configs/ai').send(config).expect(201);
    const legacy: Partial<typeof config> = { ...config };
    delete legacy.supportsToolCalls; delete legacy.requestsPerMinute;
    await request(app).put('/api/configs/ai/fixture').send(legacy).expect(200);
    await request(app).put('/api/configs/ai/bulk').send({ configs: [legacy] }).expect(200);
    let fetched = await request(app).get('/api/configs/ai').expect(200);
    expect(fetched.body[0]).toMatchObject({ supportsToolCalls: true, requestsPerMinute: 90 });
    await request(app).put('/api/configs/ai/fixture').send({ ...legacy, supportsToolCalls: false, requestsPerMinute: 0 }).expect(200);
    fetched = await request(app).get('/api/configs/ai').expect(200);
    expect(fetched.body[0]).toMatchObject({ supportsToolCalls: false, requestsPerMinute: 0 });
  });
});
