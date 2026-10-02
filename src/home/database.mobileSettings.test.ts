import 'fake-indexeddb/auto';
import {describe,it,expect} from 'vitest';
import {HomeDatabase} from './database';
const identity={workspaceId:'home',githubUserId:42};
const db=()=>new HomeDatabase(crypto.randomUUID());
describe('mobile settings data protection',()=>{
  it('honors an explicit missing remote record instead of resurrecting an old shadow',async()=>{
    const database=db();await database.applyRemote([{collection:'repositories',id:'1',version:5,data:{name:'old'}}],5,true);
    await database.edit('repositories','1',{name:'phone'});let [pending]=await database.pending();await database.reject(pending,null,'VERSION_MISMATCH');await database.resolve(pending.key,false);
    expect(await database.list()).toEqual([]);await database.edit('repositories','1',{name:'new'});[pending]=await database.pending();expect(pending.baseVersion).toBe(0);
    await database.reject(pending,null,'VERSION_MISMATCH');await database.resolve(pending.key,true);expect((await database.pending())[0].baseVersion).toBe(0);expect((await database.list())[0].version).toBe(0);
  });
  it('previews without mutation and roundtrips only approved local experience with pending edits',async()=>{
    const source=db();await source.edit('repositories','1',{full_name:'owner/repo',custom_description:'saved',authToken:'x-secret',ct0:'cookie-secret',apiSecret:'backend-secret',nested:{modelCredential:'singular-secret'}});
    await source.setMetadata('mobile:savedFilters',[{id:'f',name:'Rust',filter:{query:'',category:'',language:'Rust',sort:'stars'}}]);
    await source.setMetadata('mobile:recentViews',[{id:'1',fullName:'owner/repo',viewedAt:'2026-09-30T00:00:00Z'}]);
    await source.setMetadata('composer:general','private draft excluded');
    const text=await source.exportBackup(identity,{density:'compact',readingFontSize:18,reducedMotion:true},'dark');
    for(const secret of ['x-secret','cookie-secret','backend-secret','singular-secret','private draft excluded'])expect(text).not.toContain(secret);
    const target=db();const preview=target.previewBackup(text,identity);expect(preview.records).toBe(1);expect(preview.pending).toBe(1);expect(await target.list()).toEqual([]);
    await target.edit('repositories','1',{full_name:'owner/repo',custom_description:'new local'});const pending=await target.pending();
    const experience=await target.importBackup(text,identity);expect(experience?.preferences?.readingFontSize).toBe(18);expect(await target.pending()).toEqual(pending);expect(await target.metadata('mobile:savedFilters')).toHaveLength(1);
  });
  it('clears only reacquirable cache while keeping tasks drafts edits and local preferences',async()=>{
    const database=db();await database.edit('repositories','1',{name:'offline'});
    for(const key of ['repository-readme:a/b','discovery-cache:a','discovery-last:a','discovery-repo:a/b'])await database.setMetadata(key,'cache');
    for(const key of ['unconfirmedTask','inFlight','tasks','composer:x','mobile:savedFilters','mobile:recentViews','discovery-research-selection'])await database.setMetadata(key,'keep');
    await database.setMetadata('discovery-view:trending',{q:'rust',scroll:200,results:{items:[{full_name:'cache/repo'}]}});
    expect((await database.cacheStats()).entries).toBe(5);await database.clearCaches();expect((await database.cacheStats()).entries).toBe(0);expect(await database.metadata('discovery-view:trending')).toEqual({q:'rust',scroll:200});
    for(const key of ['unconfirmedTask','inFlight','tasks','composer:x','mobile:savedFilters','mobile:recentViews','discovery-research-selection'])expect(await database.metadata(key)).toBe('keep');expect(await database.pending()).toHaveLength(1);
  });
  it('rejects foreign or malformed experience on preview, supports old backups',async()=>{
    const database=db();const old={format:'gsm-mobile-backup',version:1,...identity,createdAt:'2026-09-30',records:[],pending:[]};
    expect(database.previewBackup(JSON.stringify(old),identity).records).toBe(0);
    expect(()=>database.previewBackup(JSON.stringify({...old,githubUserId:12}),identity)).toThrow('同一');
    expect(()=>database.previewBackup(JSON.stringify({...old,localExperience:{preferences:{density:'compact',readingFontSize:99,reducedMotion:false}}}),identity)).toThrow('格式');
  });
});
