/** Keep saved positions stable and append newly synced objects in arrival order. */
export function orderedIds<T extends string | number>(saved: readonly T[], current: readonly T[]): T[] {
  const live = new Set(current);
  return [...new Set([...saved.filter(id => live.has(id)), ...current])];
}

export function moveBefore<T extends string | number>(order: readonly T[], source: T, target: T): T[] {
  if (source === target || !order.includes(source) || !order.includes(target)) return [...order];
  const next = order.filter(id => id !== source);
  next.splice(next.indexOf(target), 0, source);
  return next;
}

/** Replace only the group's slots; unrelated categories retain their custom order. */
export function replaceGroupOrder<T extends string | number>(global: readonly T[], group: readonly T[]): T[] {
  const members = new Set(group);
  let index = 0;
  return global.map(id => members.has(id) ? group[index++] : id);
}
