import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { agySchedulerStatus } from '../services/agyClient';
import { ArrowRight, Check, ChevronRight, FolderTree, MessageSquare, Plus, RefreshCw, RotateCcw, Square } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog';
import { Button } from './ui/button';
import { Textarea } from './ui/textarea';
import { useT } from '../i18n/useT';
import type { useAIOrganization } from '../hooks/useAIOrganization';
import { isAIConfigAvailable } from '../utils/aiConfig';
import { OrganizationModelReadiness } from './organization/OrganizationModelReadiness';
import { modelProblemKey, organizationProgress } from './organization/organizationPresentation';
import { OrganizationReview } from './organization/OrganizationReview';
import { emptyReplacedCategories } from '../services/aiOrganizationDualStructure';
import { OrganizationSetup } from './organization/OrganizationSetup';
import { OrganizationGeneration } from './organization/OrganizationGeneration';
import { OrganizationApplicationReview } from './organization/OrganizationApplicationReview';
import { LegacyOrganizationReview } from './organization/LegacyOrganizationReview';

export type OrganizationController = ReturnType<typeof useAIOrganization>;
export function DualOrganizationWizard({ open, onOpenChange, controller: c }: { open: boolean; onOpenChange: (value: boolean) => void; controller: OrganizationController }) {
  const t = useT('repositories'); const [step, setStep] = useState(1); const [refining, setRefining] = useState(false); const [regenerating, setRegenerating] = useState(false);
  const [confirmation, setConfirmation] = useState<string | null>(null);
  const draft = c.proposal?.organization; const dual = draft?.dual; const total = draft?.scope.repositoryIds.length ?? c.count;
  const externalAgent = draft?.externalAgent;
  const progress = useMemo(() => organizationProgress(dual, total), [dual, total]);
  const pool = useSyncExternalStore(agySchedulerStatus.subscribe, agySchedulerStatus.snapshot);
  const config = c.aiConfigs.find(config => config.id === c.configId); const quarantined = config?.provider === 'agy-cli' && !!pool?.quarantined;
  const modelReady = isAIConfigAvailable(config) && !quarantined;
  const phase = dual?.phase ?? 'understanding'; const editable = !!dual && ['ready', 'interrupted'].includes(draft!.status) && !c.busy && !c.readonly;
  const legacy = !!draft && !dual;
  const structures = dual ? Object.values(dual.schemes).filter(scheme => scheme.selected).flatMap(scheme => scheme.structureOperations?.filter(op => ['pending', 'conflict'].includes(op.status)) ?? []) : [];
  const hasApplied = !!dual && Object.values(dual.schemes).some(scheme => scheme.application?.status === 'applied');
  const selected = dual ? Object.values(dual.schemes).filter(s => s.selected).flatMap(s => s.entries.filter(e => e.selected && e.disposition === 'move' && e.status === 'pending')) : [];
  const retirements = dual && dual.outcome !== 'empty' ? Object.values(dual.schemes).filter(s => s.selected).flatMap(s => s.cleanupReplaced ? emptyReplacedCategories(s) : s.retireCategoryIds ?? []) : [];
  const failedEntries = dual ? Object.values(dual.schemes).some(s => s.entries.some(e => e.error || e.disposition === 'insufficient')) : false;
  const revision = draft?.revision; const status = draft?.status; const blocked = !!progress.blocked;
  const stageDone = phase === 'structure' ? Object.values(dual?.schemes ?? {}).filter(s => s.ready).length : phase === 'assignments' ? Math.min(...Object.values(dual?.schemes ?? {}).map(s => s.entries.filter(e => e.manual || e.verification === 'verified').length)) : c.analysisDepth === 'quick' ? dual?.understanding.length ?? 0 : progress.done;
  const stageTotal = phase === 'structure' ? 2 : total;
  useEffect(() => { setStep(!status ? 1 : status === 'generating' || blocked || status === 'interrupted' && ['understanding', 'structure'].includes(phase) ? 2 : 3); }, [status, revision, blocked, phase]);
  useEffect(() => { setRefining(false); setRegenerating(false); setConfirmation(null); }, [c.proposal?.id]);
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="flex h-[calc(100dvh-2rem)] max-h-[920px] w-[calc(100%_-_1rem)] max-w-[1440px] flex-col gap-0 overflow-hidden p-0 !duration-0 sm:w-[calc(100%_-_3rem)]">
      <DialogHeader className="shrink-0 border-b px-4 py-4 pr-12 sm:px-6"><DialogTitle className="flex items-center gap-2 text-base"><FolderTree className="h-5 w-5" />{t('aiOrganization.title')}<span className="ml-2 text-xs font-normal text-muted-foreground">{total} {t('dualOrganization.repositories')}</span></DialogTitle><DialogDescription className="sr-only">{t('aiOrganization.description')}</DialogDescription></DialogHeader>
      <nav aria-label={t('dualOrganization.steps')} className="flex shrink-0 items-center gap-1 border-b bg-muted/10 px-3 py-1 sm:gap-3 sm:px-6">{[1, 2, 3].map(value => <button key={value} type="button" disabled={value !== 1 && !dual || c.busy && value === 1} aria-current={step === value ? 'step' : undefined} onClick={() => setStep(value)} className={`flex min-h-9 min-w-0 flex-1 items-center justify-center gap-2 border-b-2 px-1 py-2 text-xs sm:flex-none sm:justify-start sm:px-3 ${step === value ? 'border-primary font-medium text-foreground' : 'border-transparent text-muted-foreground'} disabled:opacity-40`}><span className={`flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full text-[10px] ${step === value ? 'bg-primary text-primary-foreground' : 'bg-muted'}`}>{value}</span><span className="min-w-0 break-words">{t(`dualOrganization.step${value}`)}</span></button>)}</nav>
      {externalAgent && dual && <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-b bg-muted/20 px-4 py-2 text-xs sm:px-6"><span className="font-medium">{t('localAgentOrganization.source')}</span>{(['purpose', 'technology'] as const).map(id => <span key={id} className="text-muted-foreground">{t(`dualOrganization.${id}Short`)} {dual.schemes[id].entries.filter(row => row.manual || row.verification === 'verified').length}/{total}</span>)}<span className="text-muted-foreground">{t('localAgentOrganization.confirmInGsm')}</span>{externalAgent.progress && <p className="basis-full break-words text-muted-foreground">{externalAgent.progress}</p>}</div>}
      {!externalAgent && config?.provider === 'agy-cli' && <details className="shrink-0 border-b" open={blocked || quarantined || undefined}><summary className="cursor-pointer px-5 py-2 text-xs text-muted-foreground">{t('organizationUx.modelStatus')} · {t('categoryTree.manualAvailable')}</summary><OrganizationModelReadiness disabled={c.busy} needsRepair={blocked || quarantined} /></details>}
      {legacy && step !== 1 ? <LegacyOrganizationReview controller={c} /> : step === 1 ? <OrganizationSetup controller={c} /> : step === 2 ? <OrganizationGeneration controller={c} /> : <div className="relative flex min-h-0 flex-1 flex-col"><OrganizationReview controller={c} />{confirmation && <aside className="absolute inset-y-0 right-0 z-20 flex w-full max-w-[480px] flex-col border-l bg-background shadow-lg" aria-label={t('categoryTree.confirmTitle')} onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setConfirmation(null); } }}><OrganizationApplicationReview controller={c} revision={confirmation} onCancel={() => setConfirmation(null)} /></aside>}</div>}
      <footer className={`shrink-0 space-y-3 border-t bg-muted/20 px-4 py-3 sm:px-6 ${confirmation ? 'hidden' : ''}`}>
        {c.error && !progress.blocked && <p role="alert" className="max-h-16 overflow-y-auto break-words text-xs text-destructive">{c.error.startsWith('AGY_') ? t(modelProblemKey(c.error)) : c.error}</p>}
        {c.proposal?.syncError && <p role="alert" className="text-xs text-destructive">{t('aiOrganization.syncFailed')}</p>}
        {refining && editable && step === 3 && <div className="flex flex-col gap-2 sm:flex-row"><Textarea autoFocus value={c.instruction} onChange={e => c.setInstruction(e.target.value)} maxLength={10000} className="min-h-16 flex-1 resize-none text-sm" placeholder={t('organizationUx.localAdjustmentPlaceholder')} /><div className="flex items-start gap-2"><Button size="sm" disabled={!modelReady || !c.instruction.trim()} onClick={() => void c.refine()}>{t('organizationUx.adjustLocal')}</Button><Button size="icon" variant="outline" className="h-8 w-8" title={t('organizationUx.regenerate')} aria-label={t('organizationUx.regenerate')} disabled={!modelReady} onClick={() => setRegenerating(value => !value)}><RotateCcw className="h-3.5 w-3.5" /></Button></div></div>}
        {regenerating && editable && step === 3 && <div role="alert" className="flex flex-wrap items-center gap-2 border-l-2 border-amber-500 bg-amber-500/5 px-3 py-2"><p className="min-w-0 flex-1 text-xs leading-5">{t('organizationUx.regenerateWarning', { count: total })}</p><Button size="sm" variant="outline" onClick={() => setRegenerating(false)}>{t('organizationUx.cancel')}</Button><Button size="sm" disabled={!modelReady} onClick={() => void c.generate()}>{t('organizationUx.confirmRegenerate')}</Button></div>}
        {step === 3 && retirements.length > 0 && <p className="text-xs text-muted-foreground">{t('organizationUx.cleanupCount', { count: retirements.length })}</p>}
        <div className="flex flex-wrap items-center gap-2">
          {dual?.phase === 'understanding' && progress.understood > 0 && progress.pending > 0 && !c.readonly && <Button size="sm" variant="outline" title={t('organizationSpeed.deferPendingHint')} onClick={() => void c.continueCompleted()}>{t('organizationSpeed.deferPending', { count: progress.pending })}<ArrowRight className="ml-1.5 h-3.5 w-3.5" /></Button>}
          {c.busy ? <Button size="sm" variant="outline" onClick={c.stop}><Square className="mr-1.5 h-3.5 w-3.5" />{t('aiOrganization.stop')}</Button> : legacy ? <><Button size="sm" disabled={c.readonly || !['ready', 'interrupted', 'applied', 'restored'].includes(draft!.status)} onClick={() => void c.continueLegacy()}>{t('categoryTree.continueLegacy')}</Button>{draft?.status === 'applied' && !draft.structureOperations?.length && <Button size="sm" variant="outline" disabled={c.readonly} onClick={() => void c.restore()}>{t('aiOrganization.restore')}</Button>}<Button size="sm" variant="ghost" onClick={c.newDraft}>{t('aiOrganization.newTask')}</Button></> : !dual ? <Button size="sm" disabled={!modelReady || !c.count} onClick={() => void c.generate()}>{t('dualOrganization.start')}<ArrowRight className="ml-1.5 h-3.5 w-3.5" /></Button> : <>
            {editable && !externalAgent && (failedEntries || !!progress.blocked || draft?.status === 'interrupted') && <Button size="sm" variant="outline" title={t('organizationUx.resume')} aria-label={t('organizationUx.resume')} disabled={!modelReady} onClick={() => void c.retry()}><RefreshCw className="h-3.5 w-3.5 sm:mr-1.5" /><span className="hidden sm:inline">{t('organizationUx.resume')}</span></Button>}
            {editable && !externalAgent && step === 3 && <Button size="sm" variant="ghost" title={t('organizationUx.adjustLocal')} aria-label={t('organizationUx.adjustLocal')} onClick={() => setRefining(value => !value)}><MessageSquare className="h-3.5 w-3.5 sm:mr-1.5" /><span className="hidden sm:inline">{t('organizationUx.adjustLocal')}</span></Button>}
            {editable && !externalAgent && step === 3 && c.analysisDepth === 'quick' && <Button size="sm" variant="outline" disabled={!modelReady} onClick={() => void c.deepenAll()}>{t('organizationSpeed.deepenAll')}</Button>}
            {hasApplied && <Button size="sm" variant="outline" disabled={c.readonly} onClick={() => void c.restore()}><RotateCcw className="mr-1.5 h-3.5 w-3.5" />{t('aiOrganization.restore')}</Button>}
            <Button size="icon" variant="ghost" className="h-8 w-8" title={t('aiOrganization.newTask')} aria-label={t('aiOrganization.newTask')} onClick={c.newDraft}><Plus className="h-4 w-4" /></Button>
          </>}
          {dual && <Button size="icon" variant="ghost" className="h-8 w-8" title={t('aiOrganization.continue')} aria-label={t('aiOrganization.continue')} onClick={() => { c.continueInWorkbench(); onOpenChange(false); }}><MessageSquare className="h-4 w-4" /></Button>}
          {c.proposal?.syncError && <Button size="sm" variant="outline" disabled={c.busy} onClick={() => void c.retrySync()}>{t('aiOrganization.retrySync')}</Button>}
          {c.busy && <span role="status" className="ml-auto text-xs text-muted-foreground">{t(phase === 'understanding' && c.analysisDepth === 'quick' ? 'organizationRuntime.prepare' : `dualOrganization.phase.${phase}`)} · {Number.isFinite(stageDone) ? stageDone : 0}/{stageTotal}</span>}
          {step === 3 && !c.busy && (selected.length > 0 || retirements.length > 0 || structures.length > 0) && <><span className="text-xs text-muted-foreground">{t('categoryTree.pendingSummary', { structures: structures.length, assignments: selected.length })}</span><Button size="sm" className="order-first ml-auto w-full sm:order-last sm:w-auto" disabled={!editable} onClick={() => setConfirmation(c.proposal!.updatedAt)}><Check className="mr-1.5 h-3.5 w-3.5" />{t('categoryTree.reviewApply')}</Button></>}
          {step === 2 && dual && !c.busy && !progress.blocked && <Button size="sm" className="ml-auto" onClick={() => setStep(3)}>{t('dualOrganization.step3')}<ChevronRight className="ml-1 h-3.5 w-3.5" /></Button>}
        </div>
      </footer>
    </DialogContent>
  </Dialog>;
}
