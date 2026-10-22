import { useAppStore } from '../store/useAppStore';
import type { AIConfig, Repository } from '../types';
import type { ExplorationAccount, ExplorationOverride, ExplorationProfile, ExplorationTask, SavedExploration } from '../features/repositories/exploration/types';
import { loadExploration, updateExploration } from '../features/repositories/exploration/storage';
import { explorationFingerprint, projectScene, queryFingerprint, resultsForRelationKind, stableId } from '../features/repositories/exploration/model';
import { localExplorationAccount, localProfile, savedExplorationAccount, snapshotRepository } from '../features/repositories/exploration/local';
import { analyzeExplorationBatch, consolidateExplorationTopics, explorationCandidates } from './explorationAI';
import { assertRepositoryIdentityWritable } from './repositoryIdentityGate';
import { assertOrganizationModelReady } from './aiOrganizationReadiness';
import { refreshAgyDeviceState, readAgyRecovery, acknowledgeAgyRecovery } from './agyClient';
import { aiTaskJournal, type AITaskRecord } from './aiTaskJournal';
import { bindTaskItemSignal, bindTaskSignal, retryTaskConfig, taskConfigSnapshot, type TaskHandle, type TaskRetryParameters } from './taskExecution';
import { confirmTaskRecovery } from './agyRecoveryPolicy';
import type { AgyRecoveryRecord } from '../types/agy';
import { taskObservability } from './taskObservability';

