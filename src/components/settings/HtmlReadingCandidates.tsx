import { useEffect, useMemo, useState } from 'react';
import { useT } from '../../i18n/useT';
import type { ReadingState } from '../../lib/html-reading/model';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from '../ui/dialog';
import { ReadingGroup } from './HtmlReadingFields';

export interface CandidateItem {
  id: string; name: string; summary: string; analysis: Array<{ title: string; text: string }>;
  candidateFingerprint?: string;
  source?: { fileName: string; snapshotId: string; importId: string; importedAt: string };
  state: ReadingState;
}
export interface CandidateBatch {
  id: string; status: 'running' | 'paused' | 'completed'; createdAt?: string; updatedAt?: string; pauseReason?: string; retryAt?: string; syncError?: string;
  rows: Array<{ repoId: number; name: string; status: string; sourceFingerprint?: string; updatedAt?: string; error?: string }>;
}
export interface CandidateController {
  items: CandidateItem[]; batches: CandidateBatch[]; busy: boolean; error: string; accountLabel: string;
  start: (ids: string[], expectedFingerprints?: Record<string,string>) => Promise<void>; resume: (batchId: string) => Promise<void>; stop: () => void;
  dismiss: (ids: string[], expectedFingerprints?: Record<string,string>) => Promise<void>; refresh: () => Promise<void>;
  retrySync?: (batchId: string) => Promise<void>;
}
const resumable = new Set(['queued', 'checking', 'sending', 'failed', 'uncertain', 'local-pending']);
const pageSize = 40;

function CandidateBatchResults({ batch }: { batch: CandidateBatch }) {
  const t = useT('settings');
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(0);
  const pages = Math.max(1, Math.ceil(batch.rows.length / pageSize));
  const current = Math.min(page, pages - 1);
  return <details onToggle={event => setOpen(event.currentTarget.open)}><summary className="cursor-pointer text-sm">{t('htmlReadingWorkflow.batchResults', { count: batch.rows.length })}</summary>{open && <div className="mt-2 space-y-2"><ul className="max-h-60 space-y-2 overflow-y-auto text-sm">{batch.rows.slice(current * pageSize, (current + 1) * pageSize).map(row => <li key={row.repoId} className="break-words">{row.name} · {t(`htmlReadingWorkflow.status.${row.status}`)}{row.error && <span className="block text-destructive">{row.error}</span>}</li>)}</ul>{pages > 1 && <div className="flex items-center justify-between gap-3"><Button size="sm" variant="outline" disabled={!current} onClick={() => setPage(current - 1)}>{t('htmlReadingWorkflow.previous')}</Button><span className="text-xs">{t('htmlReadingWorkflow.page', { page: current + 1, pages })}</span><Button size="sm" variant="outline" disabled={current + 1 >= pages} onClick={() => setPage(current + 1)}>{t('htmlReadingWorkflow.next')}</Button></div>}</div>}</details>;
}

function CandidateBatchCard({batch,controller:c,onResume}:{batch:CandidateBatch;controller:CandidateController;onResume:(batch:CandidateBatch)=>void}) {
  const t=useT('settings');
  return <section key={batch.id} className="space-y-2 rounded-md border p-3" aria-label={t('htmlReadingWorkflow.starProgress')}>
      <p className="text-xs text-muted-foreground">{batch.createdAt || batch.id}</p>
      <p role="status" className="text-sm">{t('htmlReadingWorkflow.batchProgress', { done: batch.rows.filter(row => ['starred', 'already-starred'].includes(row.status)).length, total: batch.rows.length, failed: batch.rows.filter(row => ['failed', 'uncertain'].includes(row.status)).length })}</p>
      {batch.pauseReason && <p className="text-sm text-muted-foreground">{batch.pauseReason}</p>}
      {batch.retryAt && <p className="text-xs text-muted-foreground">{t('htmlReadingWorkflow.retryAfter', { time: batch.retryAt })}</p>}
      {batch.syncError && <div className="space-y-2"><p role="alert" className="text-sm text-destructive">{t('htmlReadingWorkflow.syncError', { error: batch.syncError })}</p>{c.retrySync && <Button size="sm" variant="outline" disabled={c.busy} onClick={() => void c.retrySync!(batch.id).catch(() => {})}>{t('htmlReadingWorkflow.retrySync')}</Button>}</div>}
      <div className="flex flex-wrap gap-2">{c.busy ? batch.status === 'running' && <Button size="sm" variant="outline" onClick={c.stop}>{t('htmlReadingWorkflow.stop')}</Button> : batch.rows.some(row => resumable.has(row.status)) && <Button size="sm" variant="outline" onClick={() => onResume(batch)}>{t(batch.rows.some(row => ['failed', 'uncertain'].includes(row.status)) ? 'htmlReadingWorkflow.retryFailed' : 'htmlReadingWorkflow.resume')}</Button>}</div>
      <CandidateBatchResults batch={batch} />
    </section>;

}

