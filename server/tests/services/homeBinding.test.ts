import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { initializeSyncV2, assertWorkspace } from '../../src/services/syncV2.js';
import { auditWorkspaceBinding, bindingStatus, recordVerifiedBinding } from '../../src/services/homeBinding.js';
import { createSyncV2Router } from '../../src/routes/syncV2.js';
import { encrypt } from '../../src/services/crypto.js';
import { config } from '../../src/config.js';

let db:Database.Database;
beforeEach(()=>{
  db=new Database(':memory:');initializeSyncV2(db);
  db.exec("CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT);INSERT INTO sync_v2_workspace VALUES('w',42,'2026-10-01',0)");
  db.prepare('INSERT INTO settings VALUES(?,?)').run('github_token',encrypt('fixture-token',config.encryptionKey));
  recordVerifiedBinding(db,{id:42,login:'owner'});
});
afterEach(()=>{db.close();vi.restoreAllMocks();});
describe('durable Home binding',()=>{
  it('normal replication never calls GitHub even with an expired audit',async()=>{
    db.prepare("UPDATE sync_v2_binding SET next_audit_at='2020-01-01'").run();
    const network=vi.spyOn(globalThis,'fetch').mockRejectedValue(Error('offline'));
    const app=express().use(express.json()).use(createSyncV2Router({db:()=>db,requireSecret:false}));
    expect((await request(app).get('/api/sync/v2/changes?workspaceId=w&githubUserId=42')).status).toBe(200);
    expect((await request(app).get('/api/sync/v2/snapshot?workspaceId=w&githubUserId=42')).status).toBe(200);
    expect(network).not.toHaveBeenCalled();
  });
  it('offline audits publish retry status without blocking LAN replication',async()=>{
    await auditWorkspaceBinding(db,async()=>{throw Error('offline');},true);
    expect(bindingStatus(db)).toMatchObject({status:'verified',error:'GITHUB_AUDIT_UNAVAILABLE'});
    expect(()=>assertWorkspace(db,'w',42)).not.toThrow();
  });
  it('blocks an authenticated account mismatch and persists it across audits',async()=>{
    await auditWorkspaceBinding(db,async()=>({id:43,login:'wrong'}),true);
    expect(()=>assertWorkspace(db,'w',42)).toThrow('WORKSPACE_BINDING_BLOCKED');
    await auditWorkspaceBinding(db,async()=>{throw Error('offline');},true);
    expect(bindingStatus(db)?.status).toBe('blocked');
  });
  it('does not apply a stale audit after a token rotation',async()=>{
    let resolve!:(value:{id:number;login:string})=>void;
    const pending=auditWorkspaceBinding(db,()=>new Promise(r=>{resolve=r;}),true);
    db.prepare("UPDATE settings SET value=? WHERE key='github_token'").run(encrypt('rotated',config.encryptionKey));
    recordVerifiedBinding(db,{id:42,login:'owner'});
    resolve({id:43,login:'stale'});await pending;
    expect(bindingStatus(db)?.status).toBe('verified');
  });
  it('runs a successful audit only once a day',async()=>{
    const verify=vi.fn(async()=>({id:42,login:'owner'}));
    await auditWorkspaceBinding(db,verify);expect(verify).not.toHaveBeenCalled();
    await auditWorkspaceBinding(db,verify,true);await auditWorkspaceBinding(db,verify);
    expect(verify).toHaveBeenCalledOnce();
  });
});
