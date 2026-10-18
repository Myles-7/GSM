import { useSyncExternalStore } from 'react';
import { AlertCircle, Check, ChevronRight, Loader2 } from 'lucide-react';
import { useT } from '../../i18n/useT';
import type { OrganizationController } from '../DualOrganizationWizard';
import { organizationProgress, modelProblemKey } from './organizationPresentation';
import { agySchedulerStatus } from '../../services/agyClient';

export function OrganizationProgress({ controller: c }: { controller: OrganizationController; summaryOnly?: boolean }) {
  const t = useT('repositories');
  const pool = useSyncExternalStore(agySchedulerStatus.subscribe, agySchedulerStatus.snapshot);
  const dual = c.proposal?.organization?.dual;
  const total = dual?.understanding.length ?? c.count;
  const progress = organizationProgress(dual, total); const metrics = dual?.progress;
  const usesAgy = c.aiConfigs.find(config => config.id === c.configId)?.provider === 'agy-cli';
  const effectiveConcurrency = usesAgy && pool ? Math.min(metrics?.effectiveConcurrency ?? metrics?.concurrency ?? 5, pool.effective) : metrics?.effectiveConcurrency ?? 0;
  const running = c.busy ? usesAgy && pool ? Math.min(metrics?.running ?? 0, pool.running) : metrics?.running ?? 0 : 0;
  const phases = ['understanding', 'structure', 'assignments'] as const;
  const phaseIndex = phases.indexOf(dual?.phase === 'review' ? 'assignments' : dual?.phase ?? 'understanding');
  return <section className="shrink-0 space-y-2 border-b bg-muted/20 px-4 py-3 sm:px-6">
    <div className="flex flex-wrap items-center gap-2">{phases.map((phase, index) => <div key={phase} className={`flex items-center gap-1.5 text-xs ${phaseIndex === index ? 'font-medium' : 'text-muted-foreground'}`}>
      {index < phaseIndex ? <Check className="h-3.5 w-3.5" /> : c.busy && index === phaseIndex ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <span className="flex h-4 w-4 items-center justify-center rounded-full bg-muted text-[10px]">{index + 1}</span>}
      {t(phase === 'understanding' && c.analysisDepth === 'quick' ? 'organizationRuntime.prepare' : `dualOrganization.phase.${phase}`)}{index < 2 && <ChevronRight className="h-3 w-3" />}
    </div>)}<span className="ml-auto text-xs text-muted-foreground">{t(`organizationSpeed.${dual?.verificationIds ? 'deep' : c.analysisDepth}Short`)}</span></div>
    {progress.blocked && <div role="alert" className="border-l-2 border-destructive bg-destructive/5 px-3 py-2"><p className="flex items-center gap-2 text-sm font-medium"><AlertCircle className="h-4 w-4" />{t('organizationUx.paused')}</p><p className="mt-1 break-words text-xs">{t(modelProblemKey(progress.blocked.code))} · {progress.blocked.code}</p></div>}
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground"><span>{t('organizationRuntime.coverage', { count: total, total: c.count })}</span><span>{t('dualOrganization.understood', { count: progress.understood })}</span><span>{t('organizationSpeed.reused', { count: metrics?.reused ?? 0 })}</span><span className={progress.failed ? 'text-destructive' : ''}>{t('dualOrganization.failed', { count: progress.failed })}</span><span>{t('organizationUx.uncertainCount', { count: progress.uncertain })}</span>
      {dual?.phase === 'structure' && metrics?.summaryTotal !== undefined && <span>{t('organizationRecovery.summary', { done: (metrics.summaryCompleted ?? 0) + (metrics.summaryFallback ?? 0), total: metrics.summaryTotal, success: metrics.summaryCompleted ?? 0, fallback: metrics.summaryFallback ?? 0 })}</span>}
    </div>
    <div className="grid gap-2 border-t pt-2 sm:grid-cols-2">{(['purpose', 'technology'] as const).map(id => {
      const entries = dual?.schemes[id].entries ?? [];
      const verified = entries.filter(entry => (entry.verification === 'verified' || entry.manual) && entry.categoryId && entry.disposition !== 'insufficient').length;
      const failed = entries.filter(entry => entry.verification === 'failed').length;
      const uncertain = entries.filter(entry => entry.verification === 'verified' && entry.disposition === 'insufficient').length;
      return <div key={id} className="min-w-0 space-y-1"><div className="flex flex-wrap items-center justify-between gap-1 text-xs"><span className="font-medium">{t(`dualOrganization.${id}`)}</span><span className="text-muted-foreground">{t(dual?.schemes[id].ready ? 'dualOrganization.structureReady' : 'dualOrganization.structurePending')}</span></div><p className="text-[11px] text-muted-foreground">{t('organizationRuntime.assignmentCounts', { verified, failed, pending: Math.max(0, total - verified - failed - uncertain), uncertain, total })}</p><div className="flex h-1 overflow-hidden rounded bg-muted" role="progressbar" aria-label={t(`dualOrganization.${id}`)} aria-valuemin={0} aria-valuemax={total} aria-valuenow={verified + failed + uncertain}><span className="bg-primary" style={{ width: `${verified / Math.max(1, total) * 100}%` }} /><span className="bg-destructive" style={{ width: `${failed / Math.max(1, total) * 100}%` }} /><span className="bg-muted-foreground/40" style={{width:`${uncertain / Math.max(1,total) * 100}%`}} /></div></div>;
    })}</div>
    {metrics && <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground"><span>{t('organizationSpeed.active', { running, queued: c.busy ? metrics.queued : 0, reading: c.busy ? metrics.reading : 0 })}</span><span>{t('organizationSpeed.effective', { count: effectiveConcurrency, limit: metrics.concurrency })}</span><span>{t('organizationSpeed.attempts', { count: metrics.requests })}</span>{pool && usesAgy && <span>{t('organizationSpeed.globalPool', { running: pool.running, queued: pool.queued, limit: pool.effective })}</span>}</div>}
    {!!dual?.errors.length && <details className="text-xs"><summary className="cursor-pointer text-destructive">{t('dualOrganization.stageErrors', { count: dual.errors.length })}</summary><div className="max-h-24 overflow-y-auto">{[...new Set(dual.errors.map(error => `${error.stage}: ${error.message}`))].map(error => <p key={error} className="mt-1 break-words">{error}</p>)}</div></details>}
  </section>;
}
