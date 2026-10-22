import type { Repository } from '../../../types';
import type { ExplorationAccount, ExplorationProfile, RelationKind } from './types';
import { conceptId, explorationFingerprint, stableId } from './model';
import { emptyExplorationAccount } from './storage';

export const repositoryFixture = (id: number, changes: Partial<Repository> = {}): Repository => ({ id, name: `project-${id}`, full_name: `owner/project-${id}`, description: 'Coding agents and workflow automation',
  html_url: `https://github.com/owner/project-${id}`, stargazers_count: 100 - id, forks_count: 1, forks: 1, language: 'TypeScript', created_at: '2026-01-01', updated_at: '2026-01-01', pushed_at: '2026-01-01', owner: { login: 'owner', avatar_url: '' }, topics: [], ai_summary: '编程智能体与开发工作流', ...changes });
export function profileFixture(repo: Repository, kind?: RelationKind): ExplorationProfile {
  const entity = { id: conceptId('entity', 'Codex'), label: 'OpenAI Codex', aliases: ['Codex'], description: '编程工具生态' };
  const verified = kind === 'direct' || kind === 'interoperable';
  return { repositoryId: repo.id, fingerprint: explorationFingerprint(repo), summary: repo.ai_summary ?? '编程工具', status: 'ready', topics: [{ id: conceptId('topic', '编程智能体'), label: '编程智能体' }], entities: kind ? [entity] : [],
    evidence: kind ? [{ id: `evidence-${repo.id}`, kind: verified ? 'readme' : 'analysis', label: verified ? 'README' : '已有 AI 分析', text: verified ? 'This tool supports Codex workflows.' : 'Coding workflow automation', verified, retrievedAt: '2026-10-19T10:00:00Z', url: repo.html_url }] : [],
    relations: kind ? [{ id: stableId('relation', `${repo.id}:${kind}`), repositoryId: repo.id, targetType: 'entity', targetId: entity.id, kind, branch: kind === 'direct' ? '技能与工作流' : kind === 'interoperable' ? '工具集成' : '编程自动化', reason: verified ? 'README明确说明支持Codex工作流' : 'AI推断具有相近编程能力', evidenceIds: [`evidence-${repo.id}`], verified }] : [] };
}
export function accountFixture(repositories: Repository[], kinds: (RelationKind | undefined)[] = []): ExplorationAccount {
  return { ...emptyExplorationAccount('42'), index: { version: 1, id: 'index-1', model: 'config:model', createdAt: '2026-10-19T10:00:00Z', profiles: Object.fromEntries(repositories.map((repo, index) => [repo.id, profileFixture(repo, kinds[index])])) } };
}
