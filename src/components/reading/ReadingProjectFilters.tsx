import type { ProjectBrowseState } from './readingProjectBrowse';
import { useT } from '../../i18n/useT';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '../ui/dialog';

export function ReadingProjectFilters({ open, onOpenChange, browse, onChange, hasImport }: {
  open: boolean; onOpenChange: (value: boolean) => void; browse: ProjectBrowseState; onChange: (patch: Partial<ProjectBrowseState>) => void; hasImport: boolean;
}) {
  const t = useT('settings');
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent closeLabel={t('dailyProjects.cancel')}><DialogTitle>{t('readingClean.filters')}</DialogTitle><DialogDescription>{t('readingClean.filtersHint')}</DialogDescription>
    <div className="space-y-3"><label className="flex items-center gap-3 text-sm"><input type="checkbox" checked={!!browse.importOnly} disabled={!hasImport} onChange={event => onChange({ importOnly: event.target.checked })}/>{t('dailyProjects.scopes.import')}</label><label className="flex items-center gap-3 text-sm"><input type="checkbox" checked={!!browse.candidateOnly} onChange={event => onChange({ candidateOnly: event.target.checked })}/>{t('dailyProjects.scopes.candidates')}</label></div>
    <div className="grid gap-3 sm:grid-cols-2">{([
      ['read', ['all', 'read', 'unread']], ['interest', ['all', 'neutral', 'interested', 'ignored']], ['note', ['all', 'yes', 'no']], ['star', ['all', 'starred', 'unstarred', 'unknown']],
    ] as const).map(([filter, options]) => <label key={filter} className="space-y-2 text-sm"><span>{t(`dailyProjects.filter.${filter}`)}</span><select aria-label={t(`dailyProjects.filter.${filter}`)} value={browse[filter]} onChange={event => onChange({ [filter]: event.target.value })} className="h-10 w-full rounded-md border bg-background px-3">{options.map(option => <option key={option} value={option}>{t(`dailyProjects.${filter}.${option}`)}</option>)}</select></label>)}</div>
    <div className="flex justify-between"><Button variant="ghost" onClick={() => onChange({ importOnly: false, candidateOnly: false, read: 'all', interest: 'all', note: 'all', star: 'all' })}>{t('readingClean.clearFilters')}</Button><Button onClick={() => onOpenChange(false)}>{t('readingClean.backToProjects')}</Button></div>
  </DialogContent></Dialog>;
}
