import { useT } from '../../../i18n/useT';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Minus, Plus, Expand, Move, Maximize2, X, LocateFixed } from 'lucide-react';
import { Button } from '../../../components/ui/button';
import type { Repository } from '../../../types';
import { layoutExploration, explorationNodeLabel, computeLayerSatellites, type ExplorationLevel, type MapNode } from './graphLayout';
import { explorationViewportCache } from '../hooks/useExplorationWorkspace';
import { overviewCamera, zoomCamera, hitOverviewNode, labelPlacement, emptyInsets } from './mapGeometry';
import type { ExplorationCamera, ExplorationFocus, ExplorationScene } from './types';

interface Props {
  level?: ExplorationLevel; scene: ExplorationScene; focus: ExplorationFocus; repositories: Repository[];
  onFocus: (focus: ExplorationFocus) => void; onSelect: (id: number, anchor: Element) => void; onBlank: () => void; onAllTopics: () => void;
  initialCamera?: ExplorationCamera; viewKey?: string; onCameraChange?: (camera: ExplorationCamera) => void;
  initialPositions?: Record<string,{x:number;y:number}>; onLayoutChange?: (positions: Record<string,{x:number;y:number}>) => void;
  onMoreProjects?: () => void;
  selectedRepositoryId?: number;
  insets?: { left: number; right: number; top: number; bottom: number };
}
const palette = ['#368c82', '#657dcc', '#b68035', '#a9698c', '#7a6ab3', '#63874c'];
const lineColors = { membership: '#8b9c98', direct: '#368c82', interoperable: '#657dcc', similar: '#a77b30', discovery: '#9878a5' };
export function ExplorationMap({ level, scene, focus, repositories, onFocus, onSelect, onBlank, onAllTopics, initialCamera, viewKey = '', onCameraChange, onLayoutChange, selectedRepositoryId, insets }: Props) {
  const t = useT('repositories');
  const viewport = useRef<HTMLDivElement>(null);
  const linesCanvas=useRef<HTMLCanvasElement>(null);
  const [viewportSize,setViewportSize]=useState({width:0,height:0});
  const [camera, setCamera] = useState<ExplorationCamera>({ zoom: 1, x: 0, y: 0 });
  const [full, setFull] = useState(false), [active, setActive] = useState('');
  const drag = useRef<{ x: number; y: number; camera: ExplorationCamera; moved: boolean } | null>(null);
  const repos = useMemo(() => new Map(repositories.map(repo => [repo.id, repo])), [repositories]);
  const scopeKey = JSON.stringify(focus);
  const layout = useMemo(() => level?.layout ?? layoutExploration(scene, focus, new Map(repositories.map(repo=>[repo.id,repo.name]))),[level,scene,focus,repositories]);
  const layoutCallback = useRef(onLayoutChange);layoutCallback.current=onLayoutChange;
  useEffect(()=>{layoutCallback.current?.(Object.fromEntries(layout.nodes.map(node=>[node.id,{x:node.x,y:node.y}])));},[layout]);
  const byId = useMemo(() => new Map(layout.nodes.map(node => [node.id, node])), [layout]);
  const activeNode=byId.has(active)?active:'';
  const neighbors = useMemo(()=>new Set(layout.edges.filter(edge => edge.source === activeNode || edge.target === activeNode).flatMap(edge => [edge.source, edge.target])),[layout,activeNode]);
  const cameraLive=useRef(camera); cameraLive.current=camera;
  const pendingCamera=useRef<ExplorationCamera>(),frame=useRef<number>();
  const commitCamera=useCallback((update:React.SetStateAction<ExplorationCamera>)=>{
    const next=typeof update==='function'?update(pendingCamera.current??cameraLive.current):update;
    if(frame.current!==undefined)cancelAnimationFrame(frame.current);
    frame.current=undefined;pendingCamera.current=undefined;cameraLive.current=next;setCamera(next);
  },[]);
  const cacheKey = `${viewKey}:${scopeKey}`;
  const overview = () => { const rect=viewport.current?.getBoundingClientRect(); return rect?.width && rect.height ? overviewCamera(layout,rect.width,rect.height,insets) : undefined; };
  const fit = () => { const next=overview(); if(next){cameraLive.current=next;commitCamera(next);} };
  const fitRef = useRef(() => fit()); fitRef.current = () => fit();
  const initialRef = useRef(initialCamera); initialRef.current = initialCamera;
  const appliedInitial=useRef<ExplorationCamera>();
  const restored = useRef(false);
  useLayoutEffect(() => {
    const key = cacheKey;
    const cached = viewKey ? explorationViewportCache.read(key)?.camera : undefined;
    const supplied=initialRef.current!==appliedInitial.current?initialRef.current:undefined;
    if(supplied)appliedInitial.current=supplied;
    setActive('');restored.current=!!(supplied??cached);
    if(supplied??cached){cameraLive.current=(supplied??cached)!;commitCamera((supplied??cached)!);}else fitRef.current();
    return () => {if(viewKey)explorationViewportCache.write(key,{camera:pendingCamera.current??cameraLive.current});};
  }, [cacheKey,viewKey,commitCamera]);
  useLayoutEffect(() => {
    const element = viewport.current; if (!element) return;
    let previous: { width: number; height: number } | undefined;
    const observer = new ResizeObserver(() => {
      const rect = element.getBoundingClientRect(); if (!rect.width || !rect.height) return;
      setViewportSize(current=>current.width===rect.width&&current.height===rect.height?current:{width:rect.width,height:rect.height});
      if (previous) {
        const dx = (rect.width - previous.width) / 2, dy = (rect.height - previous.height) / 2;
        if (dx || dy) commitCamera(current => ({ ...current, x: current.x + dx, y: current.y + dy }));
      } else if (!restored.current) fitRef.current();
      previous = { width: rect.width, height: rect.height };
    });
    observer.observe(element); return () => observer.disconnect();
  }, [commitCamera]);
  const selectionView = useRef({ layout, insets }); selectionView.current = { layout, insets };
  const selectionRestored = useRef(!!initialCamera);
  useLayoutEffect(()=>{selectionRestored.current=restored.current;},[cacheKey]);
  useEffect(() => {
    if (selectionRestored.current) { selectionRestored.current = false; return; }
    if (!selectedRepositoryId) {setActive('');return;}
    const { layout, insets } = selectionView.current;
    const node = layout.nodes.find(node => node.repositoryId === selectedRepositoryId), rect = viewport.current?.getBoundingClientRect();
    if (!node || !rect?.width) return;
    setActive(node.id);
    commitCamera(current=>{const space=insets??emptyInsets,zoom=Math.max(.75,current.zoom);return {zoom,x:(space.left+rect.width-space.right)/2-node.x*zoom,y:(space.top+rect.height-space.bottom)/2-node.y*zoom};});
    // Selection centers once; folding panels must not move the camera.
  }, [selectedRepositoryId,commitCamera]);
  const cameraCallback = useRef(onCameraChange); cameraCallback.current = onCameraChange;
  useEffect(() => { cameraCallback.current?.(camera); }, [camera]);
  const locate = () => {
    const node=layout.nodes.find(node=>!!selectedRepositoryId&&node.repositoryId===selectedRepositoryId),rect=viewport.current?.getBoundingClientRect();
    if(!node||!rect)return;
    const space=insets??emptyInsets;
    commitCamera(current=>{const zoom=Math.max(.75,current.zoom);return {zoom,x:(space.left+rect.width-space.right)/2-node.x*zoom,y:(space.top+rect.height-space.bottom)/2-node.y*zoom};});
  };
  const minimumZoom = () => Math.min(.1,(overview()?.zoom??.1)*.8);
  const zoom = (factor: number) => commitCamera(current => {const rect=viewport.current?.getBoundingClientRect();return zoomCamera(current,factor,(rect?.width??600)/2,(rect?.height??500)/2,minimumZoom());});
  const enqueue=(update:(current:ExplorationCamera)=>ExplorationCamera)=>{
    pendingCamera.current=update(pendingCamera.current??cameraLive.current);
    if(frame.current===undefined)frame.current=requestAnimationFrame(()=>{frame.current=undefined;const next=pendingCamera.current;pendingCamera.current=undefined;if(next)commitCamera(next);});
  };
  const enqueueRef=useRef(enqueue);enqueueRef.current=enqueue;
  useLayoutEffect(()=>()=>{if(frame.current!==undefined)cancelAnimationFrame(frame.current);frame.current=undefined;pendingCamera.current=undefined;},[scopeKey,viewKey]);
  useEffect(()=>{
    const element=viewport.current;if(!element)return;
    const wheel=(event:WheelEvent)=>{
      if(!event.deltaY)return;event.preventDefault();
      const rect=element.getBoundingClientRect(),x=event.clientX-rect.left,y=event.clientY-rect.top;
      const delta=Math.max(-120,Math.min(120,event.deltaY*(event.deltaMode===1?16:event.deltaMode===2?rect.height:1)));
      enqueueRef.current(current=>zoomCamera(current,Math.exp(-delta*.002),x,y,Math.min(.1,overviewCamera(selectionView.current.layout,rect.width,rect.height,selectionView.current.insets).zoom*.8)));
    };
    element.addEventListener('wheel',wheel,{passive:false});return()=>element.removeEventListener('wheel',wheel);
  },[]);
  useEffect(() => { if (!full) return; const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setFull(false); }; window.addEventListener('keydown', close); return () => window.removeEventListener('keydown', close); }, [full]);
  const nodeLabel = useCallback((node:MapNode)=>explorationNodeLabel(node,t),[t]);
  const satellites = useMemo(() => computeLayerSatellites(layout, scene, focus, new Map(repositories.map(r => [r.id, r.name]))), [layout, scene, focus, repositories]);
  const isOverview=camera.zoom<.22||(layout.nodes.length>36&&camera.zoom<.45);
  const activate = (node:MapNode,anchor:Element) => {
    if(node.repositoryId&&(node.type==='repository'||node.type==='focus'))onSelect(node.repositoryId,anchor);
    else if(node.focus)onFocus(node.focus.type==='all'?node.focus:{...node.focus,label:nodeLabel(node)});
  };
  const hovered = (event: React.MouseEvent<HTMLDivElement>) => { const rect=event.currentTarget.getBoundingClientRect();return hitOverviewNode(layout.nodes,cameraLive.current,event.clientX-rect.left,event.clientY-rect.top); };
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
    const baseAlpha=isOverview?Math.max(.08,Math.min(.35,15/Math.max(1,layout.edges.length))):.7;
    for(const group of groups.values()){ctx.globalAlpha = !group.highlighted ? .04 : activeNode ? .8 : baseAlpha;ctx.strokeStyle=group.color;ctx.lineWidth=(activeNode&&group.highlighted?2.3:1.2)/camera.zoom;ctx.setLineDash(group.verified?[]:[5/camera.zoom,5/camera.zoom]);ctx.stroke(group.path);}
    if(!isOverview&&satellites.length){
      for(const sat of satellites){
        const parent=byId.get(sat.parentId);if(!parent)continue;
        const highlighted=!activeNode||activeNode===sat.parentId;
        ctx.globalAlpha=highlighted?(sat.verified?.58:.38):.08;
        ctx.strokeStyle=sat.kind?lineColors[sat.kind]:palette[sat.color];
        ctx.lineWidth=(sat.verified?1.5:1.1)/camera.zoom;
        ctx.setLineDash(sat.verified?[]:[3.5/camera.zoom,4/camera.zoom]);
        ctx.beginPath();ctx.moveTo(parent.x,parent.y);
        ctx.quadraticCurveTo((parent.x+sat.x)/2+(parent.y-sat.y)*.06,(parent.y+sat.y)/2+(sat.x-parent.x)*.06,sat.x,sat.y);
        ctx.stroke();
      }
    }
    if(isOverview){
      const ratio=window.devicePixelRatio||1;ctx.setTransform(ratio,0,0,ratio,0,0);ctx.setLineDash([]);ctx.globalAlpha=1;
      const place=labelPlacement();ctx.font='500 12px system-ui';ctx.textAlign='center';ctx.textBaseline='top';
      const textColor=getComputedStyle(canvas).color;
      for(const node of layout.nodes){
        const x=node.x*camera.zoom+camera.x,y=node.y*camera.zoom+camera.y;
        if(x<-100||y<-40||x>viewportSize.width+100||y>viewportSize.height+40)continue;
        ctx.fillStyle=palette[node.color];ctx.beginPath();ctx.arc(x,y,node.type==='focus'?7:node.id===activeNode||(!!selectedRepositoryId&&node.repositoryId===selectedRepositoryId)?6:3.5,0,Math.PI*2);ctx.fill();
        if(node.id===activeNode||(!!selectedRepositoryId&&node.repositoryId===selectedRepositoryId))continue;
        const label=nodeLabel(node).length>18?nodeLabel(node).slice(0,17)+'…':nodeLabel(node),width=ctx.measureText(label).width+12;
        if(place({x:x-width/2,y:y+9,width,height:20})){ctx.fillStyle=textColor;ctx.fillText(label,x,y+10);}
      }
    }
  },[layout,byId,camera,activeNode,viewportSize,isOverview,nodeLabel,selectedRepositoryId,satellites]);
  const visibleNodes=useMemo(()=>{
    if(!viewportSize.width||!viewportSize.height)return layout.nodes;
    return layout.nodes.filter(node=>{if(isOverview)return node.id===activeNode||(!!selectedRepositoryId&&node.repositoryId===selectedRepositoryId);const x=node.x*camera.zoom+camera.x,y=node.y*camera.zoom+camera.y,w=node.width*camera.zoom/2+100,h=node.height*camera.zoom/2+100;return x+w>=0&&x-w<=viewportSize.width&&y+h>=0&&y-h<=viewportSize.height;});
  },[layout,viewportSize,camera,isOverview,activeNode,selectedRepositoryId]);
  const renderedNodes=useMemo(()=><>
        {visibleNodes.map(node => <button key={node.id} aria-pressed={node.repositoryId ? node.repositoryId === selectedRepositoryId : undefined} className={`explore-graph-node ${isOverview?'is-overview-node':''} node-${node.type} ${activeNode && !neighbors.has(node.id) && activeNode !== node.id ? 'is-dimmed' : ''}`} style={{ left:isOverview?Math.max(8,Math.min(viewportSize.width-(insets?.right??8)-220,node.x*camera.zoom+camera.x-110)):node.x-node.width/2, top:isOverview?Math.max(insets?.top??8,Math.min(viewportSize.height-(insets?.bottom??8)-80,node.y*camera.zoom+camera.y-40)):node.y-node.height/2, width:isOverview?220:node.width, height:isOverview?80:node.height, '--node-color':palette[node.color] } as React.CSSProperties}
          title={node.repositoryId ? repos.get(node.repositoryId)?.full_name : nodeLabel(node)} aria-label={node.type === 'repository' ? t('exploration.view-project', { name: node.label }) : `${node.kind&&node.label!==`relation:${node.kind}` ? t(`exploration.relations.${node.kind}`) + ' ' : ''}${nodeLabel(node)}${node.count !== undefined ? t('exploration.project-count', { count: node.count }) : ''}`}
          onMouseEnter={() => setActive(node.id)} onMouseLeave={() => setActive('')} onFocus={() => setActive(node.id)} onBlur={() => setActive('')}
          onClick={event => { if(node.repositoryId && node.type==='focus')onSelect(node.repositoryId,event.currentTarget); else if (node.type === 'repository') onSelect(node.repositoryId!, event.currentTarget); else if (node.focus) onFocus(node.focus.type==='all'?node.focus:{...node.focus,label:nodeLabel(node)}); else if(node.type==='more')onAllTopics(); }}>
          {node.type === 'repository' ? <><span className="explore-graph-dot">{repos.get(node.repositoryId!)?.owner.avatar_url ? <img src={repos.get(node.repositoryId!)!.owner.avatar_url} alt="" loading="lazy" /> : node.label[0]?.toUpperCase()}</span><strong>{nodeLabel(node)}</strong>{node.description && <small className="explore-node-description">{node.description}</small>}</> : <><div className="explore-node-header"><span className="explore-node-mark">{node.type === 'focus' ? '◎' : node.type === 'more' ? '+' : '◉'}</span><strong>{nodeLabel(node)}</strong></div>{node.count !== undefined && <small className="explore-node-count">{node.count} {node.id === 'more-topics' ? t('exploration.topics') : node.id === 'more-branches' ? t('exploration.directions') : t('exploration.projects')}{node.verifiedCount ? ` · ✓${node.verifiedCount}` : ''}</small>}{!isOverview && node.subLabels && node.subLabels.length > 0 && <div className="explore-node-subtags" aria-hidden="true">{node.subLabels.slice(0, 2).map(sub => <span key={sub}>{sub}</span>)}</div>}{!isOverview && node.previewIds && node.previewIds.length > 0 && <div className="explore-node-previews" aria-hidden="true">{node.previewIds.slice(0, 3).map(id => { const r = repos.get(id); return r ? <span key={id} className="explore-node-preview-chip">{r.name}</span> : null; })}</div>}</>}
        </button>)}
        {!isOverview && satellites.map(sat => {
          const repo = repos.get(sat.repositoryId);
          if (!repo) return null;
          return (
            <div
              key={sat.id}
              data-testid={`satellite-${sat.repositoryId}`}
              className={`explore-satellite-node ${sat.verified ? 'is-verified-sat' : ''} ${selectedRepositoryId === sat.repositoryId ? 'is-selected-sat' : ''} ${activeNode && activeNode !== sat.parentId ? 'is-dimmed' : ''}`}
              style={{ left: sat.x - 68, top: sat.y - 16, '--node-color': palette[sat.color] } as React.CSSProperties}
              onMouseEnter={() => setActive(sat.parentId)}
              onMouseLeave={() => setActive('')}
              onClick={event => { event.stopPropagation(); onSelect(sat.repositoryId, event.currentTarget); }}
            >
              <span className="explore-satellite-dot">{repo.owner.avatar_url ? <img src={repo.owner.avatar_url} alt="" loading="lazy" /> : repo.name[0]?.toUpperCase()}</span>
              <span className="explore-satellite-label">{repo.name}</span>
            </div>
          );
        })}
  </>,[visibleNodes,activeNode,neighbors,repos,selectedRepositoryId,nodeLabel,t,onSelect,onFocus,onAllTopics,isOverview,camera,viewportSize,insets,satellites]);

  return <section className={`explore-map-shell ${full ? 'is-fullscreen' : ''} ${camera.zoom < .5 ? 'is-overview-scale' : ''}`} aria-label={t('exploration.project-relationship-map')}>
    <div className="explore-map-toolbar"><span title={t('exploration.drag-to-pan-ctrl-scroll-to-zoom')}><Move size={13} /></span><div>
      <Button size="icon" variant="ghost" aria-label={t('exploration.zoom-out-map')} onClick={() => zoom(.85)}><Minus size={15} /></Button><span>{Math.round(camera.zoom * 100)}%</span>
      <Button size="icon" variant="ghost" aria-label={t('exploration.zoom-in-map')} onClick={() => zoom(1.15)}><Plus size={15} /></Button><Button size="icon" variant="ghost" aria-label={t('exploration.fit-canvas-and-reset')} onClick={fit}><Expand size={15} /></Button>
      <Button size="icon" variant="ghost" disabled={!selectedRepositoryId} aria-label={t('browser.locate-selection')} onClick={locate}><LocateFixed size={15}/></Button>
      <Button size="icon" variant="ghost" aria-label={full ? t('exploration.exit-map-fullscreen') : t('exploration.view-map-fullscreen')} onClick={() => setFull(value => !value)}>{full ? <X size={15} /> : <Maximize2 size={15} />}</Button>
    </div></div>
    <div ref={viewport} className="explore-map-viewport" tabIndex={0} aria-label={t('exploration.relationship-canvas-arrow-keys-pan-home-resets')} onKeyDown={event => {
      if (event.target !== event.currentTarget) return;
      const delta = ({ ArrowLeft: [30, 0], ArrowRight: [-30, 0], ArrowUp: [0, 30], ArrowDown: [0, -30] } as Record<string, number[]>)[event.key];
      if (delta) { event.preventDefault(); commitCamera(current => ({ ...current, x: current.x + delta[0], y: current.y + delta[1] })); }
      if (event.key === 'Home') { event.preventDefault(); fit(); }
    }} onPointerDown={event => { if (event.button !== 0 || (event.target as Element).closest('button,a,input')) return; drag.current = { x: event.clientX, y: event.clientY, camera, moved: false }; event.currentTarget.setPointerCapture(event.pointerId); }}
    onDoubleClick={event=>{if(!(event.target as Element).closest('button,a,input')&&(!isOverview||!hovered(event)))fit();}}
    onPointerMove={event => { if (!drag.current) {if(isOverview&&!(event.target as Element).closest('button'))setActive(hovered(event)?.id??'');return;} const dx = event.clientX - drag.current.x, dy = event.clientY - drag.current.y; if (Math.abs(dx) + Math.abs(dy) > 4) drag.current.moved = true; const start=drag.current.camera;enqueue(()=>({...start,x:start.x+dx,y:start.y+dy})); }}
    onPointerUp={event => { if (drag.current && !drag.current.moved) {const node=isOverview?hovered(event):undefined;if(node)activate(node,event.currentTarget);else onBlank();} drag.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }} onPointerCancel={() => { drag.current = null; }}>
      <canvas ref={linesCanvas} className="explore-lines explore-canvas-lines" data-edge-count={layout.edges.length} aria-hidden="true"/>
      <div className="explore-world" data-total-nodes={layout.nodes.length} data-camera={JSON.stringify(camera)} style={{ width:0,height:0, transform: isOverview?undefined:`translate(${camera.x}px,${camera.y}px) scale(${camera.zoom})`, '--node-text-size':'18px', '--repo-text-size':'16px', '--count-text-size':'14px' } as React.CSSProperties}>
        {renderedNodes}
      </div>
      {!layout.nodes.length && <div className="explore-map-empty">{t('exploration.no-topics-yet')}</div>}
    </div>
    <div className="explore-map-footer" title={t('exploration.topic-branch-project-solid-verified-dashed-membership-or')}>{focus.type === 'all' && <Button variant="ghost" size="sm" onClick={onAllTopics}>{t('exploration.all-topics')}{scene.topics.length})</Button>}</div>
  </section>;
}
