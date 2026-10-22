import { useT } from '../../../i18n/useT';
import { Bookmark, ChevronDown, ChevronUp, Compass, Pencil, Trash2 } from 'lucide-react';
import { Button } from '../../../components/ui/button';
import type { SavedExploration } from './types';
export function SavedExplorations({ items, selected, busy, onOpen, onHome, onRename, onDelete, onMove }: {
  items: SavedExploration[]; selected: string; busy: boolean; onOpen: (item: SavedExploration) => void; onHome: () => void;
  onRename: (item: SavedExploration) => void; onDelete: (item: SavedExploration) => void; onMove: (item: SavedExploration, direction: number) => void;
}) {
  const t = useT('repositories');
  return <aside className="explore-saved-sidebar" aria-label={t('exploration.saved-explorations')}><button className={`explore-saved-home ${!selected ? 'is-selected' : ''}`} onClick={onHome}><Compass size={16} />{t('exploration.library-map')}</button>
    <h2><Bookmark size={13} />{t('exploration.saved-explorations')}{' '}<span>{items.length}</span></h2>
    {!items.length && <p>{t('exploration.no-saved-explorations-yet')}</p>}
    <div className="explore-saved-items">{items.map((item,index) => <div key={item.id} className={`explore-saved-item ${selected === item.id ? 'is-selected' : ''}`}>
      <button className="explore-saved-open" onClick={() => onOpen(item)} title={item.name}><Bookmark size={13} /><span>{item.name}<small>{item.resultIds.length} {' '}{t('exploration.projects')}</small></span></button>
      <div className="explore-saved-actions"><Button size="icon" variant="ghost" disabled={busy} aria-label={t('exploration.rename-saved', { name: item.name })} onClick={() => onRename(item)}><Pencil size={11} /></Button>
        <Button size="icon" variant="ghost" disabled={busy || index === 0} aria-label={t('exploration.move-up-saved', { name: item.name })} onClick={() => onMove(item,-1)}><ChevronUp size={12} /></Button>
        <Button size="icon" variant="ghost" disabled={busy || index === items.length-1} aria-label={t('exploration.move-down-saved', { name: item.name })} onClick={() => onMove(item,1)}><ChevronDown size={12} /></Button>
        <Button size="icon" variant="ghost" disabled={busy} aria-label={t('exploration.delete-saved', { name: item.name })} onClick={() => onDelete(item)}><Trash2 size={11} /></Button></div>
    </div>)}</div>
  </aside>;
}
