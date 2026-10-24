import { useT } from '../../../i18n/useT';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Minus, Plus, Expand, Move, Maximize2, X } from 'lucide-react';
import { Button } from '../../../components/ui/button';
import type { Repository } from '../../../types';
import { layoutExploration, type MapNode } from './graphLayout';
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
export function ExplorationMap({ scene, focus, repositories, onFocus, onSelect, onBlank, onAllTopics, initialCamera, viewKey = '', onCameraChange, onLayoutChange, selectedRepositoryId, insets }: Props) {
  const t = useT('repositories');
  const viewport = useRef<HTMLDivElement>(null);
  const linesCanvas=useRef<HTMLCanvasElement>(null);
  const [viewportSize,setViewportSize]=useState({width:0,height:0});
  const [camera, setCamera] = useState<ExplorationCamera>({ zoom: 1, x: 0, y: 0 });
  const [full, setFull] = useState(false), [active, setActive] = useState('');
  const drag = useRef<{ x: number; y: number; camera: ExplorationCamera; moved: boolean } | null>(null);
  const repos = useMemo(() => new Map(repositories.map(repo => [repo.id, repo])), [repositories]);
  const scopeKey = JSON.stringify(focus);
  const layout = useMemo(() => layoutExploration(scene, focus, new Map(repositories.map(repo=>[repo.id,repo.name]))),[scene,focus,repositories]);
  const layoutCallback = useRef(onLayoutChange);layoutCallback.current=onLayoutChange;
  useEffect(()=>{layoutCallback.current?.(Object.fromEntries(layout.nodes.map(node=>[node.id,{x:node.x,y:node.y}])));},[layout]);
  const byId = useMemo(() => new Map(layout.nodes.map(node => [node.id, node])), [layout]);
  const activeNode=byId.has(active)?active:'';
  const neighbors = useMemo(()=>new Set(layout.edges.filter(edge => edge.source === activeNode || edge.target === activeNode).flatMap(edge => [edge.source, edge.target])),[layout,activeNode]);
  const fit = (overview = false) => { const rect = viewport.current?.getBoundingClientRect(); if (!rect?.width || !rect.height) return;
    if (!layout.nodes.length) return;
    const left = Math.min(...layout.nodes.map(node => node.x-node.width/2))-28, right = Math.max(...layout.nodes.map(node => node.x+node.width/2))+28;
    const top = Math.min(...layout.nodes.map(node => node.y-node.height/2))-28, bottom = Math.max(...layout.nodes.map(node => node.y+node.height/2))+28;
    const space = insets ?? { left: 0, right: 0, top: 0, bottom: 0 };
    const width = Math.max(100, rect.width - space.left - space.right), height = Math.max(100, rect.height - space.top - space.bottom);
    const zoom = Math.max(overview ? .1 : .7, Math.min(1.15, (width - 16) / (right-left), (height - 16) / (bottom-top)));
    setCamera({ zoom, x: space.left+width/2-(overview?(left+right)/2:layout.nodes[0].x)*zoom, y:space.top+height/2-(overview?(top+bottom)/2:layout.nodes[0].y)*zoom });
  };
  const fitRef = useRef(() => fit()); fitRef.current = () => fit();
  const initialRef = useRef(initialCamera); initialRef.current = initialCamera;
  const lastKey = useRef(''), restored = useRef(false);
  useLayoutEffect(() => {
    const key = `${viewKey}:${scopeKey}`;
    if (lastKey.current !== key) { const firstView = !lastKey.current.startsWith(`${viewKey}:`); lastKey.current = key; setActive('');
      restored.current = firstView && !!initialRef.current;
      if (restored.current) setCamera(initialRef.current!); else fitRef.current(); }
  }, [viewKey, scopeKey]);
  useLayoutEffect(() => {
    const element = viewport.current; if (!element) return;
    let previous: { width: number; height: number } | undefined;
    const observer = new ResizeObserver(() => {
      const rect = element.getBoundingClientRect(); if (!rect.width || !rect.height) return;
      setViewportSize(current=>current.width===rect.width&&current.height===rect.height?current:{width:rect.width,height:rect.height});
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
  const cameraCallback = useRef(onCameraChange); cameraCallback.current = onCameraChange;
  useEffect(() => { cameraCallback.current?.(camera); }, [camera]);
  const zoom = (factor: number) => setCamera(current => { const rect = viewport.current?.getBoundingClientRect(); const next = Math.min(4, Math.max(.1, current.zoom * factor));
    const cx = (rect?.width ?? 600) / 2, cy = (rect?.height ?? 500) / 2; return { zoom: next, x: cx - (cx - current.x) * next / current.zoom, y: cy - (cy - current.y) * next / current.zoom }; });
  const cameraLive=useRef(camera);cameraLive.current=camera;
  const pendingCamera=useRef<ExplorationCamera>(),frame=useRef<number>();
  const enqueue=(update:(current:ExplorationCamera)=>ExplorationCamera)=>{
    pendingCamera.current=update(pendingCamera.current??cameraLive.current);
    if(frame.current===undefined)frame.current=requestAnimationFrame(()=>{frame.current=undefined;const next=pendingCamera.current;pendingCamera.current=undefined;if(next)setCamera(next);});
  };
  const enqueueRef=useRef(enqueue);enqueueRef.current=enqueue;
  useEffect(()=>()=>{if(frame.current!==undefined)cancelAnimationFrame(frame.current);frame.current=undefined;pendingCamera.current=undefined;},[scopeKey,viewKey]);
  useEffect(()=>{
    const element=viewport.current;if(!element)return;
    const wheel=(event:WheelEvent)=>{
      if(!event.deltaY)return;event.preventDefault();
      const rect=element.getBoundingClientRect(),x=event.clientX-rect.left,y=event.clientY-rect.top;
      const delta=Math.max(-120,Math.min(120,event.deltaY*(event.deltaMode===1?16:event.deltaMode===2?rect.height:1)));
      enqueueRef.current(current=>{const next=Math.max(.1,Math.min(4,current.zoom*Math.exp(-delta*.002)));return {zoom:next,x:x-(x-current.x)*next/current.zoom,y:y-(y-current.y)*next/current.zoom};});
    };
    element.addEventListener('wheel',wheel,{passive:false});return()=>element.removeEventListener('wheel',wheel);
  },[]);
  useEffect(() => { if (!full) return; const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setFull(false); }; window.addEventListener('keydown', close); return () => window.removeEventListener('keydown', close); }, [full]);
  const nodeLabel = useCallback((node: MapNode) => node.label==='library-overview' ? t('exploration.all-library-topics') : node.label.startsWith('group:') ? t(`radial.groups.${node.label.slice(6)}`) : node.label.startsWith('relation:') ? t(`exploration.relations.${node.label.slice(9)}`) : node.type === 'more' ? t(`exploration.${node.id}`) : node.label,[t]);
  useLayoutEffect(()=>{
    const canvas=linesCanvas.current;
    if(!canvas||!viewportSize.width||!viewportSize.height||typeof CanvasRenderingContext2D==='undefined')return;
    const ctx=canvas.getContext('2d');if(!ctx)return;
    const ratio=window.devicePixelRatio||1,w=Math.round(viewportSize.width*ratio),h=Math.round(viewportSize.height*ratio);
    if(canvas.width!==w)canvas.width=w;if(canvas.height!==h)canvas.height=h;
    ctx.setTransform(ratio,0,0,ratio,0,0);ctx.clearRect(0,0,viewportSize.width,viewportSize.height);
    ctx.translate(camera.x,camera.y);ctx.scale(camera.zoom,camera.zoom);
    const groups=new Map<string,{path:Path2D;color:string;verified:boolean;highlighted:boolean}>();
    for(const edge of layout.edges){
      const a=byId.get(edge.source)!,b=byId.get(edge.target)!,highlighted=!activeNode||edge.source===activeNode||edge.target===activeNode;
      const key=`${edge.kind}:${edge.verified}:${highlighted}`;
      let group=groups.get(key);if(!group){group={path:new Path2D(),color:lineColors[edge.kind],verified:edge.verified,highlighted};groups.set(key,group);}
      const dx=b.x-a.x,dy=b.y-a.y;
      const fraction=(node:MapNode)=>Math.min(node.width/(2*Math.max(.001,Math.abs(dx))),node.height/(2*Math.max(.001,Math.abs(dy))));
      const start={x:a.x+dx*fraction(a),y:a.y+dy*fraction(a)},end={x:b.x-dx*fraction(b),y:b.y-dy*fraction(b)};
      group.path.moveTo(start.x,start.y);group.path.quadraticCurveTo((start.x+end.x)/2+(start.y-end.y)*.08,(start.y+end.y)/2+(end.x-start.x)*.08,end.x,end.y);
    }
    for(const group of groups.values()){ctx.globalAlpha=group.highlighted?.7:.1;ctx.strokeStyle=group.color;ctx.lineWidth=(activeNode&&group.highlighted?2.3:1.2)/camera.zoom;ctx.setLineDash(group.verified?[]:[5/camera.zoom,5/camera.zoom]);ctx.stroke(group.path);}
  },[layout,byId,camera,activeNode,viewportSize]);
  const visibleNodes=useMemo(()=>{
    if(!viewportSize.width||!viewportSize.height)return layout.nodes;
    return layout.nodes.filter(node=>{const x=node.x*camera.zoom+camera.x,y=node.y*camera.zoom+camera.y,w=node.width*camera.zoom/2+100,h=node.height*camera.zoom/2+100;return x+w>=0&&x-w<=viewportSize.width&&y+h>=0&&y-h<=viewportSize.height;});
  },[layout,viewportSize,camera]);
  const renderedNodes=useMemo(()=><>
        {visibleNodes.map(node => <button key={node.id} aria-pressed={node.repositoryId ? node.repositoryId === selectedRepositoryId : undefined} className={`explore-graph-node node-${node.type} ${activeNode && !neighbors.has(node.id) && activeNode !== node.id ? 'is-dimmed' : ''}`} style={{ left: node.x - node.width/2, top: node.y-node.height/2, width:node.width, height:node.height, '--node-color':palette[node.color] } as React.CSSProperties}
          title={node.repositoryId ? repos.get(node.repositoryId)?.full_name : nodeLabel(node)} aria-label={node.type === 'repository' ? t('exploration.view-project', { name: node.label }) : `${node.kind ? t(`exploration.relations.${node.kind}`) + ' ' : ''}${nodeLabel(node)}${node.count !== undefined ? t('exploration.project-count', { count: node.count }) : ''}`}
          onMouseEnter={() => setActive(node.id)} onMouseLeave={() => setActive('')} onFocus={() => setActive(node.id)} onBlur={() => setActive('')}
          onClick={event => { if(node.repositoryId && node.type==='focus')onSelect(node.repositoryId,event.currentTarget); else if (node.type === 'repository') onSelect(node.repositoryId!, event.currentTarget); else if (node.focus) onFocus(node.focus.type==='all'?node.focus:{...node.focus,label:nodeLabel(node)}); else if(node.type==='more')onAllTopics(); }}>
          {node.type === 'repository' ? <><span className="explore-graph-dot">{repos.get(node.repositoryId!)?.owner.avatar_url ? <img src={repos.get(node.repositoryId!)!.owner.avatar_url} alt="" loading="lazy" /> : node.label[0]?.toUpperCase()}</span><strong>{nodeLabel(node)}</strong>{node.description && <small className="explore-node-description">{node.description}</small>}</> : <><span className="explore-node-mark">{node.type === 'focus' ? '◎' : node.type === 'more' ? '+' : '◉'}</span><strong>{nodeLabel(node)}</strong>{node.count !== undefined && <small>{node.count} {node.id === 'more-topics' ? t('exploration.topics') : node.id === 'more-branches' ? t('exploration.directions') : t('exploration.projects')}</small>}</>}
        </button>)}
  </>,[visibleNodes,activeNode,neighbors,repos,selectedRepositoryId,nodeLabel,t,onSelect,onFocus,onAllTopics]);

  return <section className={`explore-map-shell ${full ? 'is-fullscreen' : ''} ${camera.zoom < .5 ? 'is-overview-scale' : ''}`} aria-label={t('exploration.project-relationship-map')}>
    <div className="explore-map-toolbar"><span title={t('exploration.drag-to-pan-ctrl-scroll-to-zoom')}><Move size={13} /></span><div>
      <Button size="icon" variant="ghost" aria-label={t('exploration.zoom-out-map')} onClick={() => zoom(.85)}><Minus size={15} /></Button><span>{Math.round(camera.zoom * 100)}%</span>
      <Button size="icon" variant="ghost" aria-label={t('exploration.zoom-in-map')} onClick={() => zoom(1.15)}><Plus size={15} /></Button><Button size="icon" variant="ghost" aria-label={t('exploration.fit-canvas-and-reset')} onClick={() => fit(true)}><Expand size={15} /></Button>
      <Button size="icon" variant="ghost" aria-label={full ? t('exploration.exit-map-fullscreen') : t('exploration.view-map-fullscreen')} onClick={() => setFull(value => !value)}>{full ? <X size={15} /> : <Maximize2 size={15} />}</Button>
    </div></div>
    <div ref={viewport} className="explore-map-viewport" tabIndex={0} aria-label={t('exploration.relationship-canvas-arrow-keys-pan-home-resets')} onKeyDown={event => {
      if (event.target !== event.currentTarget) return;
      const delta = ({ ArrowLeft: [30, 0], ArrowRight: [-30, 0], ArrowUp: [0, 30], ArrowDown: [0, -30] } as Record<string, number[]>)[event.key];
      if (delta) { event.preventDefault(); setCamera(current => ({ ...current, x: current.x + delta[0], y: current.y + delta[1] })); }
      if (event.key === 'Home') { event.preventDefault(); fit(true); }
    }} onPointerDown={event => { if (event.button !== 0 || (event.target as Element).closest('button,a,input')) return; drag.current = { x: event.clientX, y: event.clientY, camera, moved: false }; event.currentTarget.setPointerCapture(event.pointerId); }}
    onPointerMove={event => { if (!drag.current) return; const dx = event.clientX - drag.current.x, dy = event.clientY - drag.current.y; if (Math.abs(dx) + Math.abs(dy) > 4) drag.current.moved = true; const start=drag.current.camera;enqueue(()=>({...start,x:start.x+dx,y:start.y+dy})); }}
    onPointerUp={event => { if (drag.current && !drag.current.moved) onBlank(); drag.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }} onPointerCancel={() => { drag.current = null; }}>
      <canvas ref={linesCanvas} className="explore-lines explore-canvas-lines" data-edge-count={layout.edges.length} aria-hidden="true"/>
      <div className="explore-world" data-total-nodes={layout.nodes.length} style={{ width:0,height:0, transform: `translate(${camera.x}px,${camera.y}px) scale(${camera.zoom})`, '--node-text-size':'18px', '--repo-text-size':'16px', '--count-text-size':'14px' } as React.CSSProperties}>
        {renderedNodes}
      </div>
      {!layout.nodes.length && <div className="explore-map-empty">{t('exploration.no-topics-yet')}</div>}
    </div>
    <div className="explore-map-footer" title={t('exploration.topic-branch-project-solid-verified-dashed-membership-or')}>{focus.type === 'all' && <Button variant="ghost" size="sm" onClick={onAllTopics}>{t('exploration.all-topics')}{scene.topics.length})</Button>}</div>
  </section>;
}
