import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, ChevronRight, Loader2, Pencil, Plus, Search, X } from 'lucide-react';
import { useT } from '../../../i18n/useT';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Textarea } from '../../../components/ui/textarea';
import type { WorkbenchDepth, WorkbenchRequirements } from '../../../types/aiWorkbench';

type ConditionGroup = 'required' | 'preferred' | 'excluded';
const groups: ConditionGroup[] = ['required', 'preferred', 'excluded'];
const signature = (value: WorkbenchRequirements) => JSON.stringify([
  value.purpose, value.required, value.preferred, value.excluded, value.questions,
]);
const clean = (items: string[]) => [...new Set(items.map((item) => item.trim()).filter(Boolean))];

export function RequirementsEditor({ value, disabled, depth, searchedValue, onSearch }: {
  value: WorkbenchRequirements;
  disabled: boolean;
  depth: WorkbenchDepth;
  searchedValue?: WorkbenchRequirements;
  onSearch: (value: WorkbenchRequirements) => Promise<void>;
}) {
  const t = useT('chat');
  const [draft, setDraft] = useState(value);
  const [collapsed, setCollapsed] = useState(() => Boolean(searchedValue && signature(searchedValue) === signature(value)));
  const [editingPurpose, setEditingPurpose] = useState(false);
  const [editor, setEditor] = useState<{ group: ConditionGroup; originalGroup?: ConditionGroup; index?: number; questionIndex?: number; text: string } | null>(null);
  const [note, setNote] = useState('');
  const [showNote, setShowNote] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const dirty = useRef(false);
  const received = useRef(signature(value));
  const currentSignature = signature(value);
  const changedUpstream = currentSignature !== received.current;
  const locked = disabled || submitting;
  const count = groups.reduce((total, group) => total + draft[group].length, 0);

  useEffect(() => {
    if (currentSignature === received.current || dirty.current) return;
    received.current = currentSignature;
    setDraft(value);
    setCollapsed(false);
    setEditor(null);
  }, [currentSignature, value]);

  const update = (next: WorkbenchRequirements) => {
    dirty.current = true;
    setDraft(next);
    setError('');
  };
  const commitCondition = () => {
    if (!editor?.text.trim()) return;
    const next = { ...draft };
    if (editor.index !== undefined && editor.originalGroup === editor.group) {
      next[editor.group] = clean(next[editor.group].map((item, index) => index === editor.index ? editor.text : item));
    } else {
      if (editor.index !== undefined && editor.originalGroup) {
        next[editor.originalGroup] = next[editor.originalGroup].filter((_, index) => index !== editor.index);
      }
      next[editor.group] = clean([...next[editor.group], editor.text]);
    }
    if (editor.questionIndex !== undefined) next.questions = next.questions.filter((_, index) => index !== editor.questionIndex);
    update(next); setEditor(null);
  };
  const suggestedKeys = /数学|建模|model|optim|数值/i.test(draft.purpose)
    ? ['suggestExamples', 'suggestVisualization', 'suggestLocal']
    : /桌面|desktop|windows|macos|linux/i.test(draft.purpose)
      ? ['suggestGUI', 'suggestLocal', 'suggestExamples']
      : ['suggestExamples', 'suggestMaintained', 'suggestLocal'];
  const suggestions = suggestedKeys.map((key) => t(`requirementsEditor.${key}`))
    .filter((text) => !groups.some((group) => draft[group].includes(text)));

  const search = async () => {
    if (locked || !draft.purpose.trim() || editor) return;
    const next = {
      ...draft, purpose: draft.purpose.trim(),
      required: clean(draft.required), preferred: clean([...draft.preferred, note]),
      excluded: clean(draft.excluded), queries: [],
    };
    setSubmitting(true); setError(''); setCollapsed(true);
    try {
      await onSearch(next);
      received.current = signature(next);
      dirty.current = false;
      setDraft(next); setNote(''); setShowNote(false); setCollapsed(true);
    } catch (failure) {
      setCollapsed(false);
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally { setSubmitting(false); }
  };

  return (
    <section aria-label={t('workbench.requirements')} className="border-y border-border/70 py-3">
      <div className="flex min-w-0 items-center gap-2">
        {collapsed ? <Check className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" /> : <Search className="h-4 w-4 shrink-0 text-muted-foreground" />}
        <h2 className="min-w-0 flex-1 text-xs font-medium text-muted-foreground">
          {t(collapsed ? 'requirementsEditor.confirmed' : 'workbench.requirements')}
          {count > 0 && <span className="ml-2">{t('requirementsEditor.conditionCount', { count })}</span>}
        </h2>
        <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" aria-expanded={!collapsed}
          aria-label={t(collapsed ? 'requirementsEditor.expand' : 'requirementsEditor.collapse')}
          title={t(collapsed ? 'requirementsEditor.expand' : 'requirementsEditor.collapse')} onClick={() => setCollapsed(!collapsed)}>
          {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </Button>
      </div>
      <div className="mt-1 flex min-w-0 items-start gap-2">
        {editingPurpose && !collapsed ? <Input autoFocus value={draft.purpose} disabled={locked} aria-label={t('workbench.purpose')}
          className="min-w-0 flex-1 text-sm" onChange={(event) => update({ ...draft, purpose: event.target.value })}
          onKeyDown={(event) => { if (event.key === 'Enter' || event.key === 'Escape') { event.preventDefault(); setEditingPurpose(false); } }}
          onBlur={() => setEditingPurpose(false)} />
          : <p className="min-w-0 flex-1 whitespace-pre-wrap break-words text-sm font-semibold leading-6">{draft.purpose}</p>}
        {!collapsed && !editingPurpose && <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" disabled={locked}
          aria-label={t('requirementsEditor.editPurpose')} title={t('requirementsEditor.editPurpose')} onClick={() => setEditingPurpose(true)}><Pencil className="h-3.5 w-3.5" /></Button>}
      </div>
      {!collapsed && <div className="mt-3 space-y-3">
        {changedUpstream && dirty.current && <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>{t('requirementsEditor.draftPreserved')}</span>
          <button type="button" disabled={locked} className="text-primary underline underline-offset-4" onClick={() => {
            received.current = currentSignature; dirty.current = false; setDraft(value); setEditor(null); setNote('');
          }}>{t('requirementsEditor.useNew')}</button>
        </div>}
        {groups.filter((group) => draft[group].length > 0).map((group) => (
          <div key={group} className="grid grid-cols-1 gap-1.5 sm:grid-cols-[5.5rem_minmax(0,1fr)] sm:items-start">
            <span className="pt-1 text-xs text-muted-foreground">{t(`workbench.${group}`)}</span>
            <ul className="flex min-w-0 flex-wrap gap-1.5">
              {draft[group].map((text, index) => (
                <li key={`${index}-${text}`} className="flex max-w-full min-w-0 items-center rounded-md border border-border/70 bg-muted/30">
                  <button type="button" disabled={locked} title={t('requirementsEditor.editCondition')} className="min-w-0 px-2 py-1 text-left text-xs leading-5 [overflow-wrap:anywhere]"
                    onClick={() => { dirty.current = true; setEditor({ group, originalGroup: group, index, text }); }}>{text}</button>
                  <button type="button" disabled={locked} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-r-md text-muted-foreground hover:bg-muted hover:text-destructive"
                    aria-label={t('requirementsEditor.removeCondition', { condition: text })} title={t('requirementsEditor.removeCondition', { condition: text })}
                    onClick={() => update({ ...draft, [group]: draft[group].filter((_, i) => i !== index) })}><X className="h-3 w-3" /></button>
                </li>
              ))}
            </ul>
          </div>
        ))}
        {editor ? <div className="flex flex-wrap items-center gap-2">
          <select aria-label={t('requirementsEditor.priority')} disabled={locked} value={editor.group}
            onChange={(event) => setEditor({ ...editor, group: event.target.value as ConditionGroup })}
            className="h-8 rounded-md border border-border bg-background px-2 text-xs">
            {groups.map((group) => <option key={group} value={group}>{t(`workbench.${group}`)}</option>)}
          </select>
          <Input autoFocus className="h-8 min-w-[120px] flex-1 text-xs" value={editor.text} disabled={locked}
            aria-label={t('requirementsEditor.condition')} placeholder={t('requirementsEditor.conditionPlaceholder')}
            onChange={(event) => { dirty.current = true; setEditor({ ...editor, text: event.target.value }); }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') { event.preventDefault(); commitCondition(); }
              if (event.key === 'Escape') setEditor(null);
            }} />
          <Button size="icon" variant="secondary" className="h-8 w-8" disabled={locked || !editor.text.trim()} onClick={commitCondition}
            aria-label={t('workbench.save')} title={t('workbench.save')}><Check className="h-4 w-4" /></Button>
          <Button size="icon" variant="ghost" className="h-8 w-8" disabled={locked} onClick={() => setEditor(null)}
            aria-label={t('requirementsEditor.cancel')} title={t('requirementsEditor.cancel')}><X className="h-4 w-4" /></Button>
        </div> : <Button size="sm" variant="ghost" className="h-7 px-1 text-xs text-muted-foreground" disabled={locked}
          onClick={() => { dirty.current = true; setEditor({ group: 'preferred', text: '' }); }}><Plus className="h-3.5 w-3.5" />{t('requirementsEditor.addCondition')}</Button>}
        {suggestions.length > 0 && <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          <span className="text-muted-foreground">{t('requirementsEditor.suggestions')}</span>
          {suggestions.map((suggestion) => <button key={suggestion} type="button" disabled={locked}
            className="inline-flex items-center gap-1 py-1 text-muted-foreground hover:text-foreground"
            onClick={() => update({ ...draft, preferred: clean([...draft.preferred, suggestion]) })}>
            <Plus className="h-3 w-3" />{suggestion}
          </button>)}
        </div>}
        {draft.questions.length > 0 && <div className="space-y-2 border-l-2 border-primary/30 pl-3">
          <p className="text-xs font-medium">{t('requirementsEditor.openQuestions')}</p>
          {draft.questions.map((question, index) => <div key={question} className="flex items-start gap-2">
            <span className="min-w-0 flex-1 break-words text-xs leading-5">{question}</span>
            <button type="button" disabled={locked} className="shrink-0 text-xs text-primary underline underline-offset-4"
              onClick={() => { dirty.current = true; setEditor({ group: 'preferred', questionIndex: index, text: `${question} ` }); }}>{t('requirementsEditor.answer')}</button>
            <button type="button" disabled={locked} className="shrink-0 text-xs text-muted-foreground" onClick={() => update({ ...draft, questions: draft.questions.filter((_, i) => i !== index) })}>{t('requirementsEditor.skip')}</button>
          </div>)}
        </div>}
        <button type="button" className="flex items-center gap-1 text-xs text-muted-foreground" onClick={() => setShowNote(!showNote)} aria-expanded={showNote}>
          {showNote ? <ChevronDown className="h-3 w-3" /> : <Plus className="h-3 w-3" />}{t('requirementsEditor.note')}
        </button>
        {showNote && <Textarea className="min-h-16 text-xs" value={note} disabled={locked} aria-label={t('requirementsEditor.note')}
          placeholder={t('requirementsEditor.notePlaceholder')} onChange={(event) => { dirty.current = true; setNote(event.target.value); }} />}
        {error && <p role="alert" className="break-words text-xs text-destructive">{error}</p>}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
          <span className="text-xs text-muted-foreground">{t('repositoryChatSheet.task-depth')} · {t(`workbench.${depth}`)}</span>
          <Button size="sm" disabled={locked || !draft.purpose.trim() || Boolean(editor)} onClick={() => void search()}>
            {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
            {t(searchedValue ? 'requirementsEditor.searchAgain' : 'workbench.startSearch')}
          </Button>
        </div>
      </div>}
    </section>
  );
}
