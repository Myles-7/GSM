export type TaskDetailTab = 'process' | 'content' | 'results';
const pending = new Map<string, { id: string; tab: TaskDetailTab }>();
export function openTaskDetails(owner: string, id: string, tab: TaskDetailTab = 'process') {
  pending.set(owner, { id, tab });
  window.dispatchEvent(new CustomEvent('gsm:open-task-details', { detail: { owner, id, tab } }));
}
export function taskDetailsTarget(owner: string) { return pending.get(owner); }
export function takeTaskDetailTab(owner: string, id: string): TaskDetailTab | undefined {
  const target = pending.get(owner);
  if (target?.id !== id) return;
  pending.delete(owner);
  return target.tab;
}
