import { useT } from '../../../i18n/useT';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Minus, Plus, Expand, Move, Maximize2, X } from 'lucide-react';
import { Button } from '../../../components/ui/button';
import type { Repository } from '../../../types';
import { layoutExploration, retainLayoutPositions, type MapNode } from './graphLayout';
import type { ExplorationCamera, ExplorationFocus, ExplorationScene } from './types';

interface Props {
  scene: ExplorationScene; focus: ExplorationFocus; repositories: Repository[];
  onFocus: (focus: ExplorationFocus) => void; onSelect: (id: number, anchor: Element) => void; onBlank: () => void; onAllTopics: () => void;
  initialCamera?: ExplorationCamera; viewKey?: string; onCameraChange?: (camera: ExplorationCamera) => void;
  initialPositions?: Record<string,{x:number;y:number}>; onLayoutChange?: (positions: Record<string,{x:number;y:number}>) => void;
  onMoreProjects?: () => void;
  selectedRepositoryId?: number;
  insets?: { left: number; right: number; top: number; bottom: number };
}
const palette = ['#368c82', '#657dcc', '#b68035', '#a9698c', '#7a6ab3', '#63874c'];
const lineColors = { membership: '#8b9c98', direct: '#368c82', interoperable: '#657dcc', similar: '#a77b30', discovery: '#9878a5' };
export function ExplorationMap({ scene, focus, repositories, onFocus, onSelect, onBlank, onAllTopics, initialCamera, viewKey = '', onCameraChange, initialPositions, onLayoutChange, onMoreProjects, selectedRepositoryId, insets }: Props) {
  const t = useT('repositories');
  const viewport = useRef<HTMLDivElement>(null);
  const [camera, setCamera] = useState<ExplorationCamera>({ zoom: 1, x: 0, y: 0 });
  const [expanded, setExpanded] = useState(false), [full, setFull] = useState(false), [active, setActive] = useState('');
  const drag = useRef<{ x: number; y: number; camera: ExplorationCamera; moved: boolean } | null>(null);
  const repos = useMemo(() => new Map(repositories.map(repo => [repo.id, repo])), [repositories]);
  const scopeKey = JSON.stringify(focus), layoutKey = `${viewKey}:${scopeKey}`;
  const placements = useRef(new Map<string,Record<string,{x:number;y:number}>>());
  const initialView = useRef('');
  const layout = useMemo(() => {
    let next = layoutExploration(scene, focus, new Map(repositories.map(repo => [repo.id, repo.name])), expanded, selectedRepositoryId);
    const prior = placements.current.get(layoutKey) ?? (initialView.current !== viewKey ? initialPositions : undefined);
    if (prior) next = retainLayoutPositions(next,prior);
    initialView.current = viewKey;
    placements.current.set(layoutKey,Object.fromEntries(next.nodes.map(node=>[node.id,{x:node.x,y:node.y}])));
    if(placements.current.size>40) placements.current.delete(placements.current.keys().next().value!);
    return next;
  }, [scene, focus, repositories, expanded, layoutKey, viewKey, initialPositions, selectedRepositoryId]);
  const layoutCallback = useRef(onLayoutChange);layoutCallback.current=onLayoutChange;
  useEffect(()=>{layoutCallback.current?.(Object.fromEntries(layout.nodes.map(node=>[node.id,{x:node.x,y:node.y}])));},[layout]);
  const byId = useMemo(() => new Map(layout.nodes.map(node => [node.id, node])), [layout]);
  const neighbors = new Set(layout.edges.filter(edge => edge.source === active || edge.target === active).flatMap(edge => [edge.source, edge.target]));
  const fit = (readable = false) => { const rect = viewport.current?.getBoundingClientRect(); if (!rect?.width || !rect.height) return;
    if (!layout.nodes.length) return;
    const left = Math.min(...layout.nodes.map(node => node.x-node.width/2))-28, right = Math.max(...layout.nodes.map(node => node.x+node.width/2))+28;
    const top = Math.min(...layout.nodes.map(node => node.y-node.height/2))-28, bottom = Math.max(...layout.nodes.map(node => node.y+node.height/2))+28;
    const space = insets ?? { left: 0, right: 0, top: 0, bottom: 0 };
    const width = Math.max(100, rect.width - space.left - space.right), height = Math.max(100, rect.height - space.top - space.bottom);
    const zoom = Math.max(readable ? .75 : .1, Math.min(1.15, (width - 16) / (right-left), (height - 16) / (bottom-top)));
    setCamera({ zoom, x: space.left + (width - (right-left)*zoom)/2-left*zoom, y: space.top + Math.max(0,(height - (bottom-top)*zoom)/2)-top*zoom });
  };
  const fitRef = useRef(() => fit(true)); fitRef.current = () => fit(true);
  const initialRef = useRef(initialCamera); initialRef.current = initialCamera;
  const lastKey = useRef(''), restored = useRef(false);
  useLayoutEffect(() => {
    const key = `${viewKey}:${scopeKey}`;
    if (lastKey.current !== key) { const firstView = !lastKey.current.startsWith(`${viewKey}:`); lastKey.current = key; setActive(''); setExpanded(false);
      restored.current = firstView && !!initialRef.current;
      if (restored.current) setCamera(initialRef.current!); else fitRef.current(); }
  }, [viewKey, scopeKey]);
  useLayoutEffect(() => {
    const element = viewport.current; if (!element) return;
    let previous: { width: number; height: number } | undefined;
    const observer = new ResizeObserver(() => {
      const rect = element.getBoundingClientRect(); if (!rect.width || !rect.height) return;
      if (previous) {
        const dx = (rect.width - previous.width) / 2, dy = (rect.height - previous.height) / 2;
        if (dx || dy) setCamera(current => ({ ...current, x: current.x + dx, y: current.y + dy }));
      } else if (!initialRef.current) fitRef.current();
      previous = { width: rect.width, height: rect.height };
    });
    observer.observe(element); return () => observer.disconnect();
  }, []);
  const selectionView = useRef({ layout, insets }); selectionView.current = { layout, insets };
  const selectionRestored = useRef(!!initialCamera);
  useEffect(() => {
    if (selectionRestored.current) { selectionRestored.current = false; return; }
    if (!selectedRepositoryId) return;
    const { layout, insets } = selectionView.current;
    const node = layout.nodes.find(node => node.repositoryId === selectedRepositoryId), rect = viewport.current?.getBoundingClientRect();
    if (!node || !rect?.width) return;
    setActive(node.id);
    setCamera(current => ({ ...current, x: (rect.width - (insets?.right ?? 0) + (insets?.left ?? 0)) / 2 - node.x * current.zoom, y: rect.height / 2 - node.y * current.zoom }));
    // Selection centers once; folding panels must not move the camera.
  }, [selectedRepositoryId]);
  const previousNodes = useRef(''), previousExpanded = useRef(expanded);
  useLayoutEffect(() => { const key = layout.nodes.map(node => node.id).join('|'); if (!restored.current && (!previousNodes.current || previousExpanded.current !== expanded)) fitRef.current(); restored.current = false; previousNodes.current = key; previousExpanded.current = expanded; }, [layout,expanded]);
  const cameraCallback = useRef(onCameraChange); cameraCallback.current = onCameraChange;
  useEffect(() => { cameraCallback.current?.(camera); }, [camera]);
  const zoom = (factor: number) => setCamera(current => { const rect = viewport.current?.getBoundingClientRect(); const next = Math.min(4, Math.max(.1, current.zoom * factor));
    const cx = (rect?.width ?? 600) / 2, cy = (rect?.height ?? 500) / 2; return { zoom: next, x: cx - (cx - current.x) * next / current.zoom, y: cy - (cy - current.y) * next / current.zoom }; });
  const zoomRef = useRef(zoom); zoomRef.current = zoom;
  useEffect(() => { const element = viewport.current; if (!element) return; const wheel = (event: WheelEvent) => { if (event.ctrlKey || event.metaKey) { event.preventDefault(); zoomRef.current(event.deltaY > 0 ? .9 : 1.1); } }; element.addEventListener('wheel', wheel, { passive: false }); return () => element.removeEventListener('wheel', wheel); }, []);
  useEffect(() => { if (!full) return; const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setFull(false); }; window.addEventListener('keydown', close); return () => window.removeEventListener('keydown', close); }, [full]);
  const nodeLabel = (node: MapNode) => node.id==='library-overview' ? t('exploration.all-library-topics') : node.type === 'more' ? t(`exploration.${node.id}`) : node.label;
  return <section className={`explore-map-shell ${full ? 'is-fullscreen' : ''} ${camera.zoom < .5 ? 'is-overview-scale' : ''}`} aria-label={t('exploration.project-relationship-map')}>
    <div className="explore-map-toolbar"><span title={t('exploration.drag-to-pan-ctrl-scroll-to-zoom')}><Move size={13} /></span><div>
      <Button size="icon" variant="ghost" aria-label={t('exploration.zoom-out-map')} onClick={() => zoom(.85)}><Minus size={15} /></Button><span>{Math.round(camera.zoom * 100)}%</span>
      <Button size="icon" variant="ghost" aria-label={t('exploration.zoom-in-map')} onClick={() => zoom(1.15)}><Plus size={15} /></Button><Button size="icon" variant="ghost" aria-label={t('exploration.fit-canvas-and-reset')} onClick={() => fit()}><Expand size={15} /></Button>
      <Button size="icon" variant="ghost" aria-label={full ? t('exploration.exit-map-fullscreen') : t('exploration.view-map-fullscreen')} onClick={() => setFull(value => !value)}>{full ? <X size={15} /> : <Maximize2 size={15} />}</Button>
    </div></div>
    <div ref={viewport} className="explore-map-viewport" tabIndex={0} aria-label={t('exploration.relationship-canvas-arrow-keys-pan-home-resets')} onKeyDown={event => {
      if (event.target !== event.currentTarget) return;
      const delta = ({ ArrowLeft: [30, 0], ArrowRight: [-30, 0], ArrowUp: [0, 30], ArrowDown: [0, -30] } as Record<string, number[]>)[event.key];
      if (delta) { event.preventDefault(); setCamera(current => ({ ...current, x: current.x + delta[0], y: current.y + delta[1] })); }
      if (event.key === 'Home') { event.preventDefault(); fit(); }
    }} onPointerDown={event => { if (event.button !== 0 || (event.target as Element).closest('button,a,input')) return; drag.current = { x: event.clientX, y: event.clientY, camera, moved: false }; event.currentTarget.setPointerCapture(event.pointerId); }}
    onPointerMove={event => { if (!drag.current) return; const dx = event.clientX - drag.current.x, dy = event.clientY - drag.current.y; if (Math.abs(dx) + Math.abs(dy) > 4) drag.current.moved = true; setCamera({ ...drag.current.camera, x: drag.current.camera.x + dx, y: drag.current.camera.y + dy }); }}
    onPointerUp={event => { if (drag.current && !drag.current.moved) onBlank(); drag.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }} onPointerCancel={() => { drag.current = null; }}>
      <div className="explore-world" style={{ width: layout.width, height: layout.height, transform: `translate(${camera.x}px,${camera.y}px) scale(${camera.zoom})` }}>
        <svg className="explore-lines" width={layout.width} height={layout.height} aria-hidden="true">
          {layout.regions.map(region => <ellipse key={region.id} cx={region.x} cy={region.y} rx={region.radius + 20} ry={region.radius} fill={palette[region.color]} fillOpacity=".045" stroke={palette[region.color]} strokeOpacity=".15" strokeDasharray="3 7" />)}
          {layout.edges.map(edge => { const a = byId.get(edge.source)!, b = byId.get(edge.target)!; const highlighted = !active || edge.source === active || edge.target === active;
            const end = { x:b.x, y:b.y-b.height/2+13 }, dx=end.x-a.x, dy=end.y-a.y;
            const fraction = a.type === 'focus' ? 1/Math.sqrt((dx/(a.width/2+5))**2+(dy/(a.height/2+5))**2) : 0;
            const start = {x:a.x+dx*fraction,y:a.y+dy*fraction};
            return <g key={`${edge.source}:${edge.target}`} opacity={highlighted ? .85 : .12}><path d={`M${start.x},${start.y} Q${(start.x+end.x)/2+(start.y-end.y)*.08},${(start.y+end.y)/2+(end.x-start.x)*.08} ${end.x},${end.y}`} stroke={lineColors[edge.kind]} strokeWidth={active && highlighted ? 2.6 : 1.6} strokeDasharray={edge.verified ? undefined : '5 5'} fill="none" />
              {edge.label && <text x={start.x*.4+end.x*.6} y={start.y*.4+end.y*.6-9} textAnchor="middle" fill={lineColors[edge.kind]} fontSize="12" stroke="hsl(var(--card))" strokeWidth="4" paintOrder="stroke">{edge.label}</text>}</g>; })}
        </svg>
        {layout.nodes.map(node => <button key={node.id} aria-pressed={node.repositoryId ? node.repositoryId === selectedRepositoryId : undefined} className={`explore-graph-node node-${node.type} ${active && !neighbors.has(node.id) && active !== node.id ? 'is-dimmed' : ''}`} style={{ left: node.x - node.width/2, top: node.y-node.height/2, width:node.width, height:node.height, '--node-color':palette[node.color], '--node-text-size': `${Math.max(14,12/camera.zoom)}px`, '--repo-text-size': `${Math.max(11,10/camera.zoom)}px`, '--count-text-size':`${Math.max(11,10/camera.zoom)}px`, '--overview-label-width': `${100/camera.zoom}px` } as React.CSSProperties}
          title={node.repositoryId ? repos.get(node.repositoryId)?.full_name : nodeLabel(node)} aria-label={node.type === 'repository' ? t('exploration.view-project', { name: node.label }) : `${node.kind ? t(`exploration.relations.${node.kind}`) + ' ' : ''}${nodeLabel(node)}${node.count !== undefined ? t('exploration.project-count', { count: node.count }) : ''}`}
          onMouseEnter={() => setActive(node.id)} onMouseLeave={() => setActive('')} onFocus={() => setActive(node.id)} onBlur={() => setActive('')}
          onClick={event => { if (node.type === 'repository') onSelect(node.repositoryId!, event.currentTarget); else if (node.focus) onFocus(node.focus); else if (node.type === 'more') { if (node.id === 'more-topics') onAllTopics(); else if (node.id === 'more-projects' && expanded) onMoreProjects?.(); else setExpanded(true); } }}>
          {node.type === 'repository' ? <><span className="explore-graph-dot">{repos.get(node.repositoryId!)?.owner.avatar_url ? <img src={repos.get(node.repositoryId!)!.owner.avatar_url} alt="" loading="lazy" /> : node.label[0]?.toUpperCase()}</span><strong>{nodeLabel(node)}</strong>{node.description && <small className="explore-node-description">{node.description}</small>}</> : <><span className="explore-node-mark">{node.type === 'focus' ? '◎' : node.type === 'more' ? '+' : '◉'}</span><strong>{nodeLabel(node)}</strong>{node.count !== undefined && <small>{node.count} {node.id === 'more-topics' ? t('exploration.topics') : node.id === 'more-branches' ? t('exploration.directions') : t('exploration.projects')}</small>}</>}
        </button>)}
      </div>
      {!layout.nodes.length && <div className="explore-map-empty">{t('exploration.no-topics-yet')}</div>}
    </div>
    <div className="explore-map-footer" title={t('exploration.topic-branch-project-solid-verified-dashed-membership-or')}>{focus.type === 'all' && <Button variant="ghost" size="sm" onClick={onAllTopics}>{t('exploration.all-topics')}{scene.topics.length})</Button>}</div>
  </section>;
}
