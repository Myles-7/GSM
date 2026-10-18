import { useEffect, useState, useSyncExternalStore } from 'react';
import { AlertCircle, Check, ChevronDown, ChevronRight, Copy, Loader2, RefreshCw } from 'lucide-react';
import { Button } from '../ui/button';
import { useT } from '../../i18n/useT';
import type { OrganizationController } from '../DualOrganizationWizard';
import { organizationRunEvents } from '../../services/aiOrganizationRunEvents';
import { agySchedulerStatus } from '../../services/agyClient';

export function OrganizationExecutionDetails({ controller: c }: { controller: OrganizationController }) {
  const t = useT('repositories'); const id = c.proposal?.id; const owner = c.proposal?.ownerId;
  const traces = useSyncExternalStore(organizationRunEvents.subscribe, () => organizationRunEvents.snapshot(id));
  const pool = useSyncExternalStore(agySchedulerStatus.subscribe, agySchedulerStatus.snapshot);
  const quarantined = c.aiConfigs.find(config => config.id === c.configId)?.provider === 'agy-cli' && pool?.quarantined;
  const [expanded, setExpanded] = useState<string | null>(null); const [now, setNow] = useState(Date.now());
  const [monitorOpen, setMonitorOpen] = useState(false);
  useEffect(() => { if (owner && id) void organizationRunEvents.load(owner, id); }, [owner, id]);
  useEffect(() => { if (!c.busy) return; const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, [c.busy]);
  const runId = c.proposal?.organization?.dual?.execution?.runId;
  const current = traces.filter(row => !runId || row.runId === runId);
  const ordered = [...current].sort((a, b) => Number(!b.endedAt) - Number(!a.endedAt) || b.createdAt - a.createdAt);
  const copy = (value: string) => { void navigator.clipboard?.writeText(value).catch(() => {}); };
  return <aside className="flex min-h-0 shrink-0 flex-col border-t bg-muted/10 xl:w-[340px] xl:border-l xl:border-t-0" aria-label={t('organizationRuntime.title')}>
    <div className="flex shrink-0 items-center justify-between gap-2 border-b px-3 py-2"><button type="button" className="flex items-center gap-1 text-xs font-medium xl:pointer-events-none" aria-expanded={monitorOpen} onClick={() => setMonitorOpen(value => !value)}><ChevronRight className={`h-3 w-3 xl:hidden ${monitorOpen ? 'rotate-90' : ''}`} />{t('organizationRuntime.title')}</button><span className="text-[11px] text-muted-foreground">{current.filter(row => row.state === 'verified').length}/{current.length}</span></div>
    {c.recoverableResults && <Button variant="outline" size="sm" disabled={c.busy || c.readonly} onClick={() => void c.retrySave()}>{t('organizationRecovery.saveOnly')}</Button>}
    <div className={`max-h-[240px] min-h-0 flex-1 overflow-y-auto xl:max-h-none ${monitorOpen ? '' : 'hidden xl:block'}`}>
      {!ordered.length && <p className="px-3 py-4 text-xs text-muted-foreground">{t('organizationRuntime.noRequests')}</p>}
      {ordered.slice(0, 100).map(row => {
        const opened = expanded === row.id; const seconds = Math.max(0, Math.floor(((row.endedAt ?? now) - row.createdAt) / 1000));
        const stage = row.key.split(':')[0]; const index = /^assignments:both:(\d+)$/.exec(row.key)?.[1];
        return <article key={row.id} className="border-b px-3 py-2">
          <button type="button" className="flex w-full min-w-0 items-start gap-2 text-left" aria-expanded={opened} onClick={() => setExpanded(opened ? null : row.id)}>
            {row.state === 'failed' ? <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" /> : row.state === 'verified' ? <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" /> : !row.endedAt ? <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin" /> : <ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
            <span className="min-w-0 flex-1"><span className="block break-words text-xs font-medium">{t(`organizationRuntime.stage.${stage}`, { defaultValue: stage })}{index !== undefined ? ` ${Number(index) + 1}` : row.key.startsWith('structure:') ? ` · ${t(`dualOrganization.${row.key.split(':')[1]}`)}` : ''}</span><span className="mt-1 block break-all text-[11px] text-muted-foreground">{row.model} · {row.effort ?? '—'}</span></span>
            <span className="shrink-0 text-right text-[11px] text-muted-foreground">{t(`organizationRuntime.state.${row.state}`)}<span className="mt-1 block">{seconds}s</span></span>
          </button>
          {row.code && <p className="mt-1 break-all text-[11px] text-destructive">{row.code}</p>}
          {row.originalCode && <p className="mt-1 break-all text-[11px] text-muted-foreground">{t('organizationRecovery.originalError', { code: row.originalCode })}</p>}
          {row.warning && <p className="mt-1 break-all text-[11px] text-amber-700 dark:text-amber-400">{row.warning}</p>}
          {opened && <div className="mt-2 space-y-2 border-t pt-2">
            <p className="break-words text-[11px] text-muted-foreground">{t('organizationRuntime.requestInfo', { attempt: row.attempt, count: row.repositoryIds.length, chars: row.inputChars })}</p>
            <p className="text-[11px] text-muted-foreground">{t('organizationRuntime.timing', { queue: Math.floor((row.queueMs ?? 0) / 1000), init: Math.floor((row.initMs ?? 0) / 1000), model: Math.max(0, Math.floor((row.modelMs ?? (row.startedAt ? (row.endedAt ?? now) - row.startedAt : 0)) / 1000)), cleanup: Math.floor((row.cleanupMs ?? 0) / 1000) })}</p>
            <p className="text-[11px] text-muted-foreground">{row.lastOutputAt ? t('organizationRuntime.lastOutput', { seconds: Math.max(0, Math.floor((now - row.lastOutputAt) / 1000)) }) : t('organizationRuntime.waitingOutput')}</p>
            {row.error && <p className="break-words text-xs text-destructive">{row.error}</p>}
            <div className="flex items-center justify-between gap-2"><span className="text-[11px] text-muted-foreground">{t('organizationRuntime.publicOutput')}</span><Button size="icon" variant="ghost" className="h-6 w-6" title={t('organizationRuntime.copy')} aria-label={t('organizationRuntime.copy')} onClick={() => copy(JSON.stringify({ ...row, output: row.output }, null, 2))}><Copy className="h-3 w-3" /></Button></div>
            {row.output && <pre className="max-h-[220px] overflow-y-auto whitespace-pre-wrap break-all rounded border bg-background p-2 text-[11px] leading-5">{row.output}</pre>}
            {row.state === 'failed' && !c.busy && !c.readonly && <Button size="sm" variant="outline" className="h-7 text-xs" disabled={!!quarantined} onClick={() => void (index !== undefined ? c.retryBatch(Number(index)) : c.retry())}><RefreshCw className="mr-1.5 h-3 w-3" />{t(index !== undefined ? 'organizationRuntime.retryBatch' : 'organizationUx.resume')}</Button>}
          </div>}
        </article>;
      })}
      {current.length > 100 && <p className="px-3 py-2 text-[11px] text-muted-foreground">{t('organizationRuntime.recentOnly')}</p>}
    </div>
    {!c.busy && c.proposal?.organization?.dual?.blocked && <details className="shrink-0 border-t px-3 py-2 text-xs" open><summary className="flex cursor-pointer items-center gap-1 text-destructive"><ChevronDown className="h-3 w-3" />{t('organizationRuntime.blocked')}</summary><p className="mt-2 break-all text-xs">{c.proposal.organization.dual.blocked.code} · {c.proposal.organization.dual.blocked.message}</p><Button size="sm" variant="ghost" className="mt-1 h-7" onClick={() => copy(JSON.stringify(c.proposal?.organization?.dual?.blocked))}><Copy className="mr-1 h-3 w-3" />{t('organizationRuntime.copy')}</Button></details>}
  </aside>;
}
