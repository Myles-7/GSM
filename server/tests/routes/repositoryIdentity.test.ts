import Database from 'better-sqlite3';
import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSyncV2Router } from '../../src/routes/syncV2.js';
import { initializeIdentityMigration } from '../../src/services/repositoryIdentity.js';
import { bootstrapWorkspace, getRecord, getWorkspace, initializeSyncV2, pushOperations, writeCanonicalRecord } from '../../src/services/syncV2.js';
import { initializeSchema } from '../../src/db/schema.js';

describe('repository identity recovery HTTP contract', () => {
  let db: Database.Database;
  const oldId = 1_700_000_000_001;
  const mappings = [{ oldId, newId: 123, fullName: 'owner/repo', evidence: 'explicit manual confirmation' }];
  beforeEach(() => {
    db = new Database(':memory:');
    initializeSyncV2(db);
    initializeIdentityMigration(db);
    const seed = { githubUserId: 42, source: 'desktop', records: [
      { collection: 'repositories' as const, id: String(oldId), data: { id: oldId, full_name: 'owner/repo' } },
    ] };
    const preview = bootstrapWorkspace(db, seed);
    bootstrapWorkspace(db, { ...seed, confirm: true, previewToken: 'previewToken' in preview ? preview.previewToken : '' });
  });
  afterEach(() => db.close());
  const app = (account = 42) => express().use(express.json()).use(createSyncV2Router({
    db: () => db, requireSecret: false, verifyAccount: async () => ({ id: account, login: 'user' }),
  }));
  const input = () => ({ workspaceId: getWorkspace(db)!.id, githubUserId: 42, mappings });

  it('accepts the original preview proof from a durable local journal and writes no business records', async () => {
    const preview = await request(app()).post('/api/sync/v2/identity').send({ ...input(), phase: 'preview' });
    expect(preview.status).toBe(200);
    const localJournal = JSON.parse(JSON.stringify({
      id: 'local-journal', account: '42', workspace: input().workspaceId, mappings,
      serverInputHash: preview.body.inputHash, steps: [], phase: 'restoring',
    }));
    const before = db.prepare('SELECT * FROM sync_v2_records ORDER BY collection,id').all();
    const changes = db.prepare('SELECT * FROM sync_v2_changes ORDER BY seq').all();
    const response = await request(app()).post('/api/sync/v2/identity').send({
      phase: 'restore', workspaceId: localJournal.workspace, githubUserId: Number(localJournal.account),
      journalId: localJournal.id, inputHash: localJournal.serverInputHash, mappings: localJournal.mappings,
    });
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ journalId: 'local-journal', restored: false, notApplied: true });
    expect(db.prepare('SELECT * FROM sync_v2_records ORDER BY collection,id').all()).toEqual(before);
    expect(db.prepare('SELECT * FROM sync_v2_changes ORDER BY seq').all()).toEqual(changes);
    const journals = db.prepare('SELECT * FROM repository_identity_journals').all();
    expect(journals).toEqual([expect.objectContaining({
      id: localJournal.id, workspace_id: localJournal.workspace, github_user_id: 42,
      input_hash: localJournal.serverInputHash, mappings: JSON.stringify(mappings),
      status: 'cancelled', backup: '[]', result: JSON.stringify(response.body),
    })]);
    const writes = db.prepare('SELECT total_changes() AS n').get();
    const delayedApply = await request(app()).post('/api/sync/v2/identity').send({
      ...input(), journalId: localJournal.id, inputHash: localJournal.serverInputHash, phase: 'apply',
    });
    expect(delayedApply.status).toBe(409);
    expect(delayedApply.body.code).toBe('IDENTITY_JOURNAL_RESTORED');
    const replay = await request(app()).post('/api/sync/v2/identity').send({
      ...input(), journalId: localJournal.id, inputHash: localJournal.serverInputHash, phase: 'restore',
    });
    expect(replay.status).toBe(200);
    expect(replay.body).toEqual(response.body);
    expect(db.prepare('SELECT total_changes() AS n').get()).toEqual(writes);
    expect(db.prepare('SELECT * FROM repository_identity_journals').all()).toEqual(journals);
    expect(db.prepare('SELECT * FROM sync_v2_records ORDER BY collection,id').all()).toEqual(before);
    expect(db.prepare('SELECT * FROM sync_v2_changes ORDER BY seq').all()).toEqual(changes);
  });
  it('distinguishes a pre-apply change from a lost apply ACK when local completed steps are absent', async () => {
    const value = input();
    const preview = await request(app()).post('/api/sync/v2/identity').send({ ...value, phase: 'preview' });
    const recovery = { ...value, journalId: 'local-journal', inputHash: preview.body.inputHash };
    pushOperations(db, { ...value, clientId: 'editor', operations: [
      { opId: 'edit', collection: 'repositories', id: String(oldId), kind: 'put', baseVersion: 1,
        data: { id: oldId, full_name: 'owner/repo', custom_description: 'Other client edit' } },
    ] });
    const apply = await request(app()).post('/api/sync/v2/identity').send({ ...recovery, phase: 'apply' });
    expect(apply.status).toBe(409);
    expect(apply.body.code).toBe('IDENTITY_PREVIEW_CHANGED');
    const notApplied = await request(app()).post('/api/sync/v2/identity').send({ ...recovery, phase: 'restore' });
    expect(notApplied.body).toMatchObject({ notApplied: true, restored: false });
    expect(getRecord(db, 'repositories', String(oldId))?.data?.custom_description).toBe('Other client edit');

    const fresh = await request(app()).post('/api/sync/v2/identity').send({ ...value, phase: 'preview' });
    const dispatched = { ...value, journalId: 'lost-ack', inputHash: fresh.body.inputHash };
    expect((await request(app()).post('/api/sync/v2/identity').send({ ...dispatched, phase: 'apply' })).status).toBe(200);
    const restored = await request(app()).post('/api/sync/v2/identity').send({ ...dispatched, phase: 'restore' });
    expect(restored.status).toBe(200);
    expect(restored.body).toEqual({ journalId: 'lost-ack', restored: true });
    expect(getRecord(db, 'repositories', String(oldId))?.data?.custom_description).toBe('Other client edit');
  });
  it('fails closed for an unknown journal without proof or the wrong verified account', async () => {
    const value = input();
    const missingProof = await request(app()).post('/api/sync/v2/identity').send({
      workspaceId: value.workspaceId, githubUserId: 42, phase: 'restore', journalId: 'missing',
    });
    expect(missingProof.status).toBe(409);
    expect(missingProof.body.code).toBe('IDENTITY_RECOVERY_PROOF_REQUIRED');
    const wrongAccount = await request(app(43)).post('/api/sync/v2/identity').send({
      ...value, phase: 'restore', journalId: 'missing', inputHash: '0'.repeat(64),
    });
    expect(wrongAccount.status).toBe(403);
    expect(wrongAccount.body.code).toBe('BACKEND_ACCOUNT_MISMATCH');
  });
  it('returns an operation identity conflict instead of SQL 500 for unconfirmed same-name Star data', async () => {
    initializeSchema(db);
    const source = { id: oldId, name: 'repo', full_name: 'owner/repo',
      html_url: 'https://github.com/owner/repo', owner: { login: 'owner' },
      ai_summary: 'retain source AI', custom_description: '' };
    writeCanonicalRecord(db, { collection: 'repositories', id: String(oldId), data: source, deleted: false });
    const operation = { opId: 'unconfirmed-star', collection: 'repositories', id: '123', kind: 'put',
      baseVersion: 0, data: { ...source, id: 123, stargazers_count: 100, unknown: { incoming: true } } };
    const push = { ...input(), clientId: 'star-sync', operations: [operation] };
    const records = db.prepare('SELECT * FROM sync_v2_records ORDER BY collection,id').all();
    const changes = db.prepare('SELECT * FROM sync_v2_changes ORDER BY seq').all();
    const legacy = db.prepare('SELECT * FROM repositories').all();
    const response = await request(app()).post('/api/sync/v2/operations').send(push);
    expect(response.status).toBe(200);
    expect(response.body.results[0]).toMatchObject({
      opId: operation.opId, status: 'conflict',
      conflict: { reason: 'REPOSITORY_IDENTITY_CONFIRMATION_REQUIRED', incoming: operation, current: null },
    });
    expect(db.prepare('SELECT * FROM sync_v2_records ORDER BY collection,id').all()).toEqual(records);
    expect(db.prepare('SELECT * FROM sync_v2_changes ORDER BY seq').all()).toEqual(changes);
    expect(db.prepare('SELECT * FROM repositories').all()).toEqual(legacy);
    const writes = db.prepare('SELECT total_changes() AS n').get();
    const replay = await request(app()).post('/api/sync/v2/push').send(push);
    expect(replay.status).toBe(200);
    expect(replay.body).toEqual(response.body);
    expect(db.prepare('SELECT total_changes() AS n').get()).toEqual(writes);
  });
});
