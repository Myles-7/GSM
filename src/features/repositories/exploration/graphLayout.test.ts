import { describe, expect, it } from 'vitest';
import { accountFixture, repositoryFixture } from './testFixtures';
import { conceptId, projectScene } from './model';
import { layoutExploration, retainLayoutPositions } from './graphLayout';
describe('spatial relationship layout',()=>{
  it('preserves existing node coordinates when a new community is added',()=>{
    const repos=[repositoryFixture(1)];const account=accountFixture(repos);const names=new Map([[1,'project-1']]);
    const before=layoutExploration(projectScene(account,repos,{type:'all'}),{type:'all'},names);
    const positions=Object.fromEntries(before.nodes.map(node=>[node.id,{x:node.x,y:node.y}]));
    account.index!.profiles['1'].topics.push({id:'new-community',label:'新用途主题'});
    const after=retainLayoutPositions(layoutExploration(projectScene(account,repos,{type:'all'}),{type:'all'},names),positions);
    for(const node of before.nodes) expect(after.nodes.find(value=>value.id===node.id)).toMatchObject({x:node.x,y:node.y});
    expect(after.nodes.some(node=>node.id==='new-community')).toBe(true);
  });
  it('keeps every nonempty direction and only shows branch nodes on an entity first screen',()=>{
    const repos=[1,2,3,4].map(id=>repositoryFixture(id)); const account=accountFixture(repos,['direct','interoperable','similar','discovery']);
    const focus={type:'entity' as const,id:conceptId('entity','Codex'),label:'Codex'}; const scene=projectScene(account,repos,focus,'Codex');
    const layout=layoutExploration(scene,focus,new Map(repos.map(repo=>[repo.id,repo.name])));
    expect(layout.nodes.filter(node=>node.type==='branch')).toHaveLength(scene.branches.length);
    expect(layout.nodes.some(node=>node.type==='repository')).toBe(false);
    expect(layout.edges.filter(edge=>edge.verified)).toHaveLength(2);
  });
  it('is deterministic, has unique shared project nodes and resolves label collisions',()=>{
    const repos=Array.from({length:30},(_,i)=>repositoryFixture(i+1)); const account=accountFixture(repos);
    repos.forEach((repo,i)=>{ account.index!.profiles[String(repo.id)].topics=[{id:`topic-${i%6}`,label:`具体用途主题 ${i%6}`}]; });
    account.index!.profiles['1'].topics.push({id:'topic-2',label:'具体用途主题 2'});
    const scene=projectScene(account,repos,{type:'all'}),names=new Map(repos.map(repo=>[repo.id,repo.name]));
    const layout=layoutExploration(scene,{type:'all'},names);
    expect(layoutExploration(scene,{type:'all'},names)).toEqual(layout);
    expect(layout.nodes.filter(node=>node.repositoryId===1)).toHaveLength(1);
    expect(layout.edges.filter(edge=>edge.target==='repo-1')).toHaveLength(2);
    for(let i=0;i<layout.nodes.length;i++) for(let j=i+1;j<layout.nodes.length;j++) {const a=layout.nodes[i],b=layout.nodes[j]; expect(Math.abs(a.x-b.x)>=(a.width+b.width)/2 || Math.abs(a.y-b.y)>=(a.height+b.height)/2).toBe(true);}
  });
});
