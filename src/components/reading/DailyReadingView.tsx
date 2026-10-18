import { useEffect, useState } from 'react';
import { FileCode2, Save } from 'lucide-react';
import { useHtmlReading } from '../../features/settings/hooks/useHtmlReading';
import { useT } from '../../i18n/useT';
import { useAppStore } from '../../store/useAppStore';
import type { AppState } from '../../types';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from '../ui/dialog';
import { HtmlReadingImport } from '../settings/HtmlReadingImport';
import { ReadingProjects } from './ReadingProjects';
import { ReadingConfiguration } from './ReadingConfiguration';
import { ReadingDelivery } from './ReadingDelivery';
import { allowReadingNavigation, registerReadingLeaveGuard } from './readingNavigation';
import './readingWorkspace.css';

type Page = 'projects' | 'delivery' | 'settings';
export function DailyReadingView() {
  const controller = useHtmlReading();
  return <AccountReadingView key={controller.account} controller={controller}/>;
}
function AccountReadingView({ controller: c }: { controller: ReturnType<typeof useHtmlReading> }) {
  const t = useT('settings');
  const [page, setPage] = useState<Page>('projects');
  const [group, setGroup] = useState<'content' | 'layout' | 'mail' | 'storage' | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [scopeRevision, setScopeRevision] = useState(0);
  const [leaving, setLeaving] = useState<AppState['currentView'] | null>(null);
  const [feedback, setFeedback] = useState('');
  const dirty = JSON.stringify(c.settings) !== JSON.stringify(c.saved);
  useEffect(() => {
    const open = () => { setPage('settings'); setGroup(null); try { sessionStorage.removeItem('gsm:pending-reading-page'); } catch { /* Navigation also works in memory. */ } };
    try { if (sessionStorage.getItem('gsm:pending-reading-page') === 'settings') open(); } catch { /* Storage can be unavailable. */ }
    window.addEventListener('gsm:reading-configuration', open);
    return () => window.removeEventListener('gsm:reading-configuration', open);
  }, []);
  useEffect(() => {
    if (!dirty || !c.ready) return;
    const dispose = registerReadingLeaveGuard(view => setLeaving(view));
    const unload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', unload);
    return () => { dispose(); window.removeEventListener('beforeunload', unload); };
  }, [dirty, c.ready]);
  useEffect(() => { if (!c.message) return; setFeedback(c.message); const timer = window.setTimeout(() => setFeedback(''), 5000); return () => window.clearTimeout(timer); }, [c.message]);
  const leave = () => { if (leaving) allowReadingNavigation(() => useAppStore.getState().setCurrentView(leaving)); setLeaving(null); };
  if (!c.account) return <p className="p-4 text-muted-foreground">{t('htmlReadingUi.signInToGithubBeforeConfiguringDaily')}</p>;
  if (!c.ready) return <div role={c.error ? 'alert' : 'status'} className="p-4"><p>{c.error || t('htmlReadingUi.loadingDailyHtmlSettingsForThisAccount')}</p>{c.error && <Button onClick={c.retryLoad}>{t('htmlReadingUi.reload')}</Button>}</div>;
  return <div className="reading-page" data-testid="daily-reading">
    <header className="reading-page-header"><div className="flex items-center gap-2.5"><FileCode2 className="h-5 w-5 text-muted-foreground"/><h1>HTML</h1></div><nav aria-label={t('dailyReading.navigation')} className="reading-nav">{(['projects','delivery','settings'] as const).map(id => <Button key={id} size="sm" variant="ghost" aria-pressed={page === id} onClick={() => { setPage(id); setImportOpen(false); }}>{t(`readingClean.page.${id}`)}</Button>)}</nav></header>
    {c.error && <p role="alert" className="rounded-lg border border-destructive/25 bg-destructive/5 px-3 py-2 text-sm text-destructive">{c.error}</p>}
    <section hidden={page !== 'projects'}><ReadingProjects controller={c.projects} importRevision={scopeRevision} active={page === 'projects'} onImport={() => setImportOpen(true)}/></section>
    <section hidden={page !== 'delivery'}>{page === 'delivery' && <ReadingDelivery controller={c} onConfigure={(target = 'mail') => { setPage('settings'); setGroup(target); }}/>}</section>
    <section hidden={page !== 'settings'}><ReadingConfiguration controller={c} group={group} onGroup={setGroup}/></section>
    {dirty && <div className="reading-save-bar"><span className="text-xs text-muted-foreground">{t('readingClean.unsavedConfiguration')}</span><div className="flex gap-2"><Button size="sm" variant="ghost" disabled={c.busy} onClick={() => c.setSettings(structuredClone(c.saved))}>{t('readingClean.discardChanges')}</Button><Button size="sm" disabled={c.busy} onClick={() => void c.save()}><Save className="mr-1.5 h-4 w-4"/>{t('readingClean.saveChanges')}</Button></div></div>}
    {feedback && <p role="status" className="fixed bottom-5 left-1/2 z-40 max-w-[calc(100vw-32px)] -translate-x-1/2 rounded-lg border bg-card px-4 py-3 text-sm shadow-sm">{feedback}</p>}
    <Dialog open={importOpen} onOpenChange={open => { if (!c.busy) setImportOpen(open); }}><DialogContent className="max-w-4xl" closeLabel={t('htmlReadingUi.cancel')} onEscapeKeyDown={event => { if (c.busy) event.preventDefault(); }} onInteractOutside={event => { if (c.busy) event.preventDefault(); }}><DialogTitle>{t('dailyReading.page.import')}</DialogTitle><DialogDescription>{t('readingClean.importHint')}</DialogDescription><HtmlReadingImport key={c.account} controller={c} guided onProjects={() => { setScopeRevision(value => value + 1); setImportOpen(false); setPage('projects'); }}/></DialogContent></Dialog>
    <Dialog open={!!leaving} onOpenChange={open => { if (!open) setLeaving(null); }}><DialogContent closeLabel={t('readingClean.stay')}><DialogTitle>{t('readingClean.unsavedConfiguration')}</DialogTitle><DialogDescription>{t('readingClean.leaveHint')}</DialogDescription><DialogFooter><Button variant="ghost" onClick={() => setLeaving(null)}>{t('readingClean.stay')}</Button><Button variant="outline" disabled={c.busy} onClick={() => { c.setSettings(structuredClone(c.saved)); leave(); }}>{t('readingClean.discardAndLeave')}</Button><Button disabled={c.busy} onClick={async () => { if (await c.save()) leave(); }}>{t('readingClean.saveAndLeave')}</Button></DialogFooter></DialogContent></Dialog>
  </div>;
}
