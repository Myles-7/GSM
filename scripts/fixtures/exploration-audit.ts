// Synthetic, offline visual audit data. Never loaded by the production entry.
import { useAppStore } from '../../src/store/useAppStore';
import { conceptId, explorationFingerprint, stableId } from '../../src/features/repositories/exploration/model';
import { emptyExplorationAccount, updateExploration } from '../../src/features/repositories/exploration/storage';
import type { ExplorationProfile, RelationKind } from '../../src/features/repositories/exploration/types';
import type { Repository } from '../../src/types';

export async function configureExplorationAudit(count = 368, partialTask = false, searchAudit = false) {
  const state = useAppStore.getState();
  if (state.user?.id !== 990001) throw new Error('Exploration audit requires the isolated synthetic account.');
  const labels = ['编程智能体', '浏览器自动化', '知识库问答', '开发工作流', '数据采集', '部署与运维'];
  const prefixes = ['coding-agent-demo', 'browser-robot-demo', 'knowledge-search-demo', 'workflow-kit-demo', 'data-collector-demo', 'deployment-kit-demo'];
  const repositories: Repository[] = Array.from({ length: Math.max(1, Math.min(1000, count)) }, (_, index) => ({
    id: index + 1, name: `${prefixes[index % 6]}-${index + 1}`, full_name: `synthetic-demo/${prefixes[index % 6]}-${index + 1}`, description: `合成测试项目，能力主题：${labels[index % 6]}。`, ai_summary: `合成界面测试资料：围绕${labels[index % 6]}组织工作流，非真实项目。`,
    html_url: `https://example.test/synthetic-demo/${index + 1}`, stargazers_count: 10000 - index, forks_count: 0, forks: 0, owner: { login: 'synthetic-demo', avatar_url: '' }, topics: [], language: index % 2 ? 'Python' : 'TypeScript', created_at: '2026-01-01', updated_at: '2026-10-19', pushed_at: '2026-10-19', category_id: null, subcategory_id: null,
  }));
  const profiles = Object.fromEntries(repositories.map((repo, index) => {
    const topicLabels = [labels[index % 6], ...(index % 7 === 0 ? [labels[(index + 1) % 6]] : [])];
    const kind: RelationKind = (['direct', 'interoperable', 'similar', 'discovery'] as const)[index % 4];
    const related = index % 3 === 0, verified = kind === 'direct' || kind === 'interoperable';
    const entity = { id: conceptId('entity', 'Codex'), label: 'OpenAI Codex', aliases: ['Codex', 'Codex CLI'], description: '合成测试中的工具生态节点' };
    const profile: ExplorationProfile = { repositoryId: repo.id, fingerprint: explorationFingerprint(repo), summary: repo.ai_summary!, status: 'ready', topics: topicLabels.map(label => ({ id: conceptId('topic', label), label })), entities: related ? [entity] : [],
      evidence: related ? [{ id: `synthetic-evidence-${repo.id}`, kind: verified ? 'document' : 'analysis', label: '合成测试资料（非真实仓库）', text: verified ? 'Synthetic demonstration: this demo supports Codex workflows.' : '合成测试推断：该项目演示编程自动化能力。', verified, retrievedAt: '2026-10-19T12:00:00Z' }] : [],
      relations: related ? [{ id: stableId('relation', `fixture:${repo.id}`), repositoryId: repo.id, targetType: 'entity', targetId: entity.id, kind, branch: kind === 'direct' ? '技能与工作流' : kind === 'interoperable' ? '配置与工具集成' : kind === 'similar' ? '同类编程工具' : '自动化配套', reason: '合成界面测试关系，不代表真实仓库能力。', evidenceIds: [`synthetic-evidence-${repo.id}`], verified }] : [],
    };
    return [String(repo.id), profile];
  }));
  if(searchAudit) {
    repositories[0].name='codex-skills-demo';repositories[0].full_name='synthetic-demo/codex-skills-demo';repositories[0].ai_summary='合成测试：为 Codex 管理编程技能和工作流。';
    repositories[1].name='cli-account-manager-demo';repositories[1].full_name='synthetic-demo/cli-account-manager-demo';repositories[1].ai_summary='合成测试：管理终端工具多账号配置。';
    repositories[1].ai_details={version:1,generated_at:'now',repository_pushed_at:null,model:'synthetic',sources:[],problem:null,features:['合成测试：支持 Codex CLI 的多账号配置切换。'],scenarios:[],architecture:null,quickstart:[],deployment:null,cost:null,maintenance:null};
    for(const repo of repositories) { const profile=profiles[String(repo.id)];profile.entities=[];profile.relations=[];profile.evidence=[];profile.summary=repo.ai_summary!;profile.fingerprint=explorationFingerprint(repo); }
    profiles['1'].topics=[{id:conceptId('topic','编程智能体'),label:'编程智能体'},{id:conceptId('topic','学习资源'),label:'学习资源'}];
    profiles['2'].topics=[{id:conceptId('topic','编程智能体'),label:'编程智能体'}];
    for(const repo of repositories.slice(2,22)) { profiles[String(repo.id)].topics=[{id:conceptId('topic','学习资源'),label:'学习资源'}]; }
  }
  if (partialTask) repositories.slice(-4).forEach(repo => { repo.ai_summary = ''; });
  useAppStore.setState({ repositories, searchResults: repositories, repositoryViewMode: 'cluster', currentView: 'repositories', language: 'zh', theme: 'light' });
  if(searchAudit) useAppStore.setState({activeAIConfig:'offline-audit',aiConfigs:[{id:'offline-audit',name:'离线测试模型（不调用）',model:'synthetic',isActive:true,baseUrl:'https://example.invalid/v1',apiKey:'offline-test'}]});
  await updateExploration('990001', current => ({ ...emptyExplorationAccount('990001'), saved: current.saved,
    index: partialTask ? null : { version: 1, id: `synthetic-${count}`, createdAt: new Date().toISOString(), model: 'Synthetic UI fixture, not AI generated', profiles },
    task: partialTask ? { id:'synthetic-timeout',type:'build',status:'failed',startedAt:new Date().toISOString(),model:'Synthetic UI fixture',fingerprint:'synthetic',completed:Math.max(0,count-10),total:count,
      draft:Object.fromEntries(Object.entries(profiles).slice(0,Math.max(0,count-10))),error:'AGY_TIMEOUT; AGY_TIMEOUT',failures:[{repositoryIds:repositories.slice(-10,-5).map(repo=>repo.id),message:'AGY_TIMEOUT',unknown:true},{repositoryIds:repositories.slice(-5).map(repo=>repo.id),message:'AGY_TIMEOUT',unknown:true}] } : null }));
  // React may have loaded the empty account before the seed transaction; remount once.
  useAppStore.setState({ repositoryViewMode: 'grid' });
  setTimeout(() => useAppStore.setState({ repositoryViewMode: 'cluster' }), 50);
}
