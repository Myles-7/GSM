import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import type { Repository } from '../../../types';
import { useT } from '../../../i18n/useT';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../../../components/ui/dialog';

export function WorkbenchRepositoryPicker({ repositories, selected, onClose, onSave, onDiscover, onReturnFocus, disabled }: {
  repositories: Repository[];
  selected: Repository[];
  onClose: () => void;
  onSave: (items: Repository[]) => Promise<void>;
  onDiscover: () => void;
  onReturnFocus: () => void;
  disabled: boolean;
}) {
  const t = useT('chat');
  const [query, setQuery] = useState('');
  const [checked, setChecked] = useState(() => new Set(selected.map(repo => repo.full_name.toLowerCase())));
  const [saving, setSaving] = useState(false);
  const candidates = useMemo(() => [...new Map([...selected, ...repositories].map(repo => [repo.full_name.toLowerCase(), repo])).values()], [selected, repositories]);
  const visible = candidates.filter(repo => `${repo.full_name} ${repo.description ?? ''}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  return <Dialog open onOpenChange={open => { if (!open && !saving) onClose(); }}><DialogContent className="max-w-xl" closeLabel={t('workbench.close')} onCloseAutoFocus={event => { event.preventDefault(); onReturnFocus(); }}>
    <DialogHeader><DialogTitle>{t('workbench.chooseRepositories')}</DialogTitle><DialogDescription>{t('workbench.repositoryPickerHint')}</DialogDescription></DialogHeader>
    <div className="relative"><Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" /><Input autoFocus value={query} onChange={event => setQuery(event.target.value)} aria-label={t('workbench.searchContext')} placeholder={t('workbench.searchContext')} className="pl-9" /></div>
    <div className="max-h-[45dvh] min-h-24 space-y-1 overflow-y-auto" role="group" aria-label={t('workbench.availableRepositories')}>
      {!visible.length && <p className="px-2 py-6 text-sm text-muted-foreground">{t(candidates.length ? 'workbench.noContextMatches' : 'workbench.noContextCandidates')}</p>}
      {visible.map(repo => <label key={repo.full_name} className="flex cursor-pointer items-start gap-3 rounded-lg px-3 py-3 hover:bg-muted"><input type="checkbox" className="mt-1" checked={checked.has(repo.full_name.toLowerCase())} disabled={disabled || saving} onChange={event => setChecked(previous => { const next = new Set(previous); if (event.target.checked) next.add(repo.full_name.toLowerCase()); else next.delete(repo.full_name.toLowerCase()); return next; })} /><span className="min-w-0"><span className="block break-words text-sm font-medium">{repo.full_name}</span>{repo.description && <span className="mt-1 line-clamp-2 block text-xs text-muted-foreground">{repo.description}</span>}</span></label>)}
    </div>
    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground"><span>{t('workbench.contextCount', { count: checked.size })}</span><Button type="button" size="sm" variant="ghost" disabled={saving || disabled} onClick={onDiscover}>{t('workbench.discoverMore')}</Button></div>
    <DialogFooter><Button type="button" variant="outline" disabled={saving} onClick={onClose}>{t('workbench.cancel')}</Button><Button type="button" disabled={disabled || saving} onClick={async () => { setSaving(true); try { await onSave(candidates.filter(repo => checked.has(repo.full_name.toLowerCase()))); } finally { setSaving(false); } }}>{t('workbench.useContext')}</Button></DialogFooter>
  </DialogContent></Dialog>;
}
