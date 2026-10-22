import { describe, expect, it } from 'vitest';
import { accountFixture, profileFixture, repositoryFixture } from './testFixtures';
import { conceptId, explorationFingerprint, projectScene, queryFingerprint, resolveExplorationTargets, resultsForRelationKind } from './model';

describe('local relationship exploration', () => {
  it('finds mentions inside detailed AI features and ranks them before shared capabilities and popularity',()=>{
    const repos=[repositoryFixture(1,{stargazers_count:500000}),repositoryFixture(2,{stargazers_count:1,ai_details:{version:1,generated_at:'now',repository_pushed_at:null,model:'test',sources:[],problem:null,features:['为 Codex CLI 管理多账号配置'],scenarios:[],architecture:null,quickstart:[],deployment:null,cost:null,maintenance:null}})];
    const account=accountFixture(repos);const scene=projectScene(account,repos,{type:'entity',id:conceptId('entity','Codex'),label:'Codex'},'codex');
    expect(scene.results.map(row=>row.repositoryId)).toEqual([2,1]);
    expect(scene.results[0].evidence[0].text).toContain('Codex CLI');
    expect(scene.branches.map(row=>row.label)).toContain('明确提及');
    const branch=projectScene(account,repos,{type:'branch',targetId:conceptId('entity','Codex'),label:'明确提及（待核实）',branch:'明确提及（待核实）',kind:'discovery'},'codex');
    expect(branch.results.map(row=>row.repositoryId)).toEqual([2]);
  });
  it('retains scoped AI-verified results when a lexical mention branch is enhanced',()=>{
    const repo=repositoryFixture(1,{name:'codex-tool',full_name:'owner/codex-tool'}),account=accountFixture([repo]);
    const focus={type:'branch' as const,targetId:conceptId('entity','Codex'),label:'明确提及',branch:'明确提及',kind:'discovery' as const};
    const scope=JSON.stringify(focus);
    account.queries=[{id:'enhanced',query:'Codex',scope,fingerprint:queryFingerprint('Codex',[repo],account.index,'model',scope),model:'model',createdAt:'now',profiles:{'1':profileFixture(repo,'direct')}}];
    const result=projectScene(account,[repo],focus,'Codex');
    expect(result.results[0]).toMatchObject({repositoryId:1,verified:true,kind:'direct'});
  });
  it('does not expand a Codex resource mention into every learning or repository directory project',()=>{
    const repos=[repositoryFixture(1,{ai_summary:'Codex 使用资料'}),repositoryFixture(2,{ai_summary:'学习资源目录',stargazers_count:900000}),repositoryFixture(3,{ai_summary:'无关工具'})];
    const account=accountFixture(repos);
    Object.values(account.index!.profiles).forEach(profile=>{profile.summary=repos[profile.repositoryId-1].ai_summary!;profile.topics=[{id:'learning',label:'学习资源'},{id:'directory',label:'项目收藏'}];});
    const scene=projectScene(account,repos,{type:'entity',id:conceptId('entity','Codex'),label:'Codex'},'codex');
    expect(scene.results.map(row=>row.repositoryId)).toEqual([1]);
  });
  it('normalizes identities and semantic inputs independently of timestamps and input order', () => {
    const repo = repositoryFixture(1, { ai_tags: ['agent', 'code'], analyzed_at: 'old' });
    expect(explorationFingerprint(repo)).toBe(explorationFingerprint({ ...repo, ai_tags: ['code', 'agent', 'agent'], analyzed_at: 'new' }));
    expect(conceptId('entity', 'Codex CLI')).toBe(conceptId('entity', 'OpenAI Codex'));
    expect(explorationFingerprint({ ...repo, ai_summary: 'Changed content' })).not.toBe(explorationFingerprint(repo));
  });
  it('supports overlapping purpose topics while counting unique projects', () => {
    const repos = [repositoryFixture(1), repositoryFixture(2)]; const account = accountFixture(repos);
    account.index!.profiles['1'].topics.push({ id: conceptId('topic', '浏览器自动化'), label: '浏览器自动化' });
    const scene = projectScene(account, repos, { type: 'all' });
    expect(scene.results).toHaveLength(2); expect(scene.topics.reduce((count, topic) => count + topic.repositoryIds.length, 0)).toBe(3);
    expect(projectScene(account, repos, { type: 'topic', id: conceptId('topic', '浏览器自动化'), label: '浏览器自动化' }).results.map(row => row.repositoryId)).toEqual([1]);
  });
  it('separates Codex support, explicit integration and inference with evidence', () => {
    const repos = [1, 2, 3, 4].map(id => repositoryFixture(id)); const account = accountFixture(repos, ['direct', 'interoperable', 'similar', undefined]);
    const focus = { type: 'entity' as const, id: conceptId('entity', 'Codex'), label: 'Codex' };
    const scene = projectScene(account, repos, focus, 'Codex');
    expect(scene.results.map(row => row.kind)).toEqual(['direct', 'interoperable', 'similar', 'discovery']);
    expect(scene.results[0].evidence[0].text).toContain('supports Codex'); expect(scene.results[3].verified).toBe(false);
    const direction = projectScene(account, repos, { type: 'branch', targetId: focus.id, label: '间接', kind: 'discovery', branch: '待核实与间接线索' }, 'Codex');
    expect(direction.results.map(row => row.repositoryId)).toEqual([4]);
  });
  it('does not infer Codex support from common language or MCP tags', () => {
    const repos = [repositoryFixture(1, { topics: ['mcp'] })]; const account = accountFixture(repos);
    expect(projectScene(account, repos, { type: 'entity', id: conceptId('entity', 'Codex'), label: 'Codex' }, 'Codex').results).toHaveLength(0);
  });
  it('keeps the exact metadata source for lexical recall without treating it as a supported relationship', () => {
    const repo = repositoryFixture(1, { name: 'codex-tools', full_name: 'owner/codex-tools' }), account = accountFixture([repo]);
    const row = projectScene(account, [repo], { type: 'entity', id: conceptId('entity', 'Codex'), label: 'Codex' }, 'Codex').results[0];
    expect(row.reason).toContain('召回线索'); expect(row.verified).toBe(false); expect(row.kind).toBe('discovery'); expect(row.evidence[0].text).toBe(repo.full_name);
  });
  it('allows the same project in multiple relation directions without losing source-specific evidence', () => {
    const repo = repositoryFixture(1), account = accountFixture([repo], ['direct']);
    const profile = account.index!.profiles['1']; profile.relations.push({ ...profile.relations[0], id: 'second-direction', kind: 'similar', reason: '同类编程能力' });
    const results = projectScene(account, [repo], { type: 'entity', id: conceptId('entity', 'Codex'), label: 'Codex' }, 'Codex').results;
    expect(results).toHaveLength(1); expect(resultsForRelationKind(results, 'direct')).toHaveLength(1);
    expect(resultsForRelationKind(results, 'similar')[0]).toMatchObject({ kind: 'similar', reason: '同类编程能力' });
    expect(resultsForRelationKind(results, 'interoperable')).toHaveLength(0);
  });
  it('shows both directions of a repository relationship with the original source evidence', () => {
    const repos = [repositoryFixture(1), repositoryFixture(2)]; const account = accountFixture(repos, ['direct']);
    const profile = account.index!.profiles['1'];
    profile.relations[0] = { ...profile.relations[0], targetType: 'repository', targetId: '2', reason: '焦点项目支持 owner/project-2 工作流' };
    const outgoing = projectScene(account, repos, { type: 'repository', id: 1, label: 'project-1' });
    expect(outgoing.results.map(row => row.repositoryId)).toEqual([2]); expect(outgoing.results[0].relations[0].repositoryId).toBe(1);
    expect(outgoing.results[0].evidence[0].id).toBe('evidence-1');
    expect(projectScene(account, repos, { type: 'repository', id: 2, label: 'project-2' }).results[0].repositoryId).toBe(1);
  });
  it('shows the actual topic citations and clears automatic citations for manually adjusted membership', () => {
    const repo = repositoryFixture(1), account = accountFixture([repo], ['direct']);
    account.index!.profiles['1'].topics[0].evidenceIds = ['evidence-1'];
    const topic = account.index!.profiles['1'].topics[0];
    expect(projectScene(account, [repo], { type: 'topic', ...topic }).results[0].evidence).toHaveLength(1);
    account.overrides = [{ id: 'manual', createdAt: 'now', type: 'set-topics', repositoryId: 1, topics: [{ id: topic.id, label: topic.label }] }];
    const row = projectScene(account, [repo], { type: 'topic', ...topic }).results[0];
    expect(row.reason).toContain('人工调整'); expect(row.evidence).toHaveLength(0);
  });
  it('keeps corrections independent of regenerated data and retains unresolved corrections', () => {
    const repo = repositoryFixture(1); const account = accountFixture([repo], ['direct']); const original = structuredClone(account.index);
    account.overrides = [{ id: 'hide', type: 'remove-relation', relationId: account.index!.profiles['1'].relations[0].id, createdAt: 'now' }, { id: 'rename', type: 'rename-topic', topicId: conceptId('topic', '编程智能体'), label: '编码助手', createdAt: 'now' }, { id: 'missing', type: 'remove-relation', relationId: 'removed-relation', createdAt: 'now' }];
    const scene = projectScene(account, [repo], { type: 'all' });
    expect(scene.profiles['1'].relations).toHaveLength(0); expect(scene.topics[0].label).toBe('编码助手'); expect(scene.unresolvedOverrides.map(row => row.id)).toEqual(['missing']);
    expect(account.index).toEqual(original);
  });
  it('applies query discoveries only within that query and ignores stale cache', () => {
    const repo = repositoryFixture(1); const account = accountFixture([repo]); const discovered = profileFixture(repo, 'direct');
    account.queries = [{ id: 'cache', query: 'Codex', fingerprint: queryFingerprint('Codex', [repo], account.index, 'model'), model: 'model', createdAt: 'now', profiles: { '1': discovered } }];
    expect(projectScene(account, [repo], { type: 'all' }).entities).toHaveLength(0);
    expect(projectScene(account, [repo], { type: 'entity', id: conceptId('entity', 'Codex'), label: 'Codex' }, 'Codex').results[0].verified).toBe(true);
    expect(projectScene(account, [{ ...repo, ai_summary: 'new input' }], { type: 'entity', id: conceptId('entity', 'Codex'), label: 'Codex' }, 'Codex').results).toHaveLength(0);
  });

  it('uses the active generation of a direction instead of accumulating contradictory model results', () => {
    const repo = repositoryFixture(1), account = accountFixture([repo]);
    account.queries = [
      { id: 'old', query: 'Codex', model: 'old', generation: 'old', fingerprint: queryFingerprint('Codex', [repo], account.index, 'old', '', 'old'), createdAt: 'now', profiles: { '1': profileFixture(repo, 'interoperable') } },
      { id: 'new', query: 'Codex', model: 'new', generation: 'new', fingerprint: queryFingerprint('Codex', [repo], account.index, 'new', '', 'new'), createdAt: 'now', profiles: { '1': profileFixture(repo, 'similar') } },
    ];
    const scene = projectScene(account, [repo], { type: 'entity', id: conceptId('entity', 'Codex'), label: 'Codex' }, 'Codex');
    expect(scene.profiles['1'].relations.map(row => row.kind)).toEqual(['similar']);
  });
  it('keeps deeper direction caches scoped while combining the root exploration cache', () => {
    const repo = repositoryFixture(1); const account = accountFixture([repo]);
    const focus = { type: 'branch' as const, targetId: conceptId('entity', 'Codex'), label: '工具集成', kind: 'interoperable' as const, branch: '工具集成' };
    const scope = JSON.stringify(focus);
    account.queries = [
      { id: 'root', query: 'Codex', fingerprint: queryFingerprint('Codex', [repo], account.index, 'model'), model: 'model', createdAt: 'now', profiles: { '1': profileFixture(repo, 'direct') } },
      { id: 'branch', query: 'Codex', scope, fingerprint: queryFingerprint('Codex', [repo], account.index, 'model', scope), model: 'model', createdAt: 'now', profiles: { '1': profileFixture(repo, 'interoperable') } },
    ];
    const root = projectScene(account, [repo], { type: 'entity', id: focus.targetId, label: 'Codex' }, 'Codex');
    expect(root.results[0].relations.map(row => row.kind)).toEqual(['direct']);
    const deeper = projectScene(account, [repo], focus, 'Codex'); expect(deeper.results[0].relations[0].kind).toBe('interoperable');
  });
  it('excludes removed repositories and disambiguates entity labels without inventing a repository', () => {
    const repo = repositoryFixture(1); const account = accountFixture([repo], ['direct']);
    const scene = projectScene(account, [], { type: 'all' }); expect(scene.results).toHaveLength(0); expect(scene.topics).toHaveLength(0);
    const entity = resolveExplorationTargets(projectScene(account, [repo], { type: 'all' }), 'Codex')[0]; expect(entity.id).toBe(conceptId('entity', 'Codex'));
  });
  it('builds the projection for 1000 repositories with stable identities', () => {
    const repos = Array.from({ length: 1000 }, (_, index) => repositoryFixture(index + 1)); const account = accountFixture(repos);
    const scene = projectScene(account, repos, { type: 'all' }); expect(scene.results).toHaveLength(1000); expect(scene.topics[0].repositoryIds).toHaveLength(1000);
  });
});
