import type { AIConfig, Repository } from '../types';
import type { ExplorationAccount, ExplorationTask, ExplorationProfile } from '../features/repositories/exploration/types';
import { explorationFingerprint, queryFingerprint, stableId } from '../features/repositories/exploration/model';
import { localExplorationAccount } from '../features/repositories/exploration/local';
import { explorationCandidates } from './explorationAI';
import { taskConfigSnapshot } from './taskExecution';
import type { ExplorationRun } from './explorationRuntime';

export interface ExplorationAnalysisPreview { total: number; reused: number; pending: number; identity: string }
export const explorationTaskScope = (task: Pick<ExplorationTask,'type'|'query'|'scope'|'savedId'>) => task.type==='build' ? 'build' : JSON.stringify([task.type,task.savedId??'',task.query?.trim()??'',task.scope??'']);
export function explorationGeneration(config: AIConfig, language: string) {
  const profile = taskConfigSnapshot(config, 'organization');
  // Increment the version when the exploration prompt/parser semantics change.
  // Never include credentials, timeouts or concurrency in a content identity.
  return stableId('exploration-v3', JSON.stringify({ language, id: config.id,
    provider: profile.provider, model: profile.model, effort: profile.effort, apiType: config.apiType, endpoint: config.baseUrl,
    mode: config.provider === 'agy-cli' ? config.agyMode : undefined }));
}

/** Pure planning: no journal, provider, recovery or persistence side effects. */
export function planExploration(initial: ExplorationAccount, repositories: Repository[], input: ExplorationRun, config: AIConfig, language: string) {
  const model=`${config.id}:${config.model}`,query=input.query?.trim()??'',scope=input.scope??'',generation=explorationGeneration(config,language);
  const saved = input.savedId ? initial.saved?.find(row => row.id === input.savedId) : undefined;
  if (input.savedId && !saved) throw new Error('已保存探索已被删除，请返回全库。');
  const fingerprint = input.type === 'query' ? queryFingerprint(query, repositories, initial.index, model, scope, generation) : stableId('build', `${repositories.map(repo => explorationFingerprint(repo)).sort().join('|')}:${generation}:${input.force}`);
  const cachedQuery = initial.queries.find(row => row.fingerprint === fingerprint);
  const changed = saved && !input.force ? repositories.filter(repo => saved.checked[String(repo.id)] !== explorationFingerprint(repo)) : repositories;
  const context = scope ? JSON.parse(scope)?.label?.slice(0, 200) ?? '' : '';
  const local = localExplorationAccount(initial, repositories);
  const candidates = input.type === 'build' ? repositories : explorationCandidates(changed, `${query} ${context}`.trim(), { ...local.index!.profiles, ...(saved?.profiles ?? {}) });
  const previous = input.type === 'build' && !input.force && initial.index?.generation === generation ? initial.index.profiles : {};
  const checkpoint = [initial.task,...initial.pendingTasks??[]].find(task=>task && explorationTaskScope(task)===explorationTaskScope({...input,query,scope})) ?? undefined;
  const resuming = !!(input.resume || input.previousTask || input.recoveryOnly || input.failedOnly);
  const reuseCheckpoint = !!checkpoint && (!input.force || resuming) &&
    (resuming || !checkpoint.generation || checkpoint.generation === generation);
  const draft: Record<string, ExplorationProfile> = {};
  for (const repo of candidates) { const existing = (reuseCheckpoint ? checkpoint?.draft[String(repo.id)] : undefined) ?? previous[String(repo.id)]; if (existing?.fingerprint === explorationFingerprint(repo)) draft[String(repo.id)] = existing; }

  return { saved, fingerprint, cachedQuery, changed, context, local, candidates, checkpoint, resuming, reuseCheckpoint, draft, generation };
}

export function analysisPreview(plan: ReturnType<typeof planExploration>, input: ExplorationRun): ExplorationAnalysisPreview {
  const cacheHit=input.type==='query'&&!plan.saved&&!input.force&&!input.resume&&!input.previousTask&&!input.recoveryOnly&&!!plan.cachedQuery;
  const reused=cacheHit?plan.candidates.length:Object.keys(plan.draft).length;
  return { total:plan.candidates.length,reused,pending:plan.candidates.length-reused,identity:plan.fingerprint };
}
