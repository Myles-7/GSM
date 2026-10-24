import type { MapLayout, MapNode } from './graphLayout';
import type { ExplorationCamera } from './types';

export interface CanvasInsets { left: number; right: number; top: number; bottom: number }
export const emptyInsets: CanvasInsets = { left: 16, right: 16, top: 16, bottom: 54 };
export function overviewCamera(layout: MapLayout, width: number, height: number, insets = emptyInsets): ExplorationCamera {
  const left = Math.min(...layout.nodes.map(n => n.x - n.width / 2)) - 24;
  const right = Math.max(...layout.nodes.map(n => n.x + n.width / 2)) + 24;
  const top = Math.min(...layout.nodes.map(n => n.y - n.height / 2)) - 24;
  const bottom = Math.max(...layout.nodes.map(n => n.y + n.height / 2)) + 24;
  const w = Math.max(1, width - insets.left - insets.right), h = Math.max(1, height - insets.top - insets.bottom);
  const zoom = Math.min(1.15, w / Math.max(1, right - left), h / Math.max(1, bottom - top));
  return { zoom, x: insets.left + w / 2 - (left + right) / 2 * zoom, y: insets.top + h / 2 - (top + bottom) / 2 * zoom };
}
export function zoomCamera(current: ExplorationCamera, factor: number, x: number, y: number, minimum: number) {
  const zoom = Math.min(4, Math.max(minimum, current.zoom * factor));
  return { zoom, x: x - (x - current.x) * zoom / current.zoom, y: y - (y - current.y) * zoom / current.zoom };
}
export function hitOverviewNode(nodes: MapNode[], camera: ExplorationCamera, x: number, y: number) {
  let closest: MapNode | undefined, distance = 13;
  for (const node of nodes) {
    const d = Math.hypot(node.x * camera.zoom + camera.x - x, node.y * camera.zoom + camera.y - y);
    if (d < distance) { closest = node; distance = d; }
  }
  return closest;
}
/** Label collisions are a screen-space concern, independent of the number of nodes. */
export function labelPlacement() {
  const cells = new Map<string, { x: number; y: number; width: number; height: number }[]>();
  return (box: { x: number; y: number; width: number; height: number }) => {
    const keys: string[] = [];
    for (let x = Math.floor(box.x / 40); x <= Math.floor((box.x + box.width) / 40); x++) for (let y = Math.floor(box.y / 40); y <= Math.floor((box.y + box.height) / 40); y++) keys.push(`${x}:${y}`);
    if (keys.some(key => cells.get(key)?.some(other => box.x < other.x + other.width && box.x + box.width > other.x && box.y < other.y + other.height && box.y + box.height > other.y))) return false;
    keys.forEach(key => cells.set(key, [...cells.get(key) ?? [], box]));
    return true;
  };
}
