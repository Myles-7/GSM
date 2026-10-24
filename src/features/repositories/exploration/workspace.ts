import { topicGroups } from './topicGroups';
import type { Repository } from '../../../types';
import { explorationSearchFields, normalizeConcept, stableId } from './model';
import type { ExplorationFocus, ExplorationScene, ExplorationWorkspace } from './types';

export function workspaceContent(value: Pick<ExplorationWorkspace, 'query' | 'path' | 'kindFilter'>) {
  return JSON.stringify([value.query, value.path, value.kindFilter]);
}
export function workspaceScope(scene: ExplorationScene) {
  return stableId('workspace-scope-v1', JSON.stringify([scene.results.map(row => [row.repositoryId,row.kind,row.relations.map(relation=>relation.id)]).sort((a,b)=>Number(a[0])-Number(b[0])),scene.topics.map(row=>[row.id,row.label]).sort(),scene.branches.map(row=>[row.id,row.count]).sort()]));
}
export function restoreWorkspacePath(path: ExplorationFocus[], scene: ExplorationScene, repositories: Repository[], resolve?: (focus: ExplorationFocus) => ExplorationScene) {
  const valid: ExplorationFocus[] = [];
  for (const step of path) {
    const current=resolve?.(step)??scene;
    if(step.type==='relation'&&resolve&&!current.results.length)break;
    if(step.type==='group'&&!topicGroups(scene).some(group=>group.id===step.id))break;
    if (step.type === 'topic' && !current.topics.some(row => row.id === step.id) || step.type === 'repository' && !repositories.some(row => row.id === step.id)) break;
    // Entity queries remain meaningful even if no repository currently matches them.
    if (step.type === 'branch' && !(resolve?current.results.length>0:Object.values(scene.profiles).some(profile => profile.relations.some(row => row.targetId === step.targetId && row.branch === step.branch && row.kind === step.kind)))) break;
    valid.push(step);
  }
  return valid.length ? valid : [{type:'all'} as const];
}
export interface SearchSuggestion { id: string; group: 'repositories' | 'topics' | 'entities'; label: string; focus: ExplorationFocus; repositoryId?: number }
export function explorationSuggestions(query: string, scene: ExplorationScene, repositories: Repository[]): SearchSuggestion[] {
  const term = normalizeConcept(query);
  if (!term) return [];
  const repos = repositories.map(repo => ({repo, score: normalizeConcept(repo.full_name) === term || normalizeConcept(repo.name) === term ? 1000 : normalizeConcept(repo.full_name).includes(term) ? 900 : explorationSearchFields(repo, scene.profiles[String(repo.id)]).find(field => normalizeConcept(field.text).includes(term))?.weight ?? 0})).filter(row => row.score > 0).sort((a,b) => b.score-a.score || a.repo.full_name.localeCompare(b.repo.full_name)).slice(0,6);
  return [
    ...repos.map(({repo}): SearchSuggestion => ({id:`repo-${repo.id}`,group:'repositories',label:repo.full_name,focus:{type:'repository',id:repo.id,label:repo.name},repositoryId:repo.id})),
    ...scene.topics.filter(row => normalizeConcept(row.label).includes(term)).slice(0,4).map((row): SearchSuggestion => ({id:row.id,group:'topics',label:row.label,focus:{type:'topic',id:row.id,label:row.label}})),
    ...scene.entities.filter(row => [row.label,...row.aliases].some(label => normalizeConcept(label).includes(term))).slice(0,4).map((row): SearchSuggestion => ({id:row.id,group:'entities',label:row.label,focus:{type:'entity',id:row.id,label:row.label}})),
  ];
}
