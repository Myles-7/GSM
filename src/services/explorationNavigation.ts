import type { AppState } from '../types';
type View = AppState['currentView'];
let guard: ((next: View) => void) | undefined;
let bypass = false;
export function registerExplorationLeaveGuard(callback: (next: View) => void) {
  guard = callback;
  return () => { if (guard === callback) guard = undefined; };
}
export function blockExplorationNavigation(current: View, next: View) {
  if (bypass || current !== 'repositories' || next === current || !guard) return false;
  guard(next); return true;
}
export function allowExplorationNavigation(action: () => void) {
  bypass = true;
  try { action(); } finally { bypass = false; }
}
