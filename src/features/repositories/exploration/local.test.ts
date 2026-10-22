import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { accountFixture, repositoryFixture } from './testFixtures';
import { conceptId, projectScene } from './model';
import { createSavedExploration, localExplorationAccount, localProfile, savedChanges, savedExplorationAccount } from './local';
import { emptyExplorationAccount, parseExplorationBackup, serializeExploration, updateExploration, loadExploration } from './storage';

describe('local first maps and durable saved explorations', () => {
  it('saves only the projects visible in the selected relationship filter', () => {
    const repos=[repositoryFixture(1),repositoryFixture(2)];const account=accountFixture(repos,['direct','similar']);
    const saved=createSavedExploration(account,repos,{name:'Direct Codex',query:'Codex',path:[{type:'entity',id:conceptId('entity','Codex'),label:'Codex'}],kindFilter:'direct'});
    expect(saved.resultIds).toEqual([1]);expect(saved.repositories.map(repo=>repo.id)).toEqual([1]);
    expect(Object.keys(saved.profiles)).toEqual(['1']);
  });
  it('saves snapshots from legacy repositories with null optional notes and missing display fields', async () => {
    const repo = repositoryFixture(13, { custom_description: null, forks: undefined, pushed_at: null, owner: { login:'owner' } } as unknown as Partial<import('../../../types').Repository>);
    const account = localExplorationAccount(emptyExplorationAccount('save-legacy'), [repo]);
    const saved = createSavedExploration(account, [repo], { name:'Codex', query:'', path:[{type:'all'}], kindFilter:'all' });
    await updateExploration('save-legacy', current => ({...current, saved:[saved]}));
    const restored = await loadExploration('save-legacy');
    expect(restored.saved?.[0].repositories[0].full_name).toBe(repo.full_name);
    expect(restored.saved?.[0].repositories[0].custom_description).toBeUndefined();
  });
  it('keeps the same capability results when a large-library query is reopened as a smaller saved snapshot',()=>{
    const repos=Array.from({length:200},(_,index)=>repositoryFixture(index+1,{ai_summary:index<31?'编程智能体':'图像生成与编辑',...(index===0?{name:'codex-demo',full_name:'owner/codex-demo'}:{})}));
    const account=localExplorationAccount(emptyExplorationAccount('42'),repos),focus={type:'entity' as const,id:conceptId('entity','Codex'),label:'Codex'};
    const saved=createSavedExploration(account,repos,{name:'Codex',query:'Codex',path:[focus],kindFilter:'all'});
    expect(saved.resultIds).toHaveLength(31);
    expect(projectScene(savedExplorationAccount(saved,'42'),saved.repositories,focus,'Codex').results.map(row=>row.repositoryId)).toEqual(saved.resultIds);
  });
  it('finds related capability projects from a local Codex mention without claiming integration',()=>{
    const repos=[repositoryFixture(1,{name:'Codex-skills',full_name:'owner/Codex-skills'}),repositoryFixture(2),repositoryFixture(3,{ai_summary:'图像编辑与处理'})];
    const account=localExplorationAccount(emptyExplorationAccount('42'),repos);
    const scene=projectScene(account,repos,{type:'entity',id:conceptId('entity','Codex'),label:'Codex'},'Codex');
    expect(scene.results.map(row=>row.repositoryId)).toEqual([1,2]);expect(scene.results.every(row=>!row.verified)).toBe(true);
    expect(scene.results[1].reason).toContain('共同用途主题');
  });
  it('uses analysis evidence, never a repository name or language alone, and leaves official categories untouched', () => {
    const repo = repositoryFixture(1,{ name:'browser-automation-codex', ai_summary:undefined, language:'Python' });
    expect(localProfile(repo).topics).toHaveLength(0);
    const local = localExplorationAccount(emptyExplorationAccount('42'),[repositoryFixture(2)]);
    expect(local.index?.profiles['2'].topics[0].label).toBe('编程智能体'); expect(local.index?.profiles['2'].evidence[0].verified).toBe(false);
    expect(repo.category_id).toBeUndefined();
  });
  it('retains exact snapshot results and evidence after library changes, export and import', async () => {
    const repos = [repositoryFixture(1),repositoryFixture(2)]; const account = accountFixture(repos,['direct',undefined]);
    const saved = createSavedExploration(account,repos,{ name:'Codex',query:'Codex',kindFilter:'direct',path:[{type:'entity',id:conceptId('entity','Codex'),label:'Codex'}],camera:{zoom:1.2,x:33,y:42} });
    account.saved=[saved]; await updateExploration('42',()=>account);
    const roundtrip=parseExplorationBackup(serializeExploration(await loadExploration('42')),'42');
    expect(roundtrip.saved?.[0]).toEqual(saved); expect(saved.checked['2']).toBeDefined();
    const changes=savedChanges(saved,[repositoryFixture(1,{ai_summary:'different'}),repositoryFixture(3)]);
    expect(changes).toEqual({added:1,changed:1,removed:1});
    expect(projectScene(savedExplorationAccount(saved,'42'),saved.repositories,saved.path.at(-1)!,'Codex').results.map(row=>row.repositoryId)).toEqual(saved.resultIds);
    expect(saved.profiles['1'].evidence[0].text).toContain('supports Codex');
  });
  it('accepts old local data without saved explorations and rejects cross-account imports', () => {
    const old=accountFixture([repositoryFixture(1)]);
    expect(parseExplorationBackup(serializeExploration(old),'42').index).toEqual(old.index);
    expect(()=>parseExplorationBackup(serializeExploration(old),'99')).toThrow('其他账号');
  });
});
