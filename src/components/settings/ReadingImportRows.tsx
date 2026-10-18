import { useState, type ReactNode } from 'react';
import { Button } from '../ui/button';
import { useT } from '../../i18n/useT';

/** Ordinary edits stay grouped and unmounted until requested; conflicts remain visible. */
export function ReadingImportRows<T extends { name: string; status: string }>({ rows, guided, renderRow }: {
  rows: T[]; guided: boolean; renderRow: (row: T) => ReactNode;
}) {
  const t = useT('settings');
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(0);
  const conflicts = rows.filter(row => row.status === 'conflict');
  const groups = new Map<string, T[]>();
  for (const row of rows) if (row.status !== 'conflict') groups.set(row.name, [...(groups.get(row.name) ?? []), row]);
  const projects = [...groups];
  const currentPage = Math.min(page, Math.max(0, Math.ceil(projects.length / 40) - 1));
  if (!guided) return <div className="max-h-96 space-y-3 overflow-y-auto">{rows.map(renderRow)}</div>;
  return <div className="space-y-3">
    {!!conflicts.length && <div className="max-h-96 space-y-3 overflow-auto" aria-label={t('dailyReading.conflicts')}>{conflicts.map(renderRow)}</div>}
    {!!projects.length && <details open={open} onToggle={event => setOpen(event.currentTarget.open)} className="rounded-md border p-3">
      <summary className="cursor-pointer text-sm font-medium">{t('dailyReading.viewChanges', { count: projects.length })}</summary>
      {open && <div className="mt-3 space-y-3">{projects.slice(currentPage * 40, (currentPage + 1) * 40).map(([name, values]) => <details key={name} className="rounded border p-3"><summary className="cursor-pointer text-sm">{name} · {t('dailyReading.changedFields', { count: values.length })}</summary><div className="mt-2 space-y-2">{values.map(renderRow)}</div></details>)}
        <div className="flex items-center justify-between gap-2"><Button size="sm" variant="outline" disabled={!currentPage} onClick={() => setPage(currentPage - 1)}>{t('htmlReadingWorkflow.previous')}</Button><span className="text-xs">{currentPage + 1} / {Math.ceil(projects.length / 40)}</span><Button size="sm" variant="outline" disabled={(currentPage + 1) * 40 >= projects.length} onClick={() => setPage(currentPage + 1)}>{t('htmlReadingWorkflow.next')}</Button></div>
      </div>}
    </details>}
  </div>;
}
