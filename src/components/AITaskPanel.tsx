import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ListTodo, Pause, Play, RotateCcw, Square } from 'lucide-react';
import { aiTaskJournal, type AITaskRecord } from '../services/aiTaskJournal';
import { agySchedulerStatus } from '../services/agyClient';
import { useAppStore, getAllCategories } from '../store/useAppStore';
import { useRepositoryDetailAnalysisJob } from '../features/repositories/hooks/useRepositoryDetailAnalysisJob';
import { useRepositoryAnalysisJob } from '../features/repositories/hooks/useRepositoryAnalysisJob';
import { useGistActions } from '../features/gists/hooks/useGistActions';
import { useT } from '../i18n/useT';
import { Button } from './ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from './ui/sheet';

export function AITaskPanel() {
  const t = useT('chat');
  const owner = useAppStore(state => state.user ? String(state.user.id) : '');
  const chinese = useAppStore(state => state.language.startsWith('zh'));
  const tasks = useSyncExternalStore(aiTaskJournal.subscribe, aiTaskJournal.snapshot);
  const scheduler = useSyncExternalStore(agySchedulerStatus.subscribe, agySchedulerStatus.snapshot);
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const [error, setError] = useState('');
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
  const owned = tasks.filter(task => task.owner === owner).slice().reverse();
  const retry = async (task: AITaskRecord, failedOnly: boolean) => {
    const state = useAppStore.getState();
    if (String(state.user?.id ?? '') !== task.owner) return;
    const ids = task.items.filter(item => failedOnly ? item.state === 'failed' : item.state !== 'complete').map(item => item.id);
    if (!ids.length) return;
    setError('');
    try {
      if (task.kind === 'details') await details.run(state.repositories.filter(repo => ids.includes(String(repo.id))), state.user?.id, task.configId);
      else if (task.kind === 'summary') await summary.run({ repositories: state.repositories.filter(repo => ids.includes(String(repo.id))),
        scope: 'selected', syncOnComplete: true, configId: task.configId });
      else if (task.kind === 'gists') await gists.analyzeVisibleGists(ids, task.configId);
      else if (task.kind === 'discovery') await (await import('../features/discovery/custom/store')).startCustomRun(ids);
      else if (task.kind === 'discovery-analysis') {
        const { useCustomDiscovery } = await import('../features/discovery/custom/store');
        const data = useCustomDiscovery.getState().data;
        const channel = data.channels.find(item => item.id === task.channelId);
        if (!channel) { useAppStore.getState().setCurrentView('subscription'); setOpen(false); return; }
        const repos = data.editions.filter(item => item.channelId === channel.id)
          .flatMap(item => [...item.entries, ...item.pending]).map(item => item.repo).filter(repo => ids.includes(String(repo.id)));
        if (!repos.length) throw new Error(state.language.startsWith('zh')
          ? '原任务中的项目已不在订阅结果中，请刷新订阅后重试。'
          : 'The original projects are no longer in subscription results. Refresh the subscription before retrying.');
        const { enqueueAnalysis } = await import('../features/discovery/custom/analysis');
        enqueueAnalysis(channel, repos, { force: true, configId: task.configId });
      }
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };
  if (!owned.length) return null;
  return <>
    <Button ref={trigger} variant="ghost" size="icon" className="relative shrink-0" onClick={() => setOpen(true)}
      title={t('research.tasks')} aria-label={t('research.tasks')}><ListTodo className="h-5 w-5" />
      {owned.some(task => aiTaskJournal.live(task.id)) && <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-primary" />}</Button>
    <Sheet open={open} onOpenChange={setOpen}><SheetContent className="w-full overflow-y-auto sm:max-w-lg"
      onCloseAutoFocus={event => { event.preventDefault(); trigger.current?.focus(); }}>
      <SheetHeader><SheetTitle>{t('research.tasks')}</SheetTitle></SheetHeader>
      {scheduler && <p className="my-2 text-xs" role="status">AGY: {scheduler.running}/{scheduler.effective} · {chinese ? '等待' : 'Queued'} {scheduler.queued}
        {scheduler.cooldownUntil > Date.now() && ` · ${chinese ? '限流冷却至' : 'Cooling down until'} ${new Date(scheduler.cooldownUntil).toLocaleTimeString()}`}</p>}
      {error && <p role="alert" className="my-2 text-sm text-destructive">{error}</p>}
      {owned.map(task => <section key={task.id} className="space-y-2 border-b border-border py-4">
        <h3 className="text-sm font-semibold">{t(`research.${task.kind === 'discovery-analysis' ? 'discovery' : task.kind}`)}</h3>
        <p className="text-xs" role="status">{task.state === 'complete'
          ? task.items.some(item => item.state === 'failed')
            ? task.items.some(item => item.state === 'complete') ? (chinese ? '部分完成' : 'Partially complete') : t('research.failed')
            : (chinese ? '已完成' : 'Complete')
          : t(`research.${task.state}`)} · {task.items.filter(item => item.state === 'complete').length}/{task.items.length}</p>
        <div className="flex flex-wrap gap-2">
          {task.items.some(item => item.state === 'running') && <p className="w-full break-words text-xs" role="status">
            {chinese ? '正在处理' : 'Running'}: {task.items.filter(item => item.state === 'running').map(item => item.label).join(', ')}
          </p>}
          {aiTaskJournal.live(task.id) ? <>
            {aiTaskJournal.supports(task.id, 'pause') && <Button size="icon" variant="outline" title={t(task.state === 'paused' ? 'research.resume' : 'research.pause')}
              aria-label={t(task.state === 'paused' ? 'research.resume' : 'research.pause')}
              onClick={() => aiTaskJournal.control(task.id, task.state === 'paused' ? 'resume' : 'pause')}>
              {task.state === 'paused' ? <Play size={16} /> : <Pause size={16} />}</Button>}
            {aiTaskJournal.supports(task.id, 'stop') && <Button size="icon" variant="outline" title={t('research.stop')} aria-label={t('research.stop')}
              onClick={() => aiTaskJournal.control(task.id, 'stop')}><Square size={16} /></Button>}
          </> : task.kind === 'plugins' ? <Button size="sm" variant="outline" onClick={() => {
            sessionStorage.setItem('gsm:pending-settings-tab', 'plugins');
            useAppStore.getState().setCurrentView('settings'); setOpen(false);
          }}>{t('research.openPlugin')}</Button> : <>
            {task.state === 'interrupted' && <Button size="sm" variant="outline" onClick={() => void retry(task, false)}><Play size={14} />{t('research.resume')}</Button>}
            {task.items.some(item => item.state === 'failed') && <Button size="sm" variant="outline" onClick={() => void retry(task, true)}><RotateCcw size={14} />{t('research.retry')}</Button>}
          </>}
        </div>
        <details><summary className="cursor-pointer text-xs">{t('research.state')}</summary>
          <ul className="mt-2 max-h-64 space-y-1 overflow-y-auto text-xs">{task.items.map(item =>
            <li key={item.id} className="flex gap-2"><span className="min-w-0 flex-1 break-all">{item.label}</span><span>{t(`research.${item.state}`)}</span></li>)}</ul>
        </details>
      </section>)}
    </SheetContent></Sheet>
  </>;
}
