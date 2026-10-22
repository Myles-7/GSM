import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { ArrowDown, ArrowUpRight, Copy, Pin } from 'lucide-react';
import { aiTaskJournal, type AITaskRecord } from '../../services/aiTaskJournal';
import { taskPhaseLabel, taskCommitStatusLabel, taskTimerEnd, taskFailureLabel } from '../../services/taskPresentation';
import { taskObservability } from '../../services/taskObservability';
import type { TaskObservedResult, TaskRequestObservation } from '../../types/taskObservation';
import { Button } from '../ui/button';
import { takeTaskDetailTab } from '../../services/taskDetailsNavigation';

type Tab = 'process' | 'content' | 'results';
const selections = new Map<string, { tab: Tab; requestId?: string }>();
const date = (value: string | undefined, zh: boolean) => value ? new Date(value).toLocaleString(zh ? 'zh-CN' : 'en-US') : zh ? '未记录' : 'Not recorded';
const elapsed = (start: string, end?: string) => Math.max(0, ((Date.parse(end ?? '') || Date.now()) - Date.parse(start)) / 1000).toFixed(1);

export function TaskObservationView({ task, chinese: zh, children, onLocate }: {
  task: AITaskRecord; chinese: boolean; children?: ReactNode; onLocate?(result: TaskObservedResult): void;
}) {
  const txt = (cn: string, en: string) => zh ? cn : en;
  const key = JSON.stringify([task.owner, task.id]);
  const [selection, setSelection] = useState(() => {
    const tab = takeTaskDetailTab(task.owner, task.id);
    if (tab) {
      const explicit = { ...selections.get(key), tab };
      selections.set(key, explicit);
      return explicit;
    }
    return selections.get(key) ?? { tab: 'process' as Tab };
  });
  const [copyMessage, setCopyMessage] = useState('');
  const observed = useSyncExternalStore(taskObservability.subscribe, () => taskObservability.snapshot(task.owner, task.id));
  useEffect(() => { void taskObservability.load(task.owner, task.id); }, [task.owner, task.id]);
  useEffect(() => { setSelection(selections.get(key) ?? { tab: 'process' }); }, [key]);
  const update = (next: typeof selection) => {
    selections.set(key, next); if (selections.size > 300) selections.delete(selections.keys().next().value!);
    setSelection(next);
  };
  const request = observed.requests.find(item => item.requestId === selection.requestId) ?? observed.requests[0];
  const copy = (value: string) => { if (!navigator.clipboard?.writeText) { setCopyMessage(txt('复制不可用，请手动选择文本', 'Clipboard unavailable; select the text manually')); return; } void navigator.clipboard.writeText(value).then(() => setCopyMessage(txt('已复制', 'Copied'))).catch(() => setCopyMessage(txt('复制失败，请手动选择文本', 'Copy failed; select the text manually'))); };
  const phases = new Map<string, number>();
  for (const item of task.items) {
    const phase = item.state === 'running' ? item.phase ?? 'running' : item.state;
    phases.set(phase, (phases.get(phase) ?? 0) + 1);
  }
  const lastActivity = [...observed.events.map(event => event.time), ...observed.requests.map(item => item.lastActivityAt)]
    .filter(Boolean).sort((a, b) => Date.parse(b) - Date.parse(a))[0];
  const repoTask = task.units?.items === 'repositories' || ['summary', 'details', 'discovery-analysis'].includes(task.kind);
  const repositoryCount = task.units?.repositories ?? (repoTask ? new Set(task.items.map(item => item.id)).size : undefined);
  const batchCount = task.units?.items === 'batches' ? task.items.filter(item => task.kind !== 'exploration' || item.id !== 'topics').length : undefined;
  const outcomeName = (outcome: TaskRequestObservation['outcome']) => outcome ? ({ succeeded: txt('已成功', 'Succeeded'), failed: txt('失败', 'Failed'), unknown: txt('结果待核对', 'Outcome unknown'), canceled: txt('已取消', 'Canceled') })[outcome] : '';
  const phaseName = (phase: string) => ({ pending: txt('未执行', 'Pending'), running: txt('执行中', 'Running'), complete: txt('已完成', 'Complete'), failed: txt('失败', 'Failed'), canceled: txt('已取消', 'Canceled') })[phase] ?? taskPhaseLabel(phase, zh);
  return <div className="min-w-0" data-testid="task-observations">
    <div className="my-4 flex flex-wrap items-center justify-between gap-3 border-b border-border">
      <div className="flex gap-1" role="tablist" aria-label={txt('任务详情内容', 'Task detail content')}>
        {([['process', txt('执行过程', 'Execution process')], ['content', txt('返回内容', 'Returned content')], ['results', txt('分析结果', 'Analysis results')]] as const).map(([tab, label]) => <button key={tab} id={`task-tab-${task.id}-${tab}`} type="button" role="tab" aria-selected={selection.tab === tab} aria-controls={`task-panel-${task.id}`} tabIndex={selection.tab === tab ? 0 : -1}
          onKeyDown={event => { const tabs: Tab[] = ['process', 'content', 'results']; if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') { event.preventDefault(); const next = tabs[(tabs.indexOf(tab) + (event.key === 'ArrowRight' ? 1 : 2)) % 3]; update({ ...selection, tab: next }); document.getElementById(`task-tab-${task.id}-${next}`)?.focus(); } }}
          className={`border-b-2 px-4 py-3 text-sm font-medium ${selection.tab === tab ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`} onClick={() => update({ ...selection, tab })}>{label}</button>)}
      </div>
      <Button size="sm" variant="ghost" disabled={!observed.loaded} aria-pressed={observed.pinned} onClick={() => { void taskObservability.pin(task.owner,task.id,!observed.pinned).then(saved=>{if(saved)aiTaskJournal.patch(task.id,{pinned:!observed.pinned});}); }}><Pin size={14} />{observed.pinned ? txt('取消保留历史', 'Unpin history') : txt('保留历史', 'Pin history')}</Button>
    </div>
    {observed.storageError && <p role="alert" className="mb-3 break-words rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{txt('正文历史存储异常，当前内存内容仍可查看：', 'Content history storage failed; current in-memory content is still available: ')}{observed.storageError}</p>}
    {observed.truncated && <p className="mb-3 text-sm text-muted-foreground">{txt('内容达到保留上限，部分历史已截断。', 'Content reached the retention limit; some history was truncated.')}</p>}
    {copyMessage && <p role="status" className="mb-2 text-xs text-muted-foreground">{copyMessage}</p>}
    <div role="tabpanel" id={`task-panel-${task.id}`} aria-labelledby={`task-tab-${task.id}-${selection.tab}`} className="min-w-0">
      {selection.tab === 'process' && <>
        <div className="mb-5 grid gap-3 rounded-lg border border-border bg-muted/20 p-4 text-sm sm:grid-cols-2">
          <p>{repositoryCount !== undefined ? `${txt('仓库', 'Repositories')}: ${repositoryCount}` : `${txt('子项', 'Items')}: ${task.items.length}`}</p>
          <p>{txt('请求', 'Requests')}: {observed.requests.length} · {txt('批次', 'Batches')}: {batchCount ?? txt('未记录', 'Not recorded')}</p>
          <div className="flex flex-wrap gap-x-4 gap-y-2 sm:col-span-2">{[...phases].map(([phase, count]) => <span key={phase}>{phaseName(phase)}: {count}</span>)}</div>
          {task.units?.items === 'batches' && task.kind === 'exploration' && task.items.some(item => item.id === 'topics') && <p className="text-xs text-muted-foreground sm:col-span-2">{txt('阶段计数包含主题整理步骤，批次数不包含此步骤。', 'Phase counts include topic consolidation; batch counts exclude that step.')}</p>}
          <p className="sm:col-span-2">{txt('最近实际活动', 'Last recorded activity')}: {date(lastActivity, zh)}</p>
          <p className="text-xs text-muted-foreground sm:col-span-2">{txt('计时仅表示已用时，不代表进度或预计完成时间。', 'Elapsed time is not progress or an estimated completion time.')}</p>
          {task.kind === 'exploration' && task.progress && <p className="sm:col-span-2">{txt('累计项目已保存（含此前检查点）', 'Total projects saved (including earlier checkpoints)')}: {task.progress.done}/{task.progress.total}</p>}
        </div>
        {(task.error || task.items.some(item => item.error)) && <p role="status" className="mb-4 break-words rounded-lg border border-destructive/30 p-3 text-sm text-destructive">{taskFailureLabel(task.error ?? task.items.find(item => item.error)?.error ?? '', zh)}</p>}
        {observed.requests.length > 0 && <section className="mb-5" aria-label={txt('请求时间线', 'Request timeline')}><h3 className="mb-3 text-sm font-semibold">{txt('请求时间线', 'Request timeline')}</h3><ol className="space-y-3">{observed.requests.map(item => <li key={item.requestId} className="min-w-0 rounded-lg border border-border p-3 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2"><span className="break-all font-medium">{item.label} · {txt('尝试', 'Attempt')} {item.attempt}</span><span className="text-xs text-muted-foreground">{item.source} · {item.endedAt ? outcomeName(item.outcome) || txt('已结束，结果未记录', 'Ended; outcome not recorded') : phaseName(item.phase)}</span></div>
          <p className="mt-1 text-xs text-muted-foreground">{item.model ?? task.config?.model ?? txt('模型未记录', 'Model not recorded')} · {txt('请求用时', 'Request elapsed')} {elapsed(item.startedAt, item.endedAt ?? taskTimerEnd(task))}s · {txt('当前阶段用时', 'Current phase elapsed')} {elapsed(item.phaseStartedAt, item.endedAt ?? taskTimerEnd(task))}s</p>
          <p className="mt-1 text-xs text-muted-foreground">{txt('开始', 'Started')}: {date(item.startedAt, zh)} · {txt('最后活动', 'Last activity')}: {date(item.lastActivityAt, zh)}</p>
          {item.error && <p className="mt-2 break-words text-xs text-destructive">{taskFailureLabel(item.error, zh)}</p>}
          <Button size="sm" variant="ghost" className="mt-1" onClick={() => update({ tab: 'content', requestId: item.requestId })}>{txt('查看返回内容', 'View returned content')}<ArrowUpRight size={13} /></Button>
        </li>)}</ol></section>}
        {observed.events.length > 0 && <details className="mb-5 rounded-lg border border-border p-3 text-xs"><summary className="cursor-pointer">{txt('阶段事件', 'Phase events')} ({observed.events.length})</summary><ol className="mt-3 max-h-72 space-y-2 overflow-y-auto">{observed.events.map(event => <li key={event.id} className="break-words"><time>{date(event.time, zh)}</time> · {event.source === 'gsm' ? txt('程序执行', 'Application') : event.source} · {event.requestId && <span className="break-all">{event.requestId} · </span>}{event.phase ? phaseName(event.phase) : event.type}{event.message ? ` · ${event.message}` : ''}</li>)}</ol></details>}
        {children}
      </>}
      {selection.tab === 'content' && <div className="space-y-4">
        {observed.requests.length > 0 ? <><label className="block text-sm">{txt('选择请求', 'Select request')}<select aria-label={txt('选择请求', 'Select request')} className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3" value={request?.requestId ?? ''} onChange={event => update({ ...selection, requestId: event.target.value })}>{observed.requests.map(item => <option key={item.requestId} value={item.requestId}>{item.label} · {item.requestId} · {txt('尝试', 'Attempt')} {item.attempt}</option>)}</select></label>
        {request && <RequestContent key={`${key}:${request.requestId}`} request={request} chinese={zh} copy={copy} />}</> : <p className="py-10 text-sm text-muted-foreground">{txt('未提供或未记录返回正文。旧任务不会补造历史内容。', 'No response body was provided or recorded. Older tasks have no reconstructed content.')}</p>}
      </div>}
      {selection.tab === 'results' && <div className="space-y-4">{observed.results.length ? observed.results.map(result => <article key={result.id} className="min-w-0 rounded-lg border border-border p-4">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><h3 className="break-all text-base font-semibold">{result.label}</h3><div className="flex flex-wrap items-center gap-2"><span className={`text-xs ${result.commitStatus === 'failed' ? 'text-destructive' : 'text-muted-foreground'}`}>{taskCommitStatusLabel(result.commitStatus, zh)}</span>{onLocate && <Button variant="outline" size="sm" onClick={() => onLocate(result)}><ArrowUpRight size={14} />{txt('定位结果', 'Locate result')}</Button>}</div></div>
        <StructuredValue value={result.data} chinese={zh} />
        <details className="mt-5 border-t border-border pt-3"><summary className="cursor-pointer text-xs text-muted-foreground">{txt('原始 JSON', 'Raw JSON')}</summary><Button className="my-2" variant="ghost" size="sm" onClick={() => copy(JSON.stringify(result.data, null, 2) ?? '')}><Copy size={13} />{txt('复制 JSON', 'Copy JSON')}</Button><pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded bg-muted p-3 text-xs">{JSON.stringify(result.data, null, 2)}</pre></details>
      </article>) : <p className="py-10 text-sm text-muted-foreground">{txt('暂无已记录的结构化分析结果。返回正文可在“返回内容”中查看。', 'No structured analysis result is recorded. Response text is available under Returned content.')}</p>}</div>}
    </div>
  </div>;
}

function RequestContent({ request, chinese: zh, copy }: { request: TaskRequestObservation; chinese: boolean; copy(value: string): void }) {
  const txt = (cn: string, en: string) => zh ? cn : en;
  const viewport = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const [paused, setPaused] = useState(false);
  useLayoutEffect(() => { if (following.current && viewport.current) viewport.current.scrollTop = viewport.current.scrollHeight; }, [request.answer, request.reasoning]);
  return <>
    <p className="break-words text-xs text-muted-foreground">{request.source} · {request.model ?? txt('模型未记录', 'Model not recorded')} · {request.endedAt ? txt('已结束', 'Ended') : taskPhaseLabel(request.phase, zh)} · {txt('已接收字符', 'Characters received')} {request.receivedChars}</p>
    {request.mode === 'final' && <p className="rounded-md bg-muted p-3 text-sm">{txt('此来源仅返回最终内容，未记录增量输出。', 'Final response only; no incremental output was recorded.')}</p>}
    {request.mode === 'stream' && <p className="text-xs text-muted-foreground">{txt('来源支持增量返回。', 'The source supports incremental output.')}</p>}
    {request.mode === 'unknown' && <p className="text-xs text-muted-foreground">{txt('输出模式未记录。', 'Output mode was not recorded.')}</p>}
    {request.truncated && <p className="text-sm text-destructive">{txt('此请求正文已截断，显示的是已保留部分。', 'This request content was truncated; the retained portion is shown.')}</p>}
    {request.error && <p className="break-words text-sm text-destructive">{request.error}</p>}
    <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-semibold">{txt('回答正文', 'Answer')}</h3><Button size="sm" variant="outline" disabled={!request.answer} onClick={() => copy(request.answer)}><Copy size={14} />{txt('复制正文', 'Copy answer')}</Button></div>
    <div ref={viewport} data-testid="task-answer-scroll" tabIndex={0} aria-label={txt('回答正文', 'Answer')} onScroll={() => { const element = viewport.current; if (!element) return; following.current = element.scrollHeight - element.scrollTop - element.clientHeight < 64; setPaused(!following.current); }} className="max-h-[52dvh] min-h-40 overflow-y-auto rounded-lg border border-border bg-muted/20 p-4 text-sm leading-7">
      <div className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{request.answer || txt('尚未提供或记录回答正文。', 'No answer text has been provided or recorded yet.')}</div>
    </div>
    {paused && <Button variant="outline" size="sm" onClick={() => { following.current = true; setPaused(false); if (viewport.current) viewport.current.scrollTop = viewport.current.scrollHeight; }}><ArrowDown size={14} />{txt('回到最新', 'Back to latest')}</Button>}
    {request.reasoning ? <details className="rounded-lg border border-border p-4"><summary className="cursor-pointer text-sm font-medium">{txt('来源提供的原生推理', 'Native reasoning from source')}</summary><p className="my-2 text-xs text-muted-foreground">{txt('以下内容由模型来源提供，与回答正文分开记录。', 'This content was supplied by the model source and recorded separately from the answer.')}</p><Button size="sm" variant="ghost" onClick={() => copy(request.reasoning)}><Copy size={13} />{txt('复制', 'Copy')}</Button><div className="mt-2 max-h-80 overflow-y-auto whitespace-pre-wrap break-words text-sm leading-7">{request.reasoning}</div></details> : <p className="text-xs text-muted-foreground">{txt('来源未提供或未记录原生推理。', 'Native reasoning was not provided or recorded.')}</p>}
  </>;
}
const fieldNames: Record<string, [string, string]> = { summary: ['摘要', 'Summary'], description: ['描述', 'Description'], topics: ['主题', 'Topics'], tags: ['标签', 'Tags'], categories: ['分类', 'Categories'], relations: ['关联', 'Relations'], relationships: ['关联', 'Relationships'], evidence: ['依据', 'Evidence'], reason: ['原因', 'Reason'], target: ['关联对象', 'Target'], source: ['来源', 'Source'], repository: ['仓库', 'Repository'], url: ['来源链接', 'Source URL'], text: ['原文', 'Source text'], excerpt: ['原文摘录', 'Source excerpt'], citations: ['引用来源', 'Citations'], repositories: ['仓库', 'Repositories'], insights: ['洞察', 'Insights'], conclusion: ['结论', 'Conclusion'], confidence: ['置信度', 'Confidence'] };
function StructuredValue({ value, chinese: zh, depth = 0 }: { value: unknown; chinese: boolean; depth?: number }) {
  if (value === null || value === undefined) return <span className="text-muted-foreground">—</span>;
  if (typeof value !== 'object') return <p className="whitespace-pre-wrap break-words text-sm leading-7 [overflow-wrap:anywhere]">{String(value)}</p>;
  if (depth > 8) return <details><summary className="cursor-pointer text-xs">{zh ? '展开嵌套内容' : 'Expand nested content'}</summary><pre className="overflow-auto whitespace-pre-wrap break-words text-xs">{JSON.stringify(value, null, 2)}</pre></details>;
  if (Array.isArray(value)) return value.length ? <ul className="space-y-2">{value.map((entry, index) => <li key={index} className={typeof entry === 'object' && entry !== null ? 'rounded-md border border-border p-3' : 'ml-4 list-disc'}><StructuredValue value={entry} chinese={zh} depth={depth + 1} /></li>)}</ul> : <p className="text-sm text-muted-foreground">{zh ? '无' : 'None'}</p>;
  return <dl className="space-y-4">{Object.entries(value).map(([field, entry]) => <div key={field} className="min-w-0"><dt className="mb-1 break-words text-xs font-semibold text-muted-foreground">{fieldNames[field]?.[zh ? 0 : 1] ?? field.replace(/[_-]/g, ' ')}</dt><dd className="min-w-0"><StructuredValue value={entry} chinese={zh} depth={depth + 1} /></dd></div>)}</dl>;
}
