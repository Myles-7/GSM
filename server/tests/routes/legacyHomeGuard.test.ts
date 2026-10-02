import Database from 'better-sqlite3';
import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bootstrapWorkspace, initializeSyncV2 } from '../../src/services/syncV2.js';

const connection = vi.hoisted(() => ({ db: null as Database.Database | null }));
vi.mock('../../src/db/connection.js', () => ({ getDb: () => connection.db }));
import { legacySyncV2Guard } from '../../src/routes/syncV2.js';

describe('migrated workspace legacy write guard', () => {
  beforeEach(() => {
    const db = connection.db = new Database(':memory:'); initializeSyncV2(db);
    const seed = { githubUserId: 42, source: 'desktop', records: [{ collection: 'repositories' as const, id: '1', data: { name: 'repo' } }] };
    const preview = bootstrapWorkspace(db, seed);
    bootstrapWorkspace(db, { ...seed, confirm: true, previewToken: 'previewToken' in preview ? preview.previewToken : '' });
  });
  afterEach(() => { connection.db?.close(); vi.unstubAllGlobals(); });
  const app = () => express().use(express.json()).use(legacySyncV2Guard).put('/api/settings', (_req, res) => res.json({ updated: true }));
  it('permits only verified same-account credential rotation', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 42 })));
    vi.stubGlobal('fetch', fetcher);
    expect((await request(app()).put('/api/settings').send({ github_token: 'replacement-fixture' })).status).toBe(200);
    expect(fetcher).toHaveBeenCalledOnce();
    expect((await request(app()).put('/api/settings').send({ github_token: 'replacement-fixture', categoryOrder: [] })).status).toBe(409);
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it('rejects wrong-account, unverifiable and empty replacements without allowing a write', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 43 }))));
    expect((await request(app()).put('/api/settings').send({ github_token: 'other-fixture' })).status).toBe(403);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    expect((await request(app()).put('/api/settings').send({ github_token: 'other-fixture' })).status).toBe(502);
    expect((await request(app()).put('/api/settings').send({ github_token: '' })).status).toBe(409);
  });
});
