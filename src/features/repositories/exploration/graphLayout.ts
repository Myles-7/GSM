import type { ExplorationFocus, ExplorationScene, RelationKind } from './types';
import { relationLabels } from './model';

export interface MapNode {
  id: string; type: 'topic' | 'repository' | 'focus' | 'branch' | 'more'; label: string;
  x: number; y: number; width: number; height: number; color: number; count?: number;
  description?: string; repositoryId?: number; focus?: ExplorationFocus; kind?: RelationKind; verified?: boolean;
}
export interface MapEdge { source: string; target: string; kind: 'membership' | RelationKind; verified: boolean; label?: string }
export interface MapLayout { nodes: MapNode[]; edges: MapEdge[]; regions: { id: string; x: number; y: number; color: number; radius: number }[]; width: number; height: number }
export function retainLayoutPositions(layout: MapLayout, positions: Record<string,{x:number;y:number}>): MapLayout {
  const placed = layout.nodes.filter(node => positions[node.id]);
  placed.forEach(node => Object.assign(node,positions[node.id]));
  for (const node of layout.nodes.filter(node => !positions[node.id])) {
    const start = {x:node.x,y:node.y};
    for(let attempt=0;attempt<200;attempt++) {
      const collision = placed.some(other => Math.abs(node.x-other.x)<(node.width+other.width)/2+18 && Math.abs(node.y-other.y)<(node.height+other.height)/2+22);
      if(!collision) break;
      const angle=attempt*2.399963, radius=38*Math.sqrt(attempt+1);
      node.x=Math.max(node.width/2+25,start.x+Math.cos(angle)*radius);node.y=Math.max(node.height/2+25,start.y+Math.sin(angle)*radius);
    }
    placed.push(node);
  }
  layout.regions.forEach(region=>{const node=layout.nodes.find(value=>value.id===region.id)!;region.x=node.x;region.y=node.y;});
  return {...layout,width:Math.max(layout.width,...layout.nodes.map(node=>node.x+node.width/2+40)),height:Math.max(layout.height,...layout.nodes.map(node=>node.y+node.height/2+40))};
}
/** Stable columns express hierarchy; no force simulation or selection-dependent reflow. */
export function layoutExploration(scene: ExplorationScene, focus: ExplorationFocus, names: Map<number, string>, expanded = false, selectedId?: number): MapLayout {
  const nodes: MapNode[] = [], edges: MapEdge[] = [], regions: MapLayout['regions'] = [];
  const addRepository = (row: ExplorationScene['results'][number], parent: string, y: number, color: number, membership = false) => {
    const id = `repo-${row.repositoryId}`;
    if (nodes.some(node => node.id === id)) return;
    nodes.push({ id, type: 'repository', repositoryId: row.repositoryId, label: names.get(row.repositoryId) ?? String(row.repositoryId), description: scene.profiles[String(row.repositoryId)]?.summary, kind: row.kind, verified: row.verified, x: 760, y, width: 248, height: 78, color });
    if (parent && nodes.some(node => node.id === parent)) edges.push({ source: parent, target: id, kind: membership ? 'membership' : row.kind, verified: !membership && row.verified });
  };
  if (focus.type === 'all') {
    const topics = scene.topics.slice(0, expanded ? 60 : 18);
    const radius = Math.max(215, Math.sqrt(topics.length) * 83);
    topics.forEach((topic,index) => {
      const angle=index/Math.max(1,topics.length)*Math.PI*2-Math.PI/2;
      const x=radius+190+Math.cos(angle)*radius,y=radius*.72+130+Math.sin(angle)*radius*.72;
      nodes.push({id:topic.id,type:'topic',label:topic.label,count:topic.repositoryIds.length,x,y,width:180,height:82,color:index%6,focus:{type:'topic',id:topic.id,label:topic.label}});
      regions.push({id:topic.id,x,y,color:index%6,radius:76});
    });
    if(topics.length){
      nodes.push({id:'library-overview',type:'focus',label:'library-overview',count:scene.results.length,x:radius+190,y:radius*.72+130,width:152,height:104,color:0});
      topics.forEach(topic=>edges.push({source:'library-overview',target:topic.id,kind:'membership',verified:false}));
    }
    const selected = scene.results.find(row => row.repositoryId === selectedId);
    if (selected) addRepository(selected, scene.topics.find(topic => topic.repositoryIds.includes(selected.repositoryId))?.id ?? '', 100, 0, true);
    if (scene.topics.length > topics.length) nodes.push({ id: 'more-topics', type: 'more', label: '更多主题', count: scene.topics.length - topics.length, x: 190, y: 765, width: 240, height: 60, color: 0 });
  } else {
    nodes.push({ id: 'focus', type: 'focus', label: focus.label, repositoryId: focus.type === 'repository' ? focus.id : undefined, x: 145, y: 110, width: 220, height: 82, color: 0 });
    let rows = scene.results.slice(0, expanded ? 40 : 8);
    const selected = scene.results.find(row => row.repositoryId === selectedId);
    if (selected && !rows.includes(selected)) rows = [...rows.slice(0, (expanded ? 40 : 8) - 1), selected];
    if ((focus.type === 'entity' || focus.type === 'search') && scene.branches.length) {
      let y = 100, rendered = 0;
      const hasConfirmed = rows.some(row => row.verified && ['direct', 'interoperable'].includes(row.kind));
      const branches = hasConfirmed && !expanded ? scene.branches.filter(branch=>scene.results.some(row=>row.relations.some(relation=>relation.kind===branch.kind && relation.branch===branch.label))) : scene.branches;
      for (const [index, branch] of branches.entries()) {
        const matching = scene.results.filter(row => row.relations.some(relation => relation.branch === branch.label && relation.kind === branch.kind) || row.localBranch === branch.label);
        const show = expanded || ['direct', 'interoperable'].includes(branch.kind) || !hasConfirmed || matching.some(row => row.repositoryId === selectedId);
        const children = show ? matching.filter(row => !nodes.some(node => node.repositoryId === row.repositoryId)).slice(0, expanded ? 40 - rendered : 2) : [];
        if(selected && matching.includes(selected) && !children.includes(selected)){if(children.length)children[children.length-1]=selected;else children.push(selected);}
        nodes.push({ id: branch.id, type: 'branch', label: branch.label, count: branch.count, kind: branch.kind, x: 440, y, width: 230, height: 76, color: index % 6, focus: { type: 'branch', targetId: focus.id, branch: branch.label, label: branch.label, kind: branch.kind } });
        const relations = scene.results.flatMap(row => row.relations.filter(relation => relation.branch === branch.label && relation.kind === branch.kind));
        edges.push({ source: 'focus', target: branch.id, kind: branch.kind, verified: !!relations.length && relations.every(row => row.verified), label: relationLabels[branch.kind] });
        children.forEach((row, i) => addRepository(row, branch.id, y + i * 104, index % 6));
        rendered += children.length;
        y += Math.max(1, children.length) * 104 + 22;
      }
      // A selected row must remain reachable even when it has no branch metadata.
      if (selected && !nodes.some(node => node.repositoryId === selected.repositoryId)) addRepository(selected, 'focus', y, 0);
    } else rows.forEach((row, i) => addRepository(row, 'focus', 100 + i * 104, i % 6, focus.type === 'topic'));
    const shown = nodes.filter(node => node.type === 'repository').length;
    if (scene.results.length > shown) nodes.push({ id: 'more-projects', type: 'more', label: '更多项目', count: scene.results.length - shown, x: 440, y: Math.max(210, ...nodes.map(node => node.y)) + 110, width: 230, height: 60, color: 0 });
  }
  // A selected project can be inserted after all branch budgets are spent.
  const repositoryNodes = nodes.filter(node => node.type === 'repository');
  const excess = repositoryNodes.length - 40;
  const omitted = new Set(excess > 0 ? repositoryNodes.filter(node => node.repositoryId !== selectedId).slice(-excess).map(node => node.id) : []);
  return { nodes: nodes.filter(node => !omitted.has(node.id)), edges: edges.filter(edge => !omitted.has(edge.source) && !omitted.has(edge.target)), regions, width: Math.max(1000, ...nodes.map(node => node.x + node.width / 2 + 50)), height: Math.max(550, ...nodes.map(node => node.y + node.height / 2 + 50)) };
}
