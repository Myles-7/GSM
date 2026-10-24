import type { ExplorationFocus, ExplorationScene, RelationKind } from './types';
import { relationOrder } from './model';
import { topicGroups } from './topicGroups';

export interface MapNode {
  id: string; type: 'topic' | 'repository' | 'focus' | 'branch' | 'more'; label: string;
  x: number; y: number; width: number; height: number; color: number; count?: number;
  description?: string; repositoryId?: number; focus?: ExplorationFocus; kind?: RelationKind; verified?: boolean;
  previewIds?: number[]; subLabels?: string[]; verifiedCount?: number;
}
export interface MapSatellite {
  id: string; parentId: string; repositoryId: number; label: string;
  x: number; y: number; color: number; kind?: RelationKind; verified?: boolean;
}
export interface MapEdge { source: string; target: string; kind: 'membership' | RelationKind; verified: boolean; label?: string }
export interface MapLayout { nodes: MapNode[]; edges: MapEdge[]; regions: { id: string; x: number; y: number; color: number; radius: number }[]; width: number; height: number }
export const EXPLORATION_LAYOUT_VERSION = 4;

export interface ExplorationLevel {
  center: MapNode; children: MapNode[]; projectCount: number; layout: MapLayout;
}
export function explorationLevel(scene: ExplorationScene, focus: ExplorationFocus, names: Map<number, string>): ExplorationLevel {
  const layout = layoutExploration(scene, focus, names);
  return { center: layout.nodes[0], children: layout.nodes.slice(1), projectCount: new Set(scene.results.map(row => row.repositoryId)).size, layout };
}
export function explorationNodeLabel(node: MapNode, t: (key: string) => string) {
  return node.label === 'library-overview' ? t('exploration.all-library-topics') : node.label.startsWith('group:') ? t(`radial.groups.${node.label.slice(6)}`) : node.label.startsWith('relation:') ? t(`exploration.relations.${node.label.slice(9)}`) : node.label;
}

