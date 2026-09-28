import { useEffect, useRef, useState } from 'react';
import {
  Archive, Bot, Check, Copy, Download, ExternalLink, FolderPlus, History, Loader2,
  MoreHorizontal, PanelLeft, PanelRight, Pin, Plus, RotateCcw, Send, Square, Star, Trash2, Upload, X,
} from 'lucide-react';
import { useAIWorkbench } from '../hooks/useAIWorkbench';
import { useAIOrganization } from '../../repositories/hooks/useAIOrganization';
import { AIOrganizationPanel } from '../../repositories/components/AIOrganizationPanel';
import { useT } from '../../../i18n/useT';
import type { RepositoryChatSession } from '../../../types/repositoryChat';
import type { WorkbenchCandidate, WorkbenchProject, WorkbenchProposal } from '../../../types/aiWorkbench';
import { RequirementsEditor } from './RequirementsEditor';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Textarea } from '../../../components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../../../components/ui/dialog';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '../../../components/ui/sheet';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '../../../components/ui/dropdown-menu';
import MarkdownRenderer from '../../../components/MarkdownRenderer';
import { safeWriteText } from '../../../utils/clipboardUtils';

const download = (filename: string, content: string, type: string) => {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = filename; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
const selectClass = 'h-8 min-w-0 max-w-full rounded-md border border-border bg-background px-2 text-xs';
const sourceHref = (raw: string): string | undefined => {
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' && url.hostname === 'github.com' && !url.username && !url.password ? url.href : undefined;
  } catch { return undefined; }
};

function OperationPreview({ proposal, disabled, onExecute }: {
  proposal: WorkbenchProposal; disabled: boolean;
  onExecute: (proposal: WorkbenchProposal, restore: boolean) => void;
}) {
  const t = useT('chat');
  const [selection, setSelection] = useState<Record<string, boolean>>({});
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const selected = proposal.operations.map((op) => ({
    ...op, selected: selection[op.id] ?? op.selected, overrideLocked: overrides[op.id] ?? false,
  }));
  const restoring = (error?: string) => Boolean(error && (error === '__workbench_restore_running__' || error.startsWith('Restore ')));
  const pending = selected.filter((o) => o.selected && !restoring(o.error) && ['proposed', 'failed', 'unknown', 'running'].includes(o.status));
  const unstars = pending.filter((o) => o.kind === 'unstar').length;
  const succeeded = selected.filter((o) => o.selected && (o.status === 'success' || (restoring(o.error) && ['running', 'unknown', 'failed'].includes(o.status))));
  return (
    <section className="space-y-3 border-y border-border py-4">
      <h2 className="text-sm font-semibold">{t('workbench.operationPreview')}</h2>
      {proposal.operations.length === 0 && <p className="text-sm text-muted-foreground">{t('workbench.noMatches')}</p>}
      {selected.map((op) => (
        <article key={op.id} className="rounded-md border border-border p-3 text-xs">
          <label className="flex items-start gap-2">
            <input type="checkbox" checked={op.selected} disabled={disabled || !['proposed', 'failed', 'success', 'unknown', 'running'].includes(op.status)}
              onChange={(e) => setSelection({ ...selection, [op.id]: e.target.checked })} />
            <span className="min-w-0 flex-1 break-words font-semibold">{op.repository.full_name}</span>
            <span>{t(`workbench.${op.status}`)}</span>
          </label>
          <p className="my-2 break-words">{op.reason}</p>
          {op.kind === 'unstar' ? <p className="text-destructive">{t('workbench.unstar')}</p> : (
            <dl className="grid gap-2">
              {(['custom_category', 'custom_tags', 'custom_description'] as const).filter((field) => JSON.stringify(op.before[field]) !== JSON.stringify(op.after[field])).map((field) => (
                <div key={field}>
                  <dt className="font-medium">{t(`workbench.${field}`)}</dt>
                  <dd className="mt-1 grid grid-cols-2 gap-2">
                    <span className="whitespace-pre-wrap break-words text-muted-foreground">{JSON.stringify(op.before[field] ?? null)}</span>
                    <span className="whitespace-pre-wrap break-words">{JSON.stringify(op.after[field] ?? null)}</span>
                  </dd>
                </div>
              ))}
            </dl>
          )}
          {op.before.category_locked && <label className="mt-2 flex gap-2 text-destructive">
            <input type="checkbox" disabled={disabled} checked={op.overrideLocked} onChange={(e) => setOverrides({ ...overrides, [op.id]: e.target.checked })} />
            {t('workbench.overrideLock')}
          </label>}
          {op.error && <p role="alert" className="mt-2 text-destructive">{op.error}</p>}
        </article>
      ))}
      {proposal.syncError && <p role="alert" className="text-sm text-destructive">{t('workbench.syncError')}: {proposal.syncError}</p>}
      <div className="flex flex-wrap gap-2">
        {pending.length > 0 && <Button size="sm" variant={unstars ? 'destructive' : 'default'} disabled={disabled}
          onClick={() => onExecute({ ...proposal, operations: selected }, false)}>
          <Check className="h-4 w-4" />{unstars ? t('workbench.confirmUnstar', { count: unstars }) : t('workbench.confirmChanges', { count: pending.length })}
        </Button>}
        {succeeded.length > 0 && <Button size="sm" variant="outline" disabled={disabled}
          onClick={() => onExecute({ ...proposal, operations: selected }, true)}>
          <RotateCcw className="h-4 w-4" />{t('workbench.confirmRestore', { count: succeeded.length })}
        </Button>}
      </div>
      {succeeded.some((o) => o.kind === 'unstar') && <p className="text-xs text-muted-foreground">{t('workbench.starTimeWarning')}</p>}
    </section>
  );
}

