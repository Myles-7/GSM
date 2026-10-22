import type { ExplorationFocus, ExplorationScene, RelationKind } from './types';
import { relationLabels } from './model';

export interface MapNode {
  id: string; type: 'topic' | 'repository' | 'focus' | 'branch' | 'more'; label: string;
  x: number; y: number; width: number; height: number; color: number; count?: number;
  repositoryId?: number; focus?: ExplorationFocus; kind?: RelationKind; verified?: boolean;
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
const hash = (id: string) => [...id].reduce((value, char) => (Math.imul(value, 31) + char.charCodeAt(0)) >>> 0, 7);

/** Seeded placement and rectangle collision resolution; selection never enters this input. */
export function layoutExploration(scene: ExplorationScene, focus: ExplorationFocus, names: Map<number, string>, expanded = false): MapLayout {
  const overview = focus.type === 'all', nodes: MapNode[] = [], edges: MapEdge[] = [], regions: MapLayout['regions'] = [];
  const count = overview ? Math.min(expanded ? scene.topics.length : 18, scene.topics.length) : focus.type === 'entity' ? scene.branches.length : scene.results.length;
  const radius = overview ? Math.max(195, Math.sqrt(count) * 88) : Math.max(170, Math.min(count, 16) * 22);
  const width = Math.max(800, radius * 2 + 360), height = Math.max(550, radius * 1.65 + 250), cx = width / 2, cy = height / 2;
  if (overview) {
    const topics = scene.topics.slice(0, expanded ? scene.topics.length : 18).sort((a,b) => a.id.localeCompare(b.id));
    topics.forEach((topic, index) => {
      const angle = index / topics.length * Math.PI * 2 - Math.PI / 2;
      const x = cx + Math.cos(angle) * radius, y = cy + Math.sin(angle) * radius * .72;
      nodes.push({ id: topic.id, type: 'topic', label: topic.label, count: topic.repositoryIds.length, x, y, width: 158, height: 66, color: index % 6, focus: { type: 'topic', id: topic.id, label: topic.label } });
      regions.push({ id: topic.id, x, y, color: index % 6, radius: 112 });
    });
    const representatives = [...new Set(topics.flatMap(topic => topic.repositoryIds.slice(0, 2)))].slice(0, 36);
    representatives.forEach(id => {
      const parents = nodes.filter(node => node.type === 'topic' && topics.find(topic => topic.id === node.id)?.repositoryIds.includes(id));
      if (!parents.length) return;
      const seed = hash(String(id)), angle = seed % 360 / 180 * Math.PI;
      const x = parents.reduce((sum,node) => sum + node.x, 0) / parents.length + Math.cos(angle) * 100;
      const y = parents.reduce((sum,node) => sum + node.y, 0) / parents.length + Math.sin(angle) * 86;
      nodes.push({ id: `repo-${id}`, type: 'repository', label: names.get(id) ?? String(id), repositoryId: id, x, y, width: 122, height: 54, color: parents[0].color });
      parents.forEach(parent => edges.push({ source: parent.id, target: `repo-${id}`, kind: 'membership', verified: false }));
    });
    if (scene.topics.length > topics.length) nodes.push({ id: 'more-topics', type: 'more', label: '更多主题', count: scene.topics.length - topics.length, x: cx, y: cy, width: 120, height: 58, color: 0 });
  } else {
    nodes.push({ id: 'focus', type: 'focus', label: focus.label, x: cx, y: cy, width: 176, height: 82, color: 0 });
    if (focus.type === 'entity' && scene.branches.length) {
      const branches = scene.branches.slice(0, expanded ? scene.branches.length : 16);
      branches.forEach((branch, index) => {
        const angle = index / branches.length * Math.PI * 2 - Math.PI / 2;
        nodes.push({ id: branch.id, type: 'branch', label: branch.label, count: branch.count, kind: branch.kind, x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius * .72, width: 160, height: 76, color: index % 6,
          focus: { type: 'branch', targetId: focus.id, branch: branch.label, label: branch.label, kind: branch.kind } });
        const relations = scene.results.flatMap(row => row.relations.filter(relation => relation.kind === branch.kind && relation.branch === branch.label));
        edges.push({ source: 'focus', target: branch.id, kind: branch.kind, verified: !!relations.length && relations.every(relation => relation.verified), label: relationLabels[branch.kind] });
      });
      if (scene.branches.length > branches.length) nodes.push({ id: 'more-branches', type: 'more', label: '更多关系方向', count: scene.branches.length - branches.length, x: cx, y: cy + 135, width: 140, height: 58, color: 0 });
    } else {
      const rows = scene.results.slice(0, expanded ? 100 : 24);
      rows.forEach((row,index) => {
        const ring = Math.floor(index / 12), length = Math.min(12, rows.length - ring * 12), angle = index % 12 / length * Math.PI * 2 - Math.PI / 2;
        const r = 195 + ring * 150;
        nodes.push({ id: `repo-${row.repositoryId}`, type: 'repository', repositoryId: row.repositoryId, label: names.get(row.repositoryId) ?? String(row.repositoryId), kind: row.kind, verified: row.verified, x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r * .8, width: 134, height: 58, color: index % 6 });
        edges.push({ source: 'focus', target: `repo-${row.repositoryId}`, kind: focus.type === 'topic' ? 'membership' : row.kind, verified: row.verified });
      });
      if (scene.results.length > rows.length) nodes.push({ id: 'more-projects', type: 'more', label: '更多项目', count: scene.results.length - rows.length, x: cx, y: cy + 130, width: 120, height: 58, color: 0 });
    }
  }
  for (let iteration = 0; iteration < 100; iteration++) for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
    const a = nodes[i], b = nodes[j], dx = b.x - a.x || 1, dy = b.y - a.y || 1;
    const overlapX = (a.width + b.width) / 2 + 18 - Math.abs(dx), overlapY = (a.height + b.height) / 2 + 22 - Math.abs(dy);
    if (overlapX <= 0 || overlapY <= 0) continue;
    const axis = overlapX < overlapY ? 'x' : 'y', step = (Math.min(overlapX, overlapY) + 1) / 2, direction = Math.sign(axis === 'x' ? dx : dy);
    if (a.type !== 'focus') a[axis] -= step * direction;
    if (b.type !== 'focus') b[axis] += step * direction;
  }
  for (const region of regions) { const node = nodes.find(row => row.id === region.id)!; region.x = node.x; region.y = node.y; }
  const minX = Math.min(0,...nodes.map(node => node.x - node.width / 2 - 45)), minY = Math.min(0,...nodes.map(node => node.y - node.height / 2 - 45));
  if (minX || minY) { nodes.forEach(node => { node.x -= minX; node.y -= minY; }); regions.forEach(region => { region.x -= minX; region.y -= minY; }); }
  return { nodes, edges, regions, width: Math.max(width - minX, ...nodes.map(node => node.x + node.width / 2 + 45)), height: Math.max(height - minY,...nodes.map(node => node.y + node.height / 2 + 45)) };
}
