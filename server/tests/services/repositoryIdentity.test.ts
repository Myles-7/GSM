import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { initializeIdentityMigration, previewIdentityMigration, applyIdentityMigration, restoreIdentityMigration } from '../../src/services/repositoryIdentity.js';
import { initializeSyncV2, bootstrapWorkspace, getWorkspace, getRecord, pushOperations, writeCanonicalRecord } from '../../src/services/syncV2.js';
import { initializeSchema } from '../../src/db/schema.js';

describe('confirmed canonical repository identity migration', () => {
  let db: Database.Database;
  const oldId = 1_700_000_000_001, newId = 123;
  const mappings = [{ oldId,newId,fullName:'owner/repo',evidence:'manual confirmation of retained source and GitHub identity' }];
  beforeEach(() => {
    db = new Database(':memory:'); initializeSyncV2(db); initializeIdentityMigration(db);
    const input = { githubUserId:42,source:'desktop',records:[
      { collection:'repositories' as const,id:String(oldId),data:{id:oldId,full_name:'owner/repo',ai_summary:'keep',custom_description:'',category_locked:true} },
      { collection:'organization' as const,id:'default',data:{repositoryOrder:[oldId],customCategories:[],subcategories:[]} },
      { collection:'releases' as const,id:'99',data:{id:99,repository:{id:oldId},body:'evidence old id '+oldId} },
      { collection:'subscriptions' as const,id:String(oldId),data:{repoId:oldId,subscribed:true} },
      { collection:'sessions' as const,id:'session',data:{repoId:oldId} },
      { collection:'evidence' as const,id:'evidence',data:{repoId:oldId} },
    ]};
    const preview = bootstrapWorkspace(db,input);
    bootstrapWorkspace(db,{...input,confirm:true,previewToken:'previewToken' in preview ? preview.previewToken:''});
  });
  afterEach(() => db.close());
  const input = () => { const workspace = getWorkspace(db)!; return {workspaceId:workspace.id,githubUserId:42,mappings}; };
  const apply = () => { const value=input(); return applyIdentityMigration(db,{...value,...previewIdentityMigration(db,value),journalId:'migration-1'}); };
  const state = () => Object.fromEntries([
    'sync_v2_records', 'sync_v2_changes', 'sync_v2_operations', 'sync_v2_conflicts',
    'repository_identity_maps', 'repository_identity_journals',
  ].map(table => [table, db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]));
  const businessState = () => Object.fromEntries(
    Object.entries(state()).filter(([table]) => table !== 'repository_identity_journals'),
  );
  const repository = (id = oldId) => ({ id, full_name: 'owner/repo', custom_description: '' });
  const proposal = () => ({
    ownerId: '42', sessionId: 'session',
    operations: [
      { status: 'proposed', repository: repository(), before: { category_id: 'old' }, after: { category_id: 'new' } },
      ...['success', 'failed', 'unknown', 'conflict', 'restored'].map(status => ({ status, repository: repository() })),
    ],
    organization: {
      status: 'ready', scope: { repositoryIds: [oldId] },
      entries: [{ repositoryId: oldId, status: 'pending' }, { repositoryId: 456, status: 'success' }],
      batches: [{ repositoryIds: [oldId], status: 'pending' }, { repositoryIds: [oldId], status: 'complete' }],
    },
    evidence: { repository: repository() }, extension: { id: oldId },
  });
  it('rekeys mutable records atomically, retains intentional empties and immutable evidence', () => {
    apply();
    expect(getRecord(db,'repositories',String(oldId))?.deleted).toBe(true);
    expect(getRecord(db,'repositories',String(newId))?.data).toMatchObject({id:newId,ai_summary:'keep',custom_description:'',category_locked:true});
    expect(getRecord(db,'releases','99')?.data).toMatchObject({id:99,repository:{id:newId},body:'evidence old id '+oldId});
    expect(getRecord(db,'organization','default')?.data?.repositoryOrder).toEqual([newId]);
    expect(getRecord(db,'subscriptions',String(newId))?.data?.repoId).toBe(newId);
    expect(getRecord(db,'sessions','session')?.data?.repoId).toBe(newId);
    expect(getRecord(db,'evidence','evidence')?.data?.repoId).toBe(oldId);
  });
  it('allows exact old operation ACK after migration, but rejects late writes/references', () => {
    const identity=input();
    const operation={opId:'lost-ack',collection:'repositories' as const,id:String(oldId),kind:'put' as const,baseVersion:1,data:{id:oldId,full_name:'owner/repo',ai_summary:'keep'}};
    const request={...identity,clientId:'client',operations:[operation]};
    const accepted=pushOperations(db,request);
    apply();
    expect(pushOperations(db,request).results).toEqual(accepted.results);
    const late=pushOperations(db,{...request,operations:[{...operation,opId:'late',baseVersion:2}]});
    expect(late.results[0].conflict.reason).toBe('REPOSITORY_IDENTITY_UPGRADE_REQUIRED');
    const ref=pushOperations(db,{...identity,clientId:'other',operations:[{opId:'stale-ref',collection:'sessions',id:'session',kind:'put',baseVersion:2,data:{repoId:oldId}}]});
    expect(ref.results[0].conflict.reason).toBe('REPOSITORY_IDENTITY_UPGRADE_REQUIRED');
  });
  it('replays the same journal without repeating writes and rejects changed scope/payload', () => {
    const value=input(), preview=previewIdentityMigration(db,value);
    const request={...value,...preview,journalId:'migration-1'};
    const first=applyIdentityMigration(db,request);
    const cursor=db.prepare('SELECT COUNT(*) AS n FROM sync_v2_changes').get();
    expect(applyIdentityMigration(db,request)).toEqual(first);
    expect(db.prepare('SELECT COUNT(*) AS n FROM sync_v2_changes').get()).toEqual(cursor);
    expect(()=>applyIdentityMigration(db,{...request,mappings:[{...mappings[0],newId:321}]})).toThrow('JOURNAL_REUSED');
    expect(()=>applyIdentityMigration(db,{...request,githubUserId:43})).toThrow('ACCOUNT_MISMATCH');
  });
  it('invalidates previews after concurrent edits and refuses target tombstones', () => {
    const value=input(), preview=previewIdentityMigration(db,value);
    pushOperations(db,{...value,clientId:'editor',operations:[{opId:'other',collection:'sessions',id:'session',kind:'put',baseVersion:1,data:{repoId:oldId,title:'changed'}}]});
    expect(()=>applyIdentityMigration(db,{...value,...preview,journalId:'migration-1'})).toThrow('PREVIEW_CHANGED');
    expect(getRecord(db,'repositories',String(oldId))?.deleted).toBe(false);
    pushOperations(db,{...value,clientId:'editor',operations:[{opId:'delete-target',collection:'repositories',id:String(newId),kind:'delete',baseVersion:0}]});
    expect(()=>previewIdentityMigration(db,value)).toThrow('TOMBSTONED');
  });
  it('protects external discovery configuration from old projection writes', () => {
    const identity=input();
    pushOperations(db,{...identity,clientId:'new',operations:[{opId:'config2',collection:'discovery_config',id:'default',kind:'put',baseVersion:0,data:{schemaVersion:2,channels:[{id:'external:test',sourceUrl:'https://example.com/feed'}]}}]});
    const result=pushOperations(db,{...identity,clientId:'old',operations:[{opId:'config1',collection:'discovery_config',id:'default',kind:'put',baseVersion:1,data:{channels:[]}}]});
    expect(result.results[0].conflict.reason).toBe('DISCOVERY_CONFIG_UPGRADE_REQUIRED');
  });
  it('rekeys only canonical recommended repository keys and preserves unknown keys and opaque counters', () => {
    const recommended = Object.fromEntries([
      [String(oldId), { score: 7, explanation: 'retained recommendation' }],
      ['readme', { retained: 'first unknown' }],
      ['NaN', { retained: 'second unknown' }],
      ['', { retained: 'empty unknown' }],
      [`0${oldId}`, { retained: 'noncanonical numeric key' }],
      [`+${oldId}`, { retained: 'noncanonical signed key' }],
      ['1.700000000001e12', { retained: 'noncanonical exponent key' }],
      ['000456', { retained: 'unmatched numeric key' }],
    ]);
    const data = { id: 'custom:feed', recommended, read: [oldId], blocked: [],
      counters: { [oldId]: 5, opaque: { repositoryId: oldId } } };
    writeCanonicalRecord(db, { collection: 'discovery_subscriptions', id: data.id, data, deleted: false });
    apply();
    const { [String(oldId)]: migrated, ...unknown } = recommended;
    expect(getRecord(db, 'discovery_subscriptions', data.id)?.data).toEqual({
      ...data, read: [newId], recommended: { ...unknown, [newId]: migrated },
    });
    restoreIdentityMigration(db, { ...input(), journalId: 'migration-1' });
    expect(getRecord(db, 'discovery_subscriptions', data.id)?.data).toEqual(data);
  });
  it.each([false, true])('rejects recommended target-key collisions atomically, even if values are equal=%s', equal => {
    const value = input(), inputHash = previewIdentityMigration(db, value).inputHash;
    const recommended = { [oldId]: { score: 7 }, [newId]: { score: equal ? 7 : 8 }, opaque: 'keep' };
    writeCanonicalRecord(db, { collection: 'discovery_subscriptions', id: 'custom:feed',
      data: { id: 'custom:feed', recommended }, deleted: false });
    const before = state(), recovery = { ...value, inputHash, journalId: 'recommended-collision' };
    expect(() => previewIdentityMigration(db, value)).toThrow('REPOSITORY_IDENTITY_COLLISION');
    expect(() => applyIdentityMigration(db, recovery)).toThrow('REPOSITORY_IDENTITY_COLLISION');
    expect(() => restoreIdentityMigration(db, recovery)).toThrow('REPOSITORY_IDENTITY_COLLISION');
    expect(state()).toEqual(before);
  });
  it('allows upgraded recommended writes retaining unknown keys but guards old-key references', () => {
    apply();
    const data = { id: 'custom:feed', recommended: {
      [newId]: { score: 7 }, unknown: { repositoryId: oldId }, [`0${oldId}`]: 3, '000456': 4,
    }, counters: { [oldId]: 5 } };
    const operation = { opId: 'recommended-upgraded', collection: 'discovery_subscriptions' as const,
      id: data.id, kind: 'put' as const, baseVersion: 0, data };
    const response = pushOperations(db, { ...input(), clientId: 'upgraded', operations: [operation] });
    expect(response.results[0].status).toBe('applied');
    expect(getRecord(db, 'discovery_subscriptions', data.id)?.data).toEqual(data);
    const late = pushOperations(db, { ...input(), clientId: 'old', operations: [{
      ...operation, opId: 'recommended-old-key', baseVersion: 1,
      data: { ...data, recommended: { ...data.recommended, [oldId]: 9 } },
    }] });
    expect(late.results[0].conflict.reason).toBe('REPOSITORY_IDENTITY_UPGRADE_REQUIRED');
    expect(getRecord(db, 'discovery_subscriptions', data.id)?.data).toEqual(data);
  });
  it('rekeys nested mutable selections and pending proposals without touching historical evidence', () => {
    const session = {
      ownerId: '42', repoId: oldId, repoFullName: 'owner/repo',
      workbench: { selectedRepositories: [repository()], searchBatches: [{ candidates: [{ repository: repository() }] }] },
      extension: { repoId: oldId },
    };
    const pending = proposal();
    writeCanonicalRecord(db, { collection: 'sessions', id: 'session', data: session, deleted: false });
    writeCanonicalRecord(db, { collection: 'proposals', id: 'proposal', data: pending, deleted: false });
    writeCanonicalRecord(db, { collection: 'projects', id: 'project', data: { repositories: [repository()] }, deleted: false });
    writeCanonicalRecord(db, { collection: 'discovery_editions', id: 'edition', data: { entries: [repository()] }, deleted: false });
    const evidence = getRecord(db, 'evidence', 'evidence');
    const edition = getRecord(db, 'discovery_editions', 'edition');

    apply();

    expect(getRecord(db, 'sessions', 'session')?.data).toEqual({
      ...session, repoId: newId, workbench: { ...session.workbench, selectedRepositories: [repository(newId)] },
    });
    expect(getRecord(db, 'proposals', 'proposal')?.data).toEqual({
      ...pending,
      operations: pending.operations.map(operation => operation.status === 'proposed'
        ? { ...operation, repository: repository(newId) } : operation),
      organization: {
        ...pending.organization, scope: { repositoryIds: [newId] },
        entries: [{ repositoryId: newId, status: 'pending' }, pending.organization.entries[1]],
        batches: [{ repositoryIds: [newId], status: 'pending' }, pending.organization.batches[1]],
      },
    });
    expect(getRecord(db, 'projects', 'project')?.data).toEqual({ repositories: [repository(newId)] });
    expect(getRecord(db, 'evidence', 'evidence')).toEqual(evidence);
    expect(getRecord(db, 'discovery_editions', 'edition')).toEqual(edition);
  });
  it.each([
    ['sessions', { repoId: newId, workbench: { selectedRepositories: [repository()] } }],
    ['proposals', { operations: [{ status: 'proposed', repository: repository() }] }],
    ['proposals', { organization: { status: 'ready', scope: { repositoryIds: [oldId] }, entries: [], batches: [] } }],
    ['proposals', { organization: { status: 'interrupted', scope: { repositoryIds: [newId] }, entries: [{ status: 'pending', repositoryId: oldId }], batches: [] } }],
    ['proposals', { organization: { status: 'imported', scope: { repositoryIds: [newId] }, entries: [], batches: [{ status: 'pending', repositoryIds: [oldId] }] } }],
  ] as const)('rejects late mutable nested references in %s', (collection, data) => {
    apply();
    const result = pushOperations(db, { ...input(), clientId: 'old-client', operations: [
      { opId: 'late-nested', collection, id: 'late', kind: 'put', baseVersion: 0, data },
    ] });
    expect(result.results[0].conflict.reason).toBe('REPOSITORY_IDENTITY_UPGRADE_REQUIRED');
    expect(getRecord(db, collection, 'late')).toBeNull();
  });
  it('accepts historical proposal references without rewriting their evidence', () => {
    apply();
    const data = {
      operations: [{ status: 'success', repository: repository() }],
      organization: { status: 'applied', scope: { repositoryIds: [oldId] }, entries: [{ status: 'success', repositoryId: oldId }] },
    };
    const result = pushOperations(db, { ...input(), clientId: 'history', operations: [
      { opId: 'history', collection: 'proposals', id: 'history', kind: 'put', baseVersion: 0, data },
    ] });
    expect(result.results[0].status).toBe('applied');
    expect(getRecord(db, 'proposals', 'history')?.data).toEqual(data);
  });
  it('preserves completed organization entries and batches inside a mutable draft', () => {
    const data = {
      operations: [],
      organization: {
        status: 'ready', scope: { repositoryIds: [oldId] },
        entries: [{ repositoryId: oldId, status: 'success' }],
        batches: [{ repositoryIds: [oldId], status: 'complete' }],
      },
    };
    writeCanonicalRecord(db, { collection: 'proposals', id: 'draft', data, deleted: false });
    apply();
    expect(getRecord(db, 'proposals', 'draft')?.data).toEqual({
      ...data, organization: { ...data.organization, scope: { repositoryIds: [newId] } },
    });
  });
  it('rejects a pending organization entry colliding with retained completed evidence', () => {
    const data = {
      operations: [],
      organization: {
        status: 'ready', scope: { repositoryIds: [oldId, newId] },
        entries: [{ repositoryId: oldId, status: 'pending' }, { repositoryId: newId, status: 'success' }],
        batches: [],
      },
    };
    writeCanonicalRecord(db, { collection: 'proposals', id: 'draft', data, deleted: false });
    const before = state();
    expect(() => apply()).toThrow('ORGANIZATION_IDENTITY_COLLISION');
    expect(state()).toEqual(before);
  });
  it('rejects mutation of references explicitly owned by another account', () => {
    writeCanonicalRecord(db, { collection: 'sessions', id: 'session', data: {
      ownerId: '43', repoId: oldId, repoFullName: 'owner/repo',
    }, deleted: false });
    const before = state();
    expect(() => apply()).toThrow('IDENTITY_REFERENCE_OWNER_CONFLICT');
    expect(state()).toEqual(before);
  });
  it.each([
    { workbench: { selectedRepositories: [repository(), repository(newId)] } },
    { workbench: { selectedRepositories: [{ ...repository(), full_name: 'other/repo' }] } },
  ])('rejects nested identity collisions before committing any migration', data => {
    writeCanonicalRecord(db, { collection: 'sessions', id: 'session', data: { repoId: oldId, ...data }, deleted: false });
    const before = state();
    expect(() => apply()).toThrow(/COLLISION|NAME_CONFLICT/);
    expect(state()).toEqual(before);
  });
  it.each([
    { operations: [{ status: 'running', repository: repository() }] },
    { operations: [], organization: { status: 'applying', scope: { repositoryIds: [oldId] } } },
    { operations: [], organization: { status: 'generating', scope: { repositoryIds: [oldId] } } },
    { operations: [], organization: { status: 'restoring', scope: { repositoryIds: [oldId] } } },
  ])('refuses to rekey a running mutable operation', data => {
    writeCanonicalRecord(db, { collection: 'proposals', id: 'busy', data, deleted: false });
    const before = state();
    expect(() => apply()).toThrow(/PAUSE_RUNNING/);
    expect(state()).toEqual(before);
  });
  it('durably cancels a prepared local journal without writing business data or repeating writes', () => {
    const value = input(), preview = previewIdentityMigration(db, value);
    const before = businessState();
    const recovery = { ...value, inputHash: preview.inputHash, journalId: 'local-prepared' };
    const result = { journalId: recovery.journalId, restored: false, notApplied: true };
    expect(restoreIdentityMigration(db, recovery)).toEqual(result);
    expect(businessState()).toEqual(before);
    expect(db.prepare('SELECT * FROM repository_identity_journals WHERE id=?').get(recovery.journalId)).toMatchObject({
      workspace_id: value.workspaceId, github_user_id: value.githubUserId,
      input_hash: recovery.inputHash, mappings: JSON.stringify(mappings),
      status: 'cancelled', backup: '[]', result: JSON.stringify(result),
    });
    const cancelled = state(), writes = db.prepare('SELECT total_changes() AS n').get();
    expect(restoreIdentityMigration(db, recovery)).toEqual(result);
    expect(state()).toEqual(cancelled);
    expect(db.prepare('SELECT total_changes() AS n').get()).toEqual(writes);
  });
  it('rejects the delayed original apply and its exact retry after restore cancelled it', () => {
    const value = input();
    const recovery = { ...value, inputHash: previewIdentityMigration(db, value).inputHash, journalId: 'delayed-apply' };
    restoreIdentityMigration(db, recovery);
    const cancelled = state(), writes = db.prepare('SELECT total_changes() AS n').get();
    expect(() => applyIdentityMigration(db, recovery)).toThrow('IDENTITY_JOURNAL_RESTORED');
    expect(() => applyIdentityMigration(db, recovery)).toThrow('IDENTITY_JOURNAL_RESTORED');
    expect(state()).toEqual(cancelled);
    expect(db.prepare('SELECT total_changes() AS n').get()).toEqual(writes);
  });
  it('binds cancellation to the original scope, hash and mappings', () => {
    const value = input();
    const recovery = { ...value, inputHash: previewIdentityMigration(db, value).inputHash, journalId: 'cancelled' };
    restoreIdentityMigration(db, recovery);
    const cancelled = state();
    for (const command of [applyIdentityMigration, restoreIdentityMigration]) {
      expect(() => command(db, { ...recovery, inputHash: '0'.repeat(64) })).toThrow('IDENTITY_JOURNAL_REUSED');
      expect(() => command(db, { ...recovery, mappings: [{ ...mappings[0], newId: 321 }] })).toThrow('IDENTITY_JOURNAL_REUSED');
      expect(() => command(db, { ...recovery, githubUserId: 43 })).toThrow('WORKSPACE_ACCOUNT_MISMATCH');
      expect(() => command(db, { ...recovery, workspaceId: 'other' })).toThrow('WORKSPACE_ACCOUNT_MISMATCH');
    }
    expect(state()).toEqual(cancelled);
  });
  it('reports pre-apply preview changes without overwriting another client edit', () => {
    const value = input(), preview = previewIdentityMigration(db, value);
    const recovery = { ...value, inputHash: preview.inputHash, journalId: 'local-prepared' };
    pushOperations(db, { ...value, clientId: 'editor', operations: [
      { opId: 'new-edit', collection: 'sessions', id: 'session', kind: 'put', baseVersion: 1, data: { repoId: oldId, title: 'Keep this edit' } },
    ] });
    expect(() => applyIdentityMigration(db, recovery)).toThrow('IDENTITY_PREVIEW_CHANGED');
    const before = businessState();
    expect(restoreIdentityMigration(db, recovery)).toMatchObject({ notApplied: true, restored: false });
    expect(businessState()).toEqual(before);
    const cancelled = state();
    expect(() => applyIdentityMigration(db, recovery)).toThrow('IDENTITY_JOURNAL_RESTORED');
    expect(state()).toEqual(cancelled);
  });
  it('restores a lost apply ACK and replays a lost restore ACK without rewriting operation evidence', () => {
    const value = input();
    const operation = { opId: 'original', collection: 'sessions' as const, id: 'session', kind: 'put' as const, baseVersion: 1, data: { repoId: oldId } };
    const request = { ...value, clientId: 'client', operations: [operation] };
    const acknowledgement = pushOperations(db, request);
    const recovery = { ...value, inputHash: previewIdentityMigration(db, value).inputHash, journalId: 'lost-ack' };
    const operations = db.prepare('SELECT * FROM sync_v2_operations ORDER BY rowid').all();
    applyIdentityMigration(db, recovery); // The local journal has not acknowledged this response.

    expect(restoreIdentityMigration(db, recovery)).toEqual({ journalId: recovery.journalId, restored: true });
    expect(getRecord(db, 'repositories', String(oldId))?.deleted).toBe(false);
    expect(getRecord(db, 'repositories', String(newId))?.deleted).toBe(true);
    expect(getRecord(db, 'sessions', 'session')?.data).toEqual({ repoId: oldId });
    expect(db.prepare('SELECT * FROM sync_v2_operations ORDER BY rowid').all()).toEqual(operations);
    const restored = state();
    expect(restoreIdentityMigration(db, recovery)).toEqual({ journalId: recovery.journalId, restored: true });
    expect(state()).toEqual(restored);
    expect(pushOperations(db, request).results).toEqual(acknowledgement.results);
  });
  it('refuses lost-ACK recovery after another client changed canonical data', () => {
    const value = input();
    const recovery = { ...value, inputHash: previewIdentityMigration(db, value).inputHash, journalId: 'lost-ack' };
    applyIdentityMigration(db, recovery);
    pushOperations(db, { ...value, clientId: 'editor', operations: [
      { opId: 'new-edit', collection: 'sessions', id: 'session', kind: 'put', baseVersion: 2, data: { repoId: newId, title: 'Keep this edit' } },
    ] });
    const before = state();
    expect(() => restoreIdentityMigration(db, recovery)).toThrow('IDENTITY_RECOVERY_REMOTE_CHANGED');
    expect(state()).toEqual(before);
  });
  it('requires original recovery proof and rejects reused journal inputs', () => {
    const value = input(), inputHash = previewIdentityMigration(db, value).inputHash;
    expect(() => restoreIdentityMigration(db, { ...value, journalId: 'missing' })).toThrow('IDENTITY_RECOVERY_PROOF_REQUIRED');
    expect(() => restoreIdentityMigration(db, { ...value, journalId: 'missing', inputHash: 'invalid' })).toThrow('IDENTITY_INVALID_INPUT_HASH');
    const recovery = { ...value, inputHash, journalId: 'migration-1' };
    applyIdentityMigration(db, recovery);
    expect(() => restoreIdentityMigration(db, { ...recovery, inputHash: '0'.repeat(64) })).toThrow('IDENTITY_JOURNAL_REUSED');
    expect(() => restoreIdentityMigration(db, { ...recovery, mappings: [{ ...mappings[0], newId: 321 }] })).toThrow('IDENTITY_JOURNAL_REUSED');
    expect(() => restoreIdentityMigration(db, { ...recovery, githubUserId: 43 })).toThrow('WORKSPACE_ACCOUNT_MISMATCH');
  });
  it('does not call a missing journal notApplied when mapping evidence remains', () => {
    const value = input(), inputHash = previewIdentityMigration(db, value).inputHash;
    applyIdentityMigration(db, { ...value, inputHash, journalId: 'migration-1' });
    db.prepare('DELETE FROM repository_identity_journals WHERE id=?').run('migration-1');
    const before = state();
    expect(() => restoreIdentityMigration(db, { ...value, inputHash, journalId: 'migration-1' })).toThrow('IDENTITY_RECOVERY_MAPPING_CONFLICT');
    expect(state()).toEqual(before);
  });
  it('rejects another journal mapping or a journal ID bound to another workspace', () => {
    const value = input(), inputHash = previewIdentityMigration(db, value).inputHash;
    db.prepare('INSERT INTO repository_identity_maps VALUES(?,?,?,?,?,?,?)')
      .run(value.workspaceId, 42, oldId, newId, 'owner/repo', 'manual', 'other-journal');
    expect(() => restoreIdentityMigration(db, { ...value, inputHash, journalId: 'missing' })).toThrow('IDENTITY_RECOVERY_MAPPING_CONFLICT');
    db.prepare('DELETE FROM repository_identity_maps').run();
    db.prepare('INSERT INTO repository_identity_journals VALUES(?,?,?,?,?,?,?,?,?)')
      .run('foreign-journal', 'other-workspace', 43, inputHash, JSON.stringify(mappings), 'complete', '[]', '{}', 'now');
    expect(() => restoreIdentityMigration(db, { ...value, inputHash, journalId: 'foreign-journal' })).toThrow('IDENTITY_RECOVERY_SCOPE_CONFLICT');
  });
  it.each(['missing', 'tombstone', 'recreated', 'rekeyed', 'name-collision', 'target-collision'] as const)(
    'rejects notApplied recovery with %s source/target evidence', scenario => {
      const value = input(), inputHash = previewIdentityMigration(db, value).inputHash;
      if (scenario === 'missing') db.prepare("DELETE FROM sync_v2_records WHERE collection='repositories' AND id=?").run(String(oldId));
      if (scenario === 'tombstone' || scenario === 'recreated') {
        writeCanonicalRecord(db, { collection: 'repositories', id: String(oldId), data: null, deleted: true });
      }
      if (scenario === 'recreated') writeCanonicalRecord(db, { collection: 'repositories', id: String(oldId), data: repository(), deleted: false });
      if (scenario === 'rekeyed') writeCanonicalRecord(db, { collection: 'repositories', id: String(oldId), data: repository(newId), deleted: false });
      if (scenario === 'name-collision') writeCanonicalRecord(db, { collection: 'repositories', id: String(oldId), data: { ...repository(), full_name: 'other/repo' }, deleted: false });
      if (scenario === 'target-collision') writeCanonicalRecord(db, { collection: 'repositories', id: String(newId), data: { ...repository(newId), full_name: 'other/repo' }, deleted: false });
      const before = state();
      expect(() => restoreIdentityMigration(db, { ...value, inputHash, journalId: 'missing' })).toThrow(/IDENTITY_/);
      expect(state()).toEqual(before);
    },
  );
  it('checks active server tasks before a notApplied recovery', () => {
    const value = input(), inputHash = previewIdentityMigration(db, value).inputHash;
    db.exec('CREATE TABLE ai_tasks(workspace_id TEXT,status TEXT)');
    db.prepare('INSERT INTO ai_tasks VALUES(?,?)').run(value.workspaceId, 'running');
    const before = state();
    expect(() => restoreIdentityMigration(db, { ...value, inputHash, journalId: 'missing' })).toThrow('IDENTITY_ACTIVE_TASKS');
    expect(state()).toEqual(before);
  });
  it('checks active tasks before both apply and an applied-journal recovery', () => {
    const value = input(), inputHash = previewIdentityMigration(db, value).inputHash;
    const recovery = { ...value, inputHash, journalId: 'migration-1' };
    db.exec('CREATE TABLE ai_tasks(workspace_id TEXT,status TEXT)');
    db.prepare('INSERT INTO ai_tasks VALUES(?,?)').run(value.workspaceId, 'queued');
    expect(() => applyIdentityMigration(db, recovery)).toThrow('IDENTITY_ACTIVE_TASKS');
    db.prepare('DELETE FROM ai_tasks').run();
    applyIdentityMigration(db, recovery);
    db.prepare('INSERT INTO ai_tasks VALUES(?,?)').run(value.workspaceId, 'running');
    const before = state();
    expect(() => restoreIdentityMigration(db, recovery)).toThrow('IDENTITY_ACTIVE_TASKS');
    expect(state()).toEqual(before);
  });
  it.each([
    'custom_description', 'custom_tags', 'custom_category', 'category_id', 'subcategory_id',
    'category_locked', 'category_candidates', 'category_legacy', 'ai_summary', 'ai_tags',
    'ai_platforms', 'ai_details',
  ])('rejects conflicting %s metadata atomically during apply and cancellation', field => {
    const value = input(), inputHash = previewIdentityMigration(db, value).inputHash;
    writeCanonicalRecord(db, { collection: 'repositories', id: String(oldId),
      data: { ...repository(), [field]: 'retained source' }, deleted: false });
    writeCanonicalRecord(db, { collection: 'repositories', id: String(newId),
      data: { ...repository(newId), [field]: 'retained target' }, deleted: false });
    const before = state(), recovery = { ...value, inputHash, journalId: 'collision' };
    expect(() => applyIdentityMigration(db, recovery)).toThrow('IDENTITY_METADATA_COLLISION');
    expect(() => restoreIdentityMigration(db, recovery)).toThrow('IDENTITY_METADATA_COLLISION');
    expect(state()).toEqual(before);
  });
  it.each(['', null])('does not overwrite target AI metadata with intentional source %s', ai_summary => {
    writeCanonicalRecord(db, { collection: 'repositories', id: String(oldId),
      data: { ...repository(), ai_summary }, deleted: false });
    writeCanonicalRecord(db, { collection: 'repositories', id: String(newId),
      data: { ...repository(newId), ai_summary: 'target AI' }, deleted: false });
    const before = state();
    expect(() => apply()).toThrow('IDENTITY_METADATA_COLLISION');
    expect(state()).toEqual(before);
  });
  it('preserves equal and non-overlapping source and target metadata', () => {
    writeCanonicalRecord(db, { collection: 'repositories', id: String(newId),
      data: { ...repository(newId), ai_summary: 'keep', ai_details: { unknown: ['target detail'] },
        custom_tags: [], category_candidates: ['candidate'] }, deleted: false });
    apply();
    expect(getRecord(db, 'repositories', String(newId))?.data).toMatchObject({
      ai_summary: 'keep', ai_details: { unknown: ['target detail'] },
      custom_tags: [], category_candidates: ['candidate'], custom_description: '', category_locked: true,
    });
  });
});

