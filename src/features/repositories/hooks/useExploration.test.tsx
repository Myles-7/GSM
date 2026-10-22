import 'fake-indexeddb/auto';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppStoreState } from '../../../store/types';
import { createInitialState } from '../../../store/initialState';
import { accountFixture, profileFixture, repositoryFixture } from '../exploration/testFixtures';
import { loadExploration, updateExploration } from '../exploration/storage';
import type { Repository } from '../../../types';
import { aiTaskJournal } from '../../../services/aiTaskJournal';
import { createSavedExploration, savedExplorationAccount } from '../exploration/local';
import { conceptId, projectScene } from '../exploration/model';
import { taskForSignal } from '../../../services/taskExecution';
import { explorationRuntime, retryExplorationTask } from '../../../services/explorationRuntime';

const mocks = vi.hoisted(() => ({ state: {} as AppStoreState, analyze: vi.fn(), refresh: vi.fn(), consolidate: vi.fn() }));
vi.mock('../../../services/agyClient', () => ({ refreshAgyDeviceState: mocks.refresh }));
vi.mock('../../../store/useAppStore', () => ({ useAppStore: Object.assign((selector: (state: AppStoreState) => unknown) => selector(mocks.state), { getState: () => mocks.state }) }));
vi.mock('../../../services/explorationAI', () => ({ analyzeExplorationBatch: mocks.analyze, consolidateExplorationTopics: mocks.consolidate, explorationCandidates: (repositories: Repository[]) => repositories.slice(0, 80) }));
import { useExploration } from './useExploration';
let nextOwner = 4000;
const originalElectronAPI = window.electronAPI;
afterEach(() => { window.electronAPI = originalElectronAPI; });
beforeEach(() => {
  vi.clearAllMocks();
  mocks.refresh.mockReset(); mocks.refresh.mockResolvedValue(undefined);
  mocks.consolidate.mockReset(); mocks.consolidate.mockImplementation(async (profiles: unknown) => profiles);
  mocks.state = { ...createInitialState(), user: { id: ++nextOwner }, repositories: [repositoryFixture(1)], activeAIConfig: 'model', aiConfigs: [{ id: 'model', name: 'Test AI', model: 'test-model', isActive: true, baseUrl: 'https://provider.invalid', apiKey: 'test' }] } as AppStoreState;
  mocks.analyze.mockImplementation(async ({ repositories }: { repositories: Repository[] }) => repositories.map(repo => profileFixture(repo, 'direct')));
});
async function existing() { const owner = String(mocks.state.user!.id); await updateExploration(owner, () => ({ ...accountFixture(mocks.state.repositories, mocks.state.repositories.map(() => 'direct')), ownerId: owner })); }

