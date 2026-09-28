import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, BookOpen, Copy, ExternalLink, MessageSquareText, Pin, PinOff, X } from 'lucide-react';
import type { Repository } from '../types';
import { useAppStore } from '../store/useAppStore';
import { useT } from '../i18n/useT';
import { readRepositoryDetails } from '../features/repositories/application/repositoryDetailsSchema';
import { RepositoryHealthPanel } from './RepositoryHealthPanel';
import { RepositoryDetailAnalysisAction } from './RepositoryDetailAnalysisAction';
import { useRepositoryDetailAnalysisJob } from '../features/repositories/hooks/useRepositoryDetailAnalysisJob';
import { Dialog, DialogContent, DialogTitle } from './ui/dialog';
import { Button } from './ui/button';
import { ErrorBoundary } from './ErrorBoundary';

const LazyReadmeModal = lazy(() => import('./ReadmeModal').then((module) => ({ default: module.ReadmeModal })));

export interface RepositoryDetailsPanelProps {
  repository: Repository | null;
  onClose: () => void;
  onAskRepository?: (repository: Repository) => void;
  onPinnedChange?: (pinned: boolean) => void;
  onPrevious?: () => void;
  onNext?: () => void;
}

export function RepositoryDetailsPanel({ repository, onClose, onAskRepository, onPinnedChange, onPrevious, onNext }: RepositoryDetailsPanelProps) {
  const t = useT('repositories');
  const language = useAppStore((state) => state.language);
  const releases = useAppStore((state) => state.releases);
  const [pinned, setPinned] = useState(false);
  const [canPin, setCanPin] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const [readmeOpen, setReadmeOpen] = useState(false);
  const readmeTrigger = useRef<HTMLButtonElement>(null);
  const job = useRepositoryDetailAnalysisJob();
  const pinnedRef = useRef(pinned);
  pinnedRef.current = pinned;
  const anchor = useRef<HTMLSpanElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const scrollPositions = useRef(new Map<number, number>());
  const opener = useRef<HTMLElement | null>(null);
  const wasOpen = useRef(false);
  const repositoryId = repository?.id;
  useEffect(() => setReadmeOpen(false), [repositoryId]);
  const isOpen = !!repository;
  const onPinnedChangeRef = useRef(onPinnedChange);
  onPinnedChangeRef.current = onPinnedChange;
  useEffect(() => {
    const measure = () => {
      const width = anchor.current?.parentElement?.getBoundingClientRect().width || 0;
      const eligible = window.innerWidth >= 1280 && width >= 1080;
      setCanPin(eligible);
      if (!eligible) setPinned(false);
    };
    measure();
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    if (anchor.current?.parentElement) observer?.observe(anchor.current.parentElement);
    window.addEventListener('resize', measure);
    return () => { observer?.disconnect(); window.removeEventListener('resize', measure); };
  }, [pinned, repository?.id]);
  useEffect(() => {
    onPinnedChangeRef.current?.(pinned && isOpen);
    return () => onPinnedChangeRef.current?.(false);
  }, [pinned, isOpen]);
  useEffect(() => {
    if (repository && !wasOpen.current) opener.current = document.activeElement as HTMLElement;
    if (!repository && wasOpen.current) {
      setPinned(false);
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
  const iconButton = (label: string, handler: () => void, icon: React.ReactNode, disabled = false) =>
    <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" title={label} aria-label={label} onClick={handler} disabled={disabled}>{icon}</Button>;
  const body = repository && <>
    <header className="flex flex-wrap items-center gap-1 border-b p-4">
      <h2 className="min-w-0 flex-1 break-all text-base font-semibold">{repository.full_name}</h2>
      {onPrevious && iconButton(t('details.previous'), onPrevious, <ArrowLeft className="h-4 w-4" />)}
      {onNext && iconButton(t('details.next'), onNext, <ArrowRight className="h-4 w-4" />)}
      {iconButton(t(pinned ? 'details.unpin' : 'details.pin'), () => setPinned(!pinned), pinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />, !pinned && !canPin)}
      {iconButton(t('details.close'), close, <X className="h-4 w-4" />)}
    </header>
    <div ref={scroller} className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4" onScroll={(event) => scrollPositions.current.set(repository.id, event.currentTarget.scrollTop)}>
      <p className="whitespace-pre-wrap break-words text-sm">{repository.custom_description ?? repository.ai_summary ?? repository.description ?? t('details.unknown')}</p>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        {onAskRepository && <Button variant="outline" size="sm" onClick={() => onAskRepository(repository)}><MessageSquareText className="mr-2 h-4 w-4" />{t('repositoryCard.ask-this-repository')}</Button>}
        <Button ref={readmeTrigger} variant="outline" size="sm" onClick={() => setReadmeOpen(true)}><BookOpen className="mr-2 h-4 w-4" />{t('details.readme')}</Button>
        <a href={repository.html_url} target="_blank" rel="noopener noreferrer" aria-label={t('repositoryCard.view-on-github')} title={t('repositoryCard.view-on-github')}><ExternalLink className="h-4 w-4" /></a>
      </div>
      <RepositoryDetailAnalysisAction repositories={[repository]} job={job} />
      {!details && <p className="text-sm text-muted-foreground">{t('details.notAnalyzed')}</p>}
      {details && <>
        <section><h3 className="mb-2 text-sm font-semibold">{t('details.softwareForms')}</h3><p className="text-sm">{details.software_forms?.length ? details.software_forms.map((form) => t(`details.forms.${form}`)).join(', ') : t('details.unknown')}</p></section>
        <section><h3 className="mb-2 text-sm font-semibold">{t('details.deploymentModes')}</h3><p className="text-sm">{details.deployment_modes?.length ? details.deployment_modes.map((mode) => t(`details.modes.${mode}`)).join(', ') : t('details.unknown')}</p></section>
        <p className="break-words text-xs text-muted-foreground">{details.model} · <time>{details.generated_at}</time>{details.repository_pushed_at !== (repository.pushed_at || null) && <span> · {t('details.stale')}</span>}</p>
        {(['problem', 'features', 'scenarios', 'architecture', 'deployment', 'cost', 'maintenance'] as const).map((key) => <section key={key}>
          <h3 className="mb-2 text-sm font-semibold">{t(`details.${key}`)}</h3>
          {Array.isArray(details[key])
            ? <ul className="list-inside list-disc space-y-1 break-words text-sm">{(details[key] as string[]).length ? (details[key] as string[]).map((line, index) => <li key={index}>{line}</li>) : <li>{t('details.unknown')}</li>}</ul>
            : <p className="whitespace-pre-wrap break-words text-sm">{details[key] || t('details.unknown')}</p>}
        </section>)}
        <section><h3 className="mb-2 text-sm font-semibold">{t('details.quickstart')}</h3>
          {details.quickstart.length === 0 && <p className="text-sm">{t('details.unknown')}</p>}
          {details.quickstart.map((step, index) => <div key={index} className="mb-3 text-sm">
            <p>{step.description}</p>
            {step.command && <div className="mt-1 flex items-start gap-2 bg-muted p-2">
              <code className="min-w-0 flex-1 whitespace-pre-wrap break-all">{step.command}</code>
              {iconButton(t('details.copy'), () => { if (!navigator.clipboard) { setCopyFailed(true); return; } void navigator.clipboard.writeText(step.command!).then(() => setCopyFailed(false)).catch(() => setCopyFailed(true)); }, <Copy className="h-4 w-4" />)}
            </div>}
          </div>)}
          {copyFailed && <p role="alert">{t('details.copyFailed')}</p>}
        </section>
        <section><h3 className="mb-2 text-sm font-semibold">{t('details.sources')}</h3>
          {details.sources.map((source) => <a key={source.url} className="block break-all text-sm underline" href={source.url} target="_blank" rel="noopener noreferrer">{source.label}</a>)}
        </section>
      </>}
      <RepositoryHealthPanel repository={repository} releases={releases.filter((release) => release.repository.id === repository.id).length ? releases.filter((release) => release.repository.id === repository.id) : undefined} language={language} />
    </div>
  </>;
  return <>
    <span ref={anchor} className="hidden" />
    {repository && (pinned
      ? <aside aria-label={t('details.title')} className="flex h-full max-h-[calc(100vh-5rem)] w-[400px] shrink-0 flex-col border-l bg-card" onKeyDown={(event) => { if (event.key === 'Escape') close(); }}>{body}</aside>
      : <Dialog open onOpenChange={(open) => !open && close()}>
        <DialogContent showClose={false} aria-describedby={undefined} className="left-auto right-0 top-0 flex h-dvh max-h-dvh w-full max-w-full translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none p-0 sm:max-w-[480px]" onCloseAutoFocus={(event) => { event.preventDefault(); if (!pinnedRef.current) opener.current?.focus({ preventScroll: true }); }}>
          <DialogTitle className="sr-only">{t('details.title')}</DialogTitle>{body}
        </DialogContent>
      </Dialog>)}
    {repository && readmeOpen && <ErrorBoundary><Suspense fallback={<Dialog open onOpenChange={(open) => !open && setReadmeOpen(false)}><DialogContent aria-describedby={undefined}><DialogTitle>{t('details.readme')}</DialogTitle><p role="status">{t('details.loadingReadme')}</p></DialogContent></Dialog>}>
      <LazyReadmeModal isOpen repository={repository} onClose={() => setReadmeOpen(false)} onCloseAutoFocus={() => readmeTrigger.current?.focus({ preventScroll: true })} />
    </Suspense></ErrorBoundary>}
  </>;
}