interface RuntimeState { account: ExplorationAccount | null; loading: boolean; busy: boolean; activity: string; error: string; concurrency: number }
const states = new Map<string, RuntimeState>();
const listeners = new Set<() => void>();
const jobs = new Map<string, AbortController>();
const loading = new Map<string, Promise<void>>();
const snapshot = (owner: string) => { if (!states.has(owner)) states.set(owner, { account: null, loading: !!owner, busy: false, activity: '', error: '', concurrency: 0 }); return states.get(owner)!; };
function patch(owner: string, update: Partial<RuntimeState>) { states.set(owner, { ...snapshot(owner), ...update }); listeners.forEach(listener => listener()); }
function guard(owner: string) {
  if (!owner || String(useAppStore.getState().user?.id ?? '') !== owner) throw new DOMException('账号已切换，任务已停止。', 'AbortError');
  assertRepositoryIdentityWritable(owner);
}
const safeError = (reason: unknown, config?: AIConfig) => {
  const state = useAppStore.getState(); let text = reason instanceof Error ? reason.message : String(reason);
  if (reason instanceof SyntaxError) text = '模型返回的数据不是完整 JSON；该批保留待处理，其他成功批次不受影响。';
  if (reason instanceof Error && reason.name === 'ZodError') text = '模型返回的项目或证据未通过结构校验；该批保留待处理，其他成功批次不受影响。';
  for (const secret of [config?.apiKey, state.githubToken, state.backendApiSecret]) if (secret) text = text.split(secret).join('[redacted]');
  return text.slice(0, 1000);
};
async function publish(owner: string, update: (account: ExplorationAccount) => ExplorationAccount) {
  const account = await updateExploration(owner, update, () => guard(owner));
  patch(owner, { account }); return account;
}
const fatal = (error: unknown) => /AGY_(?:DISABLED|NOT_FOUND|TEST_REQUIRED|DESKTOP_REQUIRED|AUTH_REQUIRED|PERMISSION_DENIED|QUOTA_EXHAUSTED|BUDGET_LIMIT|CONFIG_CHANGED|EXECUTABLE_CHANGED|RECOVERY_STORAGE_FULL|RECOVERY_ENCRYPTION_UNAVAILABLE)|MODEL_CONFIGURATION|本机.*保存|QuotaExceeded|账号已切换/i.test(error instanceof Error ? error.message : String(error)) || [401,403].includes((error as {status?:number})?.status ?? 0);
const uncertain = (reason: unknown) => /AGY_(TIMEOUT|PROCESS_FAILED|CANCELED|OUTPUT_LIMIT|CLEANUP_TIMEOUT)/.test(String(reason)) || (reason as {details?:{providerOutcome?:string}})?.details?.providerOutcome === 'unknown';
const retryableUnsent = (reason: unknown) => {
  const value = reason as { message?: string; details?: { sent?: boolean; providerOutcome?: string } };
  return value.details?.sent === false && /AGY_(BUSY|RESOURCE_DEFERRED|QUEUE_TIMEOUT|INIT_TIMEOUT|RATE_LIMIT)/.test(value.message ?? '');
};
async function delay(ms: number, signal: AbortSignal) {
  await new Promise<void>((resolve, reject) => { signal.throwIfAborted(); const abort = () => { clearTimeout(timer); reject(signal.reason); }; const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, ms); signal.addEventListener('abort', abort, { once: true }); });
}
export interface ExplorationRun { type: 'build' | 'query'; configId: string; query?: string; scope?: string; force?: boolean; savedId?: string; previousTask?: AITaskRecord; parameters?: TaskRetryParameters; recoveryOnly?: boolean; failedOnly?: boolean }
const taskScope = (task: Pick<ExplorationTask,'type'|'query'|'scope'|'savedId'>) => task.type==='build' ? 'build' : JSON.stringify([task.type,task.savedId??'',task.query?.trim()??'',task.scope??'']);
function resumePending(account:ExplorationAccount) { return {task:account.pendingTasks?.[0]??null,pendingTasks:account.pendingTasks?.slice(1)}; }
async function execute(owner: string, input: ExplorationRun) {
  if (jobs.has(owner)) return;
  const controller = new AbortController(); jobs.set(owner, controller); patch(owner, { busy: true, error: '', activity: '检查模型与本机状态' });
  const { signal } = controller;
  let task: ExplorationTask | undefined, journal: TaskHandle | undefined, executionConfig: AIConfig | undefined;
  try {
    guard(owner); const state = useAppStore.getState();
    executionConfig = state.aiConfigs.find(config => config.id === input.configId);
    if (executionConfig?.provider === 'agy-cli') {
      if (!window.electronAPI?.agy) throw new Error('AGY_DESKTOP_REQUIRED');
      await refreshAgyDeviceState(); guard(owner); signal.throwIfAborted(); executionConfig = useAppStore.getState().aiConfigs.find(config => config.id === input.configId);
    }
    if (!input.recoveryOnly) assertOrganizationModelReady(executionConfig);
    else if (!executionConfig) throw new Error('缺少原任务配置，请先返回设置恢复配置。');
    if (input.previousTask) executionConfig = retryTaskConfig(executionConfig, input.previousTask, input.parameters);
    const config = executionConfig, model = `${config.id}:${config.model}`, query = input.query?.trim() ?? '', scope = input.scope ?? '';
    const repositories = structuredClone(state.repositories);
    if (!repositories.length || repositories.length > 1000) throw new Error('项目地图支持1–1000个本地仓库。');
    if (query.length > 200) throw new Error('探索主题请控制在200字符内。');
    const initial = await loadExploration(owner); guard(owner); signal.throwIfAborted();
    const saved = input.savedId ? initial.saved?.find(row => row.id === input.savedId) : undefined;
    if (input.savedId && !saved) throw new Error('已保存探索已被删除，请返回全库。');
    const fingerprint = input.type === 'query' ? queryFingerprint(query, repositories, initial.index, model, scope) : stableId('build', `${repositories.map(repo => explorationFingerprint(repo)).sort().join('|')}:${model}:${input.force}`);
    if (input.type === 'query' && !saved && initial.queries.some(row => row.fingerprint === fingerprint)) { patch(owner, { account: initial }); return; }
    const changed = saved && !input.force ? repositories.filter(repo => saved.checked[String(repo.id)] !== explorationFingerprint(repo)) : repositories;
    const context = scope ? JSON.parse(scope)?.label?.slice(0, 200) ?? '' : '';
    const local = localExplorationAccount(initial, repositories);
    const candidates = input.type === 'build' ? repositories : explorationCandidates(changed, `${query} ${context}`.trim(), { ...local.index!.profiles, ...(saved?.profiles ?? {}) });
    const previous = input.type === 'build' && !input.force ? initial.index?.profiles ?? {} : {};
    const checkpoint = [initial.task,...initial.pendingTasks??[]].find(task=>task && taskScope(task)===taskScope({...input,query,scope})) ?? undefined;
    const draft: Record<string, ExplorationProfile> = {};
    for (const repo of candidates) { const existing = checkpoint?.draft[String(repo.id)] ?? previous[String(repo.id)]; if (existing?.fingerprint === explorationFingerprint(repo)) draft[String(repo.id)] = existing; }
    if (input.type === 'build' && !input.force && !checkpoint && Object.keys(draft).length === repositories.length) { patch(owner, { account: initial }); return; }
    await aiTaskJournal.load(owner);
    const previousJournal = input.previousTask ?? (checkpoint?.journalId ? aiTaskJournal.snapshot().find(row => row.id === checkpoint.journalId) : undefined);
    if (previousJournal && !input.recoveryOnly && !confirmTaskRecovery(previousJournal, state.language.startsWith('zh'), input.failedOnly ? previousJournal.items.filter(item=>item.state==='failed').map(item=>item.id) : undefined)) return;
    for (const item of previousJournal?.items.filter(item => item.recovery) ?? []) {
      const recovered = await readAgyRecovery(owner, item.recovery!.requestId);
      const context = recovered.context as { repositoryIds?: number[]; fingerprints?: string[] } | undefined;
      if (context?.repositoryIds?.length && context.repositoryIds.every((id,index) => draft[String(id)]?.fingerprint === context.fingerprints?.[index]) && recovered.record.resultDigest) await acknowledgeAgyRecovery(owner, item.recovery!.requestId, recovered.record.resultDigest);
    }
    const pending = candidates.filter(repo => !draft[String(repo.id)]);
    const failedIds = input.failedOnly && checkpoint?.failures?.length ? new Set(checkpoint.failures.flatMap(row=>row.repositoryIds)) : undefined;
    const selected = failedIds ? pending.filter(repo=>failedIds.has(repo.id)) : pending;
    const deferred = failedIds ? pending.filter(repo=>!failedIds.has(repo.id)) : [];
    const batches = Array.from({ length: Math.ceil(selected.length / 5) }, (_, index) => selected.slice(index * 5, index * 5 + 5));
    const deferredBatches = Array.from({length:Math.ceil(deferred.length/5)},(_,index)=>deferred.slice(index*5,index*5+5));
    const itemId = (batch: Repository[]) => stableId('batch', batch.map(repo => `${repo.id}:${explorationFingerprint(repo)}`).join('|'));
    journal = aiTaskJournal.begin(owner, 'exploration', [...[...batches,...deferredBatches].map(batch => ({ id: itemId(batch), label: batch.map(repo => repo.full_name).join(' · ') })), ...(input.type === 'build' ? [{ id: 'topics', label: '合并等价主题' }] : [])], config.id, undefined,
      { title: saved ? `更新探索：${saved.name}` : input.type === 'build' ? initial.index ? '更新项目地图' : '建立项目地图' : `深入探索：${query}`, parentId: previousJournal?.id,
        target: { view: 'repositories', id: input.savedId ?? (input.type === 'query' ? `query:${query}` : 'project-map') }, units:{items:'batches',repositories:candidates.length}, config: taskConfigSnapshot(config, 'organization'), location: 'device', executor: config.provider === 'agy-cli' ? 'agy-device' : 'server-provider' });
    let paused=false,wake:undefined|(()=>void);
    bindTaskSignal(signal, journal); journal.bind({ stop: () => {controller.abort();wake?.();},pause:()=>{paused=true;journal!.state('pausing');},resume:()=>{paused=false;wake?.();wake=undefined;} });
    journal.metadata({capabilities:{pause:true,cancel:true,resume:'safe'}});
    const waitForDispatch=async()=>{
      if(!paused)return;
      journal!.state('paused');
      await publish(owner,current=>current.task?.journalId===journal!.id?{...current,task:{...current.task,status:'paused'}}:current);
      while(paused&&!signal.aborted)await new Promise<void>(resolve=>{const finish=()=>{signal.removeEventListener('abort',finish);resolve();};wake=finish;signal.addEventListener('abort',finish,{once:true});if(!paused||signal.aborted)finish();});
      signal.throwIfAborted();journal!.state('running');
      await publish(owner,current=>current.task?.journalId===journal!.id?{...current,task:{...current.task,status:'running'}}:current);
    };
    await aiTaskJournal.flush(owner);
    if (aiTaskJournal.storageError()) throw new Error('AI任务记录无法持久化，尚未发送模型请求。');
    const taskId = crypto.randomUUID();
    const checked = saved ? Object.fromEntries(repositories.map(repo => [String(repo.id), explorationFingerprint(repo)])) : undefined;
    task = { id: taskId, journalId: journal.id, type: input.type, savedId: input.savedId, query: query || undefined, scope, force: input.force, status: 'running', model, fingerprint, startedAt: new Date().toISOString(), completed: Object.keys(draft).length, total: candidates.length, draft, checked, failures: [] };
    await publish(owner, current => {
      if (current.task?.status === 'running' && current.task.id !== initial.task?.id) throw new Error('另一个页面正在运行地图任务。');
      const pendingTasks=(current.pendingTasks??[]).filter(row=>taskScope(row)!==taskScope(task!));
      if(current.task && taskScope(current.task)!==taskScope(task!) && !pendingTasks.some(row=>row.id===current.task!.id)) pendingTasks.push({...current.task,status:current.task.status==='running'?'interrupted':current.task.status});
      if(pendingTasks.length>20)throw new Error('未完成的探索检查点已达20个，请先处理已有任务。');
      return { ...current, pendingTasks, task: task! };
    });
    const knownTopics = [...new Map(Object.values(local.index!.profiles).flatMap(profile => profile.topics).map(topic => [topic.id, topic])).values()].sort((a,b) => a.id.localeCompare(b.id)).slice(0, 80);
    let concurrency = Math.max(1, Math.min(5, config.concurrency ?? 2, config.provider === 'agy-cli' ? config.agyFeatureOverrides?.organization?.concurrency ?? 5 : 5));
    patch(owner, { concurrency }); journal.metadata({ usage: { configured_concurrency: concurrency } });
    let next = 0, fatalFailure: unknown;
    // Main-process AGY admission owns device capacity, feature limits and backoff.
    // A second adaptive pool here silently prevents an explicit limit of five.
    let admission = concurrency;
    const reportAdmission = () => { const usage = aiTaskJournal.snapshot().find(row => row.id === journal!.id)?.usage ?? {}; journal!.metadata({ usage: { ...usage, admission_concurrency: admission } }); };
    reportAdmission();
    const refreshConcurrency = () => {
      if(config.provider!=='agy-cli')return;
      const latest=useAppStore.getState().aiConfigs.find(row=>row.id===config.id);
      if(!latest || latest.provider!=='agy-cli')return;
      const limit=Math.max(1,Math.min(5,latest.concurrency??5,latest.agyFeatureOverrides?.organization?.concurrency??5));
      if(limit===concurrency)return;
      concurrency=limit;admission=limit;patch(owner,{concurrency});
      const usage=aiTaskJournal.snapshot().find(row=>row.id===journal!.id)?.usage??{};
      journal!.metadata({usage:{...usage,configured_concurrency:limit}});reportAdmission();
    };
    // Checkpoints merge against current durable state so concurrent completions cannot regress it.
    const saveProgress = async (profiles: ExplorationProfile[]) => {
      await publish(owner, current => {
        if (current.task?.id !== taskId) throw new Error('任务已被其他页面替换。');
        const merged = { ...current.task.draft, ...Object.fromEntries(profiles.map(profile => [String(profile.repositoryId), profile])) };
        task = { ...current.task, draft: merged, completed: Object.keys(merged).length };
        return { ...current, task };
      });
      journal!.progress(task!.completed, task!.total);
    };
    const worker = async (batchIndex: number) => {
        const batch = batches[batchIndex], id = itemId(batch), batchController = new AbortController();
        const stop = () => batchController.abort(signal.reason); signal.addEventListener('abort', stop, { once: true });
        bindTaskItemSignal(batchController.signal, journal!, id); journal!.item(id, 'running');
        const started = performance.now(); let record: AgyRecoveryRecord | undefined;
        try {
          let recovered: Parameters<typeof analyzeExplorationBatch>[0]['recovered'];
          const recoverable = previousJournal?.items.find(item => item.id === id && item.recovery);
          if (recoverable?.recovery) {
            const response = await readAgyRecovery(owner, recoverable.recovery.requestId);
            const context = response.context as { exploration?: boolean; sources?: Parameters<typeof analyzeExplorationBatch>[0]['recovered'] extends infer T ? T extends { sources: infer S } ? S : never : never; fingerprints?: string[]; repositoryIds?: number[] } | undefined;
            if (!response.result || !context?.exploration || !Array.isArray(context.sources) || JSON.stringify(context.fingerprints) !== JSON.stringify(batch.map(repo => explorationFingerprint(repo))) || JSON.stringify(context.repositoryIds) !== JSON.stringify(batch.map(repo => repo.id))) throw new Error('恢复结果与当前项目资料不一致，请核对任务记录。');
            recovered = { text: response.result.text, sources: context.sources }; record = response.record;
          }
          if (input.recoveryOnly && !recovered) throw new Error('该批没有可恢复的模型结果；未发起新的调用。请使用继续未完成项。');
          let profiles: ExplorationProfile[] = [];
          for (let attempt = 0; ; attempt++) {
            try {
              guard(owner); signal.throwIfAborted();
              profiles = await analyzeExplorationBatch({ ownerId: owner, repositories: batch, allRepositories: repositories, config, language: state.language, token: useAppStore.getState().githubToken ?? '', signal: batchController.signal, guard: () => guard(owner), knownTopics, query: input.type === 'query' ? query : undefined, context,
                onSent: () => { journal!.itemExecution(id, { providerOutcome: 'in_flight' }); const items = aiTaskJournal.snapshot().find(row => row.id === journal!.id)?.items ?? []; const usage = aiTaskJournal.snapshot().find(row => row.id === journal!.id)?.usage ?? {}; journal!.metadata({ usage: { ...usage, peak_generating_concurrency: Math.max(usage.peak_generating_concurrency ?? 0, items.filter(item => item.providerOutcome === 'in_flight').length) } }); },
                onResponse: () => journal!.itemExecution(id, { providerOutcome: 'succeeded' }),
                recovered, recovery: config.provider === 'agy-cli' && !recovered ? { requestId: crypto.randomUUID(), step: `exploration:${input.type}:${stableId('scope',query+scope+(input.savedId ?? ''))}:${id}`, onResult: value => { record = value; } } : undefined,
                onProgress: message => { if (!signal.aborted) patch(owner, { activity: `第 ${batchIndex + 1}/${batches.length} 批 · ${message}` }); } });
              break;
            } catch (reason) { if (attempt >= 2 || !retryableUnsent(reason) || signal.aborted) throw reason; await delay(Math.max(500 * 2 ** attempt, Number((reason as {retryAfterMs?:number}).retryAfterMs) || 0), signal); }
          }
          guard(owner); signal.throwIfAborted();
          await saveProgress(profiles); journal!.itemExecution(id, { validationStatus: 'passed', commitStatus: 'saved' });
          for(const profile of profiles)taskObservability.result(owner,journal!.id,{id:`profile:${profile.repositoryId}`,itemId:id,repositoryId:profile.repositoryId,label:batch.find(repo=>repo.id===profile.repositoryId)?.full_name??String(profile.repositoryId),data:profile,commitStatus:'saved'});
          if (record?.resultDigest) { await acknowledgeAgyRecovery(owner, record.requestId, record.resultDigest); journal!.itemExecution(id, { recovery: undefined }); }
          journal!.item(id, 'complete');
        } catch (reason) {
          const message = safeError(reason, config); journal!.item(id, 'failed', message);
          // Stop accepting new batches after an infrastructure failure. Already
          // dispatched siblings finish and checkpoint independently; never replay
          // an unknown model outcome automatically.
          if (config.provider === 'agy-cli' && /AGY_(TIMEOUT|INIT_TIMEOUT|RATE_LIMIT|PROCESS_FAILED|RESOURCE_DEFERRED|CLEANUP_TIMEOUT)/.test(message)) fatalFailure ??= reason;
          const unknown = uncertain(reason) && !record?.resultDigest && aiTaskJournal.snapshot().find(row => row.id === journal!.id)?.items.find(item => item.id === id)?.providerOutcome !== 'succeeded';
          if (unknown) journal!.itemExecution(id, { providerOutcome: 'unknown', failureCode: 'unknown_provider_outcome' });
          if (!signal.aborted) try { await publish(owner, current => {
            if (current.task?.id !== taskId) throw new Error('任务已替换。');
            task = { ...current.task, failures: [...(current.task.failures ?? []), { repositoryIds: batch.map(repo => repo.id), message, unknown }] }; return { ...current, task };
          }); } catch (storageError) { fatalFailure = storageError; }
          if (fatal(reason)) fatalFailure = reason;
        } finally {
          signal.removeEventListener('abort', stop);
          const old = aiTaskJournal.snapshot().find(row => row.id === journal!.id)?.usage ?? {};
          journal!.metadata({ usage: { ...old, [`batch_${batchIndex + 1}_ms`]: Math.round(performance.now() - started) } });
        }
    };
    journal.progress(task.completed, task.total);
    const running = new Set<Promise<void>>();
    while ((next < batches.length && !fatalFailure && !signal.aborted) || running.size) {
      refreshConcurrency();
      if(!running.size&&!fatalFailure&&!signal.aborted)await waitForDispatch();
      while (next < batches.length && !paused && !fatalFailure && !signal.aborted && running.size < admission) {
        const pending = worker(next++).catch(reason => { fatalFailure ??= reason; });
        running.add(pending); void pending.then(() => running.delete(pending));
      }
      if (running.size) await Promise.race(running);
    }
    signal.throwIfAborted(); if (fatalFailure) throw fatalFailure;
    if (task.failures?.length) throw new Error(task.failures.map(row => row.message).join('；').slice(0, 1000));
    if (task.completed < task.total) {
      const message = `失败项已处理，仍有 ${task.total-task.completed} 个项目尚未执行，可继续未完成项。`;
      await publish(owner,current=>{if(current.task?.id!==task!.id)throw new Error('任务已替换。');return {...current,task:{...current.task,status:'interrupted',error:message}};});
      journal.finish('partial');patch(owner,{error:message});return;
    }
    let profiles = task.draft, topicError = '';
    if (input.type === 'build' && !input.recoveryOnly) {
      await waitForDispatch();
      await publish(owner, current => { if (current.task?.id !== taskId) throw new Error('任务已替换。'); task = { ...current.task, phase: 'topics' }; return { ...current, task }; });
      journal.item('topics', 'running'); bindTaskItemSignal(signal, journal, 'topics'); patch(owner, { activity: '整理等价用途主题' });
      try { profiles = await consolidateExplorationTopics(profiles, config, state.language, new Set(initial.overrides.flatMap(row => row.type === 'rename-topic' ? [row.topicId] : row.type === 'set-topics' ? row.topics.map(topic => topic.id) : [])), signal, () => guard(owner)); journal.item('topics', 'complete'); }
      catch (reason) { signal.throwIfAborted(); topicError = safeError(reason, config); journal.item('topics', 'failed', topicError); }
    }
    journal.phase('committing');
    await publish(owner, current => {
      if (current.task?.id !== taskId) throw new Error('任务已被其他页面替换。');
      if (input.type === 'build') return { ...current, index: { version: 1, id: taskId, model, createdAt: new Date().toISOString(), profiles }, ...(topicError ? {task:{ ...current.task, phase: 'topics' as const, status: 'failed' as const, error: topicError, draft: profiles }} : resumePending(current)) };
      if (saved) {
        const currentSaved = current.saved?.find(row => row.id === saved.id);
        if (!currentSaved || currentSaved.updatedAt !== saved.updatedAt) throw new Error('保存的探索已修改，请重新更新。');
        const changedIds = new Set(changed.map(repo => repo.id));
        const updatedProfiles = { ...saved.profiles };
        for (const id of changedIds) delete updatedProfiles[String(id)];
        const candidateProfiles = { ...Object.fromEntries(changed.map(repo => [String(repo.id), localProfile(repo)])), ...profiles };
        const basis = savedExplorationAccount({ ...saved, profiles: candidateProfiles }, owner);
        const found = projectScene(basis, changed, saved.scope ?? saved.path[saved.path.length - 1] ?? { type: 'all' }, saved.query);
        const foundResults = resultsForRelationKind(found.results, saved.kindFilter);
        for (const result of foundResults) { const value = candidateProfiles[String(result.repositoryId)]; if (value) updatedProfiles[String(result.repositoryId)] = value; }
        const preservedRepos = saved.repositories.filter(repo => !changedIds.has(repo.id));
        const foundIds = new Set(foundResults.map(row => row.repositoryId));
        const updated: SavedExploration = { ...currentSaved, profiles: updatedProfiles, repositories: [...preservedRepos, ...changed.filter(repo => foundIds.has(repo.id)).map(snapshotRepository)],
          resultIds: [...saved.resultIds.filter(id => !changedIds.has(id)), ...foundResults.map(row => row.repositoryId)], checked: { ...saved.checked, ...checked }, updatedAt: new Date().toISOString(), model };
        // Removed repositories remain available as historical snapshot entries.
        return { ...current, saved: current.saved!.map(row => row.id === saved.id ? updated : row), ...resumePending(current) };
      }
      return { ...current, queries: [...current.queries.filter(row => row.fingerprint !== fingerprint), { id: taskId, query, scope, fingerprint, createdAt: new Date().toISOString(), model, profiles }].slice(-20), ...resumePending(current) };
    });
    journal.commit('saved'); journal.finish(topicError ? 'partial' : 'complete'); await aiTaskJournal.flush(owner); patch(owner, { error: topicError ? `项目已保存；主题整理未完成：${topicError}` : '' });
  } catch (reason) {
    const message = controller.signal.aborted ? '任务已取消，检查点已保留；可手动继续。' : safeError(reason, executionConfig);
    journal?.error(message); journal?.finish(controller.signal.aborted ? 'canceled' : task?.completed ? 'partial' : 'failed');
    if (String(useAppStore.getState().user?.id ?? '') === owner) {
      patch(owner, { error: message });
      if (task) try { await publish(owner, current => current.task?.id === task!.id ? { ...current, task: { ...current.task, status: signal.aborted ? 'interrupted' : 'failed', error: message } } : current); } catch { /* The previous checkpoint is still durable. */ }
    }
  } finally { jobs.delete(owner); patch(owner, { busy: false, activity: '' }); }
}
export const explorationRuntime = {
  snapshot,
  subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  async load(owner: string) {
    if (!owner || snapshot(owner).account || loading.has(owner)) return loading.get(owner);
    const run = loadExploration(owner).then(account => { patch(owner, { account: account.task?.status === 'running' && !jobs.has(owner) ? { ...account, task: { ...account.task, status: 'interrupted' } } : account, loading: false }); }).catch(reason => patch(owner, { loading: false, error: safeError(reason) })).finally(() => loading.delete(owner));
    loading.set(owner, run); return run;
  },
  async run(owner: string, input: ExplorationRun) {
    if (typeof navigator.locks?.request === 'function') await navigator.locks.request(`gsm-project-exploration:${owner}`, { ifAvailable: true }, async lock => { if (lock) await execute(owner, input); else patch(owner, { error: '另一个页面正在运行图谱任务。' }); });
    else await execute(owner, input);
  },
  cancel(owner: string) { jobs.get(owner)?.abort(); },
  update: publish,
  error(owner: string, error: unknown) { patch(owner, { error: safeError(error) }); },
  async override(owner: string, input: ExplorationOverride) { await publish(owner, current => ({ ...current, overrides: [...current.overrides.filter(row => !(row.type === input.type && (row.type === 'rename-topic' && input.type === row.type ? row.topicId === input.topicId : row.type === 'set-topics' && input.type === row.type ? row.repositoryId === input.repositoryId : row.type === 'remove-relation' && input.type === row.type && row.relationId === input.relationId))), input] })); },
};
// Service lifetime follows the account, never the map component.
if (typeof useAppStore.subscribe === 'function') useAppStore.subscribe((state, previous) => { if (state.user?.id !== previous.user?.id) for (const [owner, controller] of jobs) if (owner !== String(state.user?.id ?? '')) controller.abort(); });
export async function retryExplorationTask(task: AITaskRecord, configId = task.configId ?? '', parameters?: TaskRetryParameters, recoveryOnly = false, failedOnly = false) {
  const account = await loadExploration(task.owner), checkpoint = [account.task,...account.pendingTasks??[]].find(row=>row?.journalId===task.id);
  if (!checkpoint) throw new Error('该任务检查点已由后续任务替换，请返回项目地图操作。');
  return explorationRuntime.run(task.owner, { type: checkpoint.type, configId, query: checkpoint.query, scope: checkpoint.scope, force: checkpoint.force, savedId: checkpoint.savedId, previousTask: task, parameters, recoveryOnly, failedOnly });
}
