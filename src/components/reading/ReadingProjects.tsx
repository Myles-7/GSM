import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Check, CheckSquare, FileText, Heart, Inbox, ListFilter, MoreHorizontal, Search, Star, Upload, X, Activity } from 'lucide-react';
import type { ReadingProjectItem, useReadingProjects } from '../../features/settings/hooks/useReadingProjects';
import type { ReadingState } from '../../lib/html-reading/model';
import type { ReadingStarBatch } from '../../lib/html-reading/candidates';
import { useT } from '../../i18n/useT';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from '../ui/dialog';
import { ReadingProjectDetail } from './ReadingProjectDetail';
import { ReadingProjectNotes } from './ReadingProjectNotes';
import { ReadingProjectFilters } from './ReadingProjectFilters';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '../ui/sheet';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../ui/dropdown-menu';
import './readingWorkspace.css';
import { ReadingProjectBatches } from './ReadingProjectBatches';
import { filterProjects, loadBrowse, loadDrafts, resumableProjectStatuses, saveBrowse, saveDrafts, scopeItems, type ProjectBrowseState } from './readingProjectBrowse';

type Controller = ReturnType<typeof useReadingProjects>;
type Patch = Partial<ReadingState> & { processed?: boolean };
interface Confirmation { ids: string[]; names: string[]; fingerprints: Record<string, string>; account: string; batchId?: string; batchSignature?: string }
const patches: Record<string, Patch> = { read: { read: true }, unread: { read: false }, interested: { interest: 'interested' }, ignored: { interest: 'ignored' }, neutral: { interest: 'neutral' }, candidate: { candidate: true }, uncandidate: { candidate: false }, process: { processed: true }, restore: { processed: false } };

export function ReadingProjects({ controller: c, importRevision, onImport, active = true }: { controller: Controller; importRevision: number | string; onImport?: () => void; active?: boolean }) {
  return <AccountReadingProjects key={c.accountId} controller={c} importRevision={importRevision} onImport={onImport} active={active} />;
}

