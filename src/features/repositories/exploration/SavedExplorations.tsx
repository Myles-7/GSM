import { useMemo, useState } from 'react';
import { Bookmark, Compass, MoreHorizontal, Plus, Search, X } from 'lucide-react';
import { useT } from '../../../i18n/useT';
import { Button } from '../../../components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '../../../components/ui/dropdown-menu';
import type { ExplorationWorkspace, SavedExploration } from './types';
import { savedExplorationKey, type SavedExplorationEntry } from './workspace';

interface Props {
  workspaces: ExplorationWorkspace[]; snapshots: SavedExploration[]; selected: string; atHome: boolean; busy: boolean;
  onOpen: (entry: SavedExplorationEntry) => void; onHome: () => void; onNew: () => void;
  onRename: (entry: SavedExplorationEntry) => void; onDelete: (entry: SavedExplorationEntry) => void;
  onConvert: (snapshot: SavedExploration) => void;
}
/** One library for saved browsing conditions and explicitly labelled historical results. */
export function SavedExplorations({ workspaces, snapshots, selected, atHome, busy, onOpen, onHome, onNew, onRename, onDelete, onConvert }: Props) {
  const t = useT('repositories');
  const [search,setSearch]=useState('');
  const entries=useMemo(()=>[
    ...workspaces.map((item):SavedExplorationEntry=>({kind:'workspace',item})),
    ...snapshots.map((item):SavedExplorationEntry=>({kind:'snapshot',item})),
  ].sort((a,b)=>b.item.updatedAt.localeCompare(a.item.updatedAt)||savedExplorationKey(a).localeCompare(savedExplorationKey(b))),[workspaces,snapshots]);
  const term=search.trim().toLocaleLowerCase();
  const visible=entries.filter(({item})=>`${item.name}\n${item.query}`.toLocaleLowerCase().includes(term));
  return <section className="explore-saved-library" aria-label={t('exploration.saved-explorations')}>
    <header className="explore-library-heading"><h2><Bookmark size={15}/>{t('exploration.saved-explorations')}<span>{entries.length}</span></h2>
      <Button size="sm" variant="outline" onClick={onNew}><Plus size={14}/>{t('saved-library.new')}</Button>
    </header>
    <button className={`explore-library-home ${atHome?'is-selected':''}`} aria-pressed={atHome} onClick={onHome}><Compass size={17}/>{t('exploration.library-map')}</button>
    {!!entries.length&&<label className="explore-library-search"><Search size={14}/><input aria-label={t('saved-library.search')} placeholder={t('saved-library.search')} value={search} onChange={event=>setSearch(event.target.value)}/>{search&&<Button size="icon" variant="ghost" aria-label={t('saved-library.clear')} onClick={()=>setSearch('')}><X size={13}/></Button>}</label>}
    {!entries.length?<div className="explore-library-empty"><Bookmark size={23}/><strong>{t('exploration.no-saved-explorations-yet')}</strong><p>{t('saved-library.empty-help')}</p></div>:!visible.length?<p className="explore-library-empty">{t('saved-library.no-match')}</p>:<div className="explore-library-entries">
      {visible.map(entry=>{const {item}=entry,key=savedExplorationKey(entry),active=selected===key;
        return <article className={`explore-library-entry ${active?'is-selected':''}`} key={key}>
          <button className="explore-library-open" aria-pressed={active} onClick={()=>onOpen(entry)}>
            <span className="explore-library-entry-title">{item.name}<small className={`explore-library-kind is-${entry.kind}`}>{t(entry.kind==='workspace'?'saved-library.dynamic':'saved-library.snapshot')}</small></span>
            <span className="explore-library-entry-description">{item.query&&item.query.trim().toLocaleLowerCase()!==item.name.trim().toLocaleLowerCase()?item.query:entry.kind==='workspace'?t('saved-library.dynamic-help'):t('exploration.project-count',{count:entry.item.resultIds.length})}</span>
          </button>
          <DropdownMenu><DropdownMenuTrigger asChild><Button className="explore-library-more" size="icon" variant="ghost" disabled={busy} aria-label={t('saved-library.actions',{name:item.name})}><MoreHorizontal size={16}/></Button></DropdownMenuTrigger><DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={()=>onRename(entry)}>{t('workspace.rename')}</DropdownMenuItem>
            {entry.kind==='snapshot'&&<DropdownMenuItem onSelect={()=>onConvert(entry.item)}>{t('saved-library.convert')}</DropdownMenuItem>}
            <DropdownMenuSeparator/>
            <DropdownMenuItem className="explore-library-delete" onSelect={()=>onDelete(entry)}>{t('saved-library.delete')}</DropdownMenuItem>
          </DropdownMenuContent></DropdownMenu>
        </article>;
      })}
    </div>}
  </section>;
}
