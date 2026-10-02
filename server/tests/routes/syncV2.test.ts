import Database from 'better-sqlite3';
import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSyncV2Router } from '../../src/routes/syncV2.js';
import { bootstrapWorkspace, getWorkspace, initializeSyncV2 } from '../../src/services/syncV2.js';
import { encrypt } from '../../src/services/crypto.js';
import { config } from '../../src/config.js';

describe('sync v2 HTTP identity and capabilities', () => {
  let db: Database.Database;
  beforeEach(() => {
    db = new Database(':memory:'); initializeSyncV2(db);
    db.exec(`CREATE TABLE settings(key TEXT,value TEXT); CREATE TABLE ai_configs(id TEXT,name TEXT,api_type TEXT,base_url TEXT,model TEXT,is_active INTEGER,api_key_encrypted TEXT); INSERT INTO ai_configs VALUES('model','My model','openai','https://example.com/v1','model-v1',1,'DO-NOT-LEAK');`);
  });
  afterEach(() => db.close());
  const app = (id = 42) => express().use(express.json()).use(createSyncV2Router({ db: () => db, requireSecret: false, verifyAccount: async () => ({ id, login: 'user' }) }));
  it('exposes credential availability without exposing secret values', async () => {
    const response = await request(app()).get('/api/capabilities');
    expect(response.status).toBe(200);
    expect(response.body.github.id).toBe(42);
    expect(response.body.aiConfigs[0].credentialSource).toBe('backend');
    expect(response.body.aiConfigs[0].available).toBe(false);
    expect(response.body.tasks.kinds).toContain('chat');
    expect(response.body.discovery.features).toEqual({stablePopular:true,publicReleases:true});
    expect(response.text).not.toContain('DO-NOT-LEAK');
  });
  it('returns diagnostic counts without stored data or credentials', async () => {
    const response = await request(app()).get('/api/diagnostics');
    expect(response.status).toBe(200);
    expect(response.body.protocols).toEqual({ sync: 2, tasks: 1 });
    expect(response.body.sync.changes).toBe(0);
    expect(response.text).not.toContain('DO-NOT-LEAK');
  });
  it('validates encrypted credential availability and strips endpoint credentials', async () => {
    db.prepare('UPDATE ai_configs SET api_key_encrypted=?,base_url=?').run(encrypt('private-ai-key', config.encryptionKey), 'https://secret-user:secret-password@example.com/v1?api_key=private#secret');
    const response = await request(app()).get('/api/capabilities');
    expect(response.body.aiConfigs[0].available).toBe(true);
    expect(response.body.aiConfigs[0].baseUrl).toBe('https://example.com/v1');
    expect(response.text).not.toContain('private-ai-key');
    expect(response.text).not.toContain('secret-password');
  });
  it('rejects bootstrap and workspace use when server token belongs to another account', async () => {
    expect((await request(app(43)).post('/api/sync/v2/bootstrap').send({ githubUserId: 42 })).status).toBe(403);
    const input = { githubUserId: 42, source: 'desktop', records: [{ collection: 'repositories' as const, id: '1', data: { name: 'one' } }] };
    const preview = bootstrapWorkspace(db, input);
    bootstrapWorkspace(db, { ...input, confirm: true, previewToken: 'previewToken' in preview ? preview.previewToken : '' });
    const response = await request(app(43)).get('/api/sync/v2/changes').query({ workspaceId: getWorkspace(db)!.id, githubUserId: 42 });
    expect(response.status).toBe(403);
    expect(response.body.code).toBe('BACKEND_ACCOUNT_MISMATCH');
  });
});
