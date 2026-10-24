import { useMemo, useState } from 'react';
import { Search, X } from 'lucide-react';
import { useT } from '../../../i18n/useT';
import { Button } from '../../../components/ui/button';
import type { Repository } from '../../../types';
import type { ExplorationScene } from './types';
import { explorationSuggestions, type SearchSuggestion } from './workspace';

export function ExplorationSearch({ value, onChange, onSubmit, onChoose, scene, repositories }: {
  value: string; onChange: (text: string) => void; onSubmit: () => void; onChoose: (suggestion: SearchSuggestion) => void; scene: ExplorationScene | null; repositories: Repository[];
}) {
  const t = useT('repositories');
  const [open,setOpen] = useState(false), [active,setActive] = useState(-1);
  const suggestions = useMemo(() => scene ? explorationSuggestions(value,scene,repositories) : [], [value,scene,repositories]);
  const choose = (row: SearchSuggestion) => { onChoose(row); setOpen(false); setActive(-1); };
  return <form className="explore-search" onBlur={event => {if(!event.currentTarget.contains(event.relatedTarget))setOpen(false);}} onSubmit={event => { event.preventDefault(); if(open && active >= 0 && suggestions[active]) choose(suggestions[active]); else {onSubmit();setOpen(false);} }}>
    <Search size={18}/><input role="combobox" aria-label={t('exploration.exploration-topic')} aria-autocomplete="list" aria-expanded={open && !!suggestions.length} aria-controls="exploration-suggestions" aria-activedescendant={open && active>=0 ? `suggestion-${active}` : undefined} placeholder={t('workspace.search-placeholder')} maxLength={200} value={value} onFocus={() => setOpen(true)} onChange={event => {onChange(event.target.value);setActive(-1);setOpen(true);}} onKeyDown={event => {
      if(event.key==='Escape'){setOpen(false);setActive(-1);}
      if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();setOpen(true);setActive(index => suggestions.length ? (index+(event.key==='ArrowDown'?1:-1)+suggestions.length)%suggestions.length : -1);}
    }}/>{value && <Button type="button" variant="ghost" size="icon" aria-label={t('workspace.clear-search')} onClick={() => {onChange('');setActive(-1);}}><X size={14}/></Button>}<Button size="sm" type="submit" variant="secondary" disabled={!scene || !value.trim()}>{t('exploration.explore')}</Button>
    {open && !!suggestions.length && <div id="exploration-suggestions" role="listbox" className="explore-search-suggestions">{suggestions.map((row,index) => <div key={`${row.group}:${row.id}`}><small>{index===0 || suggestions[index-1].group!==row.group ? t(`workspace.${row.group}`) : ''}</small><button type="button" role="option" id={`suggestion-${index}`} aria-selected={active===index} onMouseDown={event=>event.preventDefault()} onClick={()=>choose(row)}>{row.label}</button></div>)}</div>}
  </form>;
}
