import { useRef, useState, type FormEvent, type RefObject } from 'react';
import { ChevronDown, FolderOpen, Library, Plus, ScanSearch, Search, Send, SlidersHorizontal, Square, X } from 'lucide-react';
import type { useAIWorkbench } from '../hooks/useAIWorkbench';
import type { WorkbenchInputIntent, WorkbenchScope, WorkbenchTaskMode } from '../../../types/aiWorkbench';
import type { RepositoryChatSession } from '../../../types/repositoryChat';
import { useT } from '../../../i18n/useT';
import { Button } from '../../../components/ui/button';
import { Textarea } from '../../../components/ui/textarea';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '../../../components/ui/sheet';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../../components/ui/select';
import { isAIConfigAvailable } from '../../../utils/aiConfig';

type Workbench = ReturnType<typeof useAIWorkbench>;

export function WorkbenchComposer({ workbench: w, draft, onDraftChange, onSubmit, textareaRef,
  taskMode, inputIntent, onIntentChange, onTaskChange, onScopeChange, onChooseRepositories,
  onChooseLocal, onChooseResults, onSessionReady, askedCount, invalidOverviewScope, keyboardOpen, transitioning,
}: {
  workbench: Workbench;
  draft: string;
  onDraftChange: (value: string) => void;
  onSubmit: (event: FormEvent) => void;
  textareaRef: RefObject<HTMLTextAreaElement>;
  taskMode: WorkbenchTaskMode;
  inputIntent: WorkbenchInputIntent;
  onIntentChange: (value: WorkbenchInputIntent) => void;
  onTaskChange: (value: WorkbenchTaskMode) => void;
  onScopeChange: (value: WorkbenchScope) => void;
  onChooseRepositories: () => void;
  onChooseLocal: () => void;
  onChooseResults: () => void;
  onSessionReady: (record: RepositoryChatSession) => void;
  askedCount: number;
  invalidOverviewScope: boolean;
  keyboardOpen: boolean;
  transitioning: boolean;
}) {
  const t = useT('chat');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const parameterTrigger = useRef<HTMLButtonElement>(null);
  const busy = w.task.running;
  const readonly = Boolean(w.active?.archived || w.active?.deletedAt);
  const disabled = busy || readonly || transitioning;
  const selectedModel = w.aiConfigs.find(config => config.id === w.modelId);
  const modelReady = isAIConfigAvailable(selectedModel);
  const local = w.data.scope === 'local' || w.data.scope === 'mixed';
  const localAvailable = Boolean(window.electronAPI?.agy);
  const scopeLabel = t(w.data.scope === 'local' ? 'localResearch.local'
    : w.data.scope === 'mixed' ? 'research.mixed' : `workbench.scope-${w.data.scope}`);
  const projectCount = w.project?.selectedRepositoryNames?.length ?? w.project?.repositories.length ?? 0;
  const missing = taskMode === 'discover' ? undefined
    : local && !w.localProject ? localAvailable ? 'localResearch.rebind' : 'workbench.desktopRequired'
      : w.data.scope === 'selected' && !w.data.selectedRepositories.length ? 'workbench.chooseResearchContext'
        : w.data.scope === 'mixed' && !w.data.selectedRepositories.length ? 'workbench.chooseResearchContext'
          : w.data.scope === 'project' && (!w.project || !projectCount) ? 'workbench.chooseProjectContext'
            : w.data.scope === 'library' && !w.repositories.length ? 'workbench.emptyLibrary' : undefined;
  const contextCount = w.data.scope === 'library' ? w.repositories.length
    : w.data.scope === 'project' ? projectCount : w.data.selectedRepositories.length;
  const showIntentSwitch = taskMode === 'discover' && (askedCount > 0 || w.data.searchBatches.length > 0 || Boolean(w.data.inputIntent));

  const modeButtons = [
    { mode: 'discover' as const, icon: Search, label: t('workbench.task-discover') },
    { mode: 'research' as const, icon: ScanSearch, label: t('workbench.task-research') },
    { mode: 'organize' as const, icon: Library, label: t('workbench.task-organize') },
  ];

  return <>
    <form onSubmit={event => {
      if (disabled || !draft.trim() || !modelReady || missing || invalidOverviewScope) { event.preventDefault(); return; }
      onSubmit(event);
    }} className="workbench-composer mx-auto w-full max-w-3xl" data-testid="workbench-composer">
      <div className="mb-2.5 flex min-w-0 flex-wrap items-center justify-between gap-2 text-xs">
        <div
          className="inline-flex min-w-0 flex-wrap items-center gap-1 rounded-xl border border-border/70 bg-muted/50 p-1"
          role="group"
          aria-label={t('workbench.currentTask')}
        >
          {modeButtons.map(({ mode, icon: Icon, label }) => {
            const isActive = taskMode === mode && !(mode === 'research' && w.data.scope === 'local');
            return (
              <button
                key={mode}
                type="button"
                disabled={disabled}
                aria-pressed={isActive}
                onClick={() => onTaskChange(mode)}
                className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 ${
                  isActive
                    ? 'bg-background text-foreground shadow-xs border border-border/60'
                    : 'text-muted-foreground hover:bg-background/60 hover:text-foreground'
                }`}
              >
                <Icon className={`h-3.5 w-3.5 shrink-0 ${isActive ? 'text-primary' : 'text-muted-foreground'}`} />
                <span>{label}</span>
              </button>
            );
          })}
          {localAvailable && (
            <button
              type="button"
              disabled={disabled}
              aria-pressed={taskMode === 'research' && w.data.scope === 'local'}
              onClick={onChooseLocal}
              className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 ${
                taskMode === 'research' && w.data.scope === 'local'
                  ? 'bg-background text-foreground shadow-xs border border-border/60'
                  : 'text-muted-foreground hover:bg-background/60 hover:text-foreground'
              }`}
            >
              <FolderOpen className={`h-3.5 w-3.5 shrink-0 ${taskMode === 'research' && w.data.scope === 'local' ? 'text-primary' : 'text-muted-foreground'}`} />
              <span>{t('workbench.startLocal')}</span>
            </button>
          )}
        </div>
        {taskMode !== 'discover' && (
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            {taskMode === 'research' && <Select value={w.data.scope} disabled={disabled} onValueChange={value => { if (['selected', 'project', 'library', 'local', 'mixed'].includes(value)) onScopeChange(value as WorkbenchScope); }}>
              <SelectTrigger className="h-8 w-auto max-w-full gap-1.5 rounded-lg text-xs" aria-label={t('workbench.scope')}><span className="truncate">{scopeLabel}</span></SelectTrigger>
              <SelectContent>
                {(['selected', 'project', 'library'] as const).map(scope => <SelectItem key={scope} value={scope}>{t(`workbench.scope-${scope}`)}</SelectItem>)}
                {localAvailable && <SelectItem value="local">{t('localResearch.local')}</SelectItem>}
                {localAvailable && <SelectItem value="mixed">{t('research.mixed')}</SelectItem>}
              </SelectContent>
            </Select>}
            <span className="rounded-md bg-muted/60 px-2 py-1 text-muted-foreground">{local ? w.data.localProject?.name ?? scopeLabel : t('workbench.contextCount', { count: contextCount })}</span>
            {taskMode === 'research' && ['selected', 'mixed', 'project'].includes(w.data.scope) && <Button type="button" variant="outline" size="sm" className="h-8 gap-1 rounded-lg px-2.5 text-xs" disabled={disabled} onClick={onChooseRepositories}><Plus className="h-3.5 w-3.5" />{t('workbench.chooseRepositories')}</Button>}
            {local && localAvailable && <Button type="button" variant="outline" size="sm" className="h-8 gap-1 rounded-lg px-2.5 text-xs" disabled={disabled} onClick={onChooseLocal}><FolderOpen className="h-3.5 w-3.5" />{t('localResearch.choose')}</Button>}
          </div>
        )}
      </div>
      {taskMode === 'research' && ['selected', 'mixed'].includes(w.data.scope) && w.data.selectedRepositories.length > 0 && <div className="mb-2 flex max-h-24 flex-wrap items-center gap-1.5 overflow-y-auto text-xs" aria-label={t('workbench.contextPrefix')}>
        <span className="text-muted-foreground">{t('workbench.contextPrefix')}</span>
        {w.data.selectedRepositories.map(repo => <span key={repo.id} className="flex min-w-0 items-center gap-1 rounded-md bg-muted px-2 py-1">
          <span className="max-w-52 truncate">{repo.full_name}</span><button type="button" className="rounded p-1 hover:bg-accent" disabled={disabled} title={t('workbench.removeContext')} aria-label={`${t('workbench.removeContext')} ${repo.full_name}`} onClick={() => void w.guard(() => w.patchData(w.activeId!, { selectedRepositories: w.data.selectedRepositories.filter(item => item.id !== repo.id) }))}><X className="h-3 w-3" /></button>
        </span>)}
        {w.data.selectedRepositories.length > 1 && <Button type="button" variant="ghost" size="sm" className="h-8 px-2 text-xs" disabled={disabled} onClick={() => void w.guard(() => w.patchData(w.activeId!, { selectedRepositories: [] }))}>{t('workbench.clearAll')}</Button>}
      </div>}
      {missing && <p className="mb-2 text-xs leading-5 text-muted-foreground" role="status">{t(missing)}</p>}
      {!modelReady && <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground" role="status"><span>{t(w.aiConfigs.length ? 'workbench.modelUnavailableHint' : 'workbench.noModelHint')}</span><Button type="button" size="sm" variant="outline" className="h-8 text-xs" onClick={w.openAISettings}>{t('workbench.configureModel')}</Button></div>}
      {taskMode === 'discover' && inputIntent === 'results' && (
        <div
          role="status"
          data-testid="composer-context-pill"
          className="mb-2 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-primary/25 bg-primary/5 px-3 py-1.5 text-xs text-foreground"
        >
          <span className="font-medium text-primary">
            {t(invalidOverviewScope ? 'overview.scopeLimit' : 'overview.askScope', { count: askedCount })}
          </span>
          <div className="flex items-center gap-1">
            <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={onChooseResults}>
              {t('overview.chooseScope')}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 px-2 text-xs"
              disabled={disabled}
              onClick={() => onIntentChange('search')}
            >
              {t('overview.newSearch')}
            </Button>
          </div>
        </div>
      )}
      <div className="rounded-xl border border-border bg-card p-3 shadow-xs transition-shadow focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/30">
        <Textarea ref={textareaRef} value={draft} disabled={readonly || transitioning} onChange={event => onDraftChange(event.target.value)} aria-label={t('repositoryChatSheet.question')}
          placeholder={t(taskMode === 'organize' ? 'workbench.organizePlaceholder' : taskMode === 'research' ? 'research.question' : inputIntent === 'results' ? 'overview.askPlaceholder' : 'workbench.emptyQuestion')}
          className={`resize-none border-0 bg-transparent p-1 shadow-none focus-visible:ring-0 ${keyboardOpen ? 'min-h-12 max-h-24' : 'min-h-24 max-h-40'}`}
          onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} />
        {showIntentSwitch && <div className="mt-1 flex flex-wrap gap-1" role="group" aria-label={t('overview.brief')}>{(['search', 'results'] as const).map(intent => <button key={intent} type="button" className={`min-h-9 rounded-md px-2.5 text-xs ${inputIntent === intent ? 'bg-muted font-medium text-foreground' : 'text-muted-foreground hover:bg-muted/50'}`} disabled={disabled || (intent === 'results' && !askedCount)} aria-pressed={inputIntent === intent} onClick={() => onIntentChange(intent)}>{t(intent === 'search' ? 'overview.newSearch' : 'overview.ask')}</button>)}</div>}
        <div className="mt-2 flex items-center gap-2 border-t border-border/50 pt-2">
          <Button ref={parameterTrigger} type="button" variant="ghost" size="sm" className="h-9 min-w-0 gap-1.5 px-2 text-xs text-muted-foreground" title={t('workbench.parameters')} aria-label={t('workbench.parameters')} disabled={busy || transitioning} onClick={() => setSettingsOpen(true)}>
            <SlidersHorizontal className="h-3.5 w-3.5 shrink-0" /><span className="truncate">{selectedModel?.name ?? t('workbench.model')} · {t(`workbench.${w.data.depth}`)}</span><ChevronDown className="h-3 w-3 shrink-0" />
          </Button>
          <Button type={busy ? 'button' : 'submit'} size="icon" className="ml-auto h-10 w-10 shrink-0 rounded-lg" disabled={!busy && (!draft.trim() || readonly || !modelReady || Boolean(missing) || invalidOverviewScope || transitioning)} onClick={busy ? w.stop : undefined} title={t(busy ? 'workbench.stop' : 'workbench.send')} aria-label={t(busy ? 'workbench.stop' : 'workbench.send')}>{busy ? <Square className="h-4 w-4" /> : <Send className="h-4 w-4" />}</Button>
        </div>
      </div>
      {local && w.localProject && !keyboardOpen && <details className="mt-2 text-xs text-muted-foreground"><summary className="cursor-pointer">{t('localResearch.scope')} ({w.localProject.entries.length}) · {t('localResearch.deviceOnly')}</summary><pre className="max-h-32 overflow-auto whitespace-pre-wrap py-2">{w.localProject.entries.map(item => item.path).join('\n')}</pre></details>}
      <p className="mt-2 hidden text-[11px] text-muted-foreground sm:block">{t('workbench.inputShortcut')}</p>
    </form>
    <Sheet open={settingsOpen} onOpenChange={setSettingsOpen}><SheetContent side="bottom" className="mx-auto max-h-[85dvh] max-w-xl overflow-y-auto rounded-t-2xl sm:bottom-4 sm:rounded-2xl" closeLabel={t('workbench.close')} onCloseAutoFocus={event => { event.preventDefault(); parameterTrigger.current?.focus(); }}>
      <SheetHeader><SheetTitle>{t('workbench.parameters')}</SheetTitle><SheetDescription>{t('workbench.parametersHint')}</SheetDescription></SheetHeader>
      <label className="space-y-2 text-sm"><span>{t('workbench.model')}</span><Select value={w.modelId || '__default__'} disabled={busy} onValueChange={value => w.setSettings({ chatConfigId: value === '__default__' ? null : value })}><SelectTrigger aria-label={t('workbench.model')}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="__default__">{t('workbench.model')}</SelectItem>{w.aiConfigs.map(config => <SelectItem key={config.id} value={config.id} disabled={!isAIConfigAvailable(config)}>{config.name} · {config.model}</SelectItem>)}</SelectContent></Select></label>
      <label className="space-y-2 text-sm"><span>{t('repositoryChatSheet.task-depth')}</span><Select value={w.data.depth} disabled={disabled} onValueChange={value => {
        if (!['quick', 'standard', 'deep'].includes(value)) return;
        void w.guard(async () => {
          const record = await w.chooseTask(taskMode, w.data.scope, onSessionReady);
          await w.patchData(record.id, { depth: value as typeof w.data.depth, inputIntent });
        });
      }}><SelectTrigger aria-label={t('repositoryChatSheet.task-depth')}><SelectValue /></SelectTrigger><SelectContent>{(['quick', 'standard', 'deep'] as const).map(depth => <SelectItem key={depth} value={depth}>{t(`workbench.${depth}`)}</SelectItem>)}</SelectContent></Select></label>
      <Button type="button" onClick={() => setSettingsOpen(false)}>{t('workbench.done')}</Button>
    </SheetContent></Sheet>
  </>;
}
