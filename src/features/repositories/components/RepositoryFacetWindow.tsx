import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, GripHorizontal, Pin, RotateCcw, Settings2, SlidersHorizontal, X } from 'lucide-react';
import type { FacetSelection, RepositoryFacet } from '../../../utils/classificationFacets';
import { Button } from '../../../components/ui/button';
import { clampFilterPosition, defaultFilterPreferences, FILTER_GROUPS, readFilterPreferences, saveFilterPreferences, type FilterPreferences, type FilterPosition } from './facetWindowPreferences';

type Option = RepositoryFacet & { count: number };
interface Props {
  account: string;
  language: string;
  options: Option[];
  selection: FacetSelection;
  onChange: (selection: FacetSelection) => void;
  resultCount: number;
  baseCount: number;
  breadcrumb: ReactNode;
}
const reorder = <T,>(items: T[], index: number, direction: number) => {
  const next = [...items];
  const target = index + direction;
  if (target >= 0 && target < items.length) [next[index], next[target]] = [next[target], next[index]];
  return next;
};

/** A modeless tool window: outside clicks keep the window open and the repository list usable. */
export function RepositoryFacetWindow({ account, language, options, selection, onChange, resultCount, baseCount, breadcrumb }: Props) {
  const zh = language.startsWith('zh');
  const labels = { technology: zh ? '技术' : 'Technology', platform: zh ? '平台与形态' : 'Platform & form', scenario: zh ? '场景' : 'Scenario' };
  const [saved, setSaved] = useState(() => ({ account, preferences: readFilterPreferences(account) }));
  const preferences = saved.account === account ? saved.preferences : readFilterPreferences(account);
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [customizing, setCustomizing] = useState(false);
  const [closedGroups, setClosedGroups] = useState<string[]>([]);
  const [search, setSearch] = useState<Record<string, string>>({});
  const [viewport, setViewport] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }));
  const triggerRef = useRef<HTMLButtonElement>(null);
  const windowRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ pointer: number; x: number; y: number; origin: FilterPosition } | null>(null);
  const knownLabels = useRef(new Map<string, string>());
  options.forEach(item => knownLabels.current.set(item.id, item.label));
  preferences.favorites.forEach(item => knownLabels.current.set(item.id, item.label));
  const activeIds = FILTER_GROUPS.flatMap(group => (selection[group] ?? []).map(id => ({ id, group })));
  const update = useCallback((change: (current: FilterPreferences) => FilterPreferences) => setSaved(current => ({ account, preferences: change(current.account === account ? current.preferences : readFilterPreferences(account)) })), [account]);
  useEffect(() => {
    setSaved({ account, preferences: readFilterPreferences(account) });
    setOpen(false); setCollapsed(false); setCustomizing(false); setClosedGroups([]); setSearch({});
    knownLabels.current.clear();
  }, [account]);
  useEffect(() => { if (saved.account === account) saveFilterPreferences(account, saved.preferences); }, [account, saved]);
  useEffect(() => {
    const resize = () => setViewport({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);
  const constrain = useCallback((position: FilterPosition) => {
    const rect = windowRef.current?.getBoundingClientRect();
    return clampFilterPosition(position, viewport, { width: rect?.width || Math.min(380, viewport.width - 24), height: rect?.height || (collapsed ? 48 : viewport.height * (viewport.width < 640 ? .6 : .7)) });
  }, [viewport, collapsed]);
  const anchorPosition = () => {
    const bounds = triggerRef.current?.getBoundingClientRect();
    return bounds ? { x: bounds.right - Math.min(380, viewport.width - 24), y: bounds.bottom + 8 }
      : { x: Math.max(12, viewport.width - 404), y: 100 };
  };
  const initialPosition = anchorPosition();
  const position = constrain(preferences.position ?? initialPosition);
  useLayoutEffect(() => {
    if (!open) return;
    const keepVisible = () => update(current => {
      const next = constrain(current.position ?? initialPosition);
      return current.position?.x === next.x && current.position?.y === next.y ? current : { ...current, position: next };
    });
    keepVisible();
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(keepVisible) : null;
    if (windowRef.current) observer?.observe(windowRef.current);
    return () => observer?.disconnect();
    // A ResizeObserver handles content changes; viewport/collapse changes also clamp immediately.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, constrain, update]);
  useEffect(() => { if (open) headerRef.current?.focus(); }, [open]);
  const close = () => { setOpen(false); setCustomizing(false); dragRef.current = null; triggerRef.current?.focus(); };
  const toggle = (item: Pick<RepositoryFacet, 'group' | 'id'>) => onChange({ ...selection, [item.group]: selection[item.group]?.includes(item.id) ? selection[item.group]!.filter(id => id !== item.id) : [...(selection[item.group] ?? []), item.id] });
  const clearLabel = zh ? '清除全部特征' : 'Clear all facets';
  const move = (next: FilterPosition) => update(current => ({ ...current, position: constrain(next) }));
  const favoriteIds = new Set(preferences.favorites.map(item => item.id));
  const favoriteOptions = preferences.favorites.map(item => options.find(option => option.id === item.id) ?? { ...item, count: 0 });
  const renderOption = (item: Option, favoriteIndex?: number) => {
    const checked = selection[item.group]?.includes(item.id) ?? false;
    const pinned = favoriteIds.has(item.id);
    return <div key={item.id} className="flex min-w-0 items-center gap-1 rounded px-1 hover:bg-muted/50">
      <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 py-2 text-xs">
        <input type="checkbox" checked={checked} disabled={!item.count && !checked} aria-label={`${item.label} ${item.count}`} onChange={() => toggle(item)} className="h-4 w-4 shrink-0 accent-primary" />
        <span className="line-clamp-2 min-w-0 flex-1 break-words" title={item.label}>{item.label}</span><span className="w-8 shrink-0 text-right tabular-nums text-muted-foreground">{item.count}</span>
      </label>
      {customizing && <>
        {favoriteIndex !== undefined && <><Button variant="ghost" size="icon" className="h-7 w-6" disabled={favoriteIndex === 0} aria-label={`${item.label} ${zh ? '常用上移' : 'move favorite up'}`} onClick={() => update(current => ({ ...current, favorites: reorder(current.favorites, favoriteIndex, -1) }))}><ArrowUp className="h-3 w-3" /></Button><Button variant="ghost" size="icon" className="h-7 w-6" disabled={favoriteIndex === preferences.favorites.length - 1} aria-label={`${item.label} ${zh ? '常用下移' : 'move favorite down'}`} onClick={() => update(current => ({ ...current, favorites: reorder(current.favorites, favoriteIndex, 1) }))}><ArrowDown className="h-3 w-3" /></Button></>}
        <Button variant="ghost" size="icon" className="h-7 w-7" aria-label={`${zh ? (pinned ? '取消常用' : '设为常用') : (pinned ? 'Unpin' : 'Pin')} ${item.label}`} aria-pressed={pinned} onClick={() => update(current => ({ ...current, favorites: pinned ? current.favorites.filter(option => option.id !== item.id) : [...current.favorites, { id: item.id, label: item.label, group: item.group }] }))}><Pin className="h-3 w-3" /></Button>
      </>}
    </div>;
  };
  return <div className="space-y-2" data-repository-facet-controls>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex min-w-0 flex-wrap items-center gap-2">{breadcrumb}<span role="status" className="text-xs tabular-nums text-muted-foreground">{resultCount} / {baseCount} {zh ? '个仓库' : 'repositories'}</span></div>
      <Button ref={triggerRef} size="sm" variant={open ? 'secondary' : 'outline'} aria-expanded={open} aria-controls="repository-facet-window" onClick={() => { if (open) { setCollapsed(false); move(anchorPosition()); } else setOpen(true); }}><SlidersHorizontal className="mr-1 h-3.5 w-3.5" />{zh ? '特征筛选' : 'Facet filters'}{activeIds.length > 0 && <span className="ml-1 tabular-nums">({activeIds.length})</span>}</Button>
    </div>
    {activeIds.length > 0 && <div className="flex flex-wrap items-center gap-1.5" aria-label={zh ? '已选特征' : 'Selected facets'}>{activeIds.map(item => <Button key={item.id} size="sm" variant="secondary" className="h-auto min-h-7 max-w-full rounded-full px-2 text-xs" aria-label={`${zh ? '移除' : 'Remove'} ${knownLabels.current.get(item.id) ?? item.id.split(':').slice(1).join(':')}`} onClick={() => toggle(item)}><span className="break-words whitespace-normal">{knownLabels.current.get(item.id) ?? item.id.split(':').slice(1).join(':')}</span><X className="ml-1 h-3 w-3 shrink-0" /></Button>)}<Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => onChange({})}>{clearLabel}</Button></div>}
    {open && createPortal(<div ref={windowRef} id="repository-facet-window" role="dialog" aria-modal="false" aria-labelledby="repository-facet-heading" style={{ left: position.x, top: position.y, width: 'min(380px, calc(100vw - 24px))' }} className="fixed z-50 flex max-h-[70dvh] flex-col overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-xl max-sm:max-h-[60dvh]" onKeyDown={event => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.stopPropagation(); event.preventDefault();
      const target = event.target as HTMLInputElement;
      if (target.type === 'search' && target.value) { setSearch(current => ({ ...current, [target.dataset.group!]: '' })); return; }
      if (customizing) { setCustomizing(false); return; }
      close();
    }}>
      <div className="flex shrink-0 items-center gap-1 border-b border-border p-2">
        <div ref={headerRef} tabIndex={0} role="button" aria-label={zh ? '拖动特征筛选窗口，方向键移动' : 'Drag facet window, use arrow keys to move'} className="flex min-w-0 flex-1 cursor-move touch-none select-none items-center gap-1.5 rounded p-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring" onPointerDown={event => {
          if (event.button !== 0) return;
          event.preventDefault(); event.currentTarget.focus();
          dragRef.current = { pointer: event.pointerId, x: event.clientX, y: event.clientY, origin: position };
          event.currentTarget.setPointerCapture?.(event.pointerId);
        }} onPointerMove={event => {
          const drag = dragRef.current;
          if (drag?.pointer === event.pointerId) move({ x: drag.origin.x + event.clientX - drag.x, y: drag.origin.y + event.clientY - drag.y });
        }} onPointerUp={event => { dragRef.current = null; if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }} onPointerCancel={() => { dragRef.current = null; }} onKeyDown={event => {
          const step = event.shiftKey ? 40 : 10;
          const delta: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
          if (delta[event.key]) { event.preventDefault(); move({ x: position.x + delta[event.key][0], y: position.y + delta[event.key][1] }); }
          if (event.key === 'Home') { event.preventDefault(); update(current => ({ ...current, position: constrain(anchorPosition()) })); }
        }}><GripHorizontal className="h-4 w-4 shrink-0 text-muted-foreground" /><span id="repository-facet-heading" className="text-sm font-medium">{zh ? '特征筛选' : 'Facet filters'} <span className="tabular-nums text-muted-foreground">{resultCount}</span></span></div>
        <Button size="icon" variant="ghost" className="h-7 w-7" aria-label={zh ? '重置窗口位置' : 'Reset window position'} onClick={() => update(current => ({ ...current, position: constrain(anchorPosition()) }))}><RotateCcw className="h-3.5 w-3.5" /></Button>
        <Button size="icon" variant="ghost" className="h-7 w-7" aria-label={zh ? '自定义筛选' : 'Customize filters'} aria-pressed={customizing} onClick={() => { setCollapsed(false); setCustomizing(current => !current); }}><Settings2 className="h-3.5 w-3.5" /></Button>
        <Button size="icon" variant="ghost" className="h-7 w-7" aria-label={collapsed ? (zh ? '展开筛选窗口' : 'Expand filter window') : (zh ? '收起筛选窗口' : 'Collapse filter window')} aria-expanded={!collapsed} onClick={() => setCollapsed(current => !current)}>{collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}</Button>
        <Button size="icon" variant="ghost" className="h-7 w-7" aria-label={zh ? '关闭特征筛选' : 'Close facet filters'} onClick={close}><X className="h-4 w-4" /></Button>
      </div>
      {!collapsed && <div className="min-h-0 space-y-3 overflow-y-auto overscroll-contain p-3">
        <div className="flex items-center justify-between gap-2 text-xs"><span className="text-muted-foreground">{zh ? '组内满足任一，组间同时满足' : 'OR within groups, AND across groups'}</span><Button variant="ghost" size="sm" className="h-7 shrink-0 px-1 text-xs" disabled={!activeIds.length} onClick={() => onChange({})}>{clearLabel}</Button></div>
        {activeIds.length > 0 && <div className="flex flex-wrap gap-1.5" aria-label={zh ? '窗口内已选特征' : 'Selected facets in window'}>{activeIds.map(item => <Button key={item.id} size="sm" variant="secondary" className="h-auto min-h-7 max-w-full rounded-full px-2 text-xs" aria-label={`${zh ? '移除' : 'Remove'} ${knownLabels.current.get(item.id) ?? item.id.split(':').slice(1).join(':')}${zh ? '（窗口内）' : ' (window)'}`} onClick={() => toggle(item)}><span className="break-words whitespace-normal">{knownLabels.current.get(item.id) ?? item.id.split(':').slice(1).join(':')}</span><X className="ml-1 h-3 w-3 shrink-0" /></Button>)}</div>}
        {resultCount === 0 && <p role="status" className="rounded-md bg-muted/50 p-2 text-xs text-muted-foreground">{zh ? (activeIds.length ? '没有符合当前特征的仓库，请移除特征或清除全部。' : '当前分类与搜索条件下暂无仓库。') : (activeIds.length ? 'No repositories match these facets. Remove a facet or clear all.' : 'No repositories in the current category and search.')}</p>}
        {customizing && <div className="space-y-2 rounded-lg bg-muted/50 p-2 text-xs"><p>{zh ? '显示分组、调整顺序，点击图钉保存常用特征。' : 'Choose groups, reorder them, and pin favorite facets.'}</p>{preferences.groups.map((group, index) => <div className="flex items-center gap-1" key={group}><label className="flex flex-1 items-center gap-2"><input type="checkbox" checked={!preferences.hidden.includes(group)} onChange={() => update(current => ({ ...current, hidden: current.hidden.includes(group) ? current.hidden.filter(item => item !== group) : [...current.hidden, group] }))} />{labels[group]}</label><Button size="icon" variant="ghost" className="h-7 w-7" disabled={!index} aria-label={`${labels[group]} ${zh ? '上移' : 'move up'}`} onClick={() => update(current => ({ ...current, groups: reorder(current.groups, index, -1) }))}><ArrowUp className="h-3 w-3" /></Button><Button size="icon" variant="ghost" className="h-7 w-7" disabled={index === preferences.groups.length - 1} aria-label={`${labels[group]} ${zh ? '下移' : 'move down'}`} onClick={() => update(current => ({ ...current, groups: reorder(current.groups, index, 1) }))}><ArrowDown className="h-3 w-3" /></Button></div>)}<Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => update(current => ({ ...defaultFilterPreferences(), position: current.position }))}>{zh ? '恢复默认筛选布局' : 'Reset filter layout'}</Button></div>}
        {favoriteOptions.length > 0 && <section aria-label={zh ? '常用特征' : 'Favorite facets'}><h3 className="mb-1 text-xs font-medium">{zh ? '常用特征' : 'Favorite facets'}</h3>{favoriteOptions.map((item, index) => renderOption(item, index))}</section>}
        {preferences.groups.filter(group => customizing || !preferences.hidden.includes(group)).map(group => {
          const groupOptions = options.filter(item => item.group === group && !favoriteIds.has(item.id));
          const shown = groupOptions.filter(item => item.label.toLocaleLowerCase().includes((search[group] ?? '').trim().toLocaleLowerCase()));
          const expanded = !closedGroups.includes(group);
          return <section key={group} aria-label={labels[group]}><button type="button" className="flex w-full items-center gap-1 py-1 text-left text-xs font-medium" aria-expanded={expanded} onClick={() => setClosedGroups(current => expanded ? [...current, group] : current.filter(item => item !== group))}>{expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}{labels[group]}<span className="ml-auto tabular-nums text-muted-foreground">{groupOptions.length}</span></button>{expanded && <><input type="search" data-group={group} aria-label={`${labels[group]} ${zh ? '特征搜索' : 'facet search'}`} placeholder={zh ? '搜索特征…' : 'Search facets…'} value={search[group] ?? ''} onChange={event => setSearch(current => ({ ...current, [group]: event.target.value }))} className="my-1 h-8 w-full rounded-md border border-input bg-background px-2 text-xs" />{shown.map(item => renderOption(item))}{!shown.length && <p className="py-2 text-xs text-muted-foreground">{zh ? (groupOptions.length ? '没有匹配的特征' : '暂无已记录特征') : (groupOptions.length ? 'No matching facets' : 'No recorded facets')}</p>}</>}</section>;
        })}
      </div>}
    </div>, document.body)}
  </div>;
}