/** Each page contains exactly one centre and its direct children. */
export function layoutExploration(scene: ExplorationScene, focus: ExplorationFocus, names: Map<number, string>): MapLayout {
  const children: MapNode[]=[];
  const base = {x:0,y:0,width:192,height:86,color:0};
  const projectNodes=()=>scene.results.map((row): MapNode=>({...base,id:`repo-${row.repositoryId}`,type:'repository',repositoryId:row.repositoryId,label:names.get(row.repositoryId)??String(row.repositoryId),description:scene.profiles[String(row.repositoryId)]?.summary,kind:row.kind,verified:row.verified,width:218,height:80,color:row.relations.length?relationOrder.indexOf(row.kind):0}));
  if(focus.type==='all') {
    children.push(...topicGroups(scene).map((group,index):MapNode=>({...base,id:`group-${group.id}`,type:'topic',label:`group:${group.id}`,count:group.repositoryIds.size,color:index%6,previewIds:[...group.repositoryIds].slice(0,3),subLabels:group.topics.slice(0,3).map(t=>t.label),focus:{type:'group',id:group.id,label:`group:${group.id}`}})));
  } else if(focus.type==='group') {
    children.push(...scene.topics.map((topic,index):MapNode=>({...base,id:topic.id,type:'topic',label:topic.label,count:topic.repositoryIds.length,color:index%6,previewIds:topic.repositoryIds.slice(0,3),focus:{type:'topic',id:topic.id,label:topic.label}})));
  } else if((focus.type==='entity'||focus.type==='search')&&scene.branches.length) {
    for(const kind of relationOrder) {
      const branches=scene.branches.filter(row=>row.kind===kind);
      if(!branches.length)continue;
      const matching=scene.results.filter(row=>row.relations.some(relation=>relation.kind===kind)||!row.relations.length&&row.kind===kind);
      const ids=new Set(matching.map(row=>row.repositoryId));
      const verifiedCount=matching.filter(row=>row.verified).length;
      children.push({...base,id:`kind-${kind}`,type:'branch',label:`relation:${kind}`,kind,count:ids.size,color:relationOrder.indexOf(kind),previewIds:[...ids].slice(0,3),subLabels:branches.slice(0,3).map(b=>b.label),verifiedCount,focus:{type:'relation',targetId:focus.id,kind,label:`relation:${kind}`}});
    }
  } else if(focus.type==='relation'&&scene.branches.length) {
    children.push(...scene.branches.map((branch,index):MapNode=>{
      const matching=scene.results.filter(row=>row.relations.some(r=>r.kind===branch.kind&&r.branch===branch.label)||row.localBranch===branch.label||(branch.label==='待核实与间接线索'&&!row.relations.length));
      return {...base,id:branch.id,type:'branch',label:branch.label,count:branch.count,kind:branch.kind,color:index%6,previewIds:matching.slice(0,3).map(r=>r.repositoryId),verifiedCount:matching.filter(r=>r.verified).length,focus:{type:'branch',targetId:focus.targetId,kind:branch.kind,branch:branch.label,label:branch.label}};
    }));
  } else children.push(...projectNodes());
  // Minimum Euclidean separation exceeds the largest node diagonal. Ring gaps
  // preserve that separation between circles as well as within each circle.
  const rings:{radius:number;nodes:MapNode[]}[]=[];
  let offset=0,radius=300;
  while(offset<children.length){
    const capacity=Math.max(1,Math.floor(Math.PI/Math.asin(265/(2*radius))));
    const ring=children.slice(offset,offset+capacity);rings.push({radius,nodes:ring});offset+=ring.length;radius+=300;
  }
  const extent=(rings.at(-1)?.radius??0)+155,cx=extent,cy=extent;
  const nodes:MapNode[]=[{id:'focus',type:'focus',label:focus.type==='all'?'library-overview':focus.label,x:cx,y:cy,width:164,height:100,color:0,count:scene.results.length,repositoryId:focus.type==='repository'?focus.id:undefined}];
  for(const [ringIndex,ring]of rings.entries())ring.nodes.forEach((node,index)=>{
    const angle=index/Math.max(1,ring.nodes.length)*Math.PI*2-Math.PI/2+(ringIndex%2?Math.PI/ring.nodes.length:0);
    nodes.push({...node,x:cx+Math.cos(angle)*ring.radius,y:cy+Math.sin(angle)*ring.radius});
  });
  const edges:MapEdge[]=children.map(node=>({source:'focus',target:node.id,kind:node.type==='repository'?node.kind??'membership':'membership',verified:node.type==='repository'&&!!node.verified}));
  return {nodes,edges,regions:[],width:extent*2,height:extent*2};
}

export function computeLayerSatellites(layout: MapLayout, scene: ExplorationScene, _focus: ExplorationFocus, names: Map<number, string>): MapSatellite[] {
  const children = layout.nodes.slice(1);
  if (!children.length || children.length > 8 || children.some(n => n.type === 'repository')) return [];
  const center = layout.nodes[0];
  const resultMap = new Map(scene.results.map(r => [r.repositoryId, r]));
  const used = new Set<number>();
  const satellites: MapSatellite[] = [];
  const maxPerNode = children.length <= 4 ? 3 : 2;
  for (const child of children) {
    const ids = (child.previewIds ?? []).filter(id => !used.has(id)).slice(0, maxPerNode);
    if (!ids.length) continue;
    const baseAngle = Math.atan2(child.y - center.y, child.x - center.x);
    ids.forEach((repoId, index) => {
      used.add(repoId);
      const spread = (index - (ids.length - 1) / 2) * 0.42;
      const angle = baseAngle + spread;
      const dist = 148;
      const res = resultMap.get(repoId);
      satellites.push({
        id: `sat-${child.id}-${repoId}`,
        parentId: child.id,
        repositoryId: repoId,
        label: names.get(repoId) ?? String(repoId),
        x: child.x + Math.cos(angle) * dist,
        y: child.y + Math.sin(angle) * dist,
        color: child.color,
        kind: res?.kind ?? child.kind,
        verified: res?.verified,
      });
    });
  }
  return satellites;
}
