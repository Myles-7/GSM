import { useState } from 'react';
import type { useReadingProjects } from '../../features/settings/hooks/useReadingProjects';
import type { ReadingStarBatch } from '../../lib/html-reading/candidates';
import { useT } from '../../i18n/useT';
import { Button } from '../ui/button';
import { resumableProjectStatuses } from './readingProjectBrowse';

type Controller = ReturnType<typeof useReadingProjects>;
function BatchCard({ batch, controller: c, onResume }: { batch: ReadingStarBatch; controller: Controller; onResume: (batch: ReadingStarBatch) => void }) {
  const t = useT('settings');
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(0);
  const pages = Math.max(1, Math.ceil(batch.rows.length / 40));
  const current = Math.min(page, pages - 1);
  const done = batch.rows.filter(row => ['starred', 'already-starred'].includes(row.status)).length;
  const failed = batch.rows.filter(row => ['failed', 'uncertain', 'local-pending'].includes(row.status)).length;
  const skipped = batch.rows.filter(row => row.status === 'skipped').length;
  return <section aria-label={t('dailyProjects.batchProgress')} className="space-y-2 rounded-lg border bg-card p-3">
    <div className="flex flex-wrap items-center justify-between gap-2"><span className="text-xs text-muted-foreground">{batch.createdAt || batch.id} · {t(`dailyProjects.batchState.${batch.status}`)}</span>{!c.busy && batch.rows.some(row => resumableProjectStatuses.has(row.status)) && <Button size="sm" variant="outline" onClick={() => onResume(batch)}>{t('dailyProjects.resume')}</Button>}</div>
    <p role="status" className="text-sm">{t('dailyProjects.batchCounts', { done, failed, skipped, remaining: batch.rows.length - done - failed - skipped, total: batch.rows.length })}</p>
    <progress aria-label={t('dailyProjects.batchProgress')} value={done + skipped} max={Math.max(1, batch.rows.length)} className="h-2 w-full accent-primary" />
    {batch.pauseReason && <p className="break-words text-xs text-muted-foreground">{batch.pauseReason}</p>}
    {batch.retryAt && <p className="text-xs text-muted-foreground">{t('dailyProjects.retryAt', { time: batch.retryAt })}</p>}
    {batch.syncError && <div className="space-y-2"><p role="alert" className="break-words text-sm text-destructive">{t('dailyProjects.syncFailed', { error: batch.syncError })}</p><Button size="sm" variant="outline" disabled={c.busy} onClick={() => void c.retrySync(batch.id).catch(() => {})}>{t('dailyProjects.retrySync')}</Button></div>}
    <details onToggle={event => setOpen(event.currentTarget.open)}><summary className="cursor-pointer text-xs">{t('dailyProjects.results', { count: batch.rows.length })}</summary>{open && <div className="mt-3 space-y-2"><ul className="max-h-60 space-y-2 overflow-y-auto text-sm">{batch.rows.slice(current * 40, (current + 1) * 40).map(row => <li key={row.repoId} className="break-words">{row.name} · {t(`htmlReadingWorkflow.status.${row.status}`)}{row.error && <span className="block text-destructive">{row.error}</span>}</li>)}</ul><div className="flex items-center justify-between gap-2"><Button size="sm" variant="ghost" disabled={!current} onClick={() => setPage(current - 1)}>{t('dailyProjects.previous')}</Button><span className="text-xs">{t('dailyProjects.page', { page: current + 1, pages })}</span><Button size="sm" variant="ghost" disabled={current + 1 >= pages} onClick={() => setPage(current + 1)}>{t('dailyProjects.next')}</Button></div></div>}</details>
  </section>;
}
export function ReadingProjectBatches({ controller: c, onResume }: { controller: Controller; onResume: (batch: ReadingStarBatch) => void }) {
  const t = useT('settings');
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(0);
  const featured = c.batches.find(batch => batch.status === 'running') ?? c.batches[0];
  const history = c.batches.filter(batch => batch !== featured);
  const pages = Math.max(1, Math.ceil(history.length / 40));
  const current = Math.min(page, pages - 1);
  if (!featured) return null;
  return <div className="space-y-3"><BatchCard batch={featured} controller={c} onResume={onResume} />{history.length > 0 && <details onToggle={event => setOpen(event.currentTarget.open)}><summary className="cursor-pointer text-sm text-muted-foreground">{t('dailyProjects.history', { count: history.length })}</summary>{open && <div className="mt-3 space-y-3">{history.slice(current * 40, (current + 1) * 40).map(batch => <BatchCard key={batch.id} batch={batch} controller={c} onResume={onResume} />)}<div className="flex items-center justify-between"><Button size="sm" variant="outline" disabled={!current} onClick={() => setPage(current - 1)}>{t('dailyProjects.previous')}</Button><span className="text-xs">{t('dailyProjects.page', { page: current + 1, pages })}</span><Button size="sm" variant="outline" disabled={current + 1 >= pages} onClick={() => setPage(current + 1)}>{t('dailyProjects.next')}</Button></div></div>}</details>}</div>;
}