describe('manual exploration tasks', () => {
  it('pauses dispatch after in-flight batches save and continues without repeating them',async()=>{
    mocks.state.repositories=Array.from({length:15},(_,i)=>repositoryFixture(i+1));mocks.state.aiConfigs[0].concurrency=2;
    const pending:{resolve:()=>void}[]=[];
    mocks.analyze.mockImplementation(({repositories}:{repositories:Repository[]})=>new Promise(resolve=>pending.push({resolve:()=>resolve(repositories.map(repo=>profileFixture(repo)))})));
    const h=renderHook(useExploration);await waitFor(()=>expect(h.result.current.loading).toBe(false));
    let run!:Promise<void>;act(()=>{run=h.result.current.build();});await waitFor(()=>expect(pending).toHaveLength(2));
    const id=h.result.current.account!.task!.journalId!;
    act(()=>aiTaskJournal.control(id,'pause'));
    await act(async()=>{pending[0].resolve();pending[1].resolve();});
    await waitFor(()=>expect(aiTaskJournal.snapshot().find(row=>row.id===id)?.state).toBe('paused'));
    expect(pending).toHaveLength(2);
    const paused=aiTaskJournal.snapshot().find(row=>row.id===id)?.state;
    act(()=>aiTaskJournal.control(id,'resume'));
    await waitFor(()=>expect(pending).toHaveLength(3));
    await act(async()=>{pending[2].resolve();await run;});
    expect(paused).toBe('paused');expect(mocks.analyze).toHaveBeenCalledTimes(3);
    expect(h.result.current.account?.index&&Object.keys(h.result.current.account.index.profiles)).toHaveLength(15);
  });
  it('retains the selected relationship filter when reanalyzing a saved snapshot', async () => {
    mocks.state.repositories=[repositoryFixture(1),repositoryFixture(2)];const owner=String(mocks.state.user!.id);
    await updateExploration(owner,()=>({...accountFixture(mocks.state.repositories,['direct','similar']),ownerId:owner}));
    const h=renderHook(useExploration);await waitFor(()=>expect(h.result.current.loading).toBe(false));
    const saved=createSavedExploration(h.result.current.account!,mocks.state.repositories,{name:'Direct',query:'Codex',path:[{type:'entity',id:conceptId('entity','Codex'),label:'Codex'}],kindFilter:'direct'});
    await act(async()=>{await h.result.current.saveExploration(saved);});
    mocks.analyze.mockImplementation(async({repositories}:{repositories:Repository[]})=>repositories.map(repo=>profileFixture(repo,repo.id===1?'direct':'similar')));
    await act(async()=>{await h.result.current.updateSaved(saved,true);});
    const updated=h.result.current.account?.saved?.find(row=>row.id===saved.id);
    expect(updated?.resultIds).toEqual([1]);expect(Object.keys(updated!.profiles)).toEqual(['1']);
  });
  it('actually analyzes unchanged snapshot candidates when a manual deepening is explicitly requested', async () => {
    await existing();const h=renderHook(useExploration);await waitFor(()=>expect(h.result.current.loading).toBe(false));
    const saved=createSavedExploration(h.result.current.account!,mocks.state.repositories,{name:'Codex',query:'Codex',path:[{type:'entity',id:conceptId('entity','Codex'),label:'Codex'}],kindFilter:'all'});
    await act(async()=>{await h.result.current.saveExploration(saved);});
    await act(async()=>{await h.result.current.updateSaved(saved,true);});
    expect(mocks.analyze).toHaveBeenCalledOnce();
    expect(h.result.current.account?.saved?.find(row=>row.id===saved.id)).toBeDefined();
  });
  it('refreshes desktop readiness on entry so a stale disabled descriptor cannot permanently disable exploration', async () => {
    mocks.state.aiConfigs=[{id:'model',name:'AGY',provider:'agy-cli',model:'test',agyMode:'model',agyEffort:'high',deviceBound:true,isActive:false}];
    window.electronAPI={agy:{}} as typeof window.electronAPI;
    mocks.refresh.mockImplementation(async()=>{mocks.state.aiConfigs=[{...mocks.state.aiConfigs[0],isActive:true}];});
    const h=renderHook(useExploration);
    await waitFor(()=>expect(h.result.current.canRun).toBe(true));
    expect(mocks.analyze).not.toHaveBeenCalled();
  });
  it('falls back to an available active model after the previously selected config is removed', async () => {
    const h=renderHook(useExploration);await waitFor(()=>expect(h.result.current.loading).toBe(false));
    mocks.state.aiConfigs=[{...mocks.state.aiConfigs[0],id:'replacement'}];mocks.state.activeAIConfig='replacement';h.rerender();
    await waitFor(()=>expect(h.result.current.configId).toBe('replacement'));
    expect(h.result.current.canRun).toBe(true);
  });
  it('uses changed AGY concurrency on later batches without changing the frozen model or canceling in-flight calls',async()=>{
    mocks.state.repositories=Array.from({length:30},(_,i)=>repositoryFixture(i+1));
    mocks.state.aiConfigs=[{id:'model',name:'AGY',provider:'agy-cli',model:'frozen-model',agyEffort:'high',agyMode:'model',deviceBound:true,isActive:true,concurrency:2}];
    window.electronAPI={agy:{}} as typeof window.electronAPI;
    const pending:{finish:()=>void;signal:AbortSignal}[]=[];
    mocks.analyze.mockImplementation(({repositories,signal}:{repositories:Repository[];signal:AbortSignal})=>new Promise(resolve=>pending.push({signal,finish:()=>resolve(repositories.map(repo=>profileFixture(repo)))})));
    const h=renderHook(useExploration);await waitFor(()=>expect(h.result.current.loading).toBe(false));
    let run!:Promise<void>;act(()=>{run=h.result.current.build();});await waitFor(()=>expect(pending).toHaveLength(2));
    mocks.state.aiConfigs=[{...mocks.state.aiConfigs[0],concurrency:1,model:'new-model'}];
    await act(async()=>{pending[0].finish();});await waitFor(()=>expect(h.result.current.concurrency).toBe(1));
    expect(pending).toHaveLength(2);expect(pending[1].signal.aborted).toBe(false);
    await act(async()=>{pending[1].finish();});await waitFor(()=>expect(pending).toHaveLength(3));
    mocks.state.aiConfigs=[{...mocks.state.aiConfigs[0],concurrency:3}];
    await act(async()=>{await waitFor(()=>{pending.splice(2).forEach(row=>row.finish());expect(mocks.analyze).toHaveBeenCalledTimes(6);});await run;});
    expect(mocks.analyze.mock.calls.every(call=>call[0].config.model==='frozen-model'&&call[0].config.agyEffort==='high')).toBe(true);
    expect(h.result.current.concurrency).toBe(3);
  });
  it('retains both failed query and build checkpoints durably and can resume either journal independently',async()=>{
    mocks.state.repositories=Array.from({length:6},(_,i)=>repositoryFixture(i+1));mocks.state.aiConfigs[0].concurrency=1;
    mocks.analyze.mockImplementationOnce(async({repositories}:{repositories:Repository[]})=>repositories.map(repo=>profileFixture(repo))).mockRejectedValueOnce(new Error('invalid build result'));
    const hook=renderHook(useExploration);await waitFor(()=>expect(hook.result.current.loading).toBe(false));
    await act(async()=>{await hook.result.current.build();});const buildRecord=aiTaskJournal.snapshot().find(row=>row.id===hook.result.current.account?.task?.journalId)!;
    const original=structuredClone(hook.result.current.account!.task);
    mocks.analyze.mockRejectedValueOnce(new Error('query temporarily failed'));
    await act(async()=>{await hook.result.current.deepen('Codex');});
    const queryRecord=aiTaskJournal.snapshot().find(row=>row.id===hook.result.current.account?.task?.journalId)!;
    const durable=await loadExploration(String(mocks.state.user!.id));expect(durable.pendingTasks?.[0]).toEqual(original);expect(durable.task?.type).toBe('query');
    await act(async()=>{await retryExplorationTask(buildRecord,'model');});
    expect(hook.result.current.account?.index?.profiles['6']).toBeDefined();expect(hook.result.current.account?.task?.type).toBe('query');
    await act(async()=>{await retryExplorationTask(queryRecord,'model');});
    expect(hook.result.current.account?.task).toBeNull();expect(hook.result.current.account?.queries).toHaveLength(1);
  });
  it('distinguishes retrying failed batches from continuing batches that were never sent',async()=>{
    mocks.state.repositories=Array.from({length:15},(_,i)=>repositoryFixture(i+1));mocks.state.aiConfigs[0].concurrency=1;
    mocks.analyze.mockRejectedValueOnce(new Error('AGY_DISABLED'));
    const hook=renderHook(useExploration);await waitFor(()=>expect(hook.result.current.loading).toBe(false));
    await act(async()=>{await hook.result.current.build();});expect(mocks.analyze).toHaveBeenCalledOnce();
    const record=aiTaskJournal.snapshot().find(row=>row.id===hook.result.current.account?.task?.journalId)!;
    await act(async()=>{await retryExplorationTask(record,'model',undefined,false,true);});
    expect(mocks.analyze).toHaveBeenCalledTimes(2);expect(hook.result.current.account?.task?.completed).toBe(5);expect(hook.result.current.account?.task?.status).toBe('interrupted');
    await act(async()=>{await hook.result.current.retry();});
    expect(mocks.analyze).toHaveBeenCalledTimes(4);expect(Object.keys(hook.result.current.account!.index!.profiles)).toHaveLength(15);
  });
  it('continues after the map component unmounts, tracks the task and restores the completed map on return', async () => {
    let resolve!: (profiles: ReturnType<typeof profileFixture>[]) => void;
    mocks.analyze.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const first = renderHook(useExploration); await waitFor(() => expect(first.result.current.loading).toBe(false));
    let running!: Promise<void>; act(() => { running = first.result.current.build(); });
    await waitFor(() => expect(mocks.analyze).toHaveBeenCalledOnce());
    const record = aiTaskJournal.snapshot().find(row => row.owner === String(mocks.state.user!.id) && row.kind === 'exploration');
    expect(record?.state).toBe('running'); expect(record?.target?.id).toBe('project-map');
    const signal = mocks.analyze.mock.calls[0][0].signal as AbortSignal;
    expect(taskForSignal(signal)?.id).toBe(record?.id);
    first.unmount(); expect(signal.aborted).toBe(false);
    await act(async () => { resolve(mocks.state.repositories.map(repo => profileFixture(repo))); await running; });
    const next = renderHook(useExploration); await waitFor(() => expect(next.result.current.loading).toBe(false));
    expect(Object.keys(next.result.current.account!.index!.profiles)).toEqual(['1']); expect(next.result.current.busy).toBe(false);
    expect(aiTaskJournal.snapshot().find(row => row.id === record?.id)?.state).toBe('complete');
  });
  it('publishes usable profiles if topic consolidation fails and retries only the consolidation stage', async () => {
    mocks.consolidate.mockRejectedValueOnce(new Error('topic service unavailable'));
    const hook=renderHook(useExploration); await waitFor(()=>expect(hook.result.current.loading).toBe(false));
    await act(async()=>{await hook.result.current.build();});
    expect(hook.result.current.account?.index?.profiles['1']).toBeDefined(); expect(hook.result.current.account?.task?.phase).toBe('topics');
    expect(mocks.analyze).toHaveBeenCalledOnce();
    await act(async()=>{await hook.result.current.retry();});
    expect(mocks.analyze).toHaveBeenCalledOnce(); expect(mocks.consolidate).toHaveBeenCalledTimes(2); expect(hook.result.current.account?.task).toBeNull();
  });
  it('keeps healthy results when one repository changes during execution and flags only that input for update',async()=>{
    const source=[repositoryFixture(1),repositoryFixture(2)]; mocks.state.repositories=source;
    let resolve!: (profiles: ReturnType<typeof profileFixture>[])=>void;
    mocks.analyze.mockImplementationOnce(()=>new Promise(done=>{resolve=done;}));
    const hook=renderHook(useExploration); await waitFor(()=>expect(hook.result.current.loading).toBe(false));
    let running!:Promise<void>;act(()=>{running=hook.result.current.build();});await waitFor(()=>expect(mocks.analyze).toHaveBeenCalledOnce());
    mocks.state.repositories=[{...source[0],ai_summary:'new semantic content'},source[1]];hook.rerender();
    await act(async()=>{resolve(source.map(repo=>profileFixture(repo)));await running;});
    expect(hook.result.current.account?.task).toBeNull();expect(hook.result.current.changedCount).toBe(1);expect(hook.result.current.account?.index?.profiles['2']).toBeDefined();
  });
  it('does not silently resend an unknown provider outcome when continuation is declined',async()=>{
    mocks.analyze.mockRejectedValueOnce(new Error('AGY_TIMEOUT'));
    const hook=renderHook(useExploration);await waitFor(()=>expect(hook.result.current.loading).toBe(false));
    await act(async()=>{await hook.result.current.build();});
    const confirm=vi.spyOn(window,'confirm').mockReturnValue(false);
    await act(async()=>{await hook.result.current.retry();});
    expect(confirm).toHaveBeenCalledOnce();expect(mocks.analyze).toHaveBeenCalledOnce();confirm.mockRestore();
  });
  it('admits five concurrent batches and continues healthy work after one batch fails', async () => {
    mocks.state.repositories = Array.from({ length: 30 }, (_,i) => repositoryFixture(i+1)); mocks.state.aiConfigs[0].concurrency = 5;
    const pending: { resolve: (value: ReturnType<typeof profileFixture>[]) => void; reject: (error: Error) => void; repositories: Repository[] }[] = [];
    mocks.analyze.mockImplementation(({ repositories }: { repositories: Repository[] }) => new Promise((resolve,reject) => pending.push({ repositories,resolve,reject })));
    const hook = renderHook(useExploration); await waitFor(() => expect(hook.result.current.loading).toBe(false));
    let running!: Promise<void>; act(() => { running = hook.result.current.build(); }); await waitFor(() => expect(pending).toHaveLength(5));
    await act(async () => { pending[0].reject(new Error('one invalid batch')); });
    await waitFor(() => expect(pending).toHaveLength(6));
    await act(async () => { pending.slice(1).forEach(batch => batch.resolve(batch.repositories.map(repo => profileFixture(repo)))); await running; });
    expect(hook.result.current.account?.task?.completed).toBe(25); expect(hook.result.current.account?.task?.failures).toHaveLength(1);
    expect(mocks.analyze).toHaveBeenCalledTimes(6);
  });
  it('admits the configured five AGY batches immediately without changing model settings',async()=>{
    mocks.state.repositories=Array.from({length:100},(_,i)=>repositoryFixture(i+1));
    mocks.state.aiConfigs=[{id:'model',name:'AGY',provider:'agy-cli',model:'configured-model',agyEffort:'high',agyMode:'model',deviceBound:true,isActive:true,concurrency:5}];
    window.electronAPI={agy:{}} as typeof window.electronAPI;
    let active=0,peak=0;const release:(()=>void)[]=[];
    mocks.analyze.mockImplementation(({repositories,onSent,onResponse}:{repositories:Repository[];onSent:()=>void;onResponse:()=>void})=>new Promise(resolve=>{active++;peak=Math.max(peak,active);onSent();release.push(()=>{active--;onResponse();resolve(repositories.map(repo=>profileFixture(repo)));});}));
    const hook=renderHook(useExploration);await waitFor(()=>expect(hook.result.current.loading).toBe(false));
    let running!:Promise<void>;act(()=>{running=hook.result.current.build();});await waitFor(()=>expect(mocks.analyze).toHaveBeenCalledTimes(5));
    expect(peak).toBe(5);
    await act(async()=>{await waitFor(()=>{release.splice(0).forEach(done=>done());expect(mocks.analyze).toHaveBeenCalledTimes(20);expect(active).toBe(0);});await running;});
    expect(peak).toBe(5);expect(mocks.analyze.mock.calls.every(call=>call[0].config.model==='configured-model'&&call[0].config.agyEffort==='high')).toBe(true);
    const record=aiTaskJournal.snapshot().find(row=>row.owner===String(mocks.state.user!.id)&&row.kind==='exploration');expect(record?.usage?.peak_generating_concurrency).toBe(5);
  });
  it('stops admitting new AGY batches after a timeout while saving healthy in-flight siblings',async()=>{
    mocks.state.repositories=Array.from({length:30},(_,i)=>repositoryFixture(i+1));
    mocks.state.aiConfigs=[{id:'model',name:'AGY',provider:'agy-cli',model:'configured-model',agyEffort:'high',agyMode:'model',deviceBound:true,isActive:true,concurrency:2}];
    window.electronAPI={agy:{}} as typeof window.electronAPI;
    const pending:{resolve:()=>void;reject:(error:Error)=>void;signal:AbortSignal}[]=[];
    mocks.analyze.mockImplementation(({repositories,signal}:{repositories:Repository[];signal:AbortSignal})=>new Promise((resolve,reject)=>pending.push({resolve:()=>resolve(repositories.map(repo=>profileFixture(repo))),reject,signal})));
    const h=renderHook(useExploration);await waitFor(()=>expect(h.result.current.loading).toBe(false));
    let run!:Promise<void>;act(()=>{run=h.result.current.build();});await waitFor(()=>expect(pending).toHaveLength(2));
    await act(async()=>{pending[0].reject(new Error('AGY_TIMEOUT'));});
    expect(pending[1].signal.aborted).toBe(false);
    await act(async()=>{pending[1].resolve();});
    const admittedAfterFailure=pending.length;
    // Drain a buggy scheduler too, so a failed assertion never leaves a background task.
    await act(async()=>{await waitFor(()=>{pending.slice(2).forEach(row=>row.resolve());expect(explorationRuntime.snapshot(String(mocks.state.user!.id)).busy).toBe(false);});await run;});
    expect(admittedAfterFailure).toBe(2);expect(mocks.analyze).toHaveBeenCalledTimes(2);
    const record=aiTaskJournal.snapshot().find(row=>row.id===h.result.current.account?.task?.journalId)!;
    expect(record.state).toBe('partial');expect(record.endedAt).toBeDefined();
    expect(record.items.filter(item=>item.id!=='topics'&&item.state==='pending')).toHaveLength(4);
    expect(mocks.consolidate).not.toHaveBeenCalled();
    expect(h.result.current.account?.task?.completed).toBe(5);
  });
  it('incrementally updates a saved exploration without reanalyzing checked matches or nonmatches', async () => {
    await existing(); const owner = String(mocks.state.user!.id);
    const basis = await loadExploration(owner), old = mocks.state.repositories[0];
    const saved = createSavedExploration(basis, [old], { name: 'Codex tools', query: 'Codex', path: [{ type: 'all' },{ type: 'entity', id: conceptId('entity','Codex'), label: 'Codex' }], kindFilter: 'all' });
    await updateExploration(owner, current => ({ ...current, saved: [saved] }));
    mocks.state.repositories = [old,repositoryFixture(2,{ ai_summary:'Codex workflow tool' })];
    const hook = renderHook(useExploration); await waitFor(() => expect(hook.result.current.loading).toBe(false));
    await act(async () => { await hook.result.current.updateSaved(saved); });
    expect(mocks.analyze.mock.calls.flatMap(call => call[0].repositories.map((repo: Repository) => repo.id))).toEqual([2]);
    const updated = hook.result.current.account!.saved![0]; expect(updated.checked['2']).toBeDefined(); expect(updated.resultIds).toEqual([1,2]);
    const calls = mocks.analyze.mock.calls.length;
    await act(async () => { await hook.result.current.updateSaved(updated); });
    expect(mocks.analyze).toHaveBeenCalledTimes(calls);
    expect(projectScene(savedExplorationAccount(updated,owner),updated.repositories,updated.path.at(-1)!,'Codex').results).toHaveLength(2);
    await act(async () => { await hook.result.current.build(true); });
    expect(hook.result.current.account!.saved![0].id).toBe(saved.id);
  });
  it('reads authoritative AGY status before creating a task and preserves the map when the device is disabled', async () => {
    await existing();
    mocks.state.aiConfigs = [{ id: 'model', name: 'AGY', provider: 'agy-cli', model: 'test-model', agyEffort: 'high', agyMode: 'model', deviceBound: true, isActive: true }];
    window.electronAPI = { agy: {} } as typeof window.electronAPI;
    mocks.refresh.mockImplementation(async () => { mocks.state.aiConfigs = mocks.state.aiConfigs.map(config => ({ ...config, isActive: false })); });
    const { result } = renderHook(useExploration); await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => { await result.current.build(); });
    expect(mocks.refresh).toHaveBeenCalledTimes(2); expect(mocks.analyze).not.toHaveBeenCalled();
    expect(result.current.canRun).toBe(false); expect(result.current.setupIssue).toContain('保存并测试');
    expect(result.current.account?.task).toBeNull(); expect(result.current.account?.index?.id).toBe('index-1');
  });
  it('uses the refreshed enabled model instead of a stale disabled descriptor without enabling it itself', async () => {
    mocks.state.aiConfigs = [{ id: 'model', name: 'AGY', provider: 'agy-cli', model: 'old-model', agyEffort: 'high', agyMode: 'model', deviceBound: true, isActive: false }];
    window.electronAPI = { agy: {} } as typeof window.electronAPI;
    mocks.refresh.mockImplementation(async () => { mocks.state.aiConfigs = mocks.state.aiConfigs.map(config => ({ ...config, model: 'current-model', isActive: true })); });
    const { result } = renderHook(useExploration); await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => { await result.current.build(); });
    expect(mocks.analyze.mock.calls[0][0].config.model).toBe('current-model'); expect(result.current.account?.index?.model).toBe('model:current-model');
  });
  it('distinguishes a missing desktop bridge from a disabled device without starting a model request', async () => {
    mocks.state.aiConfigs = [{ id: 'model', name: 'AGY', provider: 'agy-cli', model: 'test', agyEffort: 'high', agyMode: 'model', deviceBound: true, isActive: true }];
    window.electronAPI = undefined;
    const { result } = renderHook(useExploration); await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => { await result.current.build(); });
    expect(result.current.error).toContain('没有 GSM 桌面 AGY 接口'); expect(mocks.refresh).not.toHaveBeenCalled(); expect(mocks.analyze).not.toHaveBeenCalled();
    expect(result.current.account?.task).toBeNull();
  });
  it('does not present an old disabled failure as the current status after the device has been enabled', async () => {
    await existing(); const owner = String(mocks.state.user!.id);
    await updateExploration(owner, current => ({ ...current, task: { id: 'old-disabled', type: 'build', status: 'failed', model: 'model:test', startedAt: 'now', fingerprint: 'source', completed: 0, total: 1, draft: {}, error: 'AGY_DISABLED' } }));
    mocks.state.aiConfigs = [{ id: 'model', name: 'AGY', provider: 'agy-cli', model: 'test', agyEffort: 'high', agyMode: 'model', deviceBound: true, isActive: true }];
    window.electronAPI = { agy: {} } as typeof window.electronAPI;
    const { result } = renderHook(useExploration); await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe(''); expect(result.current.canRun).toBe(true); expect(result.current.account?.task?.error).toBe('AGY_DISABLED');
    expect(mocks.analyze).not.toHaveBeenCalled();
  });
  it('loads, marks changed analysis, and restores without any automatic AI calls', async () => {
    await existing(); const { result, rerender } = renderHook(useExploration);
    await waitFor(() => expect(result.current.loading).toBe(false)); expect(mocks.analyze).not.toHaveBeenCalled();
    mocks.state = { ...mocks.state, repositories: [{ ...mocks.state.repositories[0], ai_summary: 'changed meaning' }] }; rerender();
    expect(result.current.changedCount).toBe(1); expect(mocks.analyze).not.toHaveBeenCalled();
  });
  it('explains recovery storage exhaustion and preserves the explanation after reloading without retrying', async () => {
    mocks.analyze.mockRejectedValueOnce(new Error('AGY_RECOVERY_STORAGE_FULL'));
    const first = renderHook(useExploration); await waitFor(() => expect(first.result.current.loading).toBe(false));
    await act(async () => { await first.result.current.build(); });
    expect(first.result.current.recoveryStorageFull).toBe(true); expect(first.result.current.error).toContain('失效预留空间');
    expect(first.result.current.account!.task?.completed).toBe(0); first.unmount();
    const next = renderHook(useExploration); await waitFor(() => expect(next.result.current.loading).toBe(false));
    expect(next.result.current.error).toContain('AI 任务中心'); expect(mocks.analyze).toHaveBeenCalledOnce();
  });
  it('publishes one complete index and incrementally updates only changed inputs', async () => {
    mocks.state.repositories = Array.from({ length: 6 }, (_, index) => repositoryFixture(index + 1));
    const { result, rerender } = renderHook(useExploration); await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => { await result.current.build(); }); expect(mocks.analyze).toHaveBeenCalledTimes(2); expect(Object.keys(result.current.account!.index!.profiles)).toHaveLength(6);
    mocks.analyze.mockClear(); mocks.state.repositories = mocks.state.repositories.map(repo => repo.id === 2 ? { ...repo, ai_summary: 'new analysis' } : repo); rerender();
    await act(async () => { await result.current.build(); }); expect(mocks.analyze).toHaveBeenCalledTimes(1); expect(mocks.analyze.mock.calls[0][0].repositories.map((repo: Repository) => repo.id)).toEqual([2]);
  });
  it('runs at most two batches, saves out-of-order progress, and stops admitting work after failure', async () => {
    mocks.state.repositories = Array.from({ length: 15 }, (_, index) => repositoryFixture(index + 1));
    const pending: { resolve: (value: ReturnType<typeof profileFixture>[]) => void; reject: (error: Error) => void; repositories: Repository[] }[] = [];
    mocks.analyze.mockImplementation(({ repositories }: { repositories: Repository[] }) => new Promise((resolve, reject) => pending.push({ resolve, reject, repositories })));
    const { result } = renderHook(useExploration); await waitFor(() => expect(result.current.loading).toBe(false));
    let run!: Promise<void>; act(() => { run = result.current.build(); }); await waitFor(() => expect(pending).toHaveLength(2));
    await act(async () => { pending[1].resolve(pending[1].repositories.map(repo => profileFixture(repo))); });
    await waitFor(() => expect(result.current.account?.task?.completed).toBe(5)); await waitFor(() => expect(pending).toHaveLength(3));
    await act(async () => { pending[0].reject(new Error('AGY_TIMEOUT')); pending[2].resolve(pending[2].repositories.map(repo => profileFixture(repo))); await run; });
    expect(result.current.account?.task?.completed).toBe(10); expect(result.current.account?.task?.status).toBe('failed');
    expect(result.current.account?.index).toBeNull(); expect(result.current.error).toContain('AGY 已发送请求');
    expect(result.current.account?.task?.draft['6']).toBeDefined(); expect(result.current.account?.task?.draft['11']).toBeDefined();
    const checkpoint=structuredClone(result.current.account!.task);
    mocks.analyze.mockImplementation(async({repositories}:{repositories:Repository[]})=>repositories.map(repo=>profileFixture(repo,'direct')));
    await act(async () => { await result.current.deepen('Codex'); });
    expect(result.current.account?.queries).toHaveLength(1);
    expect(result.current.account?.task).toEqual(checkpoint);
    const derived=(await import('../exploration/local')).localExplorationAccount(result.current.account!,mocks.state.repositories);
    expect(projectScene(derived,mocks.state.repositories,{type:'entity',id:conceptId('entity','Codex'),label:'Codex'},'Codex').results[0].verified).toBe(true);
    const confirm=vi.spyOn(window,'confirm').mockReturnValue(true);const calls=mocks.analyze.mock.calls.length;
    await act(async()=>{await result.current.retry();});
    expect(mocks.analyze).toHaveBeenCalledTimes(calls+1);expect(result.current.account?.task).toBeNull();confirm.mockRestore();
  });
  it('honors an explicitly configured concurrency of one', async () => {
    mocks.state.repositories = Array.from({ length: 6 }, (_, index) => repositoryFixture(index + 1));
    mocks.state.aiConfigs[0].concurrency = 1;
    let release!: (value: ReturnType<typeof profileFixture>[]) => void;
    mocks.analyze.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const { result } = renderHook(useExploration); await waitFor(() => expect(result.current.loading).toBe(false));
    let run!: Promise<void>; act(() => { run = result.current.build(); }); await waitFor(() => expect(mocks.analyze).toHaveBeenCalledOnce());
    await act(async () => { release(mocks.state.repositories.slice(0, 5).map(repo => profileFixture(repo))); await run; });
    expect(mocks.analyze).toHaveBeenCalledTimes(2); expect(result.current.account?.task).toBeNull();
  });
  it('keeps the published index after failure and only resumes remaining forced work manually', async () => {
    mocks.state.repositories = Array.from({ length: 6 }, (_, index) => repositoryFixture(index + 1)); await existing();
    const { result } = renderHook(useExploration); await waitFor(() => expect(result.current.loading).toBe(false));
    mocks.analyze.mockImplementationOnce(async ({ repositories }: { repositories: Repository[] }) => repositories.map(repo => profileFixture(repo))).mockRejectedValueOnce(new Error('provider failed'));
    await act(async () => { await result.current.build(true); }); expect(result.current.account!.index!.id).toBe('index-1'); expect(result.current.account!.task?.completed).toBe(5); expect(result.current.account!.task?.status).toBe('failed');
    await act(async () => { await result.current.retry(); }); expect(mocks.analyze).toHaveBeenCalledTimes(3); expect(mocks.analyze.mock.calls[2][0].repositories).toHaveLength(1); expect(result.current.account!.task).toBeNull();
  });
  it('cancels a late response without publishing and does not restart on remount', async () => {
    await existing(); let resolve!: (value: ReturnType<typeof profileFixture>[]) => void;
    mocks.analyze.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const first = renderHook(useExploration); await waitFor(() => expect(first.result.current.loading).toBe(false));
    let running!: Promise<void>; act(() => { running = first.result.current.build(true); }); await waitFor(() => expect(mocks.analyze).toHaveBeenCalledTimes(1));
    act(() => first.result.current.cancel()); await act(async () => { resolve([profileFixture(mocks.state.repositories[0])]); await running; });
    expect(first.result.current.account!.index!.id).toBe('index-1'); expect(first.result.current.account!.task?.status).toBe('interrupted'); first.unmount();
    const second = renderHook(useExploration); await waitFor(() => expect(second.result.current.loading).toBe(false)); expect(mocks.analyze).toHaveBeenCalledTimes(1);
  });
  it('discards an old account response after switching accounts', async () => {
    await existing(); const previous = String(mocks.state.user!.id); let resolve!: (value: ReturnType<typeof profileFixture>[]) => void;
    mocks.analyze.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const { result, rerender } = renderHook(useExploration); await waitFor(() => expect(result.current.loading).toBe(false));
    let running!: Promise<void>; act(() => { running = result.current.build(true); }); await waitFor(() => expect(mocks.analyze).toHaveBeenCalledTimes(1));
    mocks.state = { ...mocks.state, user: { ...mocks.state.user!, id: ++nextOwner } }; rerender(); await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => { resolve([profileFixture(mocks.state.repositories[0])]); await running; });
    expect(result.current.account!.index).toBeNull(); expect((await loadExploration(previous)).index!.id).toBe('index-1');
  });
  it('keeps query cache separate, reuses it, and preserves manual corrections during rebuild', async () => {
    await existing(); const { result } = renderHook(useExploration); await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => { await result.current.addOverride({ id: 'rename', type: 'rename-topic', topicId: 'topic-id', label: 'My topic', createdAt: 'now' }); await result.current.deepen('Codex'); });
    expect(result.current.account!.index!.id).toBe('index-1'); expect(result.current.account!.queries).toHaveLength(1); const calls = mocks.analyze.mock.calls.length;
    await act(async () => { await result.current.deepen('Codex'); }); expect(mocks.analyze).toHaveBeenCalledTimes(calls);
    await act(async () => { await result.current.build(); }); expect(result.current.account!.overrides).toHaveLength(1); expect(result.current.account!.queries).toHaveLength(1); expect(mocks.analyze).toHaveBeenCalledTimes(calls);
  });
  it('performs a separately requested direction instead of reusing the root query result', async () => {
    await existing(); const { result } = renderHook(useExploration); await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => { await result.current.deepen('Codex'); }); const previous = mocks.analyze.mock.calls.length;
    const scope = JSON.stringify({ type: 'branch', targetId: 'codex', label: '技能与工作流', branch: '技能与工作流', kind: 'direct' });
    await act(async () => { await result.current.deepen('Codex', scope); }); expect(mocks.analyze).toHaveBeenCalledTimes(previous + 1);
    expect(result.current.account!.queries.map(row => row.scope)).toEqual(['', scope]);
  });
});
