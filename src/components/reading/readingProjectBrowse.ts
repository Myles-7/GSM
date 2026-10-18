import type { ReadingProjectItem } from '../../features/settings/hooks/useReadingProjects';

export const resumableProjectStatuses = new Set(['queued', 'checking', 'sending', 'failed', 'uncertain', 'local-pending']);

export type ProjectScope = 'import' | 'pending' | 'candidates' | 'processed';
export interface ProjectBrowseState {
  scope: ProjectScope; query: string; read: string; interest: string; note: string; star: string;
  page: number; focusedId: string; scroll: number;
  importOnly?: boolean; candidateOnly?: boolean; paneRatio?: number;
  detailScroll?: Record<string, number>; expanded?: Record<string, string[]>;
}
export const initialBrowse: ProjectBrowseState = { scope: 'pending', query: '', read: 'all', interest: 'all', note: 'all', star: 'all', page: 0, focusedId: '', scroll: 0, importOnly: false, candidateOnly: false, paneRatio: .3 };
const browseMemory = new Map<string, ProjectBrowseState>();
export interface ReadingNoteDraft { text: string; baseNote?: string }
const draftMemory = new Map<string, Record<string, ReadingNoteDraft>>();
const key = (kind: string, account: string) => `gsm:reading-projects:${kind}:${account}`;
function loadRatio(account: string) {
  try { const value = Number(localStorage.getItem(key('ratio', account))); if (value >= .22 && value <= .5) return value; } catch { /* Defaults work without persistence. */ }
  return .3;
}
export function loadBrowse(account: string): ProjectBrowseState {
  if (browseMemory.has(account)) return browseMemory.get(account)!;
  try {
    const saved = JSON.parse(sessionStorage.getItem(key('browse', account)) || 'null');
    if (saved && typeof saved === 'object' && !Array.isArray(saved)) return {
      scope: saved.scope === 'processed' ? 'processed' : 'pending',
      importOnly: saved.scope === 'import' || saved.importOnly === true,
      candidateOnly: saved.scope === 'candidates' || saved.candidateOnly === true,
      paneRatio: Number.isFinite(saved.paneRatio) ? Math.min(.5, Math.max(.22, saved.paneRatio)) : loadRatio(account),
      detailScroll: saved.detailScroll && typeof saved.detailScroll === 'object' ? Object.fromEntries(Object.entries(saved.detailScroll).filter((entry): entry is [string, number] => typeof entry[1] === 'number' && Number.isFinite(entry[1]) && entry[1] >= 0)) : {},
      expanded: saved.expanded && typeof saved.expanded === 'object' ? Object.fromEntries(Object.entries(saved.expanded).filter((entry): entry is [string, string[]] => Array.isArray(entry[1]) && entry[1].every(key => typeof key === 'string'))) : {},
      query: typeof saved.query === 'string' ? saved.query : '',
      read: ['all', 'read', 'unread'].includes(saved.read) ? saved.read : 'all',
      interest: ['all', 'neutral', 'interested', 'ignored'].includes(saved.interest) ? saved.interest : 'all',
      note: ['all', 'yes', 'no'].includes(saved.note) ? saved.note : 'all',
      star: ['all', 'starred', 'unstarred', 'unknown'].includes(saved.star) ? saved.star : 'all',
      page: Number.isSafeInteger(saved.page) && saved.page >= 0 ? saved.page : 0,
      scroll: Number.isFinite(saved.scroll) && saved.scroll >= 0 ? saved.scroll : 0,
      focusedId: typeof saved.focusedId === 'string' ? saved.focusedId : '',
    };
  } catch { /* Memory remains available if browser storage is unavailable. */ }
  return { ...initialBrowse, paneRatio: loadRatio(account) };
}
export function saveBrowse(account: string, state: ProjectBrowseState): boolean {
  browseMemory.set(account, state);
  try {
    sessionStorage.setItem(key('browse', account), JSON.stringify(state));
    const ratio = String(state.paneRatio ?? .3);
    if (localStorage.getItem(key('ratio', account)) !== ratio) localStorage.setItem(key('ratio', account), ratio);
    return true;
  } catch { return false; }
}
export function loadDrafts(account: string): Record<string, ReadingNoteDraft> {
  if (draftMemory.has(account)) return draftMemory.get(account)!;
  try {
    const saved: unknown = JSON.parse(sessionStorage.getItem(key('drafts', account)) || '{}');
    if (saved && typeof saved === 'object' && !Array.isArray(saved)) return Object.fromEntries(Object.entries(saved).flatMap(([id, value]) => {
      // Legacy drafts keep their text but require an explicit conflict decision.
      if (typeof value === 'string') return [[id, { text: value }]];
      if (value && typeof value === 'object' && 'text' in value && typeof value.text === 'string') return [[id, { text: value.text, ...('baseNote' in value && typeof value.baseNote === 'string' ? { baseNote: value.baseNote } : {}) }]];
      return [];
    }));
  } catch { /* Unsaved drafts are also held in memory. */ }
  return {};
}
export function saveDrafts(account: string, drafts: Record<string, ReadingNoteDraft>): boolean {
  draftMemory.set(account, drafts);
  try { sessionStorage.setItem(key('drafts', account), JSON.stringify(drafts)); return true; } catch { return false; }
}
export function scopeItems(items: ReadingProjectItem[], scope: ProjectScope, importIds: ReadonlySet<string>): ReadingProjectItem[] {
  return items.filter(item => scope === 'processed' ? item.processed : !item.processed && (scope === 'import' ? importIds.has(item.id) : scope === 'candidates' ? item.state.candidate : true));
}
export function filterProjects(items: ReadingProjectItem[], browse: ProjectBrowseState): ReadingProjectItem[] {
  const query = browse.query.trim().toLocaleLowerCase();
  return items.filter(item => (!query || `${item.name}\n${item.state.note}`.toLocaleLowerCase().includes(query))
    && (browse.read === 'all' || item.state.read === (browse.read === 'read'))
    && (browse.interest === 'all' || item.state.interest === browse.interest)
    && (browse.note === 'all' || Boolean(item.state.note.trim()) === (browse.note === 'yes'))
    && (browse.star === 'all' || item.starState === browse.star));
}