describe.each([false, true])('identity migration with full legacy schema (cascade=%s)', cascade => {
  let db: Database.Database;
  const oldId = 1_700_000_000_001, newId = 123;
  const mappings = [{ oldId, newId, fullName: 'owner/repo', evidence: 'manual identity confirmation' }];
  const repository = (id: number, name = 'repo') => ({
    id, name, full_name: `owner/${name}`, html_url: `https://github.com/owner/${name}`,
    owner: { login: 'owner', avatar_url: 'https://example.com/avatar' },
    ai_summary: 'retained AI', custom_description: '', category_locked: true,
    category_id: 'cat', ai_details: { nested: ['retained'] },
  });
  const release = (id: number, repoId: number, name = 'repo') => ({
    id, tag_name: 'v1', body: 'immutable release body', repository: repository(repoId, name),
    repo_id: repoId, repo_name: name, repo_full_name: `owner/${name}`,
    assets: [{ id: 1, name: 'asset.zip' }], extension: { repositoryId: oldId },
  });
  const tables = [
    'repositories', 'releases', 'settings', 'sync_v2_records', 'sync_v2_changes',
    'sync_v2_operations', 'sync_v2_conflicts', 'repository_identity_maps', 'repository_identity_journals',
  ];
  const state = () => Object.fromEntries(tables.map(table => [table, db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]));
  const input = () => ({ workspaceId: getWorkspace(db)!.id, githubUserId: 42, mappings });
  const request = () => ({ ...input(), inputHash: previewIdentityMigration(db, input()).inputHash, journalId: 'full-schema' });
  const assertProjection = (repoId: number, absentId: number) => {
    expect(getRecord(db, 'repositories', String(repoId))).toMatchObject({ deleted: false, data: repository(repoId) });
    expect(getRecord(db, 'repositories', String(absentId))).toMatchObject({ deleted: true, data: null });
    expect(db.prepare('SELECT * FROM repositories WHERE id=?').get(absentId)).toBeUndefined();
    expect(db.prepare('SELECT * FROM repositories WHERE id=?').get(repoId)).toMatchObject({
      id: repoId, full_name: 'owner/repo', ai_summary: 'retained AI', custom_description: '',
      category_locked: 1, category_id: 'cat', subscribed_to_releases: 1,
      ai_details: JSON.stringify({ nested: ['retained'] }),
    });
    expect(getRecord(db, 'subscriptions', String(repoId))).toMatchObject({
      deleted: false, data: { repoId, subscribed: true },
    });
    expect(getRecord(db, 'subscriptions', String(absentId))).toMatchObject({ deleted: true, data: null });
    expect(getRecord(db, 'releases', '99')?.data).toEqual(release(99, repoId));
    expect(db.prepare('SELECT * FROM releases WHERE id=99').get()).toMatchObject({
      repo_id: repoId, repo_name: 'repo', repo_full_name: 'owner/repo',
      body: 'immutable release body', assets: JSON.stringify([{ id: 1, name: 'asset.zip' }]), is_read: 1,
    });
    expect(db.prepare('SELECT COUNT(*) AS n FROM releases').get()).toEqual({ n: 2 });
    expect(db.pragma('foreign_key_check')).toEqual([]);
  };
  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    if (cascade) db.exec(`CREATE TABLE releases (
      id INTEGER PRIMARY KEY, tag_name TEXT NOT NULL, name TEXT, body TEXT, published_at TEXT,
      html_url TEXT, assets TEXT, repo_id INTEGER NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
      repo_full_name TEXT NOT NULL, repo_name TEXT NOT NULL,
      prerelease INTEGER DEFAULT 0, draft INTEGER DEFAULT 0, is_read INTEGER DEFAULT 0
    )`);
    initializeSchema(db);
    initializeSyncV2(db);
    initializeIdentityMigration(db);
    const seed = { githubUserId: 42, source: 'desktop', records: [
      { collection: 'repositories' as const, id: String(oldId), data: repository(oldId) },
      { collection: 'repositories' as const, id: '456', data: repository(456, 'unrelated') },
      { collection: 'subscriptions' as const, id: String(oldId), data: { repoId: oldId, subscribed: true } },
      { collection: 'releases' as const, id: '99', data: release(99, oldId) },
      { collection: 'release_reads' as const, id: '99', data: { is_read: true } },
      { collection: 'releases' as const, id: '100', data: release(100, 456, 'unrelated') },
      { collection: 'sessions' as const, id: 'session', data: { repoId: oldId } },
      { collection: 'evidence' as const, id: 'evidence', data: { repoId: oldId } },
    ] };
    const preview = bootstrapWorkspace(db, seed);
    bootstrapWorkspace(db, { ...seed, confirm: true, previewToken: 'previewToken' in preview ? preview.previewToken : '' });
  });
  afterEach(() => db.close());
  it('applies and restores through UNIQUE constraints without losing releases, reads or subscriptions', () => {
    const recovery = request(), before = state();
    applyIdentityMigration(db, recovery);
    assertProjection(newId, oldId);
    expect(state().sync_v2_operations).toEqual(before.sync_v2_operations);
    expect(getRecord(db, 'evidence', 'evidence')?.data).toEqual({ repoId: oldId });
    expect(getRecord(db, 'releases', '100')?.data).toEqual(release(100, 456, 'unrelated'));
    expect(restoreIdentityMigration(db, recovery)).toEqual({ journalId: recovery.journalId, restored: true });
    assertProjection(oldId, newId);
    expect(state().repositories).toEqual(before.repositories);
    expect(state().releases).toEqual(before.releases);
    expect(state().sync_v2_operations).toEqual(before.sync_v2_operations);
    expect(state().repository_identity_maps).toEqual([]);
    const restored = state(), writes = db.prepare('SELECT total_changes() AS n').get();
    expect(restoreIdentityMigration(db, recovery)).toEqual({ journalId: recovery.journalId, restored: true });
    expect(state()).toEqual(restored);
    expect(db.prepare('SELECT total_changes() AS n').get()).toEqual(writes);
  });
  it('restores an existing complete journal while the target holds the UNIQUE legacy name', () => {
    const recovery = request();
    // Stage only the fixture's legacy name to isolate the original restore failure.
    db.prepare('UPDATE repositories SET full_name=? WHERE id=?').run('fixture/staged', oldId);
    applyIdentityMigration(db, recovery);
    assertProjection(newId, oldId);
    expect(restoreIdentityMigration(db, recovery)).toEqual({ journalId: recovery.journalId, restored: true });
    assertProjection(oldId, newId);
  });
  it('retains target-side releases and subscriptions when restoring a pre-existing real identity', () => {
    const target = { ...repository(newId), full_name: 'Owner/Repo' };
    writeCanonicalRecord(db, { collection: 'repositories', id: String(newId), data: target, deleted: false });
    writeCanonicalRecord(db, { collection: 'subscriptions', id: String(newId),
      data: { repoId: newId, subscribed: false }, deleted: false });
    writeCanonicalRecord(db, { collection: 'releases', id: '101', data: release(101, newId), deleted: false });
    const recovery = request(), before = state();
    applyIdentityMigration(db, recovery);
    expect(db.prepare('SELECT repo_id FROM releases WHERE id=101').get()).toEqual({ repo_id: newId });
    restoreIdentityMigration(db, recovery);
    expect(state().repositories).toEqual(before.repositories);
    expect(state().releases).toEqual(before.releases);
    expect(getRecord(db, 'subscriptions', String(newId))?.data).toEqual({ repoId: newId, subscribed: false });
    expect(getRecord(db, 'subscriptions', String(oldId))?.data).toEqual({ repoId: oldId, subscribed: true });
    expect(db.pragma('foreign_key_check')).toEqual([]);
  });
  it.each(['owner/repo', 'Owner/Repo'])('keeps unconfirmed same-name %s Star pushes as durable recoverable conflicts', full_name => {
    const operation = {
      opId: 'star-refresh-real', collection: 'repositories' as const, id: String(newId),
      kind: 'put' as const, baseVersion: 0,
      data: { ...repository(newId), full_name, stargazers_count: 10, extension: { preserved: ['incoming'] } },
    };
    const push = { ...input(), clientId: 'stars-client', operations: [operation] };
    const before = state();
    const response = pushOperations(db, push);
    expect(response.results[0]).toMatchObject({
      opId: operation.opId, status: 'conflict',
      conflict: { reason: 'REPOSITORY_IDENTITY_CONFIRMATION_REQUIRED', incoming: operation, current: null },
    });
    expect(state().repositories).toEqual(before.repositories);
    expect(state().releases).toEqual(before.releases);
    expect(state().sync_v2_records).toEqual(before.sync_v2_records);
    expect(state().sync_v2_changes).toEqual(before.sync_v2_changes);
    expect(getRecord(db, 'repositories', String(newId))).toBeNull();
    const stored = db.prepare('SELECT incoming FROM sync_v2_conflicts').get() as { incoming: string };
    expect(JSON.parse(stored.incoming)).toEqual(operation);
    const conflicted = state(), writes = db.prepare('SELECT total_changes() AS n').get();
    expect(pushOperations(db, push)).toEqual(response);
    expect(state()).toEqual(conflicted);
    expect(db.prepare('SELECT total_changes() AS n').get()).toEqual(writes);
    applyIdentityMigration(db, request());
    expect(pushOperations(db, push).results).toEqual(response.results);
    const resolved = pushOperations(db, {
      ...push, operations: [{ ...operation, opId: 'confirmed-new-operation', baseVersion: getRecord(db, 'repositories', String(newId))!.version }],
    });
    expect(resolved.results[0].status).toBe('applied');
    expect(getRecord(db, 'repositories', String(newId))?.data).toEqual(operation.data);
  });
  it('rolls back name staging, canonical writes and journal evidence on a projection failure', () => {
    const recovery = request();
    db.exec(`CREATE TRIGGER reject_rekey BEFORE UPDATE ON sync_v2_records
      WHEN NEW.collection='releases' AND NEW.id='99'
      BEGIN SELECT RAISE(ABORT, 'fixture projection failure'); END`);
    const before = state();
    expect(() => applyIdentityMigration(db, recovery)).toThrow('fixture projection failure');
    expect(state()).toEqual(before);
    expect(db.pragma('foreign_key_check')).toEqual([]);
  });
  it('rolls back restore name staging and child projections when recovery fails', () => {
    const recovery = request();
    db.prepare('UPDATE repositories SET full_name=? WHERE id=?').run('fixture/staged', oldId);
    applyIdentityMigration(db, recovery);
    db.exec(`CREATE TRIGGER reject_restore BEFORE UPDATE ON sync_v2_records
      WHEN NEW.collection='releases' AND NEW.id='99'
      BEGIN SELECT RAISE(ABORT, 'fixture recovery failure'); END`);
    const before = state();
    expect(() => restoreIdentityMigration(db, recovery)).toThrow('fixture recovery failure');
    expect(state()).toEqual(before);
    expect(db.pragma('foreign_key_check')).toEqual([]);
  });
});