export function AIWorkbench() {
  const w = useAIWorkbench();
  const organization = useAIOrganization({ filteredRepositories: w.repositories, selectedRepositoryIds: [], categoryId: 'all', sessionId: w.activeId ?? undefined });
  const [organizationOpen, setOrganizationOpen] = useState(false);
  const organizationT = useT('repositories');
  const t = useT('chat');
  const [draft, setDraft] = useState('');
  const [query, setQuery] = useState('');
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [mobileLeft, setMobileLeft] = useState(false);
  const [mobileRight, setMobileRight] = useState(false);
  const [tab, setTab] = useState<'results' | 'selected'>('results');
  const [starFilter, setStarFilter] = useState('all');
  const [batchId, setBatchId] = useState('');
  const [manage, setManage] = useState(false);
  const [editor, setEditor] = useState<{ kind: 'project' | 'newProject' | 'session'; title: string; project?: WorkbenchProject; session?: RepositoryChatSession } | null>(null);
  const [projectInstructions, setProjectInstructions] = useState('');
  const [projectConclusions, setProjectConclusions] = useState('');
  const [pendingStars, setPendingStars] = useState<Set<number>>(new Set());
  const importRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [follow, setFollow] = useState(true);
  const batch = w.data.searchBatches.find((b) => b.id === batchId) ?? w.data.searchBatches[w.data.searchBatches.length - 1];
  const starred = new Set(w.repositories.map((r) => r.id));
  const hasRight = Boolean(w.data.selectedRepositories.length || batch?.candidates.length);
  const busy = w.task.running;
  const activeBusy = busy && w.task.sessionId === w.activeId;
  const readonly = Boolean(w.active?.deletedAt || w.active?.archived);
  const visibleSessions = w.sessions.filter((s) => `${s.title} ${s.repoFullName}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  const candidates: WorkbenchCandidate[] = tab === 'results' ? batch?.candidates ?? []
    : w.data.selectedRepositories.map((repository) =>
      [...w.data.searchBatches].reverse().flatMap((b) => b.candidates).find((c) => c.repository.id === repository.id)
      ?? ({ repository, summary: repository.description ?? '', reasons: [], limitations: [], sources: [], status: 'candidate' }));

  useEffect(() => {
    if (follow) bottomRef.current?.scrollIntoView?.({ block: 'end' });
  }, [w.messages, w.proposals, follow]);

  const editProject = (project: WorkbenchProject) => {
    setProjectInstructions(project.instructions); setProjectConclusions(project.conclusions);
    setEditor({ kind: 'project', title: project.name, project });
  };
  const sessionRow = (s: RepositoryChatSession) => (
    <div key={s.id} className={`flex min-w-0 items-center rounded-md ${s.id === w.activeId ? 'bg-accent' : 'hover:bg-muted'}`}>
      <button className="flex min-w-0 flex-1 items-center gap-2 px-2 py-2 text-left text-xs" onClick={() => {
        if (w.mode !== 'legacy') { w.select(s.id); setMobileLeft(false); }
      }} disabled={w.mode === 'legacy'}>
        {s.pinned && <Pin className="h-3 w-3 shrink-0" />}
        {busy && s.id === w.task.sessionId && <Loader2 className="h-3 w-3 shrink-0 animate-spin" />}
        <span className="truncate">{s.title}</span>
      </button>
      <DropdownMenu><DropdownMenuTrigger asChild>
        <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" aria-label={t('workbench.actions')}><MoreHorizontal className="h-4 w-4" /></Button>
      </DropdownMenuTrigger><DropdownMenuContent align="start">
        {w.mode === 'legacy' ? <DropdownMenuItem onSelect={() => void w.guard(() => w.claim(s.id))}>{t('workbench.claim')}</DropdownMenuItem>
          : s.deletedAt ? <DropdownMenuItem onSelect={() => void w.guard(() => w.restoreSession(s.id))}>{t('workbench.restore')}</DropdownMenuItem>
            : <>
              <DropdownMenuItem onSelect={() => setEditor({ kind: 'session', title: s.title, session: s })}>{t('workbench.rename')}</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void w.guard(() => w.patchSession(s.id, { pinned: !s.pinned }))}>{t(s.pinned ? 'workbench.unpin' : 'workbench.pin')}</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void w.guard(() => w.patchSession(s.id, { archived: !s.archived }))}>{t(s.archived ? 'workbench.restore' : 'workbench.archive')}</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void w.guard(() => w.patchSession(s.id, { projectId: undefined }))}>{t('workbench.independent')}</DropdownMenuItem>
              {w.projects.filter((p) => !p.deletedAt).map((p) => <DropdownMenuItem key={p.id} onSelect={() => void w.guard(() => w.patchSession(s.id, { projectId: p.id }))}>{p.name}</DropdownMenuItem>)}
              <DropdownMenuItem className="text-destructive" onSelect={() => void w.guard(() => w.patchSession(s.id, { deletedAt: new Date().toISOString() }))}><Trash2 className="mr-2 h-3 w-3" />{t('workbench.trash')}</DropdownMenuItem>
            </>}
      </DropdownMenuContent></DropdownMenu>
    </div>
  );

  const history = (
    <div className="flex h-full min-h-0 flex-col gap-3 p-3">
      <div className="flex gap-2">
        <Button className="min-w-0 flex-1" size="sm" variant="secondary" onClick={() => void w.guard(() => w.createSession())}><Plus className="h-4 w-4" />{t('workbench.newChat')}</Button>
        <Button size="icon" variant="ghost" className="h-8 w-8" title={t('workbench.newProject')} aria-label={t('workbench.newProject')} onClick={() => setEditor({ kind: 'newProject', title: '' })}><FolderPlus className="h-4 w-4" /></Button>
      </div>
      <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('workbench.searchHistory')} aria-label={t('workbench.searchHistory')} className="h-8 text-xs" />
      <select className={selectClass} aria-label={t('workbench.history')} value={w.mode} onChange={(e) => w.setMode(e.target.value as typeof w.mode)}>
        {(['active', 'archived', 'trash', 'legacy'] as const).map((mode) => <option key={mode} value={mode}>{t(`workbench.${mode}`)}</option>)}
      </select>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {w.mode === 'active' && w.projects.filter((p) => !p.deletedAt && (p.name.toLowerCase().includes(query.toLowerCase()) || visibleSessions.some((s) => s.projectId === p.id))).map((p) => (
          <section key={p.id} className="mb-3">
            <div className="flex items-center gap-1">
              <button className="min-w-0 flex-1 truncate px-2 py-2 text-left text-xs font-semibold" onClick={() => editProject(p)}>{p.name}</button>
              <Button size="icon" variant="ghost" className="h-7 w-7" title={t('workbench.newChat')} aria-label={t('workbench.newChat')} onClick={() => void w.guard(() => w.createSession(p.id))}><Plus className="h-3 w-3" /></Button>
            </div>
            {visibleSessions.filter((s) => s.projectId === p.id).map(sessionRow)}
          </section>
        ))}
        {visibleSessions.filter((s) => w.mode !== 'active' || !s.projectId || !w.projects.some((p) => p.id === s.projectId && !p.deletedAt)).map(sessionRow)}
      </div>
      <div className="flex items-center gap-1 border-t border-border pt-2">
        <Button size="icon" variant="ghost" title={t('workbench.export')} aria-label={t('workbench.export')} onClick={() => void w.guard(async () => download('gsm-ai-workbench.json', JSON.stringify(await w.exportBackup(), null, 2), 'application/json'))}><Download className="h-4 w-4" /></Button>
        <Button size="icon" variant="ghost" title={t('workbench.import')} aria-label={t('workbench.import')} onClick={() => importRef.current?.click()}><Upload className="h-4 w-4" /></Button>
        <label className="ml-auto flex items-center gap-1 text-xs text-muted-foreground" title={t('workbench.retention')}>
          <History className="h-3 w-3" />
          <input type="number" min={1} max={365} value={w.settings.retainSessionDays} className="w-14 rounded border border-border bg-background p-1" aria-label={t('workbench.retention')}
            onChange={(e) => { const n = Number(e.target.value); if (n >= 1 && n <= 365) w.setSettings({ retainSessionDays: n }); }} />
        </label>
      </div>
    </div>
  );

  const results = (
    <div className="flex h-full min-h-0 flex-col gap-3 p-3">
      <div className="flex border-b border-border" role="tablist">
        {(['results', 'selected'] as const).map((item) => <button key={item} role="tab" aria-selected={tab === item} className={`flex-1 border-b-2 py-2 text-xs ${tab === item ? 'border-primary font-semibold' : 'border-transparent text-muted-foreground'}`} onClick={() => setTab(item)}>{t(`workbench.${item}`)}</button>)}
      </div>
      {tab === 'results' && w.data.searchBatches.length > 0 && <select value={batch?.id ?? ''} className={selectClass} aria-label={t('workbench.searchRound')} onChange={(e) => setBatchId(e.target.value)}>
        {w.data.searchBatches.map((b, i) => <option key={b.id} value={b.id}>{i + 1}. {b.requirements.purpose.slice(0, 40)}</option>)}
      </select>}
      <select className={selectClass} value={starFilter} aria-label={t('workbench.filter')} onChange={(e) => setStarFilter(e.target.value)}>
        {['all', 'starred', 'unstarred'].map((f) => <option key={f} value={f}>{t(`workbench.${f}`)}</option>)}
      </select>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto">
        {candidates.filter((c) => starFilter === 'all' || (starFilter === 'starred') === starred.has(c.repository.id)).map((candidate) => {
          const r = candidate.repository;
          return (
            <article key={r.id} className="space-y-2 rounded-md border border-border bg-card p-3 text-xs">
              <div className="flex items-start gap-2">
                <img className="h-7 w-7 shrink-0 rounded" src={r.owner.avatar_url} alt="" />
                <a href={`https://github.com/${r.full_name}`} target="_blank" rel="noreferrer" className="min-w-0 break-words text-sm font-semibold hover:underline">{r.full_name}</a>
              </div>
              <p className="break-words leading-relaxed">{candidate.summary || t('workbench.unknown')}</p>
              {candidate.reasons.length > 0 && <p className="break-words text-emerald-700 dark:text-emerald-400">{candidate.reasons.join(' / ')}</p>}
              {candidate.limitations.length > 0 && <p className="break-words text-muted-foreground">{candidate.limitations.join(' / ')}</p>}
              <div className="flex flex-wrap gap-x-3 gap-y-1 text-muted-foreground">
                <span className="flex items-center gap-1"><Star className="h-3 w-3" />{r.stargazers_count.toLocaleString()}</span>
                <span>{r.language || t('workbench.unknown')}</span>
                <span>{r.license || t('workbench.unknown')}</span>
                <span>{r.pushed_at?.slice(0, 10) || t('workbench.unknown')}</span>
              </div>
              <details>
                <summary className="cursor-pointer text-muted-foreground">{t(`workbench.${candidate.status}`)}</summary>
                <ul className="mt-2 space-y-2">
                  {candidate.sources.map((url) => <li key={url}><a className="break-all text-primary underline" href={sourceHref(url)} target="_blank" rel="noreferrer">{url}</a></li>)}
                </ul>
              </details>
              <div className="flex flex-wrap items-center gap-1">
                <Button size="icon" variant="ghost" className="h-7 w-7" disabled={starred.has(r.id) || pendingStars.has(r.id)} title={t('workbench.star')} aria-label={t('workbench.star')} onClick={() => {
                  setPendingStars((previous) => new Set(previous).add(r.id));
                  void w.guard(async () => { try { await w.star(r); } finally { setPendingStars((previous) => { const next = new Set(previous); next.delete(r.id); return next; }); } });
                }}><Star className={`h-4 w-4 ${starred.has(r.id) ? 'fill-current text-amber-500' : ''}`} /></Button>
                <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" disabled={readonly} onClick={() => void w.guard(() => w.addRepository(r))}><Plus className="h-3 w-3" />{t('workbench.context')}</Button>
                <Button size="icon" variant="ghost" className="h-7 w-7" disabled={!w.project || readonly} title={t('workbench.addToProject')} aria-label={t('workbench.addToProject')} onClick={() => void w.guard(() => w.addRepository(r, true))}><FolderPlus className="h-4 w-4" /></Button>
                <a className="inline-flex h-7 items-center gap-1 px-2 hover:underline" href={`https://github.com/${r.full_name}#readme`} target="_blank" rel="noreferrer">README<ExternalLink className="h-3 w-3" /></a>
                {tab === 'selected' && <Button size="icon" variant="ghost" className="h-7 w-7" aria-label={t('workbench.removeContext')} disabled={readonly} onClick={() => void w.guard(() => w.patchData(w.activeId!, { selectedRepositories: w.data.selectedRepositories.filter((x) => x.id !== r.id) }))}><X className="h-3 w-3" /></Button>}
              </div>
            </article>
          );
        })}
        {tab === 'selected' && <details className="text-xs">
          <summary className="cursor-pointer py-2">{t('workbench.addSelected')}</summary>
          {w.repositories.map((r) => <button key={r.id} className="block w-full truncate py-2 text-left hover:underline" onClick={() => void w.guard(() => w.addRepository(r))}>{r.full_name}</button>)}
        </details>}
        {tab === 'results' && batch && <Button size="sm" variant="outline" disabled={busy || readonly} onClick={() => void w.guard(() => w.search(batch.requirements, batch.nextPage))}>{t('workbench.moreResults')}</Button>}
      </div>
    </div>
  );

  return (
    <div className="flex h-[calc(100dvh-4.5rem)] min-h-[420px] flex-col overflow-hidden bg-background text-foreground">
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-3">
        <Button size="icon" variant="ghost" className="hidden h-8 w-8 lg:inline-flex" aria-label={t('workbench.history')} title={t('workbench.history')} onClick={() => setLeftOpen(!leftOpen)}><PanelLeft className="h-4 w-4" /></Button>
        <Button size="icon" variant="ghost" className="h-8 w-8 lg:hidden" aria-label={t('workbench.history')} onClick={() => setMobileLeft(true)}><PanelLeft className="h-4 w-4" /></Button>
        <Bot className="h-4 w-4 shrink-0 text-primary" />
        <h1 className="min-w-0 flex-1 truncate text-sm font-semibold">{w.active?.title ?? t('workbench.title')}</h1>
        {w.project && <button className="hidden max-w-40 truncate text-xs text-muted-foreground sm:block" onClick={() => editProject(w.project!)}>{w.project.name}</button>}
        <Button size="icon" variant="ghost" className="h-8 w-8" title={t('workbench.exportMarkdown')} aria-label={t('workbench.exportMarkdown')} disabled={!w.messages.length}
          onClick={() => download('conversation.md', w.messages.map((m) => `## ${m.role}\n\n${m.content}\n`).join('\n'), 'text/markdown')}><Download className="h-4 w-4" /></Button>
        <Button size="icon" variant="ghost" className="hidden h-8 w-8 xl:inline-flex" title={t('workbench.repositories')} aria-label={t('workbench.repositories')} onClick={() => { setRightOpen(!rightOpen); if (!hasRight) setTab('selected'); }}><PanelRight className="h-4 w-4" /></Button>
        <Button size="icon" variant="ghost" className="h-8 w-8 xl:hidden" aria-label={t('workbench.repositories')} onClick={() => { setMobileRight(true); if (!hasRight) setTab('selected'); }}><PanelRight className="h-4 w-4" /></Button>
      </header>
      <div className="flex min-h-0 flex-1">
        {leftOpen && <aside className="hidden w-60 shrink-0 border-r border-border lg:block">{history}</aside>}
        <main className="flex min-w-0 flex-1 flex-col">
          {(w.error || (w.task.error && w.task.sessionId === w.activeId)) && <p role="alert" className="border-b border-destructive/30 px-4 py-2 text-sm text-destructive">{w.error || w.task.error}</p>}
          {busy && <div className="flex items-center gap-2 border-b border-border px-4 py-2 text-xs" role="status">
            <Loader2 className="h-3 w-3 animate-spin" /><span className="min-w-0 flex-1 truncate">{t(`workbench.stage-${w.task.stage}`, { defaultValue: w.task.stage })}</span>
            {!activeBusy && <Button size="sm" variant="ghost" onClick={() => w.select(w.task.sessionId)}>{t('workbench.returnTask')}</Button>}
            <Button size="icon" variant="ghost" className="h-6 w-6" aria-label={t('workbench.stop')} onClick={w.stop}><Square className="h-3 w-3" /></Button>
          </div>}
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6" onScroll={(e) => { const x = e.currentTarget; setFollow(x.scrollHeight - x.scrollTop - x.clientHeight < 100); }}>
            <div className="mx-auto max-w-3xl space-y-5">
              {!w.messages.length && <div className="flex min-h-40 items-center justify-center"><h2 className="text-xl font-medium">{t('workbench.emptyQuestion')}</h2></div>}
              {w.messages.map((message) => (
                <article key={message.id} className={`min-w-0 text-sm [overflow-wrap:anywhere] ${message.role === 'user' ? 'ml-6 border-l-2 border-border pl-4' : ''}`}>
                  <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
                    <span>{message.role === 'user' ? t('repositoryChatSheet.you') : 'AI'}</span>
                    {message.status !== 'complete' && <span>{message.status === 'streaming' && !activeBusy ? t('workbench.interrupted') : t(`workbench.${message.status}`)}</span>}
                    <Button size="icon" variant="ghost" className="ml-auto h-6 w-6" aria-label={t('repositoryChatSheet.copy-answer')} title={t('repositoryChatSheet.copy-answer')} onClick={() => void w.guard(async () => { const result = await safeWriteText(message.content); if (!result.success) throw new Error(result.error); })}><Copy className="h-3 w-3" /></Button>
                  </div>
                  <MarkdownRenderer content={message.content} shouldRender breaks fontSize="small" />
                  {message.evidenceIds.length > 0 && <details className="mt-2 text-xs">
                    <summary className="cursor-pointer">{t('workbench.evidence')}</summary>
                    {w.evidence.filter((e) => message.evidenceIds.includes(e.id)).map((e) => <a key={e.id} className="mt-2 block break-all text-primary underline" href={sourceHref(e.url)} target="_blank" rel="noreferrer">{e.repoFullName}: {e.path ?? e.url}</a>)}
                  </details>}
                  {(['error', 'aborted'].includes(message.status) || (message.status === 'streaming' && !activeBusy)) && <Button size="sm" variant="ghost" disabled={busy || readonly} onClick={() => {
                    const prior = w.messages.slice(0, w.messages.findIndex((m) => m.id === message.id)).reverse().find((m) => m.role === 'user');
                    if (prior) void w.guard(() => w.send(prior.content, false));
                  }}><RotateCcw className="h-3 w-3" />{t('repositoryChatSheet.retry')}</Button>}
                </article>
              ))}
              {w.data.requirements && !readonly && <RequirementsEditor key={w.activeId} value={w.data.requirements} disabled={busy}
                depth={w.data.depth} searchedValue={w.data.searchBatches[w.data.searchBatches.length - 1]?.requirements}
                onSearch={async (r) => { setTab('results'); setRightOpen(true); await w.search(r); }} />}
              {w.proposals.map((p) => p.organization ? <section key={p.id} className="border-y border-border py-3">
                <p className="text-sm font-medium">{organizationT('aiOrganization.title')} · {organizationT('aiOrganization.revision', { count: p.organization.revision })}</p>
                <p className="my-2 text-xs text-muted-foreground">{organizationT('aiOrganization.rangeCount', { count: p.organization.entries.length })}</p>
                <Button variant="outline" size="sm" onClick={() => { organization.selectVersion(p.id); setOrganizationOpen(true); }}>{organizationT('aiOrganization.preview')}</Button>
              </section> : <OperationPreview key={p.id} proposal={p} disabled={busy || readonly} onExecute={(value, restore) => void w.guard(() => w.execute(value, restore))} />)}
              <AIOrganizationPanel open={organizationOpen} onOpenChange={setOrganizationOpen} controller={organization} />
              <div ref={bottomRef} />
            </div>
          </div>
          <form className="shrink-0 border-t border-border p-3 sm:px-5" onSubmit={(e) => {
            e.preventDefault();
            if (!draft.trim() || busy || readonly) return;
            const question = draft; setDraft(''); setFollow(true);
            void w.guard(() => w.send(question, manage));
          }}>
            <Textarea value={draft} disabled={readonly} onChange={(e) => setDraft(e.target.value)} className="max-h-40 min-h-20 resize-y" aria-label={t('repositoryChatSheet.question')} placeholder={t('workbench.emptyQuestion')} />
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <select className={`${selectClass} max-w-36`} value={w.data.scope} disabled={busy || readonly} aria-label={t('workbench.scope')} onChange={(e) => void w.guard(async () => {
                const record = w.active ?? await w.createSession();
                await w.patchData(record.id, { scope: e.target.value as typeof w.data.scope });
                setManage(false);
              })}>{['github', 'selected', 'project', 'library'].map((s) => <option key={s} value={s}>{t(`workbench.scope-${s}`)}</option>)}</select>
              <select className={`${selectClass} max-w-40`} aria-label={t('workbench.model')} value={w.modelId} disabled={busy} onChange={(e) => w.setSettings({ chatConfigId: e.target.value || null })}>
                <option value="">{t('workbench.model')}</option>
                {w.aiConfigs.map((c) => <option key={c.id} value={c.id}>{c.name} · {c.model}</option>)}
              </select>
              <select className={selectClass} value={w.data.depth} disabled={busy || readonly} aria-label={t('repositoryChatSheet.task-depth')} onChange={(e) => void w.guard(async () => {
                const record = w.active ?? await w.createSession();
                await w.patchData(record.id, { depth: e.target.value as typeof w.data.depth });
              })}>{['quick', 'standard', 'deep'].map((d) => <option key={d} value={d}>{t(`workbench.${d}`)}</option>)}</select>
              {w.data.scope === 'library' && <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={manage} onChange={(e) => setManage(e.target.checked)} disabled={busy} />{t('workbench.manage')}</label>}
              <Button type={busy ? 'button' : 'submit'} size="icon" className="ml-auto h-8 w-8" disabled={!busy && (!draft.trim() || readonly)} onClick={busy ? w.stop : undefined}
                aria-label={t(busy ? 'workbench.stop' : 'workbench.send')} title={t(busy ? 'workbench.stop' : 'workbench.send')}>
                {busy ? <Square className="h-3 w-3" /> : <Send className="h-4 w-4" />}
              </Button>
            </div>
          </form>
        </main>
        {rightOpen && (hasRight || tab === 'selected') && <aside className="hidden w-[320px] shrink-0 border-l border-border xl:block">{results}</aside>}
      </div>
      <Sheet open={mobileLeft} onOpenChange={setMobileLeft}><SheetContent side="left" className="w-80 max-w-[90vw] p-0"><SheetHeader className="px-4 pt-4"><SheetTitle>{t('workbench.history')}</SheetTitle></SheetHeader>{history}</SheetContent></Sheet>
      <Sheet open={mobileRight} onOpenChange={setMobileRight}><SheetContent side="right" className="w-96 max-w-[95vw] p-0"><SheetHeader className="px-4 pt-4"><SheetTitle>{t('workbench.repositories')}</SheetTitle></SheetHeader>{results}</SheetContent></Sheet>
      <input ref={importRef} type="file" accept="application/json,.json" className="hidden" onChange={(e) => {
        const file = e.target.files?.[0]; e.target.value = '';
        if (file) void w.guard(async () => { if (file.size > 25 * 1024 * 1024) throw new Error(t('workbench.backupTooLarge')); await w.importBackup(JSON.parse(await file.text())); });
      }} />
      <Dialog open={Boolean(editor)} onOpenChange={(open) => !open && setEditor(null)}><DialogContent>
        <DialogHeader><DialogTitle>{t(editor?.kind === 'session' ? 'workbench.rename' : 'workbench.project')}</DialogTitle></DialogHeader>
        <Input value={editor?.title ?? ''} aria-label={t('workbench.name')} onChange={(e) => setEditor((x) => x && ({ ...x, title: e.target.value }))} />
        {editor?.kind === 'project' && <>
          <label className="text-sm">{t('workbench.instructions')}<Textarea value={projectInstructions} onChange={(e) => setProjectInstructions(e.target.value)} className="mt-1" /></label>
          <label className="text-sm">{t('workbench.conclusions')}<Textarea value={projectConclusions} onChange={(e) => setProjectConclusions(e.target.value)} className="mt-1" /></label>
          <p className="text-xs text-muted-foreground">{editor.project?.repositories.length ?? 0} {t('workbench.repositories')}</p>
        </>}
        <DialogFooter className="gap-2">
          {editor?.project && <Button variant="destructive" disabled={busy} onClick={() => void w.guard(async () => { await w.deleteProject(editor.project!); setEditor(null); })}><Archive className="h-4 w-4" />{t('workbench.deleteProject')}</Button>}
          <Button disabled={!editor?.title.trim()} onClick={() => void w.guard(async () => {
            if (!editor) return;
            if (editor.kind === 'newProject') await w.createProject(editor.title);
            else if (editor.session) await w.patchSession(editor.session.id, { title: editor.title.trim() });
            else if (editor.project) await w.saveProject({ ...editor.project, name: editor.title.trim(), instructions: projectInstructions, conclusions: projectConclusions });
            setEditor(null);
          })}>{t('workbench.save')}</Button>
        </DialogFooter>
      </DialogContent></Dialog>
    </div>
  );
}
