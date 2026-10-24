import type { ExplorationFocus, ExplorationScene, RelationKind } from './types';
import { relationOrder } from './model';
import { topicGroups } from './topicGroups';

export interface MapNode {
  id: string; type: 'topic' | 'repository' | 'focus' | 'branch' | 'more'; label: string;
  x: number; y: number; width: number; height: number; color: number; count?: number;
  description?: string; repositoryId?: number; focus?: ExplorationFocus; kind?: RelationKind; verified?: boolean;
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
    children.push(...topicGroups(scene).map((group,index):MapNode=>({...base,id:`group-${group.id}`,type:'topic',label:`group:${group.id}`,count:group.repositoryIds.size,color:index%6,focus:{type:'group',id:group.id,label:`group:${group.id}`}})));
  } else if(focus.type==='group') {
    children.push(...scene.topics.map((topic,index):MapNode=>({...base,id:topic.id,type:'topic',label:topic.label,count:topic.repositoryIds.length,color:index%6,focus:{type:'topic',id:topic.id,label:topic.label}})));
  } else if((focus.type==='entity'||focus.type==='search')&&scene.branches.length) {
    for(const kind of relationOrder) {
      const branches=scene.branches.filter(row=>row.kind===kind);
      if(!branches.length)continue;
      const ids=new Set(scene.results.filter(row=>row.relations.some(relation=>relation.kind===kind)||!row.relations.length&&row.kind===kind).map(row=>row.repositoryId));
      children.push({...base,id:`kind-${kind}`,type:'branch',label:`relation:${kind}`,kind,count:ids.size,color:relationOrder.indexOf(kind),focus:{type:'relation',targetId:focus.id,kind,label:`relation:${kind}`}});
    }
  } else if(focus.type==='relation'&&scene.branches.length) {
    children.push(...scene.branches.map((branch,index):MapNode=>({...base,id:branch.id,type:'branch',label:branch.label,count:branch.count,kind:branch.kind,color:index%6,focus:{type:'branch',targetId:focus.targetId,kind:branch.kind,branch:branch.label,label:branch.label}})));
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
