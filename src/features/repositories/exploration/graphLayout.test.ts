import {describe,it,expect} from 'vitest';
import {accountFixture,repositoryFixture} from './testFixtures';
import {conceptId,projectScene} from './model';
import {layoutExploration} from './graphLayout';
import {topicGroups} from './topicGroups';
describe('one-level radial exploration',()=>{
  it('shows only browse groups at the root and only topics after choosing one',()=>{
    const repos=Array.from({length:30},(_,i)=>repositoryFixture(i+1)),account=accountFixture(repos);
    repos.forEach((repo,i)=>{account.index!.profiles[String(repo.id)].topics=[{id:`topic-${i}`,label:`编程主题 ${i}`}];});
    const names=new Map(repos.map(repo=>[repo.id,repo.name])),scene=projectScene(account,repos,{type:'all'}),root=layoutExploration(scene,{type:'all'},names);
    expect(root.nodes.filter(node=>node.type!=='focus').every(node=>node.focus?.type==='group')).toBe(true);
    const group=topicGroups(scene)[0],focus={type:'group' as const,id:group.id,label:group.id};
    const scoped=projectScene(account,repos,focus),layout=layoutExploration(scoped,focus,names);
    expect(layout.nodes.filter(node=>node.type!=='focus')).toHaveLength(30);
    expect(layout.nodes.every(node=>node.type!=='repository')).toBe(true);expect(layout.edges).toHaveLength(30);
    expect(new Set(layout.nodes.slice(1).map(node=>Math.round(Math.hypot(node.x-layout.nodes[0].x,node.y-layout.nodes[0].y)))).size).toBeGreaterThan(1);
  });
  it('centres every level and distributes children on every side without overlaps',()=>{
    const repos=Array.from({length:8},(_,i)=>repositoryFixture(i+1)),account=accountFixture(repos),topic=account.index!.profiles['1'].topics[0];
    const focus={type:'topic' as const,id:topic.id,label:topic.label},scene=projectScene(account,repos,focus),names=new Map(repos.map(repo=>[repo.id,repo.name]));
    const layout=layoutExploration(scene,focus,names),center=layout.nodes[0],children=layout.nodes.slice(1);
    expect(children.some(node=>node.x<center.x)).toBe(true);expect(children.some(node=>node.x>center.x)).toBe(true);
    expect(children.some(node=>node.y<center.y)).toBe(true);expect(children.some(node=>node.y>center.y)).toBe(true);
    for(let i=0;i<layout.nodes.length;i++)for(let j=i+1;j<layout.nodes.length;j++){const a=layout.nodes[i],b=layout.nodes[j];expect(Math.abs(a.x-b.x)>=(a.width+b.width)/2||Math.abs(a.y-b.y)>=(a.height+b.height)/2).toBe(true);}
    expect(layoutExploration(scene,focus,names)).toEqual(layout);
  });
  it('never mixes relationship categories, branches and projects on one screen',()=>{
    const repos=[1,2,3,4].map(id=>repositoryFixture(id)),account=accountFixture(repos,['direct','interoperable','similar','discovery']);
    const focus={type:'entity' as const,id:conceptId('entity','Codex'),label:'Codex'},names=new Map(repos.map(repo=>[repo.id,repo.name]));
    const first=layoutExploration(projectScene(account,repos,focus,'Codex'),focus,names);
    expect(first.nodes.slice(1).every(node=>node.focus?.type==='relation')).toBe(true);
    const relation={type:'relation' as const,targetId:focus.id,kind:'direct' as const,label:'direct'};
    const next=layoutExploration(projectScene(account,repos,relation,'Codex'),relation,names);
    expect(next.nodes.slice(1).every(node=>node.focus?.type==='branch')).toBe(true);
    const branch=next.nodes[1].focus!;
    expect(layoutExploration(projectScene(account,repos,branch,'Codex'),branch,names).nodes.slice(1).every(node=>node.type==='repository')).toBe(true);
  });
});
