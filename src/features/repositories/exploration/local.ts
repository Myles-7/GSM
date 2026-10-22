import type { Repository } from '../../../types';
import { conceptId, explorationFingerprint, projectScene, repositorySummary, resultsForRelationKind, stableId } from './model';
import type { ExplorationAccount, ExplorationFocus, ExplorationProfile, SavedExploration } from './types';

const capabilities: [string, RegExp][] = [
  ['编程智能体', /编程智能体|coding agent|code agent|编程助手|代码生成/i], ['浏览器自动化', /浏览器自动化|browser automation|browser agent/i],
  ['知识库问答', /知识库问答|检索增强|retrieval.augmented|\brag\b/i], ['笔记与知识管理', /笔记|知识管理|note.taking|knowledge management/i],
  ['工作流自动化', /工作流自动化|workflow automation/i], ['数据采集', /数据采集|爬虫|web scraping|crawler/i],
  ['图像生成与编辑', /图像生成|图像编辑|image generation|image editing/i], ['语音与音频', /语音识别|语音合成|speech|audio processing/i],
  ['部署与运维', /部署管理|运维|deployment|observability/i], ['学习与教程', /教程|编程学习|tutorial|learning resources/i],
  ['代码搜索与审查', /代码搜索|代码审查|code search|code review/i], ['模型推理', /模型推理|inference server|local inference/i],
];
export function localProfile(repo: Repository): ExplorationProfile {
  const fields = [...(repo.ai_details?.scenarios ?? []), ...(repo.ai_details?.features ?? []), ...(repo.ai_details?.tags ?? []), ...(repo.ai_tags ?? []), repo.ai_details?.problem, repo.ai_details?.summary, repo.ai_summary].filter((text): text is string => !!text);
  const text = fields.join('\n');
  const labels = capabilities.filter(([, pattern]) => pattern.test(text)).map(([label]) => label);
  const tags = [...(repo.ai_details?.tags ?? []), ...(repo.ai_tags ?? [])].filter(label => label.length >= 3 && label.length <= 24 && /自动|生成|管理|搜索|检索|编辑|浏览|编程|阅读|笔记|分析|采集|测试|审查|部署|监控|工作流|问答|教程|教育|研究|设计|转换|同步|workflow|search|automation|generation|management|editing|testing|review|deployment|monitoring|learning|analysis/i.test(label));
  const selected = [...new Set([...labels, ...tags])].slice(0, 3);
  const evidence = selected.length ? [{ id: stableId('local-analysis', `${repo.id}:${text}`), kind: 'analysis' as const, label: '本地已有 AI 分析（未重新核实）', text: text.slice(0, 3000), retrievedAt: repo.analyzed_at || repo.updated_at, verified: false }] : [];
  return { repositoryId: repo.id, fingerprint: explorationFingerprint(repo), summary: repositorySummary(repo).slice(0, 1000), status: selected.length ? 'ready' : 'insufficient',
    topics: selected.map(label => ({ id: conceptId('topic', label), label, evidenceIds: evidence.map(row => row.id) })), evidence, entities: [], relations: [] };
}
/** A derived view only: never silently persists or starts model work. */
export function localExplorationAccount(account: ExplorationAccount, repositories: Repository[]): ExplorationAccount {
  const profiles = Object.fromEntries(repositories.map(repo => [String(repo.id), account.index?.profiles[String(repo.id)] ?? localProfile(repo)]));
  const build = account.task?.type === 'build' ? account.task : account.pendingTasks?.find(task=>task.type==='build');
  if (build) Object.assign(profiles, build.draft);
  return { ...account, index: { version: 1, id: account.index?.id ?? 'local-preview', createdAt: account.index?.createdAt ?? '', model: account.index?.model ?? '本地已有分析', generation: account.index?.generation, profiles } };
}
export function snapshotRepository(repo: Repository): Repository {
  const { id, name, full_name, description, html_url, owner, stargazers_count, forks_count, forks, language, topics, created_at, updated_at, pushed_at, custom_description } = repo;
  const count = (value: unknown, fallback = 0) => typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  return { id, name, full_name, description: typeof description === 'string' ? description : null, html_url,
    owner: { login: owner?.login || full_name.split('/')[0], avatar_url: owner?.avatar_url ?? '' },
    stargazers_count: count(stargazers_count), forks_count: count(forks_count, count(forks)), forks: count(forks, count(forks_count)),
    language: typeof language === 'string' ? language : null, topics: [...(topics ?? [])],
    created_at: created_at ?? '', updated_at: updated_at ?? '', pushed_at: pushed_at ?? '',
    custom_description: typeof custom_description === 'string' ? custom_description : undefined, ai_summary: repositorySummary(repo).slice(0, 1000) };
}
export function savedChanges(saved: SavedExploration, repositories: Repository[]) {
  const live = new Set(repositories.map(repo => String(repo.id)));
  return { added: repositories.filter(repo => !saved.checked[String(repo.id)]).length,
    changed: repositories.filter(repo => saved.checked[String(repo.id)] && saved.checked[String(repo.id)] !== explorationFingerprint(repo)).length,
    removed: Object.keys(saved.checked).filter(id => !live.has(id)).length };
}
export function createSavedExploration(account: ExplorationAccount, repositories: Repository[], input: { name: string; query: string; path: ExplorationFocus[]; kindFilter: SavedExploration['kindFilter']; camera?: SavedExploration['camera']; layoutPositions?: SavedExploration['layoutPositions'] }): SavedExploration {
  const focus = input.path[input.path.length - 1] ?? { type: 'all' as const };
  const scene = projectScene(account, repositories, focus, input.query);
  const resultIds = resultsForRelationKind(scene.results, input.kindFilter).map(row => row.repositoryId);
  const ids = new Set(resultIds);
  const now = new Date().toISOString();
  return { ...input, scope: focus, id: crypto.randomUUID(), createdAt: now, updatedAt: now, model: account.index?.model ?? '本地已有分析', resultIds,
    profiles: Object.fromEntries(Object.entries(scene.profiles).filter(([id]) => ids.has(Number(id)))), repositories: repositories.filter(repo => ids.has(repo.id)).map(snapshotRepository),
    checked: Object.fromEntries(repositories.map(repo => [String(repo.id), explorationFingerprint(repo)])), overrides: structuredClone(account.overrides) };
}
export function savedExplorationAccount(saved: SavedExploration, ownerId: string): ExplorationAccount {
  return { version: 1, ownerId, revision: 0, index: { version: 1, id: saved.id, createdAt: saved.updatedAt, model: saved.model, profiles: saved.profiles }, queries: [], overrides: saved.overrides, task: null };
}
