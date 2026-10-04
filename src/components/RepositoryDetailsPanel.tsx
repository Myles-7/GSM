import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, ArrowRight, BookOpen, Check, Copy, ExternalLink, MessageSquareText, Pin, PinOff, X } from 'lucide-react';
import type { Repository } from '../types';
import { useAppStore } from '../store/useAppStore';
import { useT } from '../i18n/useT';
import { readRepositoryDetails } from '../utils/repositoryDetailsSchema';
import { RepositoryHealthPanel } from './RepositoryHealthPanel';
import { RepositoryDetailAnalysisAction } from './RepositoryDetailAnalysisAction';
import { useRepositoryDetailAnalysisJob } from '../features/repositories/hooks/useRepositoryDetailAnalysisJob';
import { isRepeatedRepositoryProblem, repositoryDetailFields } from '../lib/repositoryReadingPresentation';
import { Dialog, DialogContent, DialogTitle } from './ui/dialog';
import { Button } from './ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from './ui/tabs';
import { ErrorBoundary } from './ErrorBoundary';
import { safeWriteText } from '../utils/clipboardUtils';
import { RepositoryAnalysisFreshness } from './RepositoryAnalysisFreshness';
import { applyRepositoryAnalysisAsset, useRepositoryAnalysisAssets } from '../services/repositoryAnalysisAssets';

const LazyReadmeModal = lazy(() => import('./ReadmeModal').then((module) => ({ default: module.ReadmeModal })));

export interface RepositoryDetailsPanelProps {
  repository: Repository | null;
  onClose: () => void;
  onAskRepository?: (repository: Repository) => void;
  onPinnedChange?: (pinned: boolean) => void;
  onPrevious?: () => void;
  onNext?: () => void;
  analysisAction?: (repository: Repository) => ReactNode;
  defaultDocked?: boolean;
  analysisStatus?: { running: boolean; stage?: string };
}