function AccountReadingProjects({ controller: c, importRevision, onImport, active = true }: { controller: Controller; importRevision: number | string; onImport?: () => void; active?: boolean }) {
  const t = useT('settings');
  const [browse, setBrowse] = useState(() => loadBrowse(c.accountId));
  const [drafts, setDrafts] = useState(() => loadDrafts(c.accountId));
  const [noteErrors, setNoteErrors] = useState<Record<string, string>>({});
  const [storageFailed, setStorageFailed] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [confirmationPage, setConfirmationPage] = useState(0);
  const [localError, setLocalError] = useState('');
  const [pendingAction, setPendingAction] = useState(false);
  const previousRevision = useRef(importRevision);
  const awaitingImport = useRef(false);
  const [selectMode, setSelectMode] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [tasksOpen, setTasksOpen] = useState(false);
  const [noteId, setNoteId] = useState('');
  const [detailOpen, setDetailOpen] = useState(false);
  const gridRef = useRef<HTMLDivElement>(null);
  const [geometry, setGeometry] = useState({ width: 1100, height: 640 });
  const listRef = useRef<HTMLDivElement>(null);
  const previousList = useRef<ReadingProjectItem[]>([]);
  const initialScroll = useRef<number | null>(browse.scroll);
  const listView = JSON.stringify([browse.page, browse.scope, browse.query, browse.importOnly, browse.candidateOnly, browse.read, browse.interest, browse.note, browse.star]);
  const previousView = useRef(listView);
  const busy = c.busy || pendingAction;
  const itemsById = useMemo(() => new Map(c.items.map(item => [item.id, item])), [c.items]);
  const importIds = useMemo(() => new Set(c.lastImportIds), [c.lastImportIds]);
  const scoped = useMemo(() => scopeItems(c.items, browse.scope, importIds).filter(item => (!browse.importOnly || importIds.has(item.id)) && (!browse.candidateOnly || item.state.candidate)), [c.items, browse.scope, browse.importOnly, browse.candidateOnly, importIds]);
  const filtered = useMemo(() => filterProjects(scoped, browse), [scoped, browse]);
  const pages = Math.max(1, Math.ceil(filtered.length / 40));
  const page = Math.min(browse.page, pages - 1);
  const visible = filtered.slice(page * 40, (page + 1) * 40);
  const selectedItems = c.items.filter(item => selected.has(item.id));
  const visibleIds = new Set(visible.map(item => item.id));
  const hiddenSelected = selectedItems.filter(item => !visibleIds.has(item.id)).length;
  const focused = filtered.find(item => item.id === browse.focusedId);
  const counts = { import: scopeItems(c.items, 'import', importIds).length, pending: scopeItems(c.items, 'pending', importIds).length, candidates: scopeItems(c.items, 'candidates', importIds).length, processed: scopeItems(c.items, 'processed', importIds).length };

  useLayoutEffect(() => {
    if (listRef.current && visible.length && initialScroll.current !== null) {
      listRef.current.scrollTop = initialScroll.current;
      initialScroll.current = null;
    }
  }, [visible.length]);
  useLayoutEffect(() => {
    if (previousView.current !== listView) {
      previousView.current = listView;
      initialScroll.current = null;
      if (listRef.current) listRef.current.scrollTop = 0;
      setBrowse(current => current.scroll ? { ...current, scroll: 0 } : current);
    }
  }, [listView]);
  useEffect(() => { if (!saveBrowse(c.accountId, browse)) setStorageFailed(true); }, [browse, c.accountId]);
  useEffect(() => {
    if (previousRevision.current !== importRevision) {
      previousRevision.current = importRevision;
      awaitingImport.current = true;
    }
    if (awaitingImport.current && c.lastImportId) {
      awaitingImport.current = false;
      setBrowse(current => ({ ...current, scope: 'pending', importOnly: true, candidateOnly: false, query: '', read: 'all', interest: 'all', note: 'all', star: 'all', page: 0, focusedId: '' }));
    }
  }, [importRevision, c.lastImportId]);
  useEffect(() => {
    if (!active) { setFiltersOpen(false); setTasksOpen(false); setNoteId(''); }
    const measure = () => {
      const grid = gridRef.current;
      const rect = grid?.getBoundingClientRect();
      if (grid && rect && rect.width > 0) {
        const scale = rect.width / grid.clientWidth || 1;
        const saveBar = grid.closest('.reading-page')?.querySelector('.reading-save-bar')?.getBoundingClientRect();
        const reserved = saveBar ? saveBar.height + 16 * scale : 0;
        setGeometry({ width: grid.clientWidth, height: Math.max(320, (window.innerHeight - rect.top - 18 - reserved) / scale) });
      }
    };
    measure();
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    if (gridRef.current) observer?.observe(gridRef.current);
    const workspace = gridRef.current?.closest('.reading-page');
    if (workspace) observer?.observe(workspace);
    window.addEventListener('resize', measure);
    return () => { observer?.disconnect(); window.removeEventListener('resize', measure); };
  }, [active]);
  useEffect(() => {
    if (!focused && filtered.length) {
      const oldIndex = previousList.current.findIndex(item => item.id === browse.focusedId);
      const next = filtered[Math.min(Math.max(0, oldIndex), filtered.length - 1)];
      setBrowse(current => ({ ...current, focusedId: next.id }));
    }
    previousList.current = filtered;
  }, [filtered, focused, browse.focusedId]);

  const isCurrent = useCallback((action: Confirmation) => action.account === c.accountLabel && action.ids.every((id, index) => {
    const item = itemsById.get(id);
    return item && item.name === action.names[index] && item.fingerprint === action.fingerprints[id];
  }) && (!action.batchId || JSON.stringify(c.batches.find(batch => batch.id === action.batchId)?.rows) === action.batchSignature), [c.accountLabel, c.batches, itemsById]);
  useEffect(() => {
    if (confirmation && !isCurrent(confirmation)) { setConfirmation(null); setLocalError(t('dailyProjects.staleConfirmation')); }
  }, [confirmation, isCurrent, t]);
  const changeBrowse = (patch: Partial<ProjectBrowseState>) => setBrowse(current => ({ ...current, ...patch, page: 0 }));
  const capture = (items: ReadingProjectItem[]): Confirmation => ({ ids: items.map(item => item.id), names: items.map(item => item.name), fingerprints: Object.fromEntries(items.map(item => [item.id, item.fingerprint])), account: c.accountLabel });
  const run = async (action: () => Promise<void>) => {
    setPendingAction(true); setLocalError('');
    try { await action(); return true; }
    catch (cause) { setLocalError(cause instanceof Error ? cause.message : t('dailyProjects.operationFailed')); return false; }
    finally { setPendingAction(false); }
  };
  const bulk = async (command: string) => {
    if (busy || !selectedItems.length || !patches[command]) return;
    const action = capture(selectedItems);
    if (!isCurrent(action)) { setLocalError(t('dailyProjects.staleConfirmation')); return; }
    const success = await run(() => c.bulk(action.ids, patches[command], action.fingerprints));
    if (success) setSelected(current => new Set([...current].filter(id => !action.ids.includes(id))));
  };
  const changeDraft = (id: string, value: string) => {
    setDrafts(current => { const next = { ...current, [id]: { text: value, baseNote: current[id] ? current[id].baseNote : itemsById.get(id)?.state.note } }; if (!saveDrafts(c.accountId, next)) setStorageFailed(true); return next; });
    setNoteErrors(current => ({ ...current, [id]: '' }));
  };
  const saveNote = async (item: ReadingProjectItem) => {
    if (busy) return;
    const draft = drafts[item.id];
    if (draft && draft.baseNote !== item.state.note) { setNoteErrors(current => ({ ...current, [item.id]: t('dailyProjects.noteConflict') })); return; }
    const value = draft?.text ?? item.state.note;
    setPendingAction(true);
    try {
      await c.bulk([item.id], { note: value }, { [item.id]: item.fingerprint });
      setDrafts(current => {
        const next = { ...current };
        if (next[item.id]?.text !== value) {
          // Typing during this save keeps the newer draft based on our saved note.
          if (next[item.id]?.baseNote !== draft?.baseNote) return current;
          next[item.id] = { ...next[item.id], baseNote: value };
        } else delete next[item.id];
        if (!saveDrafts(c.accountId, next)) setStorageFailed(true);
        return next;
      });
      setNoteErrors(current => ({ ...current, [item.id]: '' }));
    } catch (cause) { setNoteErrors(current => ({ ...current, [item.id]: t('dailyProjects.noteFailed', { error: cause instanceof Error ? cause.message : t('dailyProjects.operationFailed') }) })); }
    finally { setPendingAction(false); }
  };
  const resolveNote = (item: ReadingProjectItem, keepDraft: boolean) => {
    setDrafts(current => {
      const next = { ...current };
      if (keepDraft && next[item.id]) next[item.id] = { text: next[item.id].text, baseNote: item.state.note };
      else delete next[item.id];
      if (!saveDrafts(c.accountId, next)) setStorageFailed(true);
      return next;
    });
    setNoteErrors(current => ({ ...current, [item.id]: '' }));
  };
  const confirmStar = () => { setLocalError(''); setConfirmationPage(0); setConfirmation(capture(selectedItems)); };
  const confirmResume = (batch: ReadingStarBatch) => {
    const remaining = batch.rows.filter(row => resumableProjectStatuses.has(row.status));
    const items = remaining.map(row => itemsById.get(String(row.repoId))).filter((item): item is ReadingProjectItem => Boolean(item));
    if (items.length !== remaining.length) { setLocalError(t('dailyProjects.staleConfirmation')); return; }
    setConfirmationPage(0); setConfirmation({ ...capture(items), batchId: batch.id, batchSignature: JSON.stringify(batch.rows) });
  };
  const execute = async () => {
    const action = confirmation;
    if (!action || busy) return;
    if (!isCurrent(action)) { setConfirmation(null); setLocalError(t('dailyProjects.staleConfirmation')); return; }
    setConfirmation(null);
    const success = await run(() => action.batchId ? c.resume(action.batchId) : c.start(action.ids, action.fingerprints));
    if (success) setSelected(current => new Set([...current].filter(id => !action.ids.includes(id))));
  };
  const confirmationPages = Math.max(1, Math.ceil((confirmation?.ids.length ?? 0) / 40));

  const narrow = geometry.width < 840;
  const ratio = Math.min(.5, Math.max(.22, browse.paneRatio ?? .3));
  const noteItem = itemsById.get(noteId);
  const activeFilters = [
    ...(browse.importOnly ? [{ key: 'importOnly', label: t('dailyProjects.scopes.import'), reset: { importOnly: false } }] : []),
    ...(browse.candidateOnly ? [{ key: 'candidateOnly', label: t('dailyProjects.scopes.candidates'), reset: { candidateOnly: false } }] : []),
    ...(['read', 'interest', 'note', 'star'] as const).filter(key => browse[key] !== 'all').map(key => ({ key, label: t(`dailyProjects.${key}.${browse[key]}`), reset: { [key]: 'all' } })),
  ];
  const task = c.batches.find(batch => batch.status === 'running') ?? c.batches.find(batch => batch.status === 'paused' || batch.syncError || batch.rows.some(row => ['uncertain', 'local-pending', 'failed'].includes(row.status)));
  const taskDone = task?.rows.filter(row => ['starred', 'already-starred', 'skipped'].includes(row.status)).length ?? 0;
  const singleAction = (command: string) => { if (focused && patches[command] && !busy) void run(() => c.bulk([focused.id], patches[command], { [focused.id]: focused.fingerprint })); };
  const resize = (clientX: number) => {
    const rect = gridRef.current?.getBoundingClientRect();
    if (rect) setBrowse(current => ({ ...current, paneRatio: Math.min(.5, Math.max(280 / rect.width, (clientX - rect.left) / rect.width)) }));
  };
  return <div className="reading-projects">
    <div className="reading-project-toolbar"><div>{onImport && <Button size="sm" variant="outline" onClick={onImport}><Upload className="mr-1.5 h-4 w-4"/>{t('dailyReading.page.import')}</Button>}<Button size="sm" variant={selectMode ? 'secondary' : 'ghost'} onClick={() => { setSelectMode(value => !value); if (selectMode) setSelected(new Set()); }}>{selectMode ? <X className="mr-1.5 h-4 w-4"/> : <CheckSquare className="mr-1.5 h-4 w-4"/>}{t(selectMode ? 'readingClean.exitSelection' : 'readingClean.selectMode')}</Button></div><div>{(task || c.batches.length > 0 || busy) && <Button size="sm" variant="ghost" onClick={() => setTasksOpen(true)}><Activity className="mr-1.5 h-4 w-4"/>{task ? `${t(`dailyProjects.batchState.${task.status}`)} ${taskDone}/${task.rows.length}` : t('readingClean.tasks')}</Button>}<DropdownMenu><DropdownMenuTrigger asChild><Button size="icon" variant="ghost" aria-label={t('readingClean.listActions')}><MoreHorizontal className="h-4 w-4"/></Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem disabled={busy || !(selectedItems.length || visible.length)} onSelect={() => void run(() => c.refreshStars(selectedItems.length ? selectedItems.map(item => item.id) : visible.map(item => item.id)))}>{t(selectedItems.length ? 'dailyProjects.refreshSelected' : 'dailyProjects.refreshPage', { count: selectedItems.length || visible.length })}</DropdownMenuItem></DropdownMenuContent></DropdownMenu></div></div>
    {(c.error || localError || storageFailed) && <p role="alert" className="rounded-lg border border-destructive/25 bg-destructive/5 p-3 text-sm text-destructive">{localError || c.error || t('dailyProjects.storageFailed')}</p>}
    {task && task.status !== 'running' && <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2 text-xs"><span>{task.syncError || task.pauseReason || t('readingClean.taskAttention')}</span><Button size="sm" variant="ghost" onClick={() => setTasksOpen(true)}>{t('readingClean.viewTask')}</Button></div>}
    <div ref={gridRef} className={`reading-project-grid ${narrow ? 'narrow' : ''}`} style={{ height: geometry.height, gridTemplateColumns: `minmax(280px, ${ratio * 100}%) 12px minmax(0, 1fr)` }}>
      <section className={`reading-list-card ${narrow && detailOpen ? 'reading-pane-hidden' : ''}`}>
        <div className="reading-scope-tabs" role="group" aria-label={t('dailyProjects.scopeLabel')}>{(['pending', 'processed'] as const).map(scope => <Button key={scope} size="sm" variant="ghost" aria-pressed={browse.scope === scope} onClick={() => { changeBrowse({ scope }); setDetailOpen(false); }}>{t(`dailyProjects.scopes.${scope}`)} <span className="ml-1 text-xs tabular-nums text-muted-foreground">{counts[scope]}</span></Button>)}</div>
        <div className="reading-list-head"><label><Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground"/><input aria-label={t('dailyProjects.search')} placeholder={t('readingClean.searchShort')} value={browse.query} onChange={event => changeBrowse({ query: event.target.value })}/></label><Button size="icon" variant="ghost" aria-label={t('readingClean.filters')} title={t('readingClean.filters')} onClick={() => setFiltersOpen(true)}><ListFilter className="h-4 w-4"/>{activeFilters.length > 0 && <span className="text-xs">{activeFilters.length}</span>}</Button></div>
        {activeFilters.length > 0 && <div className="reading-filter-chips">{activeFilters.map(filter => <button key={filter.key} onClick={() => changeBrowse(filter.reset)} aria-label={t('readingClean.removeFilter', { name: filter.label })}>{filter.label}<X className="h-3 w-3"/></button>)}<button onClick={() => changeBrowse({ importOnly: false, candidateOnly: false, read: 'all', interest: 'all', note: 'all', star: 'all' })}>{t('readingClean.clearFilters')}</button></div>}
        <div ref={listRef} aria-label={t('dailyProjects.projectList')} className="reading-project-list" onScroll={event => { const scroll = event.currentTarget.scrollTop; setBrowse(current => ({ ...current, scroll })); }}>{visible.map(item => {
          const [owner, ...name] = item.name.split('/');
          return <article key={item.id} className="reading-project-row" aria-current={focused?.id === item.id}>{selectMode && <input type="checkbox" aria-label={t('dailyProjects.selectProject', { name: item.name })} checked={selected.has(item.id)} disabled={busy} onChange={event => { const checked = event.target.checked; setSelected(current => { const next = new Set(current); if (checked) next.add(item.id); else next.delete(item.id); return next; }); }} className="mt-1 h-4 w-4 shrink-0 accent-primary"/>}<button type="button" aria-label={t('dailyProjects.inspectProject', { name: item.name })} aria-pressed={focused?.id === item.id} title={item.name} onClick={() => { setBrowse(current => ({ ...current, focusedId: item.id })); setDetailOpen(true); }}><span className="reading-project-name"><strong>{name.join('/') || item.name}</strong><span className="reading-project-owner">{owner}</span></span><span className="reading-project-summary block">{item.summary.replace(/\s+/g, ' ') || t('dailyProjects.noSummary')}</span><span className="reading-row-states">{item.starState === 'starred' && <span><Star fill="currentColor"/>{t('dailyProjects.star.starred')}</span>}{item.state.candidate && <span><Inbox/>{t('dailyProjects.candidate')}</span>}{item.state.interest !== 'neutral' && <span><Heart/>{t(`dailyProjects.interest.${item.state.interest}`)}</span>}{item.state.read && <Check aria-label={t('dailyProjects.read.read')}/>} {(item.state.note || drafts[item.id]) && <span title={t('dailyProjects.noteTitle')}><FileText/>{drafts[item.id] && drafts[item.id].text !== item.state.note && t('dailyProjects.draft')}</span>}</span></button></article>;
        })}{!visible.length && <p className="p-6 text-sm text-muted-foreground">{t('dailyProjects.empty')}</p>}</div>
        <div className="reading-list-footer"><span>{t('dailyProjects.matching', { count: filtered.length })}</span><div className="flex items-center gap-1"><Button size="sm" variant="ghost" disabled={!page} onClick={() => setBrowse(current => ({ ...current, page: page - 1, scroll: 0, focusedId: filtered[(page - 1) * 40]?.id || '' }))}>{t('dailyProjects.previous')}</Button><span className="tabular-nums" title={t('dailyProjects.page', { page: page + 1, pages })}>{page + 1}/{pages}</span><Button size="sm" variant="ghost" disabled={page + 1 >= pages} onClick={() => setBrowse(current => ({ ...current, page: page + 1, scroll: 0, focusedId: filtered[(page + 1) * 40]?.id || '' }))}>{t('dailyProjects.next')}</Button></div></div>
        {selectMode && <div className="reading-selection-bar"><div><span className="text-xs">{t('dailyProjects.selected', { count: selectedItems.length })}</span><Button size="sm" variant="ghost" disabled={busy || !filtered.length} onClick={() => setSelected(current => new Set([...current, ...filtered.map(item => item.id)]))}>{t('dailyProjects.selectMatching', { count: filtered.length })}</Button></div>{hiddenSelected > 0 && <p className="text-xs text-muted-foreground">{t('dailyProjects.hiddenSelected', { count: hiddenSelected })}</p>}<div><select aria-label={t('dailyProjects.bulkActions')} value="" disabled={busy || !selectedItems.length} onChange={event => void bulk(event.target.value)} className="h-9 min-w-0 flex-1 rounded-md border bg-background px-2 text-xs"><option value="">{t('dailyProjects.bulkActions')}</option>{Object.keys(patches).map(command => <option key={command} value={command}>{t(`dailyProjects.actions.${command}`)}</option>)}</select><Button size="sm" disabled={busy || !selectedItems.length} onClick={confirmStar}><Star className="mr-1 h-4 w-4"/>{t('dailyProjects.starSelected')}</Button><Button size="sm" variant="ghost" disabled={!selected.size || busy} aria-label={t('dailyProjects.clearSelection')} onClick={() => setSelected(new Set())}><X className="h-4 w-4"/></Button></div></div>}
      </section>
      <div className="reading-divider" role="separator" aria-label={t('readingClean.resizeColumns')} aria-orientation="vertical" aria-valuemin={22} aria-valuemax={50} aria-valuenow={Math.round(ratio * 100)} tabIndex={0} onKeyDown={event => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); setBrowse(current => ({ ...current, paneRatio: Math.min(.5, Math.max(.22, ratio + (event.key === 'ArrowLeft' ? -.02 : .02))) })); } }} onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId); resize(event.clientX); }} onPointerMove={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) resize(event.clientX); }} onPointerUp={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}/>
      <ReadingProjectDetail item={focused} busy={busy} draft={focused ? drafts[focused.id]?.text : undefined} onNotes={() => { if (focused) setNoteId(focused.id); }} onAction={singleAction} onRefreshStar={id => void run(() => c.refreshStars([id]))} narrow={narrow} onBack={() => setDetailOpen(false)} scroll={focused ? browse.detailScroll?.[focused.id] : 0} onScroll={value => { if (focused) setBrowse(current => ({ ...current, detailScroll: { ...current.detailScroll, [focused.id]: value } })); }} expanded={focused ? browse.expanded?.[focused.id] : []} onExpanded={keys => { if (focused) setBrowse(current => ({ ...current, expanded: { ...current.expanded, [focused.id]: keys } })); }} className={narrow && !detailOpen ? 'reading-pane-hidden' : ''}/>
    </div>
    <ReadingProjectFilters open={filtersOpen} onOpenChange={setFiltersOpen} browse={browse} onChange={changeBrowse} hasImport={!!c.lastImportId}/>
    <ReadingProjectNotes item={noteItem} open={!!noteId} onOpenChange={open => { if (!open) setNoteId(''); }} draft={noteItem ? drafts[noteItem.id]?.text : undefined} conflict={!!noteItem && !!drafts[noteItem.id] && drafts[noteItem.id].baseNote !== noteItem.state.note} busy={busy} error={noteItem ? noteErrors[noteItem.id] || '' : ''} onDraft={changeDraft} onSave={item => void saveNote(item)} onResolve={resolveNote}/>
    <Sheet open={tasksOpen} onOpenChange={setTasksOpen}><SheetContent closeLabel={t('dailyProjects.cancel')} className="overflow-y-auto"><SheetHeader><SheetTitle>{t('readingClean.tasks')}</SheetTitle><SheetDescription>{t('readingClean.tasksHint')}</SheetDescription></SheetHeader>{busy && <Button variant="outline" onClick={c.stop}>{t('dailyProjects.stop')}</Button>}<ReadingProjectBatches controller={c} onResume={batch => { setTasksOpen(false); confirmResume(batch); }}/>{c.message && <p role="status" className="text-sm">{c.message}</p>}</SheetContent></Sheet>
    <Dialog open={!!confirmation} onOpenChange={open => { if (!open) setConfirmation(null); }}><DialogContent closeLabel={t('dailyProjects.cancel')}><DialogTitle>{t(confirmation?.batchId ? 'dailyProjects.confirmResume' : 'dailyProjects.confirmStars')}</DialogTitle><DialogDescription>{t('dailyProjects.starConfirmation', { account: confirmation?.account, count: confirmation?.ids.length ?? 0 })}</DialogDescription><ul aria-label={t('dailyProjects.confirmationProjects')} className="max-h-72 space-y-1 overflow-y-auto text-sm">{confirmation?.names.slice(confirmationPage * 40, (confirmationPage + 1) * 40).map((name, index) => <li key={`${index}:${name}`} className="break-all">{name}</li>)}</ul>{confirmationPages > 1 && <div className="flex items-center justify-between"><Button size="sm" variant="outline" disabled={!confirmationPage} onClick={() => setConfirmationPage(current => current - 1)}>{t('dailyProjects.previous')}</Button><span className="text-xs">{t('dailyProjects.page', { page: confirmationPage + 1, pages: confirmationPages })}</span><Button size="sm" variant="outline" disabled={confirmationPage + 1 >= confirmationPages} onClick={() => setConfirmationPage(current => current + 1)}>{t('dailyProjects.next')}</Button></div>}<DialogFooter><Button variant="outline" onClick={() => setConfirmation(null)}>{t('dailyProjects.cancel')}</Button><Button disabled={busy || !confirmation?.ids.length} onClick={() => void execute()}>{t('dailyProjects.confirmStars')}</Button></DialogFooter></DialogContent></Dialog>
  </div>;
}
