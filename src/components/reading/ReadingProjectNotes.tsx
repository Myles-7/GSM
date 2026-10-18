import type { ReadingProjectItem } from '../../features/settings/hooks/useReadingProjects';
import { useT } from '../../i18n/useT';
import { Button } from '../ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '../ui/sheet';

export function ReadingProjectNotes({ item, open, onOpenChange, draft, conflict, busy, error, onDraft, onSave, onResolve }: {
  item?: ReadingProjectItem; open: boolean; onOpenChange: (open: boolean) => void; draft?: string; conflict: boolean; busy: boolean; error: string;
  onDraft: (id: string, value: string) => void; onSave: (item: ReadingProjectItem) => void; onResolve: (item: ReadingProjectItem, keep: boolean) => void;
}) {
  const t = useT('settings');
  const value = draft ?? item?.state.note ?? '';
  return <Sheet open={open && !!item} onOpenChange={onOpenChange}><SheetContent closeLabel={t('dailyProjects.cancel')}>
    <SheetHeader><SheetTitle>{t('dailyProjects.noteTitle')}</SheetTitle><SheetDescription className="break-all">{item?.name}</SheetDescription></SheetHeader>
    {item && <><textarea aria-label={t('dailyProjects.editNote')} value={value} maxLength={12000} onChange={event => onDraft(item.id, event.target.value)} className="min-h-48 flex-1 resize-none rounded-lg border bg-background p-4 text-base leading-relaxed" />
      {conflict && <div role="alert" className="space-y-3 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm"><p>{t('dailyProjects.noteConflict')}</p><p className="max-h-32 overflow-auto whitespace-pre-wrap break-words text-muted-foreground">{t('dailyProjects.currentNote')}: {item.state.note || t('dailyProjects.emptyNote')}</p><div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" disabled={busy} onClick={() => onResolve(item, false)}>{t('dailyProjects.useCurrentNote')}</Button><Button size="sm" variant="outline" disabled={busy} onClick={() => onResolve(item, true)}>{t('dailyProjects.keepDraftNote')}</Button></div></div>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="flex items-center justify-between gap-3"><span role="status" className="text-xs text-muted-foreground">{value !== item.state.note ? t('dailyProjects.draftKept') : t('dailyProjects.noteSaved')}</span><Button disabled={busy || value === item.state.note || conflict} onClick={() => onSave(item)}>{t('dailyProjects.saveNote')}</Button></div>
    </>}
  </SheetContent></Sheet>;
}
