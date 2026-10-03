import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Activity, AlertCircle, Archive, ArrowLeft, ArrowUpRight, CheckCircle2, Clock3, Copy, Download, ListTodo, Pause, Play, RotateCcw, Search, Square, Trash2, X } from 'lucide-react';
import { aiTaskJournal, TASK_KINDS, taskDisplayState, taskIsTerminal, taskNeedsAttention, type AITaskRecord } from '../../services/aiTaskJournal';
import { taskElapsed, taskKindLabel, taskPhaseLabel, taskReport, taskStateLabel, taskTitle } from '../../services/taskPresentation';
import { Button } from '../ui/button';
import { useAppStore } from '../../store/useAppStore';
import type { AIConfig } from '../../types';
import { featureForTask, taskConfigSnapshot, type TaskRetryParameters } from '../../services/taskExecution';

export interface TaskCenterProps {
  tasks: AITaskRecord[]; chinese: boolean; compact?: boolean;
  retry(task: AITaskRecord, failedOnly: boolean, configId?: string, parameters?: TaskRetryParameters): Promise<void>;
  onNavigate(task: AITaskRecord): void; onOpenCenter?(): void;
}
const retryKinds = new Set(['summary', 'details', 'gists', 'discovery', 'discovery-analysis']);
export function TaskCenter({ tasks, chinese: zh, compact = false, retry, onNavigate, onOpenCenter }: TaskCenterProps) {
  const txt = (cn: string, en: string) => zh ? cn : en;
  const configs = useAppStore(state => state.aiConfigs);
  const [filter, setFilter] = useState('attention');
  const [kind, setKind] = useState('all');
  const [trigger, setTrigger] = useState('all');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('newest');
  const [selected, setSelected] = useState<string | null>(null);
  const [checked, setChecked] = useState<string[]>([]);
  const [failedOnly, setFailedOnly] = useState(false);
  const [busy, setBusy] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [retryConfig, setRetryConfig] = useState<Record<string, string>>({});
  const [retryParameters, setRetryParameters] = useState<Record<string, TaskRetryParameters>>({});
  const [clock, setClock] = useState(Date.now());
  const [itemLimit, setItemLimit] = useState(100);
  const [taskLimit, setTaskLimit] = useState(50);
  const [batchRetrying, setBatchRetrying] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const listScroll = useRef(0);
  const selectTask = (id: string | null) => {
    const scroller = root.current?.closest<HTMLElement>('[data-task-scroll]');
    if (id && !selected && scroller) listScroll.current = scroller.scrollTop;
    setSelected(id);
  };
  useLayoutEffect(() => {
    const scroller = root.current?.closest<HTMLElement>('[data-task-scroll]');
    if (scroller && (compact || window.innerWidth < 1024)) scroller.scrollTop = selected ? 0 : listScroll.current;
  }, [selected, compact]);
  useEffect(() => { setItemLimit(100); setFailedOnly(false); }, [selected]);
  useEffect(() => { const timer = setInterval(() => setClock(Date.now()), 1000); return () => clearInterval(timer); }, []);
  const visible = useMemo(() => tasks.filter(task => {
    if (compact) return !task.archived && (!taskIsTerminal(task) || taskNeedsAttention(task));
    if (filter === 'archived' ? !task.archived : task.archived) return false;
    if (filter === 'attention' && taskIsTerminal(task) && !taskNeedsAttention(task)) return false;
    if (filter === 'running' && taskIsTerminal(task)) return false;
    if (filter === 'failed' && !taskNeedsAttention(task)) return false;
    if (filter === 'history' && !taskIsTerminal(task)) return false;
    if (filter === 'automatic' && task.trigger !== 'automatic') return false;
    if (filter !== 'automatic' && filter !== 'archived' && task.trigger === 'automatic' && taskDisplayState(task) === 'complete') return false;
    return (kind === 'all' || task.kind === kind) && (trigger === 'all' || (task.trigger ?? 'manual') === trigger)
      && `${taskTitle(task, zh)} ${task.items.map(item => item.label).join(' ')}`.toLowerCase().includes(query.toLowerCase());
  }).sort((a, b) => {
    const delta = (Date.parse(b.createdAt ?? '') || 0) - (Date.parse(a.createdAt ?? '') || 0);
    return sort === 'oldest' ? -delta : delta;
  }), [tasks, compact, filter, kind, trigger, query, sort, zh]);
  const activeTask = tasks.find(task => task.id === selected);
  const chosenConfig = configs.find(config => config.id === (activeTask ? retryConfig[activeTask.id] ?? activeTask.configId : undefined));
  const retryDefaults = activeTask && chosenConfig ? chosenConfig.id === activeTask.configId
    ? activeTask.config : taskConfigSnapshot(chosenConfig, featureForTask[activeTask.kind]) : undefined;
  const activeCount = tasks.filter(task => !taskIsTerminal(task)).length;
  const attentionCount = tasks.filter(task => !task.archived && taskNeedsAttention(task)).length;
  const doneCount = tasks.filter(task => taskDisplayState(task) === 'complete').length;
  const selectedTasks = tasks.filter(task => checked.includes(task.id));
  const control = (action: 'pause' | 'resume' | 'stop') => selectedTasks.forEach(task => aiTaskJournal.control(task.id, action));
  const runRetry = async (task: AITaskRecord, failures: boolean) => {
    if (busy.includes(task.id)) return;
    setBusy(ids => [...ids, task.id]); setError('');
    try { await retry(task, failures, retryConfig[task.id] ?? task.configId, retryParameters[task.id]); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(ids => ids.filter(id => id !== task.id)); }
  };
  const batchRetry = async () => {
    if (batchRetrying) return;
    setBatchRetrying(true); setError('');
    const failures: string[] = [];
    try {
      // Existing batch executors own their queues; run retries sequentially to avoid dropping overlapping batches.
      for (const task of selectedTasks.filter(task => task.location !== 'server' && !aiTaskJournal.live(task.id)
        && taskIsTerminal(task) && retryKinds.has(task.kind) && task.items.some(item => item.state === 'failed'))) {
        try { await retry(task, true, retryConfig[task.id] ?? task.configId, retryParameters[task.id]); }
        catch (cause) { failures.push(`${taskTitle(task, zh)}: ${cause instanceof Error ? cause.message : String(cause)}`); }
      }
    } finally { setBatchRetrying(false); if (failures.length) setError(failures.join('\n')); }
  };
  const exportReport = (format: 'json' | 'markdown') => {
    const blob = new Blob([taskReport(selectedTasks.length ? selectedTasks : visible, format, zh)], { type: format === 'json' ? 'application/json' : 'text/markdown' });
    const url = URL.createObjectURL(blob), link = document.createElement('a');
    link.href = url; link.download = `gsm-tasks.${format === 'json' ? 'json' : 'md'}`; link.click(); URL.revokeObjectURL(url);
  };
  const locateItem = (task: AITaskRecord, item: AITaskRecord['items'][number]) => {
    if (task.kind === 'summary' || task.kind === 'details') onNavigate({ ...task, target: { view: 'repositories', id: item.id } });
    else if (task.kind === 'gists') onNavigate({ ...task, target: { view: 'gists', id: item.id } });
    else if (/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(item.label)) window.open(`https://github.com/${item.label}`, '_blank', 'noopener,noreferrer');
    else onNavigate(task);
  };
  const actions = (task: AITaskRecord) => <div className="flex flex-wrap items-center gap-2">
    {(['pause', 'resume', 'stop'] as const).filter(action => aiTaskJournal.supports(task.id, action)
      && (action === 'resume' ? ['paused', 'pausing', 'interrupted', 'unconfirmed'].includes(task.state) : action !== 'pause' || task.state === 'running' || task.state === 'queued')).map(action => {
      const Icon = action === 'pause' ? Pause : action === 'resume' ? Play : Square;
      const label = action === 'pause' ? txt('暂停', 'Pause') : action === 'resume' ? task.state === 'unconfirmed' ? txt('核对并恢复提交', 'Verify and recover submission') : txt('继续', 'Resume') : txt('停止', 'Stop');
      return <Button key={action} variant="outline" size="icon" title={label} aria-label={label} disabled={task.state === 'stopping'} onClick={() => aiTaskJournal.control(task.id, action)}><Icon size={16} /></Button>;
    })}
    {!aiTaskJournal.live(task.id) && taskIsTerminal(task) && task.location !== 'server' && retryKinds.has(task.kind) && task.items.some(item => item.state === 'failed') &&
      <Button variant="outline" size="sm" disabled={busy.includes(task.id)} onClick={() => void runRetry(task, true)}><RotateCcw size={14} />{txt('重试失败项', 'Retry failed')}</Button>}
    {!aiTaskJournal.live(task.id) && task.location !== 'server' && retryKinds.has(task.kind) && ['interrupted', 'canceled', 'partial'].includes(task.state) && task.items.some(item => item.state !== 'complete') &&
      <Button variant="outline" size="sm" disabled={busy.includes(task.id)} onClick={() => void runRetry(task, false)}><Play size={14} />{txt('继续未完成项', 'Continue unfinished')}</Button>}
    <Button size="icon" variant="ghost" title={txt('打开来源／结果', 'Open source / result')} aria-label={txt('打开来源／结果', 'Open source / result')} onClick={() => onNavigate(task)}><ArrowUpRight size={16} /></Button>
  </div>;
  const card = (task: AITaskRecord) => {
    const status = taskDisplayState(task), complete = task.items.filter(item => item.state === 'complete').length;
    const failed = task.items.filter(item => item.state === 'failed').length;
    const running = task.items.filter(item => item.state === 'running');
    const Icon = taskNeedsAttention(task) ? AlertCircle : status === 'complete' ? CheckCircle2 : status === 'canceled' ? Square : Activity;
    return <article key={task.id} className={`min-w-0 rounded-lg border bg-card p-4 text-card-foreground shadow-sm ${selected === task.id ? 'border-primary ring-1 ring-primary/20' : 'border-border'}`}>
      <div className="flex items-start gap-3">
        {!compact && <input type="checkbox" className="mt-1 h-4 w-4 shrink-0 accent-primary" checked={checked.includes(task.id)} aria-label={`${txt('选择', 'Select')} ${taskTitle(task, zh)}`} onChange={e => setChecked(ids => e.target.checked ? [...ids, task.id] : ids.filter(id => id !== task.id))} />}
        <div className="min-w-0 flex-1"><button type="button" className="w-full break-words text-left text-sm font-semibold hover:text-primary focus-visible:outline-primary" onClick={() => selectTask(task.id)}>{taskTitle(task, zh)}</button>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground"><span>{task.location === 'server' ? txt('服务器', 'Server') : txt('本机', 'Device')}</span><span>{task.trigger === 'automatic' ? txt('自动', 'Automatic') : txt('手动', 'Manual')}</span><span>{task.createdAt ? new Date(task.createdAt).toLocaleString(zh ? 'zh-CN' : 'en-US') : txt('时间未记录', 'Time not recorded')}</span></div>
        </div><Icon size={18} className={`shrink-0 ${taskNeedsAttention(task) ? 'text-destructive' : status === 'complete' ? 'text-emerald-600 dark:text-emerald-400' : 'text-primary'}`} />
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-xs"><span role="status" className="font-medium">{taskStateLabel(status, zh)}</span><span className="flex items-center gap-1 text-muted-foreground"><Clock3 size={12} />{taskElapsed(task, clock)}</span></div>
      {task.items.length > 1 && <><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-label={txt('子项完成比例', 'Completed items')} aria-valuenow={complete} aria-valuemin={0} aria-valuemax={task.items.length}><div className="h-full bg-primary transition-[width]" style={{ width: `${complete / task.items.length * 100}%` }} /></div><p className="mt-2 text-xs text-muted-foreground">{txt('完成', 'Complete')} {complete}/{task.items.length}{failed > 0 && ` · ${txt('失败', 'Failed')} ${failed}`}</p></>}
      {task.phase && <p className="mt-2 break-words text-xs text-muted-foreground">{taskPhaseLabel(task.phase, zh)}{task.progress && task.progress.total > 0 ? ` · ${task.progress.done}/${task.progress.total}` : ''}</p>}
      {running.length > 0 && <ul className="mt-3 space-y-1 text-xs">{running.slice(0, compact ? 2 : 3).map(item => <li key={item.id} className="truncate" title={item.label}>{item.label}</li>)}{running.length > (compact ? 2 : 3) && <li className="text-muted-foreground">+{running.length - (compact ? 2 : 3)}</li>}</ul>}
      {task.error && <p className="mt-2 line-clamp-2 break-words text-xs text-destructive">{task.error}</p>}
      {task.connectionError && <p className="mt-2 line-clamp-2 break-words text-xs text-destructive">{txt('服务器状态待核对', 'Server status needs verification')}: {task.connectionError}</p>}
      <div className="mt-4 border-t border-border pt-3">{actions(task)}</div>
    </article>;
  };
  const detail = activeTask && <aside className="min-w-0 rounded-lg border border-border bg-card p-5 text-card-foreground lg:sticky lg:top-20 lg:max-h-[calc(100vh-7rem)] lg:overflow-y-auto" aria-label={txt('任务详情', 'Task details')}>
    <div className="mb-4 flex items-center justify-between gap-2"><h2 className="text-base font-semibold">{txt('任务详情', 'Task details')}</h2><Button variant="ghost" size="icon" aria-label={txt('返回列表', 'Back to list')} title={txt('返回列表', 'Back to list')} onClick={() => selectTask(null)}><X size={16} /></Button></div>
    <h3 className="break-words text-sm font-semibold">{taskTitle(activeTask, zh)}</h3><p className="mt-2 text-xs text-muted-foreground">{taskStateLabel(taskDisplayState(activeTask), zh)} · {taskElapsed(activeTask, clock)}</p>
    <dl className="my-5 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-xs">
      <dt>{txt('模型', 'Model')}</dt><dd className="break-all">{activeTask.config?.model || txt('未记录', 'Not recorded')}</dd>
      <dt>Effort</dt><dd>{activeTask.config?.effort ?? txt('未记录', 'Not recorded')}</dd>
      <dt>{txt('超时', 'Timeout')}</dt><dd>{activeTask.config?.timeoutSeconds ? `${activeTask.config.timeoutSeconds}s` : txt('未记录', 'Not recorded')}</dd>
      <dt>{txt('阶段', 'Stage')}</dt><dd className="break-words">{taskPhaseLabel(activeTask.phase, zh)}</dd>
      <dt>{txt('开始', 'Started')}</dt><dd>{activeTask.startedAt ? new Date(activeTask.startedAt).toLocaleString() : txt('未记录', 'Not recorded')}</dd>
      <dt>{txt('结束', 'Ended')}</dt><dd>{activeTask.endedAt ? new Date(activeTask.endedAt).toLocaleString() : '—'}</dd>
    </dl>
    {activeTask.usage && <pre className="overflow-x-auto text-xs">{JSON.stringify(activeTask.usage, null, 2)}</pre>}
    {activeTask.connectionError && <p role="status" className="mb-4 break-words text-xs text-destructive">{txt('显示最近一次服务器状态，尚未重新确认。', 'Showing the last server receipt; current status is not confirmed.')} {activeTask.connectionError}</p>}
    {activeTask.parentId && <p className="mb-3 text-xs text-muted-foreground">{txt('关联重试', 'Linked retry')}: {activeTask.parentId}</p>}
    {taskNeedsAttention(activeTask) && <div className="mb-4 border-l-2 border-destructive pl-3 text-xs"><p className="break-words">{activeTask.error ?? activeTask.items.find(item => item.error)?.error ?? txt('旧记录没有保存错误详情。', 'This record has no saved error details.')}</p><p className="mt-2 text-muted-foreground">{txt('检查失败子项与模型配置，再重试；无法继续的任务可返回来源重新操作。', 'Review failed items and model settings, then retry. Open the source for tasks that cannot resume.')}</p></div>}
    {!aiTaskJournal.live(activeTask.id) && activeTask.location !== 'server' && retryKinds.has(activeTask.kind) && (taskNeedsAttention(activeTask) || activeTask.state === 'canceled') && <div className="mb-4 space-y-3 text-xs">
      <label className="block">{txt('重试配置', 'Retry configuration')}<select className="mt-1 w-full rounded-md border border-input bg-background p-2" value={retryConfig[activeTask.id] ?? activeTask.configId ?? ''} onChange={e => { setRetryConfig(value => ({ ...value, [activeTask.id]: e.target.value })); setRetryParameters(value => ({ ...value, [activeTask.id]: {} })); }}>
        <option value="">{txt('选择配置', 'Choose configuration')}</option>{activeTask.configId && !configs.some(config => config.id === activeTask.configId) && <option value={activeTask.configId} disabled>{txt('原配置已失效', 'Original configuration unavailable')}</option>}
        {configs.map((config: AIConfig) => <option key={config.id} value={config.id}>{config.name}</option>)}</select></label>
      <details><summary className="cursor-pointer text-muted-foreground">{txt('调整本次重试参数', 'Adjust retry parameters')}</summary><div className="mt-3 space-y-3">
        <label className="block">{txt('模型', 'Model')}<input className="mt-1 w-full rounded-md border border-input bg-background p-2" value={retryParameters[activeTask.id]?.model ?? retryDefaults?.model ?? ''} onChange={e => setRetryParameters(value => ({ ...value, [activeTask.id]: { ...value[activeTask.id], model: e.target.value } }))} /></label>
        {chosenConfig?.provider === 'agy-cli' && <><label className="block">Effort<select className="mt-1 w-full rounded-md border border-input bg-background p-2" value={retryParameters[activeTask.id]?.effort ?? retryDefaults?.effort ?? 'medium'} onChange={e => setRetryParameters(value => ({ ...value, [activeTask.id]: { ...value[activeTask.id], effort: e.target.value as TaskRetryParameters['effort'] } }))}>{['low', 'medium', 'high', 'max'].map(effort => <option key={effort}>{effort}</option>)}</select></label>
          <label className="block">{txt('请求超时（秒）', 'Request timeout (seconds)')}<input type="number" min={20} max={600} className="mt-1 w-full rounded-md border border-input bg-background p-2" value={retryParameters[activeTask.id]?.timeoutSeconds ?? retryDefaults?.timeoutSeconds ?? 180} onChange={e => setRetryParameters(value => ({ ...value, [activeTask.id]: { ...value[activeTask.id], timeoutSeconds: Number(e.target.value) } }))} /></label></>}
      </div></details></div>}
    {actions(activeTask)}
    {!aiTaskJournal.live(activeTask.id) && !retryKinds.has(activeTask.kind) && taskNeedsAttention(activeTask) && <p className="mt-3 text-xs text-muted-foreground">{txt('此任务需在来源页面核对结果或重新授权后继续。', 'Continue from the source after verifying results or renewing authorization.')}</p>}
    {activeTask.state === 'committing' && <p className="mt-3 text-xs text-muted-foreground">{txt('正在提交已完成结果，此阶段无法取消。', 'Completed results are being committed. This stage cannot be canceled.')}</p>}
    {!taskIsTerminal(activeTask) && activeTask.state !== 'committing' && !aiTaskJournal.supports(activeTask.id, 'pause') && <p className="mt-3 text-xs text-muted-foreground">{txt('此执行器不支持暂停；可用操作以当前按钮为准。', 'This executor does not support pausing. Available controls are shown above.')}</p>}
    <div className="my-5 flex flex-wrap items-center gap-3 border-t border-border pt-4"><h4 className="text-sm font-semibold">{txt('子项', 'Items')} ({activeTask.items.length})</h4><label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={failedOnly} onChange={e => setFailedOnly(e.target.checked)} />{txt('仅失败项', 'Failed only')}</label><Button variant="ghost" size="icon" title={txt('复制错误', 'Copy errors')} aria-label={txt('复制错误', 'Copy errors')} onClick={() => { void navigator.clipboard.writeText([activeTask.error, ...activeTask.items.filter(item => item.error).map(item => `${item.label}: ${item.error}`)].filter(Boolean).join('\n')).catch(() => setError(txt('复制失败', 'Copy failed'))); }}><Copy size={15} /></Button></div>
    <ul className="max-h-96 space-y-3 overflow-y-auto text-xs">{activeTask.items.filter(item => !failedOnly || item.state === 'failed').slice(0, itemLimit).map(item => <li key={item.id} className="border-b border-border pb-3"><div className="flex items-start gap-3"><span className="min-w-0 flex-1 break-words">{item.label}</span><span className="shrink-0 text-muted-foreground">{taskStateLabel(item.state, zh)}</span><Button size="icon" variant="ghost" className="h-6 w-6 shrink-0" title={txt('定位项目／来源', 'Locate project / source')} aria-label={`${txt('定位', 'Locate')} ${item.label}`} onClick={() => locateItem(activeTask, item)}><ArrowUpRight size={14} /></Button></div>{item.phase && <p className="mt-1 text-muted-foreground">{taskPhaseLabel(item.phase, zh)}</p>}{item.error && <p className="mt-1 break-words text-destructive">{item.error}</p>}</li>)}</ul>
    {activeTask.items.filter(item => !failedOnly || item.state === 'failed').length > itemLimit && <Button className="mt-3" size="sm" variant="outline" onClick={() => setItemLimit(value => value + 100)}>{txt('显示更多子项', 'Show more items')}</Button>}
  </aside>;
  return <div ref={root} className="min-w-0 space-y-5" data-testid={compact ? 'task-drawer' : 'task-center'}>
    {!compact && <div className={activeTask ? 'hidden lg:contents' : 'contents'}><div className="flex flex-wrap items-start justify-between gap-3"><div><h1 className="text-2xl font-semibold">{txt('任务中心', 'Task center')}</h1><p className="mt-2 text-sm text-muted-foreground">{txt('运行中', 'Active')} {activeCount} · {txt('待处理', 'Needs attention')} {attentionCount} · {txt('已完成', 'Complete')} {doneCount}</p></div><div className="flex gap-2"><Button variant="outline" size="icon" title={txt('导出 Markdown', 'Export Markdown')} aria-label={txt('导出 Markdown', 'Export Markdown')} onClick={() => exportReport('markdown')}><Download size={16} /></Button><Button variant="outline" size="sm" onClick={() => exportReport('json')}>JSON</Button></div></div>
      <div className="flex flex-wrap gap-2" aria-label={txt('任务筛选', 'Task filters')}>{[['attention', txt('活跃与待处理', 'Active & attention')], ['running', txt('正在执行', 'Active')], ['failed', txt('需要处理', 'Needs attention')], ['history', txt('完成历史', 'History')], ['automatic', txt('后台历史', 'Background')], ['archived', txt('已归档', 'Archived')], ['all', txt('全部', 'All')]].map(([value, label]) => <Button key={value} size="sm" variant={filter === value ? 'secondary' : 'ghost'} aria-pressed={filter === value} onClick={() => { setFilter(value); setChecked([]); }}>{label}</Button>)}</div>
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-[minmax(180px,1fr)_180px_140px_140px]"><label className="relative"><Search size={16} className="absolute left-3 top-3 text-muted-foreground" /><input className="h-10 w-full rounded-md border border-input bg-background pl-9 pr-3 text-sm" aria-label={txt('搜索任务', 'Search tasks')} placeholder={txt('搜索任务或项目', 'Search tasks or projects')} value={query} onChange={e => setQuery(e.target.value)} /></label><select className="h-10 rounded-md border border-input bg-background px-3 text-sm" aria-label={txt('任务类型', 'Task type')} value={kind} onChange={e => setKind(e.target.value)}><option value="all">{txt('全部类型', 'All types')}</option>{TASK_KINDS.map(value => <option key={value} value={value}>{taskKindLabel(value, zh)}</option>)}</select><select className="h-10 rounded-md border border-input bg-background px-3 text-sm" aria-label={txt('触发方式', 'Trigger')} value={trigger} onChange={e => setTrigger(e.target.value)}><option value="all">{txt('全部来源', 'All triggers')}</option><option value="manual">{txt('手动', 'Manual')}</option><option value="automatic">{txt('自动', 'Automatic')}</option></select><select className="h-10 rounded-md border border-input bg-background px-3 text-sm" aria-label={txt('排序', 'Sort')} value={sort} onChange={e => setSort(e.target.value)}><option value="newest">{txt('最新创建', 'Newest first')}</option><option value="oldest">{txt('最早创建', 'Oldest first')}</option></select></div>
      {checked.length > 0 && <div className="flex flex-wrap items-center gap-2 border-y border-border py-3"><span className="mr-2 text-xs">{txt('已选择', 'Selected')} {checked.length}</span>{(['pause', 'resume', 'stop'] as const).map(action => { const Icon = action === 'pause' ? Pause : action === 'resume' ? Play : Square; const label = action === 'pause' ? txt('暂停', 'Pause') : action === 'resume' ? txt('继续', 'Resume') : txt('停止', 'Stop'); return <Button key={action} size="icon" variant="outline" title={label} aria-label={label} disabled={!selectedTasks.some(task => aiTaskJournal.supports(task.id, action))} onClick={() => control(action)}><Icon size={15} /></Button>; })}<Button size="icon" variant="outline" title={txt('归档／恢复', 'Archive / restore')} aria-label={txt('归档／恢复', 'Archive / restore')} onClick={() => aiTaskJournal.archive(checked, filter !== 'archived')}><Archive size={15} /></Button><Button size="icon" variant="outline" title={txt('删除终结记录', 'Delete finished records')} aria-label={txt('删除终结记录', 'Delete finished records')} onClick={() => { if (window.confirm(txt('删除选中的已结束任务记录？不会删除业务结果。', 'Delete selected finished task records? Results will be preserved.'))) { aiTaskJournal.remove(checked); setChecked([]); } }}><Trash2 size={15} /></Button></div>}
    </div>}
    {activeTask && !compact && <div className="lg:hidden"><Button variant="ghost" size="sm" onClick={() => selectTask(null)}><ArrowLeft size={16} />{txt('任务中心', 'Task center')}</Button></div>}
    {!compact && checked.length > 0 && <Button variant="outline" size="sm" disabled={batchRetrying || !selectedTasks.some(task => task.location !== 'server' && !aiTaskJournal.live(task.id) && taskIsTerminal(task) && retryKinds.has(task.kind) && task.items.some(item => item.state === 'failed'))} onClick={() => void batchRetry()}><RotateCcw size={15} />{batchRetrying ? txt('正在重试', 'Retrying') : txt('重试选中任务的失败项', 'Retry failed items in selected tasks')}</Button>}
    {error && <p role="alert" className="whitespace-pre-wrap break-words text-sm text-destructive">{error}</p>}
    {aiTaskJournal.storageError() && <p role="alert" className="text-xs text-destructive">{txt('任务历史未能保存或读取，请检查本机存储。当前进度仍可查看。', 'Task history could not be saved or loaded. Check device storage. Current progress remains visible.')}</p>}
    {compact && onOpenCenter && <Button className="w-full" variant="outline" onClick={onOpenCenter}><ListTodo size={16} />{txt('打开任务中心', 'Open task center')}<ArrowUpRight size={15} /></Button>}
    <div className={!compact && activeTask ? 'grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(300px,0.85fr)]' : ''}>
      <div className={activeTask ? compact ? 'hidden' : 'hidden lg:block' : ''}>{visible.length ? <div className={compact || activeTask ? 'grid gap-4' : 'grid gap-4 lg:grid-cols-2'}>{visible.slice(0, taskLimit).map(card)}</div> : <div className="flex flex-col items-center justify-center py-14 text-muted-foreground"><ListTodo size={32} className="mb-3 opacity-50" /><p className="text-sm">{txt('暂无符合条件的任务', 'No matching tasks')}</p></div>}
        {visible.length > taskLimit && <Button className="mt-4" variant="outline" size="sm" onClick={() => setTaskLimit(value => value + 50)}>{txt('显示更多任务', 'Show more tasks')} ({taskLimit}/{visible.length})</Button>}
        {compact && tasks.some(task => taskIsTerminal(task) && !taskNeedsAttention(task)) && <details className="mt-5"><summary className="cursor-pointer text-sm text-muted-foreground">{txt('完成历史', 'Completed history')} ({tasks.filter(task => taskIsTerminal(task) && !taskNeedsAttention(task) && !task.archived).length})</summary><div className="mt-3 grid gap-3">{tasks.filter(task => taskIsTerminal(task) && !taskNeedsAttention(task) && !task.archived).sort((a, b) => (Date.parse(b.createdAt ?? '') || 0) - (Date.parse(a.createdAt ?? '') || 0)).slice(0, 5).map(card)}</div></details>}
      </div>{detail}
    </div>
    {activeTask && <Button className="lg:hidden" variant="outline" onClick={() => selectTask(null)}><ArrowLeft size={16} />{txt('返回列表', 'Back to list')}</Button>}
  </div>;
}
