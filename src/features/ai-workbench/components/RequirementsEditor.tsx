import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, ChevronRight, HelpCircle, Loader2, Pencil, Plus, Search, X } from 'lucide-react';
import { useT } from '../../../i18n/useT';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Textarea } from '../../../components/ui/textarea';
import type { WorkbenchDepth, WorkbenchRequirements } from '../../../types/aiWorkbench';
import { useAppStore } from '../../../store/useAppStore';
import { sameWorkbenchRequirements } from '../../../services/workbenchOverview';

type ConditionGroup = 'required' | 'preferred' | 'excluded';
const groups: ConditionGroup[] = ['required', 'preferred', 'excluded'];
const signature = (value: WorkbenchRequirements) => JSON.stringify([
  value.purpose, value.required, value.preferred, value.excluded, value.questions,
]);
const clean = (items: string[]) => [...new Set(items.map((item) => item.trim()).filter(Boolean))];

function extractQuestionOptions(question: string, isZh: boolean): string[] {
  const q = question.trim();

  // 1. Explicit bracketed options: [A / B / C] or (A / B / C) or 【A / B / C】 or （A / B / C）
  const bracketMatch = q.match(/[([（【]([^()（）[\]【】]{3,})[)\]）】]/);
  if (bracketMatch) {
    const candidate = bracketMatch[1].trim();
    if (/(?:\/|\||、|\s+or\s+|\s+或者\s+)/i.test(candidate)) {
      const parts = candidate
        .split(/(?:\/|\||、|\s+or\s+|\s+或者\s+)/i)
        .map((p) => p.trim().replace(/^[-*•\d.)\s]+/, ''))
        .filter((p) => p.length > 0 && p.length < 35);
      if (parts.length >= 2) return parts;
    }
  }

  // 2. Explicit numbered list in text: e.g. "1. Option A 2. Option B" or lines
  const numberPrefixRegex = /(?:^|[\s:：、,，;；?？(（[【])([1-9][.)、]|[①②③④])(?:\s+|(?=[^\d.]))/g;
  const matches: { start: number; end: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = numberPrefixRegex.exec(q)) !== null) {
    matches.push({ start: m.index, end: m.index + m[0].length });
  }
  if (matches.length >= 2) {
    const items: string[] = [];
    for (let i = 0; i < matches.length; i++) {
      const start = matches[i].end;
      const end = i + 1 < matches.length ? matches[i + 1].start : q.length;
      const itemText = q.slice(start, end).replace(/[?？!！;；.。]+$/, '').trim();
      if (itemText.length > 0 && itemText.length < 35) {
        items.push(itemText);
      }
    }
    if (items.length >= 2) return items;
  }

  // 3. Question contains "选项：" or "options:" e.g. "选项：A、B、C"
  const colonOptions = q.match(/(?:选项|options|choices)[:：]\s*([^?？!！\n]+)/i);
  if (colonOptions) {
    const parts = colonOptions[1]
      .split(/[,，、/|]|\s+or\s+|\s+或者\s+/i)
      .map((p) => p.trim())
      .filter((p) => p.length > 0 && p.length < 35);
    if (parts.length >= 2) return parts;
  }

  // 4. Check known domain keywords
  if (/gpu|cpu|推理|加速|cuda|metal|rocm|mps|npu/i.test(q)) {
    return isZh
      ? ['仅 CPU 推理', 'GPU 加速 (CUDA)', 'Apple Silicon (Metal)'] // i18n-allow-literal
      : ['CPU only', 'GPU acceleration (CUDA)', 'Apple Silicon (Metal)']; // i18n-allow-literal
  }
  if (/gui|cli|命令行|桌面|web|界面|terminal|console/i.test(q)) {
    return isZh
      ? ['桌面 GUI 界面', 'CLI 命令行工具', 'Web 界面'] // i18n-allow-literal
      : ['Desktop GUI', 'CLI Tool', 'Web UI']; // i18n-allow-literal
  }
  if (/react|vue|angular|svelte|solid/i.test(q)) {
    return ['React', 'Vue 3', 'Svelte', 'Angular'];
  }
  if (/python|rust|golang|go|typescript|ts|javascript/i.test(q)) {
    return ['Python', 'Rust', 'TypeScript', 'Go'];
  }
  if (/本地|云端|离线|部署|cloud|local|offline|docker|k8s/i.test(q)) {
    return isZh
      ? ['本地离线运行', '云端 SaaS 服务', 'Docker 私有化部署'] // i18n-allow-literal
      : ['Local offline', 'Cloud SaaS', 'Self-hosted Docker']; // i18n-allow-literal
  }
  if (/商业|开源|协议|license|mit|apache|gpl|商用/i.test(q)) {
    return isZh
      ? ['MIT / Apache-2.0 商业友好', 'GPL 严格开源'] // i18n-allow-literal
      : ['MIT / Apache-2.0 Permissive', 'GPL Copyleft']; // i18n-allow-literal
  }
  if (/移动端|ios|android|移动|flutter|react native/i.test(q)) {
    return isZh
      ? ['跨平台 Flutter / React Native', '原生 iOS / Android', 'Web 移动端适配'] // i18n-allow-literal
      : ['Cross-platform (Flutter/RN)', 'Native iOS/Android', 'Mobile Web']; // i18n-allow-literal
  }

  // 5. Pattern: A 还是 B / A or B
  const orMatch = q.match(/(?:还是|或者|\s+or\s+|\/)([^?？,，.。]+)/i);
  if (orMatch) {
    const parts = q
      .replace(/^(?:请问|是否|需要|想要|倾向于|你更希望|希望|支持|偏好使用|偏好|选择)?\s*/i, '')
      .replace(/[?？!！.。]+$/, '')
      .split(/\s*(?:还是|或者|\s+or\s+|\/)\s*/)
      .map((p) => p.trim())
      .filter((p) => p.length > 0 && p.length < 30);
    if (parts.length >= 2) {
      return parts;
    }
  }

  // 6. Fallback for yes/no or general clarification questions
  if (/\?|？|是否|吗|需要吗|支持吗/i.test(q)) {
    return isZh ? ['是 (需要)', '否 (暂不考虑)'] : ['Yes', 'No']; // i18n-allow-literal
  }

  return isZh ? ['推荐方案', '轻量首选'] : ['Recommended', 'Lightweight']; // i18n-allow-literal
}