export function HtmlReadingCandidates({ controller: c, lastImportId }: { controller: CandidateController; lastImportId: string }) {
  const t = useT('settings');
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [confirmationPage,setConfirmationPage]=useState(0);
  const [historyOpen,setHistoryOpen]=useState(false);
  const [historyPage,setHistoryPage]=useState(0);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmation, setConfirmation] = useState<{ kind: 'star' | 'remove' | 'resume'; ids: string[]; names: string[]; fingerprints?:Record<string,string>; batchId?: string } | null>(null);
  const itemsById=useMemo(()=>new Map(c.items.map(item=>[item.id,item])),[c.items]);
  const resultIndex=useMemo(()=>{
    const values=new Map<string,CandidateBatch['rows'][number]>();
    const timestamps=new Map<string,string>();
    for(const batch of c.batches)for(const row of batch.rows){const timestamp=row.updatedAt??batch.updatedAt??batch.createdAt??'';for(const key of [`fingerprint:${row.repoId}:${row.sourceFingerprint??''}`,`latest:${row.repoId}`])if(!values.has(key)||timestamp>(timestamps.get(key)??'')){values.set(key,row);timestamps.set(key,timestamp);}}
    return values;
  },[c.batches]);
  const featuredBatch=c.batches.find(batch=>batch.status==='running')??c.batches[0];
  const historyBatches=c.batches.filter(batch=>batch!==featuredBatch);
  const historyPages=Math.max(1,Math.ceil((c.batches.length-1)/pageSize));
  const currentHistoryPage=Math.min(historyPage,historyPages-1);
  const confirmationPages=Math.max(1,Math.ceil((confirmation?.names.length??0)/pageSize));
  const currentConfirmationPage=Math.min(confirmationPage,confirmationPages-1);
  const filtered = c.items.filter(item => (filter !== 'import' || !!lastImportId && item.source?.importId === lastImportId)
    && (filter !== 'notes' || !!item.state.note.trim()) && (filter !== 'interested' || item.state.interest === 'interested')
    && `${item.name}\n${item.state.note}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pages - 1);
  const selectedItems = c.items.filter(item => selected.has(item.id));
  const visibleIds = new Set(filtered.slice(currentPage * pageSize, (currentPage + 1) * pageSize).map(item => item.id));
  const hiddenSelected = selectedItems.filter(item => !visibleIds.has(item.id)).length;
  useEffect(() => { setSelected(new Set()); setConfirmation(null); }, [c.accountLabel]);
  const confirmationIsCurrent=(action:NonNullable<typeof confirmation>)=>action.kind==='resume'||action.ids.every((id,index)=>{const item=itemsById.get(id);return item&&item.name===action.names[index]&&item.candidateFingerprint===action.fingerprints?.[id];});
  useEffect(()=>{
    if(confirmation&&confirmation.kind!=='resume'&&confirmation.ids.some((id,index)=>{const item=itemsById.get(id);return !item||item.name!==confirmation.names[index]||item.candidateFingerprint!==confirmation.fingerprints?.[id];}))setConfirmation(null);
  },[confirmation,itemsById]);
  const changeFilter = (value: string) => { setFilter(value); setPage(0); };
  const confirmSelected = (kind: 'star' | 'remove') => {setConfirmationPage(0);const fingerprints=Object.fromEntries(selectedItems.filter(item=>item.candidateFingerprint!==undefined).map(item=>[item.id,item.candidateFingerprint!]));setConfirmation({ kind, ids: selectedItems.map(item => item.id), names: selectedItems.map(item => item.name),...(Object.keys(fingerprints).length?{fingerprints}:{}) });};
  const confirmResume = (batch: CandidateBatch) => {
    setConfirmationPage(0);
    const rows = batch.rows.filter(row => resumable.has(row.status));
    setConfirmation({ kind: 'resume', ids: rows.map(row => String(row.repoId)), names: rows.map(row => row.name), batchId: batch.id });
  };
  const execute = async () => {
    const action = confirmation;
    if (!action || c.busy) return;
    setConfirmation(null);
    if(!confirmationIsCurrent(action))return;
    try {
      if (action.kind === 'resume') await c.resume(action.batchId!);
      else if (action.kind === 'star') {if(action.fingerprints)await c.start(action.ids,action.fingerprints);else await c.start(action.ids);}
      else {if(action.fingerprints)await c.dismiss(action.ids,action.fingerprints);else await c.dismiss(action.ids);}
    } catch { return; }
    setSelected(current => new Set([...current].filter(id => !action.ids.includes(id))));
  };
  const statusLabel = (status: string) => t(`htmlReadingWorkflow.status.${status}`);
  return <ReadingGroup title={t('htmlReadingWorkflow.candidates')} description={t('htmlReadingWorkflow.candidateDescription')}>
    <div className="flex flex-wrap gap-2" role="group" aria-label={t('htmlReadingWorkflow.candidateFilters')}>
      {(['all', 'import', 'notes', 'interested'] as const).map(value => <Button key={value} size="sm" variant={filter === value ? 'default' : 'outline'} aria-pressed={filter === value} onClick={() => changeFilter(value)}>{t(`htmlReadingWorkflow.filters.${value}`)}</Button>)}
    </div>
    <input aria-label={t('htmlReadingWorkflow.searchCandidates')} placeholder={t('htmlReadingWorkflow.searchNamesNotes')} value={search} onChange={event => { setSearch(event.target.value); setPage(0); }} className="h-10 w-full rounded-md border bg-background px-3 text-sm" />
    <div className="flex flex-wrap items-center gap-3 text-sm"><span>{t('htmlReadingWorkflow.matchingCount', { count: filtered.length })}</span><Button size="sm" variant="outline" disabled={c.busy || !filtered.length} onClick={() => setSelected(current => new Set([...current, ...filtered.map(item => item.id)]))}>{t('htmlReadingWorkflow.selectFiltered', { count: filtered.length })}</Button></div>
    {c.error && <p role="alert" className="text-sm text-destructive">{c.error}</p>}
    {featuredBatch&&<CandidateBatchCard batch={featuredBatch} controller={c} onResume={confirmResume}/>}
    {c.batches.length>1&&<details onToggle={event=>setHistoryOpen(event.currentTarget.open)}><summary className="cursor-pointer text-sm">{t('htmlReadingWorkflow.batchHistory',{count:c.batches.length-1})}</summary>{historyOpen&&<div className="mt-3 space-y-3">{historyBatches.slice(currentHistoryPage*pageSize,(currentHistoryPage+1)*pageSize).map(batch=><CandidateBatchCard key={batch.id} batch={batch} controller={c} onResume={confirmResume}/>)}<div className="flex items-center justify-between gap-3"><Button size="sm" variant="outline" disabled={!currentHistoryPage} onClick={()=>setHistoryPage(currentHistoryPage-1)}>{t('htmlReadingWorkflow.previous')}</Button><span className="text-sm">{t('htmlReadingWorkflow.page',{page:currentHistoryPage+1,pages:historyPages})}</span><Button size="sm" variant="outline" disabled={currentHistoryPage+1>=historyPages} onClick={()=>setHistoryPage(currentHistoryPage+1)}>{t('htmlReadingWorkflow.next')}</Button></div></div>}</details>}
    <div className="space-y-3">{filtered.slice(currentPage * pageSize, (currentPage + 1) * pageSize).map(item => {
      const result=resultIndex.get(item.candidateFingerprint?`fingerprint:${item.id}:${item.candidateFingerprint}`:`latest:${item.id}`);
      return <article key={item.id} className="space-y-2 rounded-md border p-3">
        <label className="flex items-start gap-3"><input type="checkbox" aria-label={t('htmlReadingWorkflow.selectCandidate', { name: item.name })} checked={selected.has(item.id)} disabled={c.busy} onChange={event => setSelected(current => { const next = new Set(current); if (event.target.checked) next.add(item.id); else next.delete(item.id); return next; })} className="mt-1" /><a href={`https://github.com/${item.name}`} target="_blank" rel="noopener noreferrer" className="break-all text-sm font-medium underline">{item.name}</a></label>
        <p className="line-clamp-3 whitespace-pre-wrap break-words text-sm text-muted-foreground">{item.summary || t('htmlReadingWorkflow.summaryUnavailable')}</p>
        <p className="text-xs text-muted-foreground">{t(`htmlReadingUi.${item.state.interest === 'neutral' ? 'unmarked' : item.state.interest}`)} · {result ? statusLabel(result.status) : t('htmlReadingWorkflow.status.queued')} · {item.source?.fileName || t('htmlReadingWorkflow.historicalCandidate')}</p>
        {item.state.note && <div className="rounded bg-muted/50 p-2 text-sm"><p className="line-clamp-3 whitespace-pre-wrap break-words">{item.state.note}</p><details onToggle={event => { const open = event.currentTarget.open; setExpanded(current => { const next = new Set(current); if (open) next.add(`note:${item.id}`); else next.delete(`note:${item.id}`); return next; }); }}><summary className="mt-1 cursor-pointer text-xs text-muted-foreground">{t('htmlReadingWorkflow.fullNote')}</summary>{expanded.has(`note:${item.id}`) && <p className="mt-2 whitespace-pre-wrap break-words">{item.state.note}</p>}</details></div>}
        {result?.error && <p className="text-sm text-destructive">{result.error}</p>}
        <details onToggle={event=>{const open=event.currentTarget.open;setExpanded(current=>{const next=new Set(current);if(open)next.add(item.id);else next.delete(item.id);return next;});}}><summary className="cursor-pointer text-sm">{t('htmlReadingWorkflow.fullAnalysis')}</summary>{expanded.has(item.id)&&<div className="mt-2 space-y-3">{item.summary && <p className="whitespace-pre-wrap break-words text-sm">{item.summary}</p>}{item.analysis.length ? item.analysis.map((block, index) => <div key={index}><h5 className="text-sm font-medium">{block.title}</h5><p className="whitespace-pre-wrap break-words text-sm text-muted-foreground">{block.text}</p></div>) : <p className="text-sm text-muted-foreground">{t('htmlReadingWorkflow.noAnalysis')}</p>}</div>}</details>
      </article>;
    })}{!filtered.length && <p className="text-sm text-muted-foreground">{t('htmlReadingWorkflow.noCandidates')}</p>}</div>
    <div className="flex items-center justify-between gap-3"><Button size="sm" variant="outline" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>{t('htmlReadingWorkflow.previous')}</Button><span className="text-sm">{t('htmlReadingWorkflow.page', { page: currentPage + 1, pages })}</span><Button size="sm" variant="outline" disabled={currentPage + 1 >= pages} onClick={() => setPage(currentPage + 1)}>{t('htmlReadingWorkflow.next')}</Button></div>
    <div className="sticky bottom-0 z-10 flex flex-wrap items-center gap-2 rounded-md border bg-card p-3 shadow-sm" aria-label={t('htmlReadingWorkflow.candidateActions')}><div className="mr-auto"><p className="text-sm">{t('htmlReadingWorkflow.selectedCount', { count: selectedItems.length })}</p><p className="text-xs text-muted-foreground">{t('htmlReadingWorkflow.hiddenSelection', { count: hiddenSelected })}</p></div><Button disabled={c.busy || !selectedItems.length} onClick={() => confirmSelected('star')}>{t('htmlReadingWorkflow.starSelected')}</Button><Button variant="outline" disabled={c.busy || !selectedItems.length} onClick={() => confirmSelected('remove')}>{t('htmlReadingWorkflow.removeSelected')}</Button><Button variant="ghost" disabled={c.busy || !selected.size} onClick={() => setSelected(new Set())}>{t('htmlReadingWorkflow.clearSelection')}</Button></div>
    <Dialog open={!!confirmation} onOpenChange={open => { if (!open) setConfirmation(null); }}><DialogContent closeLabel={t('htmlReadingWorkflow.cancel')}><DialogTitle>{t(confirmation?.kind === 'remove' ? 'htmlReadingWorkflow.confirmRemoval' : 'htmlReadingWorkflow.confirmStars')}</DialogTitle><DialogDescription>{t(confirmation?.kind === 'remove' ? 'htmlReadingWorkflow.removalDescription' : 'htmlReadingWorkflow.starConfirmation', { account: c.accountLabel, count: confirmation?.ids.length ?? 0 })}</DialogDescription><ul className="max-h-72 space-y-1 overflow-y-auto text-sm" aria-label={t('htmlReadingWorkflow.confirmationProjects')}>{confirmation?.names.slice(currentConfirmationPage*pageSize,(currentConfirmationPage+1)*pageSize).map((name, index) => <li key={`${index}:${name}`} className="break-all">{name}</li>)}</ul>{confirmationPages>1&&<div className="flex items-center justify-between gap-3"><Button size="sm" variant="outline" disabled={!currentConfirmationPage} onClick={()=>setConfirmationPage(currentConfirmationPage-1)}>{t('htmlReadingWorkflow.previous')}</Button><span className="text-sm">{t('htmlReadingWorkflow.page',{page:currentConfirmationPage+1,pages:confirmationPages})}</span><Button size="sm" variant="outline" disabled={currentConfirmationPage+1>=confirmationPages} onClick={()=>setConfirmationPage(currentConfirmationPage+1)}>{t('htmlReadingWorkflow.next')}</Button></div>}<DialogFooter><Button variant="outline" onClick={() => setConfirmation(null)}>{t('htmlReadingWorkflow.cancel')}</Button><Button disabled={c.busy || !confirmation?.ids.length} onClick={() => void execute()}>{t(confirmation?.kind === 'remove' ? 'htmlReadingWorkflow.confirmRemoval' : 'htmlReadingWorkflow.confirmStars')}</Button></DialogFooter></DialogContent></Dialog>
  </ReadingGroup>;
}
