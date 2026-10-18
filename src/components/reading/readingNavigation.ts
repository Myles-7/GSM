import type { AppState } from '../../types';

type View = AppState['currentView'];
let guard: ((view: View) => void) | undefined;
let bypass = false;
export function registerReadingLeaveGuard(callback: (view: View) => void) {
  guard = callback;
  return () => { if (guard === callback) guard = undefined; };
}
export function blockReadingNavigation(current: View, next: View) {
  if (bypass || current !== 'reading' || next === 'reading' || !guard) return false;
  guard(next);
  return true;
}
export function allowReadingNavigation(action: () => void) {
  bypass = true;
  try { action(); } finally { bypass = false; }
}
export function requestReadingConfiguration() {
  try { sessionStorage.setItem('gsm:pending-reading-page', 'settings'); } catch { /* Same-window event remains available. */ }
  window.dispatchEvent(new Event('gsm:reading-configuration'));
}