export function RequirementsEditor({ value, disabled, depth, searchedValue, onSearch }: {
  value: WorkbenchRequirements;
  disabled: boolean;
  depth: WorkbenchDepth;
  searchedValue?: WorkbenchRequirements;
  onSearch: (value: WorkbenchRequirements) => Promise<void>;
}) {
  const t = useT('chat');
  const language = useAppStore((state) => state.language);
  const isZh = language === 'zh' || language === 'zh-TW';
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
      excluded: clean(draft.excluded), queries: sameWorkbenchRequirements({ ...draft, preferred: clean([...draft.preferred, note]) }, value) ? value.queries : [],
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
              {draft[group].map((text, index) => {
                const isEditingThis = editor && editor.index === index && editor.originalGroup === group;

                if (isEditingThis) {
                  return (
                    <li key={`${index}-${text}`} className="flex max-w-full min-w-0 items-center gap-1.5 rounded-md border border-primary/50 bg-background p-1 shadow-xs">
                      <select
                        aria-label={t('requirementsEditor.priority')}
                        disabled={locked}
                        value={editor.group}
                        onChange={(event) => setEditor({ ...editor, group: event.target.value as ConditionGroup })}
                        className="h-7 rounded border border-border bg-muted/40 px-1.5 text-xs font-medium"
                      >
                        {groups.map((g) => <option key={g} value={g}>{t(`workbench.${g}`)}</option>)}
                      </select>
                      <Input
                        autoFocus
                        className="h-7 min-w-[120px] flex-1 text-xs"
                        value={editor.text}
                        disabled={locked}
                        aria-label={t('requirementsEditor.condition')}
                        placeholder={t('requirementsEditor.conditionPlaceholder')}
                        onChange={(event) => { dirty.current = true; setEditor({ ...editor, text: event.target.value }); }}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') { event.preventDefault(); commitCondition(); }
                          if (event.key === 'Escape') setEditor(null);
                        }}
                      />
                      <Button
                        type="button"
                        size="icon"
                        variant="secondary"
                        className="h-7 w-7 shrink-0"
                        disabled={locked || !editor.text.trim()}
                        onClick={commitCondition}
                        aria-label={t('workbench.save')}
                        title={t('workbench.save')}
                      >
                        <Check className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 shrink-0"
                        disabled={locked}
                        onClick={() => setEditor(null)}
                        aria-label={t('requirementsEditor.cancel')}
                        title={t('requirementsEditor.cancel')}
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </li>
                  );
                }

                return (
                  <li
                    key={`${index}-${text}`}
                    className="group flex max-w-full min-w-0 items-center rounded-md border border-border/70 bg-muted/30 hover:border-primary/40 hover:bg-muted/50 transition-colors"
                  >
                    <button
                      type="button"
                      disabled={locked}
                      title={t('requirementsEditor.cyclePriority')}
                      className="pl-2 pr-1 py-1 text-[11px] text-muted-foreground hover:text-foreground"
                      onClick={() => {
                        dirty.current = true;
                        const nextGroup = group === 'required' ? 'preferred' : group === 'preferred' ? 'excluded' : 'required';
                        const next = { ...draft };
                        next[group] = next[group].filter((_, i) => i !== index);
                        next[nextGroup] = clean([...next[nextGroup], text]);
                        update(next);
                      }}
                    >
                      {group === 'required' ? (
                        <span className="inline-block h-2 w-2 rounded-full bg-rose-500" title={t('workbench.required')} />
                      ) : group === 'preferred' ? (
                        <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" title={t('workbench.preferred')} />
                      ) : (
                        <span className="inline-block h-2 w-2 rounded-full bg-zinc-400" title={t('workbench.excluded')} />
                      )}
                    </button>
                    <button
                      type="button"
                      disabled={locked}
                      title={`${t('requirementsEditor.editCondition')} (${t('requirementsEditor.doubleClickToDelete')})`}
                      className="min-w-0 px-1 py-1 text-left text-xs leading-5 [overflow-wrap:anywhere]"
                      onClick={(e) => {
                        if (e.detail === 2) {
                          dirty.current = true;
                          setEditor(null);
                          update({ ...draft, [group]: draft[group].filter((_, i) => i !== index) });
                        } else {
                          dirty.current = true;
                          setEditor({ group, originalGroup: group, index, text });
                        }
                      }}
                      onDoubleClick={() => {
                        dirty.current = true;
                        setEditor(null);
                        update({ ...draft, [group]: draft[group].filter((_, i) => i !== index) });
                      }}
                    >
                      {text}
                    </button>
                    <button
                      type="button"
                      disabled={locked}
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-r-md text-muted-foreground hover:bg-muted hover:text-destructive transition-colors"
                      aria-label={t('requirementsEditor.removeCondition', { condition: text })}
                      title={t('requirementsEditor.removeCondition', { condition: text })}
                      onClick={() => {
                        if (editor?.index !== undefined) setEditor(null);
                        update({ ...draft, [group]: draft[group].filter((_, i) => i !== index) });
                      }}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
        {editor && editor.index === undefined && editor.questionIndex === undefined ? (
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-primary/50 bg-background p-1.5 shadow-xs">
            <select
              aria-label={t('requirementsEditor.priority')}
              disabled={locked}
              value={editor.group}
              onChange={(event) => setEditor({ ...editor, group: event.target.value as ConditionGroup })}
              className="h-8 rounded-md border border-border bg-background px-2 text-xs"
            >
              {groups.map((group) => <option key={group} value={group}>{t(`workbench.${group}`)}</option>)}
            </select>
            <Input
              autoFocus
              className="h-8 min-w-[120px] flex-1 text-xs"
              value={editor.text}
              disabled={locked}
              aria-label={t('requirementsEditor.condition')}
              placeholder={t('requirementsEditor.conditionPlaceholder')}
              onChange={(event) => { dirty.current = true; setEditor({ ...editor, text: event.target.value }); }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') { event.preventDefault(); commitCondition(); }
                if (event.key === 'Escape') setEditor(null);
              }}
            />
            <Button
              size="icon"
              variant="secondary"
              className="h-8 w-8"
              disabled={locked || !editor.text.trim()}
              onClick={commitCondition}
              aria-label={t('workbench.save')}
              title={t('workbench.save')}
            >
              <Check className="h-4 w-4" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8"
              disabled={locked}
              onClick={() => setEditor(null)}
              aria-label={t('requirementsEditor.cancel')}
              title={t('requirementsEditor.cancel')}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-1 text-xs text-muted-foreground"
            disabled={locked}
            onClick={() => { dirty.current = true; setEditor({ group: 'preferred', text: '' }); }}
          >
            <Plus className="h-3.5 w-3.5 mr-1" />{t('requirementsEditor.addCondition')}
          </Button>
        )}
        {suggestions.length > 0 && <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          <span className="text-muted-foreground">{t('requirementsEditor.suggestions')}</span>
          {suggestions.map((suggestion) => <button key={suggestion} type="button" disabled={locked}
            className="inline-flex items-center gap-1 py-1 text-muted-foreground hover:text-foreground"
            onClick={() => update({ ...draft, preferred: clean([...draft.preferred, suggestion]) })}>
            <Plus className="h-3 w-3" />{suggestion}
          </button>)}
        </div>}
        {draft.questions.length > 0 && (
          <div className="space-y-2 border-l-2 border-primary/40 pl-3">
            <div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
              <HelpCircle className="h-3.5 w-3.5 text-primary shrink-0" />
              <span>{t('requirementsEditor.openQuestions')}</span>
            </div>
            <div className="space-y-2.5">
              {draft.questions.map((question, index) => {
                const options = extractQuestionOptions(question, isZh);
                const isAnsweringThis = editor && editor.questionIndex === index;

                return (
                  <div
                    key={`${index}-${question}`}
                    className="rounded-lg border border-border/80 bg-muted/20 p-2.5 space-y-2 transition-all"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="min-w-0 flex-1 break-words text-xs leading-5 font-medium text-foreground">
                        {question}
                      </span>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          disabled={locked}
                          className="shrink-0 text-xs text-primary underline underline-offset-4 hover:text-primary/80"
                          onClick={() => {
                            dirty.current = true;
                            setEditor({ group: 'preferred', questionIndex: index, text: `${question} ` });
                          }}
                        >
                          {t('requirementsEditor.answer')}
                        </button>
                        <button
                          type="button"
                          disabled={locked}
                          className="shrink-0 text-xs text-muted-foreground hover:text-foreground"
                          onClick={() => update({ ...draft, questions: draft.questions.filter((_, i) => i !== index) })}
                        >
                          {t('requirementsEditor.skip')}
                        </button>
                      </div>
                    </div>

                    {isAnsweringThis ? (
                      <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-border/40">
                        <select
                          aria-label={t('requirementsEditor.priority')}
                          disabled={locked}
                          value={editor.group}
                          onChange={(event) => setEditor({ ...editor, group: event.target.value as ConditionGroup })}
                          className="h-8 rounded-md border border-border bg-background px-2 text-xs"
                        >
                          {groups.map((group) => <option key={group} value={group}>{t(`workbench.${group}`)}</option>)}
                        </select>
                        <Input
                          autoFocus
                          className="h-8 min-w-[120px] flex-1 text-xs"
                          value={editor.text}
                          disabled={locked}
                          aria-label={t('requirementsEditor.condition')}
                          placeholder={t('requirementsEditor.conditionPlaceholder')}
                          onChange={(event) => { dirty.current = true; setEditor({ ...editor, text: event.target.value }); }}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') { event.preventDefault(); commitCondition(); }
                            if (event.key === 'Escape') setEditor(null);
                          }}
                        />
                        <Button
                          size="icon"
                          variant="secondary"
                          className="h-8 w-8"
                          disabled={locked || !editor.text.trim()}
                          onClick={commitCondition}
                          aria-label={t('workbench.save')}
                          title={t('workbench.save')}
                        >
                          <Check className="h-4 w-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8"
                          disabled={locked}
                          onClick={() => setEditor(null)}
                          aria-label={t('requirementsEditor.cancel')}
                          title={t('requirementsEditor.cancel')}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    ) : (
                      <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                        <span className="text-[11px] text-muted-foreground mr-0.5">{t('requirementsEditor.quickOptions')}</span>
                        {options.map((opt) => (
                          <Button
                            key={opt}
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={locked}
                            className="h-6 px-2 py-0 text-xs rounded-full border-border/70 bg-background hover:bg-primary/10 hover:border-primary/50 hover:text-primary transition-all"
                            onClick={() => {
                              dirty.current = true;
                              update({
                                ...draft,
                                preferred: clean([...draft.preferred, opt]),
                                questions: draft.questions.filter((_, i) => i !== index),
                              });
                            }}
                          >
                            <Plus className="h-3 w-3 mr-1 opacity-70" />
                            {opt}
                          </Button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
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
