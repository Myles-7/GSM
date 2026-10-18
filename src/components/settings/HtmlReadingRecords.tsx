import { useRef, useState } from 'react';
import { useT } from '../../i18n/useT';
import type { ReadingData } from '../../lib/html-reading/storage';
import type { ReadingField } from '../../lib/html-reading/model';
import { Button } from '../ui/button';
import { Textarea } from '../ui/textarea';
import { ReadingGroup } from './HtmlReadingFields';

export function HtmlReadingRecords({ data, busy, onSave }: { data: ReadingData | null; busy: boolean; onSave: (id: string, field: ReadingField, value: string | boolean) => Promise<boolean> }) {
  const t = useT('settings');
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<Set<string>>(new Set());
  const [errors, setErrors] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState<Set<string>>(new Set());
  const savingIds = useRef(new Set<string>());
  const records = Object.entries(data?.states ?? {}).filter(([id, state]) => (filter !== 'read' || state.read) && (filter !== 'unread' || !state.read) && (filter !== 'interested' || state.interest === 'interested')
    && (filter !== 'ignored' || state.interest === 'ignored') && (filter !== 'notes' || !!state.note.trim())
    && `${data?.names[id] ?? id}\n${state.note}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  const pages = Math.max(1, Math.ceil(records.length / 40));
  const currentPage = Math.min(page, pages - 1);
  const saveNote = async (id: string) => {
    if (busy || savingIds.current.has(id)) return;
    savingIds.current.add(id);
    setSaving(new Set(savingIds.current));
    let success = false;
    try { success = await onSave(id, 'note', drafts[id] ?? data?.states[id]?.note ?? ''); } catch { success = false; }
    finally { savingIds.current.delete(id); setSaving(new Set(savingIds.current)); }
    if (success) { setEditing(current => { const next = new Set(current); next.delete(id); return next; }); setErrors(current => { const next = new Set(current); next.delete(id); return next; }); setDrafts(current => { const next = { ...current }; delete next[id]; return next; }); }
    else setErrors(current => new Set([...current, id]));
  };
  return <ReadingGroup title={t('htmlReadingWorkflow.records')} description={t('htmlReadingUi.importedRecordsAreStoredUnderThisAccount')}>
    <div className="flex flex-wrap gap-2" role="group" aria-label={t('htmlReadingWorkflow.recordFilters')}>{['all', 'read', 'unread', 'interested', 'ignored', 'notes'].map(value => <Button key={value} size="sm" variant={filter === value ? 'default' : 'outline'} aria-pressed={filter === value} onClick={() => { setFilter(value); setPage(0); }}>{t(`htmlReadingWorkflow.filters.${value === 'all' ? 'allRecords' : value}`)}</Button>)}</div>
    <input aria-label={t('htmlReadingUi.searchReadingRecords')} placeholder={t('htmlReadingWorkflow.searchNamesNotes')} value={search} onChange={event => { setSearch(event.target.value); setPage(0); }} className="h-10 w-full rounded-md border bg-background px-3 text-sm" />
    <p className="text-sm text-muted-foreground">{t('htmlReadingWorkflow.matchingCount', { count: records.length })}</p>
    <div className="space-y-3">{records.slice(currentPage * 40, (currentPage + 1) * 40).map(([id, state]) => <article key={id} className="space-y-2 rounded-md border p-3">
      <a href={`https://github.com/${data?.names[id]}`} target="_blank" rel="noopener noreferrer" className="break-all text-sm font-medium underline">{data?.names[id] ?? id}</a>
      <p className="text-xs text-muted-foreground">{t(state.read ? 'htmlReadingUi.read' : 'htmlReadingUi.unread')} · {t(`htmlReadingUi.${state.interest === 'neutral' ? 'unmarked' : state.interest}`)}</p>
      {editing.has(id) ? <div className="space-y-2"><Textarea aria-label={t('htmlReadingUi.readingNote', { v1: data?.names[id] ?? id })} value={drafts[id] ?? state.note} disabled={saving.has(id)} onChange={event => {if(!savingIds.current.has(id))setDrafts(current => ({ ...current, [id]: event.target.value }));}} maxLength={12000} /><Button size="sm" disabled={busy||saving.has(id)} onClick={() => void saveNote(id)}>{t('htmlReadingWorkflow.saveNote')}</Button>{errors.has(id) && <p role="alert" className="text-sm text-destructive">{t('htmlReadingWorkflow.noteSaveFailed')}</p>}</div> : <details><summary className="cursor-pointer text-sm">{t('htmlReadingWorkflow.noteDetails', { count: state.note.length })}</summary><p className="my-2 whitespace-pre-wrap break-words text-sm">{state.note || t('htmlReadingUi.empty')}</p><Button size="sm" variant="outline" disabled={busy} onClick={() => { setDrafts(current => ({ ...current, [id]: current[id] ?? state.note })); setEditing(current => new Set([...current, id])); }}>{t('htmlReadingWorkflow.editNote')}</Button></details>}
      <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" disabled={busy} onClick={() => void onSave(id, 'read', !state.read)}>{t(state.read ? 'htmlReadingUi.markUnread' : 'htmlReadingUi.markRead')}</Button><Button size="sm" variant="outline" disabled={busy} onClick={() => void onSave(id, 'interest', state.interest === 'neutral' ? 'interested' : 'neutral')}>{t(state.interest === 'neutral' ? 'htmlReadingUi.markInterested' : 'htmlReadingUi.clearInterestMark')}</Button></div>
    </article>)}{!records.length && <p className="text-sm text-muted-foreground">{t('htmlReadingUi.noMatchingReadingRecords')}</p>}</div>
    <div className="flex items-center justify-between gap-3"><Button size="sm" variant="outline" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>{t('htmlReadingWorkflow.previous')}</Button><span className="text-sm">{t('htmlReadingWorkflow.page', { page: currentPage + 1, pages })}</span><Button size="sm" variant="outline" disabled={currentPage + 1 >= pages} onClick={() => setPage(currentPage + 1)}>{t('htmlReadingWorkflow.next')}</Button></div>
  </ReadingGroup>;
}
