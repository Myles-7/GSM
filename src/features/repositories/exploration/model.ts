import type { Repository } from '../../../types';
import type { ExplorationAccount, ExplorationEntity, ExplorationEvidence, ExplorationFocus, ExplorationIndex, ExplorationProfile, ExplorationResult, ExplorationScene, RelationKind } from './types';

import { topicGroupId } from './topicGroups';

export const normalizeConcept = (text: string) => text.normalize('NFKC').trim().toLowerCase().replace(/[\s_-]+/g, ' ');
export function stableId(prefix: string, value: string): string {
  let first = 2166136261, second = 5381;
  for (const char of value) { first = Math.imul(first ^ char.charCodeAt(0), 16777619); second = Math.imul(second, 33) ^ char.charCodeAt(0); }
  return `${prefix}-${(first >>> 0).toString(36)}${(second >>> 0).toString(36)}`;
}
export function conceptId(type: 'topic' | 'entity', label: string): string {
  const key = normalizeConcept(label);
  return stableId(type, type === 'entity' && ['codex', 'openai codex', 'codex cli', 'openai codex cli'].includes(key) ? 'openai codex' : key);
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return [...new Map(value.map(item => { const row = canonical(item); return [JSON.stringify(row), row]; })).values()].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([key]) => !['generated_at', 'retrieved_at', 'analyzed_at', 'adjustments'].includes(key)).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
  return value;
}
export function explorationFingerprint(repo: Repository): string {
  return stableId('source-v1', JSON.stringify(canonical({ id: repo.id, full_name: repo.full_name, description: repo.description, custom_description: repo.custom_description,
    topics: repo.topics, custom_tags: repo.custom_tags, ai_summary: repo.ai_summary, ai_tags: repo.ai_tags, ai_platforms: repo.ai_platforms, ai_details: repo.ai_details, language: repo.language, pushed_at: repo.pushed_at })));
}
export const libraryFingerprint = (repositories: Repository[]) => stableId('library-v1', repositories.map(repo => [repo.id, explorationFingerprint(repo)]).sort((a, b) => Number(a[0]) - Number(b[0])).map(row => row.join(':')).join('|'));
export const queryFingerprint = (query: string, repositories: Repository[], index: ExplorationIndex | null, model: string, scope = '', generation = '') => stableId('query-v1', `${conceptId('entity', query)}:${scope}:${libraryFingerprint(repositories)}:${index?.id === 'local-preview' ? undefined : index?.id}:${model}${generation ? `:${generation}` : ''}`);
export const relationLabels: Record<RelationKind, string> = { direct: '直接相关', interoperable: '明确互通', similar: '同类能力', discovery: '拓展发现' };
export const relationOrder: RelationKind[] = ['direct', 'interoperable', 'similar', 'discovery'];
export const repositorySummary = (repo: Repository) => repo.custom_description || repo.ai_details?.summary || repo.ai_summary || repo.description || '暂无项目摘要';
export function explorationSearchFields(repo: Repository, profile?: ExplorationProfile) {
  const details = repo.ai_details;
  return [
    {label:'仓库名称',text:repo.full_name,kind:'metadata' as const,weight:100},
    {label:'项目标签',text:[...(repo.topics??[]),...(repo.custom_tags??[])].join(', '),kind:'metadata' as const,weight:90},
    {label:'项目描述',text:[repo.description,repo.custom_description].filter(Boolean).join('\n'),kind:'metadata' as const,weight:80},
    {label:'已有 AI 摘要',text:[repo.ai_summary,details?.summary,...(repo.ai_tags??[]),...(details?.tags??[])].filter(Boolean).join('\n'),kind:'analysis' as const,weight:70},
    {label:'AI 详细分析',text:[details?.problem,...(details?.features??[]),...(details?.scenarios??[]),...(details?.technologies??[]),...(details?.platforms??[]),...(repo.ai_platforms??[]),details?.architecture,details?.deployment,details?.cost,details?.maintenance,...(details?.quickstart??[]).flatMap(row=>[row.description,row.command])].filter(Boolean).join('\n'),kind:'analysis' as const,weight:65},
    {label:'探索画像',text:profile?.summary??'',kind:'analysis' as const,weight:50},
  ];
}
export const specificExplorationTopic = (label:string) => !/^(?:ai(?:应用)?|开发工具|开发与工程|开发工作流|工具(?:集|集合)?|软件|项目|学习(?:资源|资料)?|编程学习|教程(?:资源)?|文档|资源(?:目录)?|开放资源|项目(?:收藏|目录)|资料(?:目录|集合)?|知识与内容|awesome(?:lists?)?|learning(?:resources)?|tutorials?|resources?|collections?|directories|developertools|opensource)$/i.test(normalizeConcept(label).replace(/ /g,''));
const localMentionBranch = '明确提及';
export const isLocalMentionBranch = (label:string) => label===localMentionBranch || label==='明确提及（待核实）';
export function resultsForRelationKind(results: ExplorationResult[], kind: RelationKind | 'all'): ExplorationResult[] {
  if (kind === 'all') return results;
  return results.flatMap(row => {
    if (!row.relations.length) return row.kind === kind ? [row] : [];
    const relations = row.relations.filter(relation => relation.kind === kind);
    if (!relations.length) return [];
    const evidenceIds = new Set(relations.flatMap(relation => relation.evidenceIds));
    return [{ ...row, kind, relations, reason: relations[0].reason, verified: relations[0].verified, evidence: row.evidence.filter(evidence => evidenceIds.has(evidence.id)) }];
  });
}

