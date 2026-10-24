import { describe, expect, it } from 'vitest';
import { accountFixture, repositoryFixture } from './testFixtures';
import { projectScene } from './model';
import { explorationSuggestions, restoreWorkspacePath, workspaceContent, workspaceScope } from './workspace';
import { parseExplorationBackup, serializeExploration, validateExplorationAccount } from './storage';
import { createSavedExploration } from './local';
import { layoutExploration } from './graphLayout';
import type { ExplorationWorkspace } from './types';

describe('dynamic exploration workspaces', () => {
  it('round trips lean workspaces together with untouched legacy snapshots', () => {
    const repositories=[repositoryFixture(1)],account=accountFixture(repositories);
    const snapshot=createSavedExploration(account,repositories,{name:'Historical',query:'',path:[{type:'all'}],kindFilter:'all'});
    const workspace: ExplorationWorkspace={version:1,id:'workspace',name:'Live',createdAt:'now',updatedAt:'now',query:'',path:[{type:'all'}],kindFilter:'all'};
    account.saved=[snapshot];account.workspaces=[workspace];
    const restored=parseExplorationBackup(serializeExploration(account),account.ownerId);
    expect(restored.saved).toEqual([snapshot]);expect(restored.workspaces).toEqual([workspace]);
    expect(restored.workspaces![0]).not.toHaveProperty('repositories');
    expect(()=>validateExplorationAccount({...account,workspaces:[workspace,workspace]},account.ownerId)).toThrow('重复');
    expect(()=>parseExplorationBackup(serializeExploration(account),'other')).toThrow('其他账号');
  });
  it('recomputes results against current repositories without altering the saved query', () => {
    const first=repositoryFixture(1),second=repositoryFixture(2),account=accountFixture([first,second]);
    const before=projectScene(account,[first],{type:'all'}),after=projectScene(account,[second],{type:'all'});
    expect(after.results.map(row=>row.repositoryId)).toEqual([2]);expect(workspaceScope(after)).not.toBe(workspaceScope(before));
    const value={query:'Codex',path:[{type:'all'} as const],kindFilter:'all' as const};
    expect(workspaceContent({...value})).toBe(workspaceContent(value));
    expect(workspaceContent({...value,query:'browser'})).not.toBe(workspaceContent(value));
  });
  it('falls back at the first removed path component and preserves free text scopes', () => {
    const repositories=[repositoryFixture(1)],scene=projectScene(accountFixture(repositories),repositories,{type:'all'});
    expect(restoreWorkspacePath([{type:'all'},{type:'topic',id:'removed',label:'old'},{type:'repository',id:1,label:'project'}],scene,repositories)).toEqual([{type:'all'}]);
    const path=[{type:'all'} as const,{type:'search' as const,id:'unknown',label:'unknown'}];
    expect(restoreWorkspacePath(path,scene,repositories)).toEqual(path);
  });
  it('ranks a repository name above description mentions and keeps suggestion kinds separate', () => {
    const one={...repositoryFixture(1),name:'Codex',full_name:'owner/Codex'},two={...repositoryFixture(2),description:'Codex'};
    const scene=projectScene(accountFixture([one,two],['direct']),[one,two],{type:'all'});
    const suggestions=explorationSuggestions('Codex',scene,[two,one]);
    expect(suggestions[0]).toMatchObject({repositoryId:1,group:'repositories'});
    expect(suggestions.some(row=>row.group==='entities')).toBe(true);
    expect(explorationSuggestions('',scene,[one,two])).toEqual([]);
  });
  it('keeps all immediate project children connected across outer rings', () => {
    const repositories=Array.from({length:100},(_,i)=>repositoryFixture(i+1)),account=accountFixture(repositories);
    const topic=account.index!.profiles['1'].topics[0],focus={type:'topic' as const,id:topic.id,label:topic.label};
    const scene=projectScene(account,repositories,focus),names=new Map(repositories.map(row=>[row.id,row.name]));
    const layout=layoutExploration(scene,focus,names);
    expect(layout.nodes.filter(row=>row.type==='repository').length).toBe(100);
    expect(layout.nodes.some(row=>row.repositoryId===100)).toBe(true);
    for(const edge of layout.edges)expect(layout.nodes.some(row=>row.id===edge.source)).toBe(true);
  });
});