export function RepositoryDetailsPanel({ repository, onClose, onAskRepository, onPinnedChange, onPrevious, onNext, analysisAction, analysisStatus, defaultDocked = false }: RepositoryDetailsPanelProps) {
  const t = useT('repositories');
  const language = useAppStore((state) => state.language);
  const account = useAppStore((state) => state.user?.id);
  useRepositoryAnalysisAssets((state) => state.assets);
  if (repository && account !== undefined) repository = applyRepositoryAnalysisAsset(String(account), repository, language);
  const releases = useAppStore((state) => state.releases);
  const [pinned, setPinned] = useState(defaultDocked);
  const [canPin, setCanPin] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const [copiedCommand, setCopiedCommand] = useState<string | null>(null);
  const [readmeOpen, setReadmeOpen] = useState(false);
  const [detailTab, setDetailTab] = useState('overview');
  const readmeTrigger = useRef<HTMLButtonElement>(null);
  const job = useRepositoryDetailAnalysisJob(!analysisAction);
  const autoDocked = useRef(false);
  const pinnedRef = useRef(pinned);
  pinnedRef.current = pinned;
  const anchor = useRef<HTMLSpanElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const scrollPositions = useRef(new Map<number, number>());
  const opener = useRef<HTMLElement | null>(null);
  const wasOpen = useRef(false);
  const repositoryId = repository?.id;
  useEffect(() => { setReadmeOpen(false); setDetailTab('overview'); }, [repositoryId]);
  const isOpen = !!repository;
  const onPinnedChangeRef = useRef(onPinnedChange);
  onPinnedChangeRef.current = onPinnedChange;
  useEffect(() => {
    const measure = () => {
      const width = anchor.current?.parentElement?.getBoundingClientRect().width || 0;
      const eligible = window.innerWidth >= 1280 && width >= 1080;
      setCanPin(eligible);
      if (!eligible) { setPinned(false); autoDocked.current = false; }
      if (repository && defaultDocked && eligible && !autoDocked.current) {
        autoDocked.current = true;
        setPinned(true);
      }
    };
    measure();
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    if (anchor.current?.parentElement) observer?.observe(anchor.current.parentElement);
    window.addEventListener('resize', measure);
    return () => { observer?.disconnect(); window.removeEventListener('resize', measure); };
  }, [pinned, repository, defaultDocked]);
  useEffect(() => {
    onPinnedChangeRef.current?.(pinned && isOpen);
    return () => onPinnedChangeRef.current?.(false);
  }, [pinned, isOpen]);
  useEffect(() => {
    if (repository && !wasOpen.current) opener.current = document.activeElement as HTMLElement;
    if (!repository && wasOpen.current) {
      setPinned(false);
      autoDocked.current = false;
      opener.current?.focus({ preventScroll: true });
    }
    wasOpen.current = !!repository;
  }, [repository]);
  useEffect(() => {
    if (repositoryId !== undefined && scroller.current) scroller.current.scrollTop = scrollPositions.current.get(repositoryId) || 0;
  }, [repositoryId, pinned]);
  const close = () => {
    setPinned(false);
    onPinnedChangeRef.current?.(false);
    onClose();
    opener.current?.focus({ preventScroll: true });
  };
  const details = readRepositoryDetails(repository?.ai_details);
  const summary = repository?.custom_description ?? repository?.ai_summary ?? repository?.description ?? '';
  const analyzing = analysisStatus?.running ?? (job.running && job.currentRepository === repository?.full_name);
  const stage = analysisStatus?.stage ?? job.stage;
  const copyText = async (text: string) => {
    const result = await safeWriteText(text);
    setCopyFailed(!result.success);
    if (result.success) { setCopiedCommand(text); setTimeout(() => setCopiedCommand(null), 2000); }
  };
  const isProblemRedundant = isRepeatedRepositoryProblem(details?.problem, summary);

  const iconButton = (label: string, handler: () => void, icon: React.ReactNode, disabled = false) =>
    <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" title={label} aria-label={label} onClick={handler} disabled={disabled}>{icon}</Button>;
  const body = repository && <>
    <header className="flex flex-wrap items-center gap-1 border-b p-4">
      <h2 className="min-w-0 flex-1 break-all text-base font-semibold">{repository.full_name}</h2>
      <RepositoryAnalysisFreshness repository={repository} />
      {onPrevious && iconButton(t('details.previous'), onPrevious, <ArrowLeft className="h-4 w-4" />)}
      {onNext && iconButton(t('details.next'), onNext, <ArrowRight className="h-4 w-4" />)}
      {iconButton(t(pinned ? 'details.unpin' : 'details.pin'), () => setPinned(!pinned), pinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />, !pinned && !canPin)}
      {iconButton(t('details.close'), close, <X className="h-4 w-4" />)}
    </header>
    <Tabs value={detailTab} onValueChange={setDetailTab} className="flex min-h-0 flex-1 flex-col">
    <TabsList className="mx-4 mt-3 grid shrink-0 grid-cols-3">
      <TabsTrigger value="overview">{t('details.overviewTab')}</TabsTrigger>
      <TabsTrigger value="usage">{t('details.usageTab')}</TabsTrigger>
      <TabsTrigger value="maintenance">{t('details.maintenanceTab')}</TabsTrigger>
    </TabsList>
    <div data-testid="repository-details-toolbar" className="shrink-0 space-y-2 border-b px-4 py-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {onAskRepository && <Button variant="outline" size="sm" onClick={() => onAskRepository(repository)}><MessageSquareText className="mr-2 h-4 w-4" />{t('repositoryCard.ask-this-repository')}</Button>}
        <Button ref={readmeTrigger} variant="outline" size="sm" onClick={() => setReadmeOpen(true)}><BookOpen className="mr-2 h-4 w-4" />{t('details.readme')}</Button>
        <Button variant="outline" size="sm" asChild>
          <a href={repository.html_url} target="_blank" rel="noopener noreferrer" title={t('repositoryCard.view-on-github')}>
            <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
            <span>GitHub</span>
          </a>
        </Button>
        <Button variant="outline" size="sm" asChild><a href={`${repository.html_url}/releases`} target="_blank" rel="noopener noreferrer"><ExternalLink className="mr-1.5 h-3.5 w-3.5" />Releases</a></Button>
      </div>
      {analysisAction ? analysisAction(repository) : <RepositoryDetailAnalysisAction repositories={[repository]} job={job} />}
    </div>
    <div ref={scroller} className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain p-4" onScroll={(event) => scrollPositions.current.set(repository.id, event.currentTarget.scrollTop)}>
      <TabsContent value={detailTab} className="space-y-5">
      {detailTab === 'overview' && summary && <section className="space-y-2">
        <div className="flex items-center justify-between gap-2"><h3 className="text-sm font-semibold">{language.startsWith('zh') ? '快速总结' : 'Quick summary'}</h3>
          {iconButton(language.startsWith('zh') ? '复制总结' : 'Copy summary', () => void copyText(summary), copiedCommand === summary ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />)}</div>
        <p className="whitespace-pre-wrap break-words text-sm">{summary}</p>
      </section>}
      {copyFailed && <p role="alert" className="text-sm text-destructive">{t('details.copyFailed')}</p>}
      {analyzing && !details && <div role="status" aria-busy="true" className="space-y-3">
        <p className="text-xs text-muted-foreground">{stage === 'readme' ? 'README' : stage === 'validation' ? (language.startsWith('zh') ? '校验分析结果' : 'Validating analysis') : (language.startsWith('zh') ? 'AI 分析中' : 'AI analyzing')}</p>
        {[0, 1, 2].map(i => <div key={i} className="space-y-2"><div className="h-4 w-1/3 animate-pulse rounded bg-muted" /><div className="h-3 w-full animate-pulse rounded bg-muted" /><div className="h-3 w-4/5 animate-pulse rounded bg-muted" /></div>)}
      </div>}
      {!details && <p className="text-sm text-muted-foreground">{t('details.notAnalyzed')}</p>}
      {details && <>
        {detailTab === 'overview' && <>
        {!!details.software_forms?.length && <section><h3 className="mb-2 text-sm font-semibold">{t('details.softwareForms')}</h3><p className="text-sm">{details.software_forms.map((form) => t(`details.forms.${form}`)).join(', ')}</p></section>}
        {!!details.deployment_modes?.length && <section><h3 className="mb-2 text-sm font-semibold">{t('details.deploymentModes')}</h3><p className="text-sm">{details.deployment_modes.map((mode) => t(`details.modes.${mode}`)).join(', ')}</p></section>}
        </>}
        {(['problem', 'features', 'scenarios', 'architecture', 'deployment', 'cost', 'maintenance'] as const).filter(key => {
          if (detailTab === 'overview') {
            if (key === 'problem' && isProblemRedundant) return false;
            return (repositoryDetailFields.overview as readonly string[]).includes(key);
          }
          if (detailTab === 'usage') return (repositoryDetailFields.usage as readonly string[]).includes(key);
          return key === 'maintenance';
        }).filter(key => Array.isArray(details[key]) ? details[key].length > 0 : Boolean(details[key]?.trim())).map((key) => <details key={key} open={detailTab === 'overview'} className="border-t pt-3">
          <summary className="mb-2 cursor-pointer text-sm font-semibold">{t(`details.${key}`)}</summary>
          {Array.isArray(details[key])
            ? <ul className="list-inside list-disc space-y-1 break-words text-sm">{(details[key] as string[]).length ? (details[key] as string[]).map((line, index) => <li key={index}>{line}</li>) : <li>{t('details.unknown')}</li>}</ul>
            : <p className="whitespace-pre-wrap break-words text-sm">{details[key] || t('details.unknown')}</p>}
        </details>)}
        {detailTab === 'usage' && details.quickstart.length > 0 && <section><h3 className="mb-2 text-sm font-semibold">{t('details.quickstart')}</h3>
          {details.quickstart.map((step, index) => <div key={index} className="mb-3 text-sm">
            <p>{step.description}</p>
            {step.command && <div className="mt-1 flex items-start gap-2 bg-muted p-2">
              <code className="min-w-0 flex-1 whitespace-pre-wrap break-all">{step.command}</code>
              {iconButton(
                t('details.copy'),
                () => void copyText(step.command!),
                copiedCommand === step.command ? <Check className="h-4 w-4 text-emerald-500 animate-in zoom-in-50" /> : <Copy className="h-4 w-4" />
              )}
            </div>}
          </div>)}
        </section>}
        <details className="border-t pt-3"><summary className="cursor-pointer text-xs text-muted-foreground">{t('details.sources')}</summary>
          <p className="my-2 break-words text-xs text-muted-foreground">{details.model} · <time>{new Date(details.generated_at).toLocaleString(language)}</time></p>
          {details.sources.map((source) => <a key={source.url} className="block break-all text-sm underline" href={source.url} target="_blank" rel="noopener noreferrer">{source.label}</a>)}
        </details>
      </>}
      {(detailTab === 'maintenance' || !details) && <RepositoryHealthPanel repository={repository} releases={releases.filter((release) => release.repository.id === repository.id).length ? releases.filter((release) => release.repository.id === repository.id) : undefined} language={language} />}
      </TabsContent>
    </div>
    </Tabs>
  </>;
  return <>
    <span ref={anchor} className="hidden" />
    {repository && (pinned
      ? <aside data-independent-reading aria-label={t('details.title')} className="sticky top-16 flex h-[calc(100dvh-4rem)] max-h-[calc(100dvh-4rem)] w-[440px] xl:w-[480px] shrink-0 flex-col border-l border-border/60 bg-card/95 backdrop-blur-sm transition-all duration-200" onKeyDown={(event) => { if (event.key === 'Escape') close(); }}>{body}</aside>
      : <Dialog open onOpenChange={(open) => !open && close()}>
        <DialogContent showClose={false} aria-describedby={undefined} className="left-0 right-auto top-0 flex h-dvh max-h-dvh w-screen max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none p-0 sm:left-auto sm:right-0 sm:w-full sm:max-w-[480px]" onCloseAutoFocus={(event) => { event.preventDefault(); if (!pinnedRef.current) opener.current?.focus({ preventScroll: true }); }}>
          <DialogTitle className="sr-only">{t('details.title')}</DialogTitle>{body}
        </DialogContent>
      </Dialog>)}
    {repository && readmeOpen && <ErrorBoundary><Suspense fallback={<Dialog open onOpenChange={(open) => !open && setReadmeOpen(false)}><DialogContent aria-describedby={undefined}><DialogTitle>{t('details.readme')}</DialogTitle><p role="status">{t('details.loadingReadme')}</p></DialogContent></Dialog>}>
      <LazyReadmeModal isOpen repository={repository} onClose={() => setReadmeOpen(false)} onCloseAutoFocus={() => readmeTrigger.current?.focus({ preventScroll: true })} />
    </Suspense></ErrorBoundary>}
  </>;
}