export function projectScene(account: ExplorationAccount, repositories: Repository[], focus: ExplorationFocus, query = '', inheritedScope?: string): ExplorationScene {
  if(focus.type==='group') {
    const scene=projectScene(account,repositories,{type:'all'});
    const topics=scene.topics.filter(topic=>topicGroupId(topic.label)===focus.id),ids=new Set(topics.flatMap(topic=>topic.repositoryIds));
    return {...scene,topics,results:scene.results.filter(row=>ids.has(row.repositoryId))};
  }
  if(focus.type==='relation') {
    const scene=projectScene(account,repositories,{type:'entity',id:focus.targetId,label:query},query,inheritedScope??JSON.stringify(focus));
    return {...scene,results:resultsForRelationKind(scene.results,focus.kind),branches:scene.branches.filter(branch=>branch.kind===focus.kind)};
  }
  const scope = inheritedScope ?? (focus.type === 'all' || (focus.type === 'entity' || focus.type === 'search') ? '' : JSON.stringify(focus));
  if (focus.type === 'branch' && (focus.branch === '待核实与间接线索' || isLocalMentionBranch(focus.branch) || focus.branch.startsWith('相近用途：'))) {
    const scene = projectScene(account, repositories, { type: 'entity', id: focus.targetId, label: query }, query, scope);
    return { ...scene, results: scene.results.filter(row => focus.branch === '待核实与间接线索' ? !row.relations.length : row.localBranch === (isLocalMentionBranch(focus.branch)?localMentionBranch:focus.branch) || row.relations.some(relation=>relation.branch===focus.branch)), branches: [] };
  }
  const live = new Map(repositories.map(repo => [repo.id, repo]));
  const profiles: Record<string, ExplorationProfile> = structuredClone(account.index?.profiles ?? {});
  const latest = new Map<string, ExplorationAccount['queries'][number]>();
  for (const row of account.queries) if (conceptId('entity', row.query) === conceptId('entity', query) && (!row.scope || row.scope === scope) &&
    row.fingerprint === queryFingerprint(query, repositories, account.index, row.model, row.scope, row.generation)) latest.set(row.scope ?? '', row);
  // Different model/language generations of one direction are alternatives,
  // not additional evidence. Apply the root before a more specific branch.
  const caches = [...latest.values()].sort((a, b) => Number(!!a.scope) - Number(!!b.scope));
  if (query) for (const cache of caches) for (const [id, profile] of Object.entries(cache.profiles)) {
    const previous = profiles[id];
    profiles[id] = previous ? { ...profile, topics: [...new Map([...previous.topics, ...profile.topics].map(row => [row.id, row])).values()], entities: [...new Map([...previous.entities, ...profile.entities].map(row => [row.id, row])).values()],
      relations: [...new Map([...previous.relations, ...profile.relations].map(row => [row.id, row])).values()], evidence: [...new Map([...previous.evidence, ...profile.evidence].map(row => [row.id, row])).values()] } : profile;
  }
  for (const id of Object.keys(profiles)) if (!live.has(Number(id))) delete profiles[id];
  const unresolvedOverrides = [] as ExplorationAccount['overrides'];
  for (const override of account.overrides) {
    let found = false;
    if (override.type === 'set-topics') {
      const profile = profiles[String(override.repositoryId)];
      if (profile) { profile.topics = structuredClone(override.topics); found = true; }
    } else for (const profile of Object.values(profiles)) {
      if (override.type === 'rename-topic') profile.topics = profile.topics.map(topic => { if (topic.id !== override.topicId) return topic; found = true; return { ...topic, label: override.label }; });
      else profile.relations = profile.relations.filter(relation => { if (relation.id !== override.relationId) return true; found = true; return false; });
    }
    if (!found) unresolvedOverrides.push(override);
  }
  const topics = new Map<string, ExplorationScene['topics'][number]>();
  const entities = new Map<string, ExplorationEntity>();
  for (const profile of Object.values(profiles)) {
    for (const topic of profile.topics) { const row = topics.get(topic.id) ?? { ...topic, repositoryIds: [] }; row.repositoryIds.push(profile.repositoryId); topics.set(row.id, row); }
    for (const entity of profile.entities) { const old = entities.get(entity.id); entities.set(entity.id, { ...entity, aliases: [...new Set([...(old?.aliases ?? []), ...entity.aliases])] }); }
  }
  const targetId = (focus.type === 'entity' || focus.type === 'search') ? focus.id : focus.type === 'branch' ? focus.targetId : '';
  const queryText = normalizeConcept(query);
  const queryTerms = [...new Set([queryText, ...(targetId === conceptId('entity', 'Codex') ? ['codex'] : []), ...(entities.get(targetId)?.aliases.map(normalizeConcept) ?? [])])].filter(Boolean);
  const mentions = new Map(repositories.map(repo=>[repo.id,explorationSearchFields(repo,profiles[String(repo.id)]).find(field=>queryTerms.some(term=>normalizeConcept(field.text).includes(term)))]));
  const seedProfiles = targetId ? Object.values(profiles).filter(profile => profile.relations.some(relation => relation.targetId === targetId) || mentions.get(profile.repositoryId)) : [];
  const sharedTopics = new Set(seedProfiles.flatMap(profile => profile.topics.filter(topic=>specificExplorationTopic(topic.label)).map(topic => topic.id)));
  const selectedRepository = focus.type === 'repository' ? profiles[String(focus.id)] : undefined;
  const rows: ExplorationResult[] = [];
  for (const repo of repositories) {
    const profile = profiles[String(repo.id)];
    let fallbackEvidence: ExplorationEvidence[] = [];
    let relations = profile?.relations.filter(relation => targetId ? relation.targetId === targetId : focus.type === 'repository' ? relation.targetType === 'repository' && relation.targetId === String(focus.id) : false) ?? [];
    if (focus.type === 'repository') relations = [...relations, ...(selectedRepository?.relations.filter(relation => relation.targetType === 'repository' && relation.targetId === String(repo.id)) ?? [])];
    if (focus.type === 'branch') relations = relations.filter(relation => relation.kind === focus.kind && relation.branch === focus.branch);
    let reason = '', include = false, localBranch: string | undefined;
    if (focus.type === 'all') { include = true; reason = profile?.status === 'ready' ? profile.topics.map(topic => topic.label).join(' · ') : '资料不足，尚未形成探索主题'; }
    else if (focus.type === 'topic') { include = !!profile?.topics.some(topic => topic.id === focus.id); reason = `${account.overrides.some(item => item.type === 'set-topics' && item.repositoryId === repo.id) ? '人工调整的探索归属' : '用途与能力主题'}：${focus.label}`; }
    else if (relations.length) { include = true; reason = relations[0].reason; }
    else if ((focus.type === 'entity' || focus.type === 'search')) {
      const matched = mentions.get(repo.id);
      if (matched) {
        include = true; reason = `${matched.label}提及该主题，仅作为召回线索；关系尚未核实`;
        localBranch = localMentionBranch;
        const offset = Math.max(0,...queryTerms.map(term=>normalizeConcept(matched.text).indexOf(term)).filter(index=>index>=0));
        fallbackEvidence = [{ id: stableId('local-evidence', `${repo.id}:${matched.label}:${matched.text}`), kind: matched.kind, label: matched.label, text: matched.text.slice(Math.max(0,offset-180),Math.max(0,offset-180)+3000), url: repo.html_url, verified: false, retrievedAt: repo.analyzed_at || repo.updated_at }];
      }
      else if (profile?.topics.some(topic => sharedTopics.has(topic.id))) { const common = profile.topics.filter(topic=>sharedTopics.has(topic.id)); include = true; localBranch = `相近用途：${common[0].label}`; reason = `通过共同用途主题发现：${common.map(topic => topic.label).join('、')}；未证明直接支持`; fallbackEvidence=profile.evidence.filter(item=>common.some(topic=>topic.evidenceIds?.includes(item.id))); }
    } else if (focus.type === 'repository' && repo.id !== focus.id && selectedRepository) {
      const common = profile?.topics.filter(topic => selectedRepository.topics.some(other => other.id === topic.id)) ?? [];
      if (common.length) { include = true; reason = `与焦点项目共享用途主题：${common.map(topic => topic.label).join('、')}；属于间接线索`; }
    }
    if (!include) continue;
    if((focus.type==='entity' || focus.type==='search')) {
      if(mentions.get(repo.id)) localBranch=localMentionBranch;
      else { const common=profile?.topics.find(topic=>sharedTopics.has(topic.id));if(common)localBranch=`相近用途：${common.label}`; }
    }
    relations = [...relations].sort((a, b) => relationOrder.indexOf(a.kind) - relationOrder.indexOf(b.kind));
    const topicEvidenceIds = (focus.type === 'topic' ? profile?.topics.filter(topic => topic.id === focus.id) : focus.type === 'all' ? profile?.topics : [])?.flatMap(topic => topic.evidenceIds ?? []) ?? [];
    const evidenceIds = new Set([...relations.flatMap(relation => relation.evidenceIds), ...topicEvidenceIds]);
    const evidence = [...new Map([...[...(profile?.evidence ?? []), ...(focus.type === 'repository' ? selectedRepository?.evidence ?? [] : [])].filter(item => evidenceIds.has(item.id)), ...fallbackEvidence].map(item => [item.id, item])).values()];
    const isExtended = (focus.type === 'entity' || focus.type === 'search') && !relations.length && !mentions.get(repo.id);
    rows.push({ repositoryId: repo.id, kind: relations[0]?.kind ?? 'discovery', reason: relations[0]?.reason ?? reason, relations, evidence, verified: !!relations[0]?.verified, ...(localBranch ? {localBranch} : {}), ...(isExtended ? { tier: 'extended' as const } : {}) });
  }
  const relevance = (row:ExplorationResult) => normalizeConcept(live.get(row.repositoryId)?.full_name ?? '') === queryText || normalizeConcept(live.get(row.repositoryId)?.name ?? '') === queryText ? 2000 : queryText && normalizeConcept(live.get(row.repositoryId)?.full_name ?? '').includes(queryText) ? 1500 : row.verified && ['direct','interoperable'].includes(row.kind) ? 1000-relationOrder.indexOf(row.kind) : mentions.get(row.repositoryId) ? 600+mentions.get(row.repositoryId)!.weight : row.relations.length ? 400-relationOrder.indexOf(row.kind) : 100;
  rows.sort((a, b) => relevance(b)-relevance(a) || Number(b.verified) - Number(a.verified) || (live.get(b.repositoryId)?.stargazers_count ?? 0) - (live.get(a.repositoryId)?.stargazers_count ?? 0) || a.repositoryId - b.repositoryId);
  const branches = new Map<string, ExplorationScene['branches'][number]>();
  if ((focus.type === 'entity' || focus.type === 'search')) for (const row of rows) {
    const values = [...row.relations, ...(row.localBranch || !row.relations.length ? [{ kind: 'discovery' as const, branch: row.localBranch ?? '待核实与间接线索' }] : [])];
    for (const value of new Map(values.map(relation => [`${relation.kind}:${relation.branch}`, relation])).values()) {
      const id = stableId('branch', `${targetId}:${value.kind}:${value.branch}`); const branch = branches.get(id) ?? { id, label: value.branch, kind: value.kind, count: 0 }; branch.count++; branches.set(id, branch);
    }
  }
  return { profiles, topics: [...topics.values()].sort((a, b) => b.repositoryIds.length - a.repositoryIds.length || a.id.localeCompare(b.id)), entities: [...entities.values()].sort((a, b) => a.label.localeCompare(b.label)), results: rows, branches: [...branches.values()].sort((a, b) => relationOrder.indexOf(a.kind) - relationOrder.indexOf(b.kind)), unresolvedOverrides };
}

export function resolveExplorationTargets(scene: ExplorationScene, query: string): ExplorationEntity[] {
  const key = normalizeConcept(query);
  const matching = scene.entities.filter(entity => [entity.label, ...entity.aliases].some(label => normalizeConcept(label) === key));
  if (matching.length) return matching;
  const partial = scene.entities.filter(entity => [entity.label, ...entity.aliases].some(label => normalizeConcept(label).includes(key) || normalizeConcept(label).length >= 3 && key.includes(normalizeConcept(label))));
  return partial.length ? partial : [{ id: conceptId('entity', query), label: conceptId('entity',query)===conceptId('entity','Codex') ? 'OpenAI Codex' : query, aliases: [], description: '当前探索主题；不代表本地已收藏对应官方项目' }];
}
