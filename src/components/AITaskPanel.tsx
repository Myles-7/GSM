import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { ListTodo } from 'lucide-react';
import { aiTaskJournal, taskIsTerminal, taskNeedsAttention, type AITaskRecord } from '../services/aiTaskJournal';
import { agySchedulerStatus } from '../services/agyClient';
import { useAppStore, getAllCategories } from '../store/useAppStore';
import { useRepositoryDetailAnalysisJob } from '../features/repositories/hooks/useRepositoryDetailAnalysisJob';
import { useRepositoryAnalysisJob } from '../features/repositories/hooks/useRepositoryAnalysisJob';
import { useGistActions } from '../features/gists/hooks/useGistActions';
import { TaskCenter } from './tasks/TaskCenter';
import { retryTaskConfig, type TaskRetryParameters } from '../services/taskExecution';
import { watchRemoteTasks } from '../services/taskRemoteAdapter';
import { getDesktopHomeSync } from '../home/desktop';
import { Button } from './ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from './ui/sheet';

export function AITaskPanel() {
  const owner = useAppStore(state => state.user ? String(state.user.id) : '');
  const chinese = useAppStore(state => state.language.startsWith('zh'));
  const tasks = useSyncExternalStore(aiTaskJournal.subscribe, aiTaskJournal.snapshot);
  const scheduler = useSyncExternalStore(agySchedulerStatus.subscribe, agySchedulerStatus.snapshot);
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const details = useRepositoryDetailAnalysisJob();
  const store = useAppStore.getState();
  const summary = useRepositoryAnalysisJob({ allCategories: getAllCategories(store.customCategories, store.language,
    store.hiddenDefaultCategoryIds, store.defaultCategoryOverrides) });
  const gists = useGistActions();
  useEffect(() => aiTaskJournal.attachHost(), []);
  useEffect(() => {
    aiTaskJournal.load(owner);
    return () => aiTaskJournal.stopOwner(owner);
  }, [owner]);
  useEffect(() => watchRemoteTasks(getDesktopHomeSync, owner), [owner]);
  const owned = tasks.filter(task => task.owner === owner).slice().reverse();
  const retry = async (task: AITaskRecord, failedOnly: boolean, configId = task.configId, parameters?: TaskRetryParameters) => {
    const state = useAppStore.getState();
    if (String(state.user?.id ?? '') !== task.owner) return;
    const ids = task.items.filter(item => failedOnly ? item.state === 'failed' : item.state !== 'complete').map(item => item.id);
    if (!ids.length) return;
    if (['summary', 'details', 'gists'].includes(task.kind) && aiTaskJournal.busy(task.owner, task.kind))
      throw new Error(chinese ? '同类任务正在执行，请完成或停止后重试。' : 'A task of this type is active. Finish or stop it before retrying.');
    if (task.kind !== 'discovery' && !state.aiConfigs.some(config => config.id === configId)) {
      throw new Error(chinese ? '原模型配置已失效，请在详情中选择重试配置。' : 'The original model configuration is unavailable. Choose a retry configuration in details.');
    }
    const selected = state.aiConfigs.find(config => config.id === configId);
    const retry = selected ? { config: retryTaskConfig(selected, task, parameters), parentId: task.id } : undefined;
    const repositories = state.repositories.filter(repo => ids.includes(String(repo.id)));
    if (['summary', 'details'].includes(task.kind) && !repositories.length)
      throw new Error(chinese ? '原任务中的仓库已不存在，请返回仓库列表刷新。' : 'The original repositories are unavailable. Refresh the repository list.');
    if (task.kind === 'details') await details.run(repositories, state.user?.id, configId, retry);
    else if (task.kind === 'summary') await summary.run({ repositories,
        scope: 'selected', syncOnComplete: true, configId, retry });
      else if (task.kind === 'gists') {
        if (![...state.gists, ...state.starredGists].some(gist => ids.includes(gist.id))) throw new Error(chinese ? '原 Gist 已不存在，请刷新列表。' : 'The original Gists are unavailable. Refresh the list.');
        await gists.analyzeVisibleGists(ids, configId, retry);
      }
      else if (task.kind === 'discovery') await (await import('../features/discovery/custom/store')).startCustomRun(ids, retry);
      else if (task.kind === 'discovery-analysis') {
        const { useCustomDiscovery } = await import('../features/discovery/custom/store');
        const data = useCustomDiscovery.getState().data;
        const channel = data.channels.find(item => item.id === task.channelId)
          ?? (task.channelId?.startsWith('builtin:') ? { id: task.channelId, revision: 1 } : undefined);
        if (!channel) throw new Error(chinese ? '原频道已不存在，请在订阅页面重新选择。' : 'The original channel is unavailable. Select a channel from subscriptions.');
        const builtin = task.channelId?.startsWith('builtin:') ? state.discoveryRepos[task.channelId.slice(8) as keyof typeof state.discoveryRepos] ?? [] : [];
        const repos = [...data.editions.filter(item => item.channelId === channel.id)
          .flatMap(item => [...item.entries, ...item.pending]).map(item => item.repo), ...builtin].filter(repo => ids.includes(String(repo.id)));
        if (!repos.length) throw new Error(state.language.startsWith('zh')
          ? '原任务中的项目已不在订阅结果中，请刷新订阅后重试。'
          : 'The original projects are no longer in subscription results. Refresh the subscription before retrying.');
        const { enqueueAnalysis } = await import('../features/discovery/custom/analysis');
        enqueueAnalysis(channel, repos, { force: true, configId, retry });
      }
  };
  const currentView = useAppStore(state => state.currentView);
  const title = chinese ? '任务中心' : 'Task center';
  const navigate = (task: AITaskRecord) => {
    const view = task.target?.view ?? (task.kind === 'gists' ? 'gists' : task.kind.startsWith('discovery') ? 'subscription'
      : task.kind === 'research' || task.kind === 'organization' ? 'ai' : task.kind === 'release' ? 'releases'
      : ['index', 'plugins', 'backup', 'restore', 'import', 'export', 'sync'].includes(task.kind) ? 'settings' : 'repositories');
    if (task.target?.tab) sessionStorage.setItem('gsm:pending-settings-tab', task.target.tab);
    if (task.kind === 'plugins') sessionStorage.setItem('gsm:pending-settings-tab', 'plugins');
    if (task.target?.id) {
      sessionStorage.setItem('gsm:pending-task-target', JSON.stringify({ ...task.target, kind: task.kind, owner: task.owner }));
      if (view === 'ai') sessionStorage.setItem('gsm:ai-workbench-session', task.target.id);
    }
    useAppStore.getState().setCurrentView(view as typeof currentView); setOpen(false);
    window.dispatchEvent(new Event('gsm:task-navigate'));
  };
  const active = owned.filter(task => !taskIsTerminal(task)).length;
  const attention = owned.filter(task => taskNeedsAttention(task) && !task.archived).length;
  return <>
    <Button ref={trigger} variant="ghost" size="icon" className="relative shrink-0" onClick={() => setOpen(true)}
      title={title} aria-label={`${title}${active ? ` · ${active}` : ''}`}><ListTodo className="h-5 w-5" />
      {active > 0 && <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] text-primary-foreground">{active}</span>}
      {attention > 0 && <span aria-label={chinese ? '任务待处理' : 'Tasks need attention'} className="absolute bottom-1 right-1 h-1.5 w-1.5 rounded-full bg-destructive" />}</Button>
    {currentView === 'tasks' && createPortal(<div data-task-scroll className="fixed inset-x-0 bottom-0 top-14 z-40 overflow-y-auto bg-background"><div className="mx-auto max-w-[1440px] px-4 py-6 sm:px-6">{scheduler && <p className="mb-4 text-xs text-muted-foreground" role="status">AGY {scheduler.running}/{scheduler.effective} · {chinese ? '等待' : 'Queued'} {scheduler.queued}</p>}<TaskCenter tasks={owned} chinese={chinese} retry={retry} onNavigate={navigate} /></div></div>, document.body)}
    <Sheet open={open} onOpenChange={setOpen}><SheetContent className="w-full gap-0 p-0 sm:max-w-lg" closeLabel={chinese ? '关闭' : 'Close'}
      onCloseAutoFocus={event => { event.preventDefault(); trigger.current?.focus(); }}>
      <SheetHeader className="shrink-0 border-b border-border p-5 pr-12"><SheetTitle>{title}</SheetTitle></SheetHeader>
      {scheduler && <p className="shrink-0 border-b border-border px-5 py-3 text-xs text-muted-foreground" role="status">AGY: {scheduler.running}/{scheduler.effective} · {chinese ? '等待' : 'Queued'} {scheduler.queued}
        {scheduler.cooldownUntil > Date.now() && ` · ${chinese ? '限流冷却至' : 'Cooling down until'} ${new Date(scheduler.cooldownUntil).toLocaleTimeString()}`}</p>}
      <div data-task-scroll className="min-h-0 flex-1 overflow-y-auto p-5"><TaskCenter tasks={owned} chinese={chinese} compact retry={retry} onNavigate={navigate}
        onOpenCenter={() => { useAppStore.getState().setCurrentView('tasks'); setOpen(false); }} /></div>
    </SheetContent></Sheet>
  </>;
}
