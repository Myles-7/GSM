import { describe,expect,it } from 'vitest';
import { accountFixture,repositoryFixture } from '../features/repositories/exploration/testFixtures';
import { analysisPreview,planExploration } from './explorationPlan';
import type { AIConfig } from '../types';

const config:AIConfig={id:'test',name:'test',model:'model',baseUrl:'https://provider.invalid',apiKey:'not-sent',isActive:true};
const repositories=[repositoryFixture(1,{name:'codex-tool',full_name:'owner/codex-tool',description:'Codex integration',ai_summary:'Codex integration'}),repositoryFixture(2,{description:'Image editing',ai_summary:'Image editing'})];
function fixture(){const account=accountFixture(repositories);account.index!.profiles['1'].topics=[{id:'coding',label:'Coding'}];account.index!.profiles['2'].topics=[{id:'images',label:'Images'}];return account;}
describe('readonly analysis preview uses execution planning',()=>{
  it('reports actual candidates instead of the full library without changing stored data',()=>{
    const account=fixture(),before=structuredClone(account),input={type:'query' as const,query:'Codex',configId:config.id};
    const plan=planExploration(account,repositories,input,config,'zh');
    expect(plan.candidates.map(repo=>repo.id)).toEqual([1]);
    expect(analysisPreview(plan,input)).toMatchObject({total:1,reused:0,pending:1});expect(account).toEqual(before);
  });
  it('reuses only compatible cache and checkpoints and respects explicit refresh',()=>{
    const account=fixture(),input={type:'query' as const,query:'Codex',configId:config.id};
    const plan=planExploration(account,repositories,input,config,'zh');
    account.queries=[{id:'cached',query:'Codex',createdAt:'now',model:'test:model',generation:plan.generation,fingerprint:plan.fingerprint,profiles:{'1':account.index!.profiles['1']}}];
    expect(analysisPreview(planExploration(account,repositories,input,config,'zh'),input)).toMatchObject({total:1,reused:1,pending:0});
    expect(analysisPreview(planExploration(account,repositories,input,{...config,model:'other'},'zh'),input).pending).toBe(1);
    expect(analysisPreview(planExploration(account,repositories,{...input,force:true},config,'zh'),{...input,force:true}).pending).toBe(1);
    account.queries=[];account.task={id:'checkpoint',type:'query',query:'Codex',model:'test:model',generation:plan.generation,fingerprint:plan.fingerprint,startedAt:'now',status:'failed',completed:1,total:1,draft:{'1':account.index!.profiles['1']}};
    expect(analysisPreview(planExploration(account,repositories,input,config,'zh'),input).reused).toBe(1);
    const changed=[{...repositories[0],description:'Updated Codex integration'},repositories[1]];
    expect(analysisPreview(planExploration(account,changed,input,config,'zh'),input).pending).toBe(1);
  });
});
