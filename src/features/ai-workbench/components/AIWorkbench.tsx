import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import {
  Archive, Bot, Check, ClipboardList, Copy, Download, ExternalLink, FolderGit2, FolderOpen, FolderPlus,
  Github, History, LayoutGrid, Loader2, MessageSquare, MoreHorizontal, PanelLeft, PanelRight, Pencil, Pin, Plus, RefreshCw,
  RotateCcw, ShieldCheck, Square, Trash2, Upload,
} from 'lucide-react';
import { useAIWorkbench } from '../hooks/useAIWorkbench';
import { useAIOrganization } from '../../../hooks/useAIOrganization';
import { AIOrganizationPanel } from '../../../components/AIOrganizationPanel';
import { useT } from '../../../i18n/useT';
import type { RepositoryChatSession } from '../../../types/repositoryChat';
import type { Repository } from '../../../types';
import type { WorkbenchCandidate, WorkbenchProject, WorkbenchProposal } from '../../../types/aiWorkbench';
import { RequirementsEditor } from './RequirementsEditor';
import { WorkbenchComposer } from './WorkbenchComposer';
import { WorkbenchStart } from './WorkbenchStart';
import { WorkbenchRepositoryPicker } from './WorkbenchRepositoryPicker';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Textarea } from '../../../components/ui/textarea';
import { Badge } from '../../../components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '../../../components/ui/popover';

import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter,
} from '../../../components/ui/dialog';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '../../../components/ui/sheet';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '../../../components/ui/dropdown-menu';
import MarkdownRenderer from '../../../components/MarkdownRenderer';
import { conversationMarkdown } from '../../../services/conversationMarkdown';
import { AnswerReviewStatus } from '../../../components/AnswerReviewStatus';
import { ResearchStatus, ResearchTimer } from './ResearchStatus';
import { safeWriteText } from '../../../utils/clipboardUtils';
import { useAppStore } from '../../../store/useAppStore';
import { WorkbenchResults } from './WorkbenchResults';
import { WorkbenchSelect } from './WorkbenchSelect';
import { mergeWorkbenchCandidates } from '../../../services/workbenchOverview';
import { isAIConfigAvailable } from '../../../utils/aiConfig';
import { retainPageTaskFailure } from '../../../services/pageTaskFailure';
import type { WorkbenchInputIntent, WorkbenchScope, WorkbenchTaskMode } from '../../../types/aiWorkbench';
import './workbench-layout.css';

const download = (filename: string, content: string, type: string) => {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = filename; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
const sourceHref = (raw: string): string | undefined => {
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' && url.hostname === 'github.com' && !url.username && !url.password ? url.href : undefined;
  } catch { return undefined; }
};

const TOPIC_TO_LANGUAGE: Record<string, string> = {
  python: 'Python',
  py: 'Python',
  pytorch: 'Python',
  tensorflow: 'Python',
  django: 'Python',
  fastapi: 'Python',
  flask: 'Python',
  numpy: 'Python',
  pandas: 'Python',
  jupyter: 'Python',
  typescript: 'TypeScript',
  ts: 'TypeScript',
  react: 'TypeScript',
  vue: 'TypeScript',
  nextjs: 'TypeScript',
  nestjs: 'TypeScript',
  svelte: 'TypeScript',
  angular: 'TypeScript',
  javascript: 'JavaScript',
  js: 'JavaScript',
  node: 'JavaScript',
  nodejs: 'JavaScript',
  express: 'JavaScript',
  electron: 'JavaScript',
  rust: 'Rust',
  cargo: 'Rust',
  tokio: 'Rust',
  wasm: 'Rust',
  go: 'Go',
  golang: 'Go',
  gin: 'Go',
  gorilla: 'Go',
  java: 'Java',
  spring: 'Java',
  springboot: 'Java',
  android: 'Java',
  kotlin: 'Kotlin',
  swift: 'Swift',
  ios: 'Swift',
  swiftui: 'Swift',
  c: 'C',
  cpp: 'C++',
  'c++': 'C++',
  cplusplus: 'C++',
  csharp: 'C#',
  'c#': 'C#',
  dotnet: 'C#',
  aspnet: 'C#',
  php: 'PHP',
  laravel: 'PHP',
  wordpress: 'PHP',
  ruby: 'Ruby',
  rails: 'Ruby',
  dart: 'Dart',
  flutter: 'Dart',
  scala: 'Scala',
  elixir: 'Elixir',
  zig: 'Zig',
  lua: 'Lua',
  shell: 'Shell',
  bash: 'Shell',
  zsh: 'Shell',
  html: 'HTML',
  css: 'CSS',
};

function resolveRepoLanguage(
  repository: { language: string | null; topics?: string[] },
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  const lang = repository.language?.trim();
  if (lang && !['null', 'none', 'unknown', 'undefined'].includes(lang.toLowerCase())) {
    return lang;
  }
  if (Array.isArray(repository.topics) && repository.topics.length > 0) {
    for (const topic of repository.topics) {
      const normalized = topic.trim().toLowerCase();
      if (TOPIC_TO_LANGUAGE[normalized]) {
        return TOPIC_TO_LANGUAGE[normalized];
      }
      for (const [key, langName] of Object.entries(TOPIC_TO_LANGUAGE)) {
        if (key.length >= 3 && (normalized.includes(key) || normalized.startsWith(key))) {
          return langName;
        }
      }
    }
  }
  return t('workbench.multilingualGeneral');
}

function OperationPreview({ proposal, disabled, onExecute }: {
  proposal: WorkbenchProposal; disabled: boolean;
  onExecute: (proposal: WorkbenchProposal, restore: boolean) => void;
}) {
  const repositoryT = useT('repositories');
  const t = useT('chat');
  const [selection, setSelection] = useState<Record<string, boolean>>({});
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const selected = proposal.operations.map((op) => ({
    ...op, selected: selection[op.id] ?? op.selected, overrideLocked: overrides[op.id] ?? false,
  }));
  const restoring = (error?: string) => Boolean(error && (error === '__workbench_restore_running__' || error.startsWith('Restore ')));
  const pending = selected.filter((o) => o.selected && !restoring(o.error) && ['proposed', 'failed', 'unknown', 'running'].includes(o.status));
  const unstars = pending.filter((o) => o.kind === 'unstar').length;
  const succeeded = selected.filter((o) => o.selected && (o.status === 'success' || (restoring(o.error) && ['running', 'unknown', 'failed'].includes(o.status))));

  const language = useAppStore((state) => state.language);
  const isZh = language === 'zh' || language === 'zh-TW';
  const NO_TAGS_LABEL = isZh ? '(无标签)' : '(No tags)'; // i18n-allow-literal
  const NOT_SET_LABEL = isZh ? '(未设置)' : '(Not set)'; // i18n-allow-literal

  const renderFieldDiff = (
    field: 'custom_category' | 'custom_tags' | 'custom_description',
    beforeVal: unknown,
    afterVal: unknown,
  ) => {
    if (field === 'custom_tags') {
      const beforeTags = Array.isArray(beforeVal) ? beforeVal : [];
      const afterTags = Array.isArray(afterVal) ? afterVal : [];
      return (
        <div key={field} className="space-y-1">
          <dt className="text-muted-foreground font-medium">{t(`workbench.${field}`)}</dt>
          <dd className="mt-1 flex flex-wrap items-center gap-1.5">
            <div className="flex flex-wrap items-center gap-1">
              {beforeTags.length === 0 ? (
                <span className="text-muted-foreground italic">{NO_TAGS_LABEL}</span>
              ) : (
                beforeTags.map((tag) => (
                  <Badge key={tag} variant="outline" className="text-[11px] font-normal px-2 py-0">
                    #{tag}
                  </Badge>
                ))
              )}
            </div>
            <span className="text-muted-foreground/60 px-1 font-mono">→</span>
            <div className="flex flex-wrap items-center gap-1">
              {afterTags.length === 0 ? (
                <span className="text-muted-foreground italic">{NO_TAGS_LABEL}</span>
              ) : (
                afterTags.map((tag) => (
                  <Badge key={tag} variant="secondary" className="text-[11px] font-normal px-2 py-0">
                    #{tag}
                  </Badge>
                ))
              )}
            </div>
          </dd>
        </div>
      );
    }

    const beforeText = typeof beforeVal === 'string' && beforeVal.trim() ? beforeVal : null;
    const afterText = typeof afterVal === 'string' && afterVal.trim() ? afterVal : null;

    return (
      <div key={field} className="space-y-1">
        <dt className="text-muted-foreground font-medium">{t(`workbench.${field}`)}</dt>
        <dd className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
          {beforeText ? (
            <span className="line-through text-muted-foreground">{beforeText}</span>
          ) : (
            <span className="text-muted-foreground italic">{NOT_SET_LABEL}</span>
          )}
          <span className="text-muted-foreground/60 px-1 font-mono">→</span>
          {afterText ? (
            <span className="font-medium text-foreground">{afterText}</span>
          ) : (
            <span className="text-muted-foreground italic">{NOT_SET_LABEL}</span>
          )}
        </dd>
      </div>
    );
  };

  return (
    <section className="space-y-3 rounded-lg border border-border bg-card/40 px-3 py-4">
      <h2 className="text-sm font-semibold">{t('workbench.operationPreview')}</h2>
      {proposal.operations.length === 0 && <p className="text-sm text-muted-foreground">{t('workbench.noMatches')}</p>}
      {selected.map((op) => (
        <article key={op.id} className="rounded-md border border-border p-3 text-xs bg-card/40">
          <label className="flex items-start gap-2">
            <input type="checkbox" checked={op.selected} disabled={disabled || !['proposed', 'failed', 'success', 'unknown', 'running'].includes(op.status)}
              onChange={(e) => setSelection({ ...selection, [op.id]: e.target.checked })} />
            <span className="min-w-0 flex-1 break-words font-semibold">{op.repository.full_name}</span>
            <Badge variant={op.status === 'success' ? 'success' : op.status === 'failed' ? 'destructive' : 'outline'} className="text-[11px] font-normal py-0">
              {t(`workbench.${op.status}`)}
            </Badge>
          </label>
          <p className="my-2 break-words text-muted-foreground">{op.reason}</p>
          {op.kind === 'update' && <p className="mb-2 text-muted-foreground">{repositoryT(`dualOrganization.${op.classificationSchemeId ?? 'purpose'}`)}</p>}
          {op.kind === 'unstar' ? <p className="text-destructive font-medium">{t('workbench.unstar')}</p> : (
            <dl className="grid gap-2 rounded-md bg-muted/30 p-2">
              {(['custom_category', 'custom_tags', 'custom_description'] as const).filter((field) => JSON.stringify(op.before[field]) !== JSON.stringify(op.after[field])).map((field) =>
                renderFieldDiff(field, op.before[field], op.after[field])
              )}
            </dl>
          )}
          {op.before.category_locked && <label className="mt-2 flex gap-2 text-destructive">
            <input type="checkbox" disabled={disabled} checked={op.overrideLocked} onChange={(e) => setOverrides({ ...overrides, [op.id]: e.target.checked })} />
            {t('workbench.overrideLock')}
          </label>}
          {op.error && <p role="alert" className="mt-2 text-destructive">{op.error}</p>}
        </article>
      ))}
      {proposal.syncError && <p role="alert" className="text-sm text-destructive">{t('workbench.syncError')}: {proposal.syncError}</p>}
      <div className="flex flex-wrap gap-2">
        {pending.length > 0 && <Button size="sm" variant={unstars ? 'destructive' : 'default'} disabled={disabled}
          onClick={() => onExecute({ ...proposal, operations: selected }, false)}>
          <Check className="h-4 w-4" />{unstars ? t('workbench.confirmUnstar', { count: unstars }) : t('workbench.confirmChanges', { count: pending.length })}
        </Button>}
        {succeeded.length > 0 && <Button size="sm" variant="outline" disabled={disabled}
          onClick={() => onExecute({ ...proposal, operations: selected }, true)}>
          <RotateCcw className="h-4 w-4" />{t('workbench.confirmRestore', { count: succeeded.length })}
        </Button>}
      </div>
      {succeeded.some((o) => o.kind === 'unstar') && <p className="text-xs text-muted-foreground">{t('workbench.starTimeWarning')}</p>}
    </section>
  );
}

function RetentionChip({
  retainSessionDays,
  onChangeDays,
  isZh,
  title,
}: {
  retainSessionDays: number;
  onChangeDays: (days: number) => void;
  isZh: boolean;
  title: string;
}) {
  const [open, setOpen] = useState(false);
  const [customDays, setCustomDays] = useState(String(retainSessionDays));

  useEffect(() => {
    setCustomDays(String(retainSessionDays));
  }, [retainSessionDays]);

  const handleApplyCustom = (val: string) => {
    setCustomDays(val);
    const n = parseInt(val, 10);
    if (!isNaN(n) && n >= 1 && n <= 365) {
      onChangeDays(n);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="ml-auto flex items-center gap-1 rounded-md border border-border/50 bg-muted/40 px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          title={title}
          aria-label={title}
        >
          <History className="h-3 w-3 shrink-0" />
          <span>{retainSessionDays >= 365 ? (isZh ? '永久保存' : 'Permanent') : `${retainSessionDays}${isZh ? '天' : 'd'}`}</span> {/* i18n-allow-literal */}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-3 text-xs" align="end">
        <p className="mb-2 font-semibold text-foreground">{title}</p>
        <div className="mb-3 grid grid-cols-2 gap-1.5">
          {[30, 90, 180, 365].map((days) => (
            <Button
              key={days}
              type="button"
              variant={retainSessionDays === days ? 'default' : 'outline'}
              size="sm"
              className="h-7 text-xs"
              onClick={() => {
                onChangeDays(days);
                setCustomDays(String(days));
              }}
            >
              {days === 365 ? (isZh ? '永久保存' : 'Permanent') : `${days}${isZh ? '天' : 'd'}`} {/* i18n-allow-literal */}
            </Button>
          ))}
        </div>
        <div className="flex items-center gap-2 border-t border-border/60 pt-2">
          <span className="shrink-0 text-[11px] text-muted-foreground">{isZh ? '自定义:' : 'Custom:'}</span> {/* i18n-allow-literal */}
          <Input
            type="number"
            min={1}
            max={365}
            value={customDays}
            className="h-7 text-xs"
            aria-label={isZh ? '自定义保留天数' : 'Custom retention days'}
            onChange={(e) => handleApplyCustom(e.target.value)}
            onBlur={() => {
              const n = parseInt(customDays, 10);
              if (isNaN(n) || n < 1 || n > 365) {
                setCustomDays(String(retainSessionDays));
              }
            }}
          />
          <span className="text-[11px] text-muted-foreground">{isZh ? '天' : 'd'}</span> {/* i18n-allow-literal */}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function AIWorkbench() {
  const w = useAIWorkbench();
  useEffect(() => {
    if (w.error) retainPageTaskFailure(w.ownerId, 'chat', w.error, {
      title: 'AI', target: { view: 'ai', id: w.activeId ?? undefined },
    });
  }, [w.ownerId, w.error, w.activeId]);
  const liveWorkbench = useRef(w);
  liveWorkbench.current = w;
  const organization = useAIOrganization({ filteredRepositories: w.repositories, selectedRepositoryIds: [], categoryId: 'all', sessionId: w.activeId ?? undefined });
  const [organizationOpen, setOrganizationOpen] = useState(false);
  const organizationT = useT('repositories');
  const t = useT('chat');
  const language = useAppStore((state) => state.language);
  const isZh = language === 'zh' || language === 'zh-TW';
  const [draft, setDraft] = useState('');
  const [query, setQuery] = useState('');
  const [leftOpen, setLeftOpen] = useState<boolean | null>(() => { try { const saved = localStorage.getItem('gsm:workbench-history'); return saved === null ? null : saved !== 'false'; } catch { return null; } });
  const historyOpen = leftOpen ?? w.sessions.length > 0;
  const [view, setView] = useState<'chat' | 'overview'>('chat');
  const [docked, setDocked] = useState(() => { try { return localStorage.getItem('gsm:workbench-dock') !== 'false'; } catch { return true; } });
  const [resultRatio, setResultRatio] = useState(() => {
    try { const value = Number(localStorage.getItem('gsm:workbench-ratio')); return value >= 35 && value <= 70 ? value : 60; } catch { return 60; }
  });
  const [inputIntent, setInputIntent] = useState<WorkbenchInputIntent>('search');
  const inputIntentSessionRef = useRef<string | null>(null);
  const splitRef = useRef<HTMLDivElement>(null);
  const seenResults = useRef(new Set<string>());
  const draftKey = `gsm:workbench-draft:${w.ownerId}:${w.activeId ?? 'new'}`;
  const pendingDraft = useRef<{ ownerId: string; sessionId: string; value: string } | null>(null);
  const [loadedDraftKey, setLoadedDraftKey] = useState<string | null>(null);
  const [mobileLeft, setMobileLeft] = useState(false);
  const [tab, setTab] = useState<'results' | 'selected'>('results');
  const [batchId, setBatchId] = useState('');
  const [transitioning, setTransitioning] = useState(false);
  const [pickerSession, setPickerSession] = useState<string | null>(null);
  const pickerOwner = useRef(w.ownerId);
  const frameRef = useRef<HTMLDivElement>(null);
  const [frameHeight, setFrameHeight] = useState<number>();
  const taskChangeRevision = useRef(0);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const [isKeyboardOpen, setIsKeyboardOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [editor, setEditor] = useState<{ kind: 'project' | 'newProject' | 'session'; title: string; project?: WorkbenchProject; session?: RepositoryChatSession } | null>(null);
  const [projectInstructions, setProjectInstructions] = useState('');
  const [projectConclusions, setProjectConclusions] = useState('');
  const importRef = useRef<HTMLInputElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const proposalsStartRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [follow, setFollow] = useState(false);
  const [showProposalCapsule, setShowProposalCapsule] = useState(false);
  const scrolledSessionIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const vv = window.visualViewport;

    const handleResize = () => {
      const height = vv ? vv.height : window.innerHeight;
      const heightDiff = window.innerHeight - height;
      const isMobileWidth = window.innerWidth < 768;
      const keyboardActive = isMobileWidth && (heightDiff > 140 || (heightDiff > 60 && height < 450));
      setIsKeyboardOpen(keyboardActive);
    };

    handleResize();
    vv?.addEventListener('resize', handleResize);
    window.addEventListener('resize', handleResize);
    return () => {
      vv?.removeEventListener('resize', handleResize);
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  useEffect(() => {
    const measure = () => {
      if (!frameRef.current) return;
      const viewport = window.visualViewport;
      const top = Math.max(0, frameRef.current.getBoundingClientRect().top - (viewport?.offsetTop ?? 0));
      setFrameHeight(Math.max(0, (viewport?.height ?? window.innerHeight) - top));
    };
    measure();
    window.addEventListener('resize', measure);
    window.visualViewport?.addEventListener('resize', measure);
    window.visualViewport?.addEventListener('scroll', measure);
    return () => { window.removeEventListener('resize', measure); window.visualViewport?.removeEventListener('resize', measure); window.visualViewport?.removeEventListener('scroll', measure); };
  }, []);
  useEffect(() => {
    const ownerChanged = pickerOwner.current !== w.ownerId;
    pickerOwner.current = w.ownerId;
    setPickerSession(current => !ownerChanged && current === w.activeId ? current : null);
  }, [w.ownerId, w.activeId]);

  const batch = w.data.searchBatches.find((b) => b.id === batchId) ?? w.data.searchBatches[w.data.searchBatches.length - 1];
  const busy = w.task.running;
  const activeBusy = busy && w.task.sessionId === w.activeId;
  const readonly = Boolean(w.active?.deletedAt || w.active?.archived);
  const visibleSessions = w.sessions.filter((s) => `${s.title} ${s.repoFullName}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  const selectedModel = w.aiConfigs.find((c) => c.id === w.modelId);
  const modelReady = isAIConfigAvailable(selectedModel);
  const candidates: WorkbenchCandidate[] = tab === 'results' ? batchId === 'all'
    ? mergeWorkbenchCandidates(...w.data.searchBatches.map(item => item.candidates)) : batch?.candidates ?? []
    : w.data.selectedRepositories.map((repository) =>
      [...w.data.searchBatches].reverse().flatMap((b) => b.candidates).find((c) => c.repository.id === repository.id)
      ?? ({ repository, summary: repository.description ?? '', reasons: [], limitations: [], sources: [], status: 'candidate' }));
  const [overviewScope, setOverviewScope] = useState<WorkbenchCandidate[] | null>(null);
  useEffect(() => { setOverviewScope(null); }, [w.activeId, batchId, tab]);
  const askedCandidates = overviewScope ?? candidates;
  const invalidOverviewScope = w.data.scope === 'github' && inputIntent === 'results' && (askedCandidates.length === 0 || askedCandidates.length > 120);

  const hasNewCandidates = candidates.length > 0 || w.data.searchBatches.some((b) => b.candidates.length > 0);
  const hasPendingRequirements = Boolean(w.data.requirements && !readonly);
  const hasProposals = w.proposals.length > 0;
  const hasPendingProposals = hasPendingRequirements || hasProposals;
  useEffect(() => {
    if (!hasNewCandidates && !w.data.selectedRepositories.length) setView('chat');
  }, [w.activeId, hasNewCandidates, w.data.selectedRepositories.length]);

  useEffect(() => {
    const pending = pendingDraft.current;
    if (pending?.ownerId === w.ownerId && pending.sessionId === w.activeId) {
      setDraft(pending.value); pendingDraft.current = null;
    } else {
      try { setDraft(localStorage.getItem(draftKey) ?? ''); } catch { setDraft(''); }
    }
    setLoadedDraftKey(draftKey);
    setBatchId('');
  }, [draftKey, w.ownerId, w.activeId]);
  useEffect(() => {
    if (!w.activeId || w.active?.id !== w.activeId) {
      inputIntentSessionRef.current = null;
      return;
    }
    // Hydrate once per loaded session; arriving batches must not reset a user's choice.
    if (inputIntentSessionRef.current === w.activeId) return;
    inputIntentSessionRef.current = w.activeId;
    setInputIntent(w.data.inputIntent ?? (w.data.searchBatches.length ? 'results' : 'search'));
  }, [w.activeId, w.active?.id, w.data.inputIntent, w.data.searchBatches.length]);
  useEffect(() => {
    if (loadedDraftKey !== draftKey) return;
    try { if (draft) localStorage.setItem(draftKey, draft); else localStorage.removeItem(draftKey); } catch { /* Storage can be unavailable. */ }
  }, [draft, draftKey, loadedDraftKey]);
  useEffect(() => {
    try { localStorage.setItem('gsm:workbench-ratio', String(resultRatio)); localStorage.setItem('gsm:workbench-dock', String(docked)); if (leftOpen !== null) localStorage.setItem('gsm:workbench-history', String(leftOpen)); } catch { /* Keep the current layout in memory. */ }
  }, [resultRatio, docked, leftOpen]);
  useEffect(() => {
    if (!w.activeId || w.active?.id !== w.activeId || !hasNewCandidates || seenResults.current.has(w.activeId)) return;
    seenResults.current.add(w.activeId);
    if (w.data.scope === 'github') setInputIntent('results');
    if (!w.task.running && document.activeElement !== textareaRef.current && !window.getSelection()?.toString()) setView('overview');
  }, [w.activeId, w.active?.id, hasNewCandidates, w.data.scope, w.task.running]);
  const resizeResults = (clientX: number) => {
    const rect = splitRef.current?.getBoundingClientRect();
    if (rect) setResultRatio(Math.max(35, Math.min(70, (clientX - rect.left) / rect.width * 100)));
  };

  const checkScrollState = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;

    // Check if user is near container bottom
    const isNearContainerBottom = el.scrollHeight > 0
      ? el.scrollHeight - el.scrollTop - el.clientHeight < 120
      : follow;

    // Check if user is near messages end
    let isNearMessagesEnd = false;
    if (messagesEndRef.current && el.scrollHeight > 0) {
      const containerRect = el.getBoundingClientRect();
      const endRect = messagesEndRef.current.getBoundingClientRect();
      // messagesEnd is visible or close to the visible viewport
      isNearMessagesEnd = endRect.top - containerRect.bottom < 150 && endRect.bottom - containerRect.top > -150;
    }

    // Follow streaming when near messages end OR near container bottom
    const shouldFollow = isNearMessagesEnd || isNearContainerBottom;
    setFollow(shouldFollow);

    // Proposal capsule: if there are proposals, show when viewport is not already down at proposals/bottom
    if (hasPendingProposals) {
      setShowProposalCapsule(!isNearContainerBottom);
    } else {
      setShowProposalCapsule(false);
    }
  }, [follow, hasPendingProposals]);

  // Session switch or reload history: default follow to false, smoothly locate at latest AI response (messagesEndRef)
  useEffect(() => {
    if (scrolledSessionIdRef.current !== w.activeId) {
      setFollow(false);
      setShowProposalCapsule(hasPendingProposals);
      if (w.messages.length > 0) {
        scrolledSessionIdRef.current = w.activeId;
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
        checkScrollState();
      }
    } else if (w.messages.length > 0 && !scrolledSessionIdRef.current) {
      scrolledSessionIdRef.current = w.activeId;
      setFollow(false);
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
      checkScrollState();
    }
  }, [w.activeId, w.messages.length, hasPendingProposals, checkScrollState]);

  // Streaming follow: only follow if user was already near bottom
  useEffect(() => {
    if (follow && busy && activeBusy) {
      messagesEndRef.current?.scrollIntoView({ block: 'end' });
    }
  }, [w.messages, busy, activeBusy, follow]);

  // Update proposal capsule visibility when proposals change
  useEffect(() => {
    checkScrollState();
  }, [hasPendingProposals, w.proposals.length, w.data.requirements, checkScrollState]);

  const scrollToProposals = () => {
    const target = proposalsStartRef.current ?? bottomRef.current;
    target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setShowProposalCapsule(false);
    setFollow(true);
  };

  const editProject = (project: WorkbenchProject) => {
    setProjectInstructions(project.instructions); setProjectConclusions(project.conclusions);
    setEditor({ kind: 'project', title: project.name, project });
  };
  const sessionRow = (s: RepositoryChatSession) => (
    <div key={s.id} className={`flex min-w-0 items-center rounded-md border-l-2 transition-colors ${s.id === w.activeId ? 'border-primary bg-muted/50 font-medium' : 'border-transparent hover:bg-muted'}`}>
      <button className="flex min-w-0 flex-1 items-start gap-2 px-2 py-2 text-left text-xs" onClick={() => {
        if (w.mode !== 'legacy') { w.select(s.id); setMobileLeft(false); }
      }} disabled={w.mode === 'legacy'}>
        {s.pinned && <Pin className="mt-0.5 h-3 w-3 shrink-0 text-primary" />}
        {busy && s.id === w.task.sessionId && <Loader2 className="mt-0.5 h-3 w-3 shrink-0 animate-spin text-primary" />}
        <span className="min-w-0 flex-1">
          <span className="block truncate">{s.title}</span>
          {(s.summary || (busy && s.id === w.task.sessionId)) && (
            <span className={`mt-0.5 block truncate text-[11px] font-normal text-muted-foreground ${isKeyboardOpen ? 'hidden' : ''}`}>
              {busy && s.id === w.task.sessionId
                ? (w.task.stage === 'overview' ? t('overview.stage') : t(`workbench.stage-${w.task.stage}`, { defaultValue: w.task.stage }))
                : s.summary}
            </span>
          )}
        </span>
      </button>
      <DropdownMenu><DropdownMenuTrigger asChild>
        <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" aria-label={t('workbench.actions')}><MoreHorizontal className="h-4 w-4" /></Button>
      </DropdownMenuTrigger><DropdownMenuContent align="start">
        {w.mode === 'legacy' ? <DropdownMenuItem onSelect={() => void w.guard(() => w.claim(s.id))}>{t('workbench.claim')}</DropdownMenuItem>
          : s.deletedAt ? <DropdownMenuItem onSelect={() => void w.guard(() => w.restoreSession(s.id))}>{t('workbench.restore')}</DropdownMenuItem>
            : <>
              <DropdownMenuItem onSelect={() => setEditor({ kind: 'session', title: s.title, session: s })}>{t('workbench.rename')}</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void w.guard(() => w.patchSession(s.id, { pinned: !s.pinned }))}>{t(s.pinned ? 'workbench.unpin' : 'workbench.pin')}</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void w.guard(() => w.patchSession(s.id, { archived: !s.archived }))}>{t(s.archived ? 'workbench.restore' : 'workbench.archive')}</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void w.guard(() => w.patchSession(s.id, { projectId: undefined }))}>{t('workbench.independent')}</DropdownMenuItem>
              {w.projects.filter((p) => !p.deletedAt).map((p) => <DropdownMenuItem key={p.id} onSelect={() => void w.guard(() => w.patchSession(s.id, { projectId: p.id }))}>{p.name}</DropdownMenuItem>)}
              <DropdownMenuItem className="text-destructive" onSelect={() => void w.guard(() => w.patchSession(s.id, { deletedAt: new Date().toISOString() }))}><Trash2 className="mr-2 h-3 w-3" />{t('workbench.trash')}</DropdownMenuItem>
            </>}
      </DropdownMenuContent></DropdownMenu>
    </div>
  );

  const history = (
    <div className="flex h-full min-h-0 flex-col gap-3 p-3">
      <div className="flex gap-2">
        <Button className="min-w-0 flex-1" size="sm" onClick={() => void w.guard(() => w.createSession())}><Plus className="h-4 w-4" />{t('workbench.newChat')}</Button>
        <Button size="icon" variant="ghost" className="h-8 w-8" title={t('workbench.newProject')} aria-label={t('workbench.newProject')} onClick={() => setEditor({ kind: 'newProject', title: '' })}><FolderPlus className="h-4 w-4" /></Button>
      </div>
      <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('workbench.searchHistory')} aria-label={t('workbench.searchHistory')} className="h-8 border-border/60 bg-muted/40 text-xs transition-colors hover:bg-muted/70" />
      <WorkbenchSelect
        ariaLabel={t('workbench.history')}
        value={w.mode}
        onValueChange={(mode) => w.setMode(mode)}
        items={(['active', 'archived', 'trash', 'legacy'] as const).map((mode) => ({ value: mode, label: t(`workbench.${mode}`) }))}
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        {w.mode === 'active' && w.projects.filter((p) => !p.deletedAt && (p.name.toLowerCase().includes(query.toLowerCase()) || visibleSessions.some((s) => s.projectId === p.id))).map((p) => (
          <section key={p.id} className="mb-3">
            <div className="flex items-center gap-1">
              <button className="min-w-0 flex-1 truncate rounded-md px-2 py-2 text-left text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground" onClick={() => editProject(p)}>{p.name}</button>
              <Button size="icon" variant="ghost" className="h-7 w-7" title={t('workbench.newChat')} aria-label={t('workbench.newChat')} onClick={() => void w.guard(() => w.createSession(p.id))}><Plus className="h-3 w-3" /></Button>
            </div>
            {visibleSessions.filter((s) => s.projectId === p.id).map(sessionRow)}
          </section>
        ))}
        {visibleSessions.filter((s) => w.mode !== 'active' || !s.projectId || !w.projects.some((p) => p.id === s.projectId && !p.deletedAt)).map(sessionRow)}
      </div>
      <div className="flex items-center gap-1 border-t border-border pt-2">
        <Button size="icon" variant="ghost" title={t('workbench.export')} aria-label={t('workbench.export')} onClick={() => void w.guard(async () => download('gsm-ai-workbench.json', JSON.stringify(await w.exportBackup(), null, 2), 'application/json'))}><Download className="h-4 w-4" /></Button>
        <Button size="icon" variant="ghost" title={t('workbench.import')} aria-label={t('workbench.import')} onClick={() => importRef.current?.click()}><Upload className="h-4 w-4" /></Button>
        <RetentionChip
          retainSessionDays={w.settings.retainSessionDays}
          onChangeDays={(days) => w.setSettings({ retainSessionDays: days })}
          isZh={isZh}
          title={t('workbench.retention')}
        />
      </div>
    </div>
  );

  const taskMode: WorkbenchTaskMode = w.data.taskMode ?? (w.data.scope === 'github' ? 'discover' : 'research');
  const isStart = !w.messages.length && !hasNewCandidates && !hasPendingRequirements && !hasProposals && !busy && !readonly;
  const researchCandidates = [...new Map([
    ...w.repositories, ...(w.project?.repositories ?? []), ...w.data.selectedRepositories,
    ...w.data.searchBatches.flatMap(item => item.candidates.map(candidate => candidate.repository)),
  ].map(repo => [repo.full_name.toLowerCase(), repo])).values()];
  const seedSessionDraft = useCallback((record: RepositoryChatSession) => {
    try {
      const key = `gsm:workbench-draft:${w.ownerId}:${record.id}`;
      if (draftRef.current) localStorage.setItem(key, draftRef.current);
      localStorage.removeItem(`gsm:workbench-draft:${w.ownerId}:new`);
    } catch { /* The in-memory draft is retained below if persistence is unavailable. */ }
    pendingDraft.current = { ownerId: w.ownerId, sessionId: record.id, value: draftRef.current };
  }, [w.ownerId]);
  const isCurrentSession = (id: string) => liveWorkbench.current.ownerId === w.ownerId
    && sessionStorage.getItem('gsm:ai-workbench-session') === id;
  const startTask = async (mode: WorkbenchTaskMode, scope?: WorkbenchScope) => {
    if (busy || readonly) return;
    const revision = ++taskChangeRevision.current;
    setTransitioning(true);
    await w.guard(async () => {
      const record = await w.chooseTask(mode, scope ?? (mode === 'research' ? 'selected' : undefined), seedSessionDraft);
      if (revision !== taskChangeRevision.current || !isCurrentSession(record.id)) return;
      setView('chat');
      setInputIntent(mode === 'discover' ? 'search' : 'research');
      if (mode === 'research' && record.workbench?.scope === 'selected' && !record.workbench.selectedRepositories.length) setPickerSession(record.id);
      requestAnimationFrame(() => textareaRef.current?.focus());
    });
    if (revision === taskChangeRevision.current) setTransitioning(false);
  };
  const startLocal = async (scope?: 'local' | 'mixed') => {
    if (busy || readonly) return;
    const revision = ++taskChangeRevision.current;
    setTransitioning(true);
    await w.guard(async () => {
      const record = await w.chooseLocalProject(seedSessionDraft, scope);
      if (!record || revision !== taskChangeRevision.current || liveWorkbench.current.ownerId !== w.ownerId
        || sessionStorage.getItem('gsm:ai-workbench-session') !== record.id) return;
      setView('chat'); setInputIntent('research');
      requestAnimationFrame(() => textareaRef.current?.focus());
    });
    if (revision === taskChangeRevision.current) setTransitioning(false);
  };
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem('gsm:workbench-prefill-research');
      if (!raw) return;
      sessionStorage.removeItem('gsm:workbench-prefill-research');
      const payload = JSON.parse(raw) as { query?: string; repositories?: Repository[] };
      const repos = Array.isArray(payload.repositories) ? payload.repositories : [];
      const promptText = payload.query
        ? (isZh ? `围绕「${payload.query}」方向，深入分析并对比这批相关项目的核心定位、互通方式、架构特点与适用场景。` : `Analyze and compare the core positioning, interoperability, architecture, and use cases of these repositories around "${payload.query}".`) /* i18n-allow-literal */
        : '';
      if (promptText) {
        draftRef.current = promptText;
        setDraft(promptText);
      }
      if (repos.length > 0) {
        const workbench = liveWorkbench.current;
        void workbench.guard(async () => {
          const record = await workbench.chooseTask('research', 'selected', seedSessionDraft);
          await workbench.patchData(record.id, { taskMode: 'research', scope: 'selected', inputIntent: 'research', selectedRepositories: repos });
          setView('chat');
          setInputIntent('research');
          requestAnimationFrame(() => textareaRef.current?.focus());
        });
      }
    } catch { /* Ignore malformed prefill payload */ }
  }, [w.ownerId, isZh, seedSessionDraft]);
  const submitQuestion = (event: FormEvent) => {
    event.preventDefault();
    if (!draft.trim() || busy || readonly || !modelReady || invalidOverviewScope || transitioning) return;
    const question = draft;
    setFollow(true);
    void w.guard(async () => {
      try {
        if (!w.active) await w.chooseTask(taskMode, w.data.scope, seedSessionDraft);
        await w.send(question, taskMode === 'organize', false, { intent: taskMode === 'discover' ? inputIntent : 'research', candidates: askedCandidates });
      } catch (error) {
        const latest = liveWorkbench.current;
        if (latest.ownerId === w.ownerId && (latest.activeId === w.activeId || latest.activeId === latest.task.sessionId)) setDraft(current => current || question);
        throw error;
      }
      const latest = liveWorkbench.current;
      if (latest.ownerId === w.ownerId && (latest.activeId === w.activeId || latest.activeId === latest.task.sessionId)) setDraft(current => current === question ? '' : current);
    });
  };
  const composer = <WorkbenchComposer workbench={w} draft={draft} onDraftChange={setDraft} onSubmit={submitQuestion} textareaRef={textareaRef}
    taskMode={taskMode} inputIntent={inputIntent} onIntentChange={intent => { setInputIntent(intent); if (w.activeId) void w.guard(() => w.patchData(w.activeId!, { inputIntent: intent })); }}
    onTaskChange={mode => void startTask(mode)} onScopeChange={scope => { if (scope === 'local' || scope === 'mixed') { if (w.localProject) void startTask('research', scope); else void startLocal(scope); } else void startTask('research', scope); }}
    onChooseRepositories={() => { if (w.activeId) setPickerSession(w.activeId); else void startTask('research'); }} onChooseLocal={() => void startLocal()}
    onChooseResults={() => setView('overview')} onSessionReady={seedSessionDraft} askedCount={askedCandidates.length} invalidOverviewScope={invalidOverviewScope} keyboardOpen={isKeyboardOpen} transitioning={transitioning} />;

  const results = <WorkbenchResults workbench={w} candidates={candidates} tab={tab} onTabChange={setTab}
    batch={batch} batchId={batchId} onBatchChange={setBatchId} resolveLanguage={repository => resolveRepoLanguage(repository, t)}
    onAsk={items => { void w.guard(async () => {
      const record = await w.chooseTask('discover', 'github', seedSessionDraft);
      await w.patchData(record.id, { inputIntent: 'results' });
      if (!isCurrentSession(record.id)) return;
      setOverviewScope(items); setInputIntent('results'); setView('chat');
      requestAnimationFrame(() => textareaRef.current?.focus());
    }); }}
    onResearch={repositories => {
      setView('chat'); setInputIntent('research');
      void w.guard(() => w.send(t('overview.researchQuestion'), false, false, { intent: 'research', repositories }));
    }} />;
  return (
    <div ref={frameRef} className="workbench-frame flex min-h-0 flex-col overflow-hidden bg-background text-foreground" style={{ height: frameHeight ?? 'calc(100dvh - 3.5rem)' }}>
      <header className={`grid shrink-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 border-b border-border transition-all ${isKeyboardOpen ? 'h-9 px-2' : 'h-11 px-3'}`}>
        <div className="flex min-w-0 items-center gap-1">
        <Button size="icon" variant="ghost" className="hidden h-8 w-8 lg:inline-flex" aria-label={t('workbench.history')} title={t('workbench.history')} onClick={() => setLeftOpen(!historyOpen)}><PanelLeft className="h-4 w-4" /></Button>
        <Button size="icon" variant="ghost" className="relative h-8 w-8 lg:hidden" aria-label={t('workbench.history')} onClick={() => setMobileLeft(true)}>
          <PanelLeft className="h-4 w-4" />
          {hasPendingProposals && (
            <span
              data-testid="badge-mobile-left"
              className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-warning ring-2 ring-background animate-pulse"
              aria-label={isZh ? '有未确认提案' : 'Pending proposals'} /* i18n-allow-literal */
            />
          )}
        </Button>
        <Bot className="h-4 w-4 shrink-0 text-primary" />
        <h1 className="min-w-0 flex-1 truncate text-sm font-semibold">{w.active?.title ?? t('workbench.title')}</h1>
        {(w.error || (w.task.error && w.task.sessionId === w.activeId)) && <Button size="sm" variant="ghost" onClick={() => useAppStore.getState().setCurrentView('tasks')}>{t('workbench.taskRecords')}</Button>}
        </div>
        {(hasNewCandidates || w.data.selectedRepositories.length > 0 || view === 'overview') ? (
          <div className="flex shrink-0 items-center justify-center" role="tablist" aria-label={t('workbench.title')}>
            {(['chat', 'overview'] as const).map(item => <button key={item} type="button" role="tab" aria-selected={view === item} aria-label={t(`overview.${item === 'chat' ? 'chat' : 'view'}`)}
              className={`flex h-8 items-center gap-1.5 border-b-2 px-2.5 text-xs transition-colors hover:text-foreground ${view === item ? 'border-primary font-semibold' : 'border-transparent text-muted-foreground'}`}
              onClick={() => setView(item)}>{item === 'chat' ? <MessageSquare className="h-3.5 w-3.5" /> : <LayoutGrid className="h-3.5 w-3.5" />}<span className="hidden sm:inline">{t(`overview.${item === 'chat' ? 'chat' : 'view'}`)}</span>{item === 'overview' && hasNewCandidates && <span className="text-[11px] text-muted-foreground">{candidates.length}</span>}</button>)}
          </div>
        ) : <div />}
        <div className="flex min-w-0 items-center justify-end gap-0.5">
        {hasNewCandidates && <Button size="icon" variant="ghost" className="hidden h-8 w-8 lg:inline-flex" title={t('overview.dock')} aria-label={t('overview.dock')} aria-pressed={docked} onClick={() => setDocked(!docked)}><PanelRight className="h-4 w-4" /></Button>}
        {hasNewCandidates && <Button size="icon" variant="ghost" className="hidden h-8 w-8 lg:inline-flex" title={t('overview.resetLayout')} aria-label={t('overview.resetLayout')} onClick={() => { setResultRatio(55); setDocked(true); setLeftOpen(true); }}><RotateCcw className="h-4 w-4" /></Button>}
        {w.project && !isKeyboardOpen && <button className="hidden max-w-40 truncate text-xs text-muted-foreground sm:block" onClick={() => editProject(w.project!)}>{w.project.name}</button>}
        <Button size="icon" variant="ghost" className="h-8 w-8" title={t('workbench.exportMarkdown')} aria-label={t('workbench.exportMarkdown')} disabled={!w.messages.length}
          onClick={() => download('conversation.md', conversationMarkdown(w.messages, w.evidence), 'text/markdown')}><Download className="h-4 w-4" /></Button>
        <Button size="icon" variant="ghost" className="relative h-8 w-8" title={t('workbench.repositories')} aria-label={t('workbench.repositories')} onClick={() => { setView('overview'); setTab('selected'); }}>
          <FolderGit2 className="h-4 w-4" />
          {(hasNewCandidates || hasPendingProposals) && (
            <span
              data-testid="badge-mobile-right"
              className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-warning ring-2 ring-background animate-pulse"
              aria-label={isZh ? '有候选仓库或提案' : 'New candidates or proposals'} /* i18n-allow-literal */
            />
          )}
        </Button>
        </div>
      </header>
      <div className="flex min-h-0 flex-1">
        {historyOpen && <aside className="hidden w-[220px] shrink-0 border-r border-border lg:block">{history}</aside>}
        <div ref={splitRef} className="workbench-split min-h-0 min-w-0 flex-1" data-view={view} data-docked={docked && hasNewCandidates} style={{ '--result-ratio': `${resultRatio}%` } as React.CSSProperties}>
          <div className="workbench-results-pane min-h-0 min-w-0">{results}</div>
          <div className="workbench-separator" role="separator" aria-label={t('overview.resize')} aria-orientation="vertical" aria-valuemin={35} aria-valuemax={70} aria-valuenow={Math.round(resultRatio)} tabIndex={0}
            onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId); resizeResults(event.clientX); }}
            onPointerMove={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) resizeResults(event.clientX); }}
            onPointerUp={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
            onKeyDown={event => {
              if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) { event.preventDefault(); setResultRatio(current => event.key === 'Home' ? 35 : event.key === 'End' ? 70 : Math.max(35, Math.min(70, current + (event.key === 'ArrowRight' ? 2 : -2)))); }
            }}><span /></div>
        <main className="workbench-chat-pane min-h-0 min-w-0 flex-col">
          {busy && <div className="flex items-center gap-2 border-b border-border px-4 py-2 text-xs" role="status">
            <Loader2 className="h-3 w-3 animate-spin" /><span className="min-w-0 flex-1 truncate">{w.task.stage === 'overview' ? t('overview.stage') : t(`workbench.stage-${w.task.stage}`, { defaultValue: w.task.stage })}</span>
            <ResearchTimer task={w.task} />
            {!activeBusy && <Button size="sm" variant="ghost" onClick={() => w.select(w.task.sessionId)}>{t('workbench.returnTask')}</Button>}
            <Button size="icon" variant="ghost" className="h-6 w-6" aria-label={t('workbench.stop')} onClick={w.stop}><Square className="h-3 w-3" /></Button>
          </div>}
          {isStart && <section className="min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-6 sm:py-10" aria-label={t('workbench.startTitle')}>
            <div className="mx-auto mb-5 max-w-3xl">
              <div className="mb-2 inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/8 px-2.5 py-0.5 text-[11px] font-medium text-primary">
                <Bot className="h-3 w-3" />
                <span>{t(`workbench.task-${taskMode}`)}</span>
              </div>
              <h2 className="text-xl font-semibold tracking-tight sm:text-2xl">{t('workbench.startTitle')}</h2>
              <p className="mt-1.5 text-sm leading-6 text-muted-foreground">{t('workbench.startHint')}</p>
            </div>
            {composer}
            {!isKeyboardOpen && <WorkbenchStart taskMode={taskMode} onSelectPrompt={(promptText) => {
              draftRef.current = promptText;
              setDraft(promptText);
              requestAnimationFrame(() => {
                const el = textareaRef.current;
                if (el) { el.focus(); el.setSelectionRange(promptText.length, promptText.length); }
              });
            }} disabled={busy || readonly || transitioning} libraryCount={w.repositories.length} />}
          </section>}
          <div className={isStart ? 'hidden' : 'relative flex min-h-0 flex-1 flex-col'}>
            <div ref={scrollContainerRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6" onScroll={checkScrollState}>
              <div className="mx-auto max-w-3xl space-y-5">
              {w.messages.map((message) =>
                message.role === 'user' ? (
                  <article
                    key={message.id}
                    className="ml-auto w-fit max-w-[88%] sm:max-w-2xl text-sm [overflow-wrap:anywhere] rounded-2xl rounded-tr-sm border border-border/60 dark:border-border-strong/50 bg-muted/60 dark:bg-muted/40 px-4 py-3 shadow-xs"
                  >
                    <div className="mb-1.5 flex items-center justify-between gap-3 text-xs text-muted-foreground border-b border-border/30 pb-1">
                      <span className="font-semibold text-foreground">{t('repositoryChatSheet.you')}</span>
                      <div className="flex items-center gap-1.5">
                        {message.status !== 'complete' && (
                          <span>{message.status === 'streaming' && !activeBusy ? t('workbench.interrupted') : t(`workbench.${message.status}`)}</span>
                        )}
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-5 w-5 text-muted-foreground hover:text-foreground"
                          aria-label={t('repositoryChatSheet.copy-answer')}
                          title={t('repositoryChatSheet.copy-answer')}
                          onClick={() => void w.guard(async () => {
                            const result = await safeWriteText(message.content);
                            if (!result.success) throw new Error(result.error);
                          })}
                        >
                          <Copy className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                    <MarkdownRenderer content={message.content} shouldRender breaks fontSize="small" />
                  </article>
                ) : (
                  <article
                    key={message.id}
                    className="w-full max-w-3xl mx-auto text-sm [overflow-wrap:anywhere] border-b border-border/60 pb-5 space-y-3"
                  >
                    <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground border-b border-border/40 pb-2">
                      <div className="flex items-center gap-2">
                        <div className="h-6 w-6 rounded-md bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center border border-primary/20 text-primary shrink-0">
                          <Bot className="h-3.5 w-3.5" />
                        </div>
                        <span className="font-semibold text-foreground">{isZh ? 'AI 助手' : 'AI Assistant'}</span> {/* i18n-allow-literal */}
                        {message.status === 'streaming' ? (
                          <span className="flex items-center gap-1 text-[11px] text-primary animate-pulse">
                            <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                            <span>{activeBusy ? t('workbench.streaming') : t('workbench.interrupted')}</span>
                          </span>
                        ) : message.status !== 'complete' ? (
                          <span className="text-[11px] text-muted-foreground">{t(`workbench.${message.status}`)}</span>
                        ) : null}
                      </div>
                      <div className="flex items-center gap-1">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-6 w-6 text-muted-foreground opacity-60 transition-opacity hover:text-foreground hover:opacity-100"
                          aria-label={t('repositoryChatSheet.copy-answer')}
                          title={t('repositoryChatSheet.copy-answer')}
                          onClick={() => void w.guard(async () => {
                            const result = await safeWriteText(message.content);
                            if (!result.success) throw new Error(result.error);
                          })}
                        >
                          <Copy className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                    <AnswerReviewStatus message={message} />
                    <MarkdownRenderer content={message.content} shouldRender breaks fontSize="small" />
                    <ResearchStatus message={message} evidence={w.evidence} />
                    {message.role === 'assistant' && message.status !== 'streaming' && (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {message.researchSources?.some(source => source.status === 'failed' || source.status === 'pending') && (
                          <Button size="sm" variant="outline" disabled={busy || readonly} onClick={() => {
                            const prior = w.messages.slice(0, w.messages.findIndex(item => item.id === message.id)).reverse().find(item => item.role === 'user');
                            if (prior) void w.guard(() => w.send(prior.content, false, true));
                          }}>
                            <RotateCcw className="mr-1 h-3 w-3" />{t('research.continue')}
                          </Button>
                        )}
                        {!!message.missing?.length && (
                          <Button size="sm" variant="ghost" disabled={busy || readonly} onClick={() =>
                            void w.guard(() => w.send(`${t('research.fillMissing')}\n${message.missing!.map(item => `- ${item}`).join('\n')}`))}
                          >
                            <Plus className="mr-1 h-3 w-3" />{t('research.fillMissing')}
                          </Button>
                        )}
                        <Button size="sm" variant="ghost" disabled={busy || readonly} onClick={() => {
                          const prior = w.messages.slice(0, w.messages.findIndex(item => item.id === message.id)).reverse().find(item => item.role === 'user');
                          if (prior) void w.guard(() => w.send(prior.content));
                        }}>
                          <RefreshCw className="mr-1 h-3 w-3" />{t('research.restart')}
                        </Button>
                      </div>
                    )}
                    {message.evidenceIds.length > 0 && (
                      <div className="mt-3 space-y-2 border-t border-border/40 pt-2 text-xs">
                        <div className="flex items-center gap-1.5 font-medium text-muted-foreground">
                          <ShieldCheck className="h-3.5 w-3.5 text-primary" />
                          <span>{t('workbench.evidence')} ({message.evidenceIds.length})</span>
                        </div>
                        <div className="flex flex-col gap-1.5">
                          {w.evidence
                            .filter((e) => message.evidenceIds.includes(e.id))
                            .map((e) => {
                              const isLocal = e.source === 'local';
                              const href = sourceHref(e.url);
                              const freshnessKey = w.freshness[e.id] ?? 'unknown';
                              const freshnessText = t(`research.freshness-${freshnessKey}`);

                              if (isLocal) {
                                return (
                                  <div
                                    key={e.id}
                                    className="flex items-center gap-2 rounded-md border border-border/60 bg-muted/20 px-2.5 py-1.5 text-foreground transition-colors hover:bg-muted/40"
                                  >
                                    <FolderGit2 className="h-3.5 w-3.5 shrink-0 text-success" />
                                    <span className="font-medium truncate">{e.repoFullName}</span>
                                    {e.path && <span className="text-muted-foreground truncate">{e.path}</span>}
                                    {e.lineStart && (
                                      <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                                        (L{e.lineStart}{e.lineEnd && e.lineEnd !== e.lineStart ? `-${e.lineEnd}` : ''})
                                      </span>
                                    )}
                                    <Badge variant="outline" className="ml-auto shrink-0 py-0 text-[11px] font-normal">
                                      {freshnessText}
                                    </Badge>
                                  </div>
                                );
                              }

                              return (
                                <a
                                  key={e.id}
                                  href={href}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="group flex items-center gap-2 rounded-md border border-border/60 bg-muted/20 px-2.5 py-1.5 text-foreground transition-colors hover:border-primary/40 hover:bg-muted/50"
                                >
                                  <Github className="h-3.5 w-3.5 shrink-0 text-muted-foreground group-hover:text-foreground" />
                                  <span className="font-medium truncate">{e.repoFullName}</span>
                                  {e.path && <span className="text-muted-foreground truncate">{e.path}</span>}
                                  {e.lineStart && (
                                    <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                                      (L{e.lineStart}{e.lineEnd && e.lineEnd !== e.lineStart ? `-${e.lineEnd}` : ''})
                                    </span>
                                  )}
                                  <Badge variant="outline" className="ml-auto shrink-0 py-0 text-[11px] font-normal">
                                    {freshnessText}
                                  </Badge>
                                  <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground opacity-50 group-hover:opacity-100" />
                                </a>
                              );
                            })}
                        </div>
                      </div>
                    )}
                    {(['error', 'aborted'].includes(message.status) || (message.status === 'streaming' && !activeBusy)) && (
                      <Button size="sm" variant="ghost" disabled={busy || readonly} onClick={() => {
                        const prior = w.messages.slice(0, w.messages.findIndex((m) => m.id === message.id)).reverse().find((m) => m.role === 'user');
                        if (prior) void w.guard(() => w.send(prior.content, false));
                      }}>
                        <RotateCcw className="h-3 w-3 mr-1" />{t('repositoryChatSheet.retry')}
                      </Button>
                    )}
                  </article>
                )
              )}
              {/* Anchor 1: End of chat messages */}
              <div ref={messagesEndRef} className="h-0 w-0" />

              {/* Anchor for proposals start */}
              <div ref={proposalsStartRef} className="h-0 w-0" />
              {w.data.requirements && !readonly && <RequirementsEditor key={w.activeId} value={w.data.requirements} disabled={busy}
                depth={w.data.depth} searchedValue={w.data.searchBatches[w.data.searchBatches.length - 1]?.requirements}
                onSearch={async (r) => { setTab('results'); await w.search(r); }} />}
              {w.proposals.map((p) => p.organization ? <section key={p.id} className="border-y border-border py-3">
                <p className="text-sm font-medium">{organizationT('aiOrganization.title')} · {organizationT('aiOrganization.revision', { count: p.organization.revision })}</p>
                <p className="my-2 text-xs text-muted-foreground">{organizationT('aiOrganization.rangeCount', { count: p.organization.entries.length })}</p>
                <Button variant="outline" size="sm" onClick={() => { organization.selectVersion(p.id); setOrganizationOpen(true); }}>{organizationT('aiOrganization.preview')}</Button>
              </section> : <OperationPreview key={p.id} proposal={p} disabled={busy || readonly} onExecute={(value, restore) => void w.guard(() => w.execute(value, restore))} />)}
              <AIOrganizationPanel open={organizationOpen} onOpenChange={setOrganizationOpen} controller={organization} />
              {/* Anchor 2: Entire container bottom */}
              <div ref={bottomRef} className="h-0 w-0" />
            </div>
          </div>

          {/* Floating proposal capsule */}
          {showProposalCapsule && (
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 pointer-events-auto">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={scrollToProposals}
                className="flex items-center gap-1.5 rounded-full border-primary/40 bg-background/95 px-4 py-1.5 text-xs font-medium text-primary shadow-lg backdrop-blur transition-all duration-200 hover:scale-105 hover:bg-primary/10"
                aria-label={t('workbench.viewNewProposals')}
              >
                <ClipboardList className="h-3.5 w-3.5" />
                <span>{t('workbench.viewNewProposals')}</span>
              </Button>
            </div>
          )}
        </div>
          {!isStart && <div className={`shrink-0 border-t border-border px-4 sm:px-6 ${isKeyboardOpen ? 'py-1.5' : 'py-3'}`}>{composer}</div>}
        </main>
        </div>
      </div>
      <Sheet open={mobileLeft} onOpenChange={setMobileLeft}><SheetContent side="left" className="w-80 max-w-[90vw] p-0"><SheetHeader className="px-4 pt-4"><SheetTitle>{t('workbench.history')}</SheetTitle></SheetHeader>{history}</SheetContent></Sheet>

      {pickerSession && <WorkbenchRepositoryPicker key={`${w.ownerId}:${pickerSession}`} repositories={researchCandidates} selected={w.data.selectedRepositories} disabled={busy || readonly || transitioning}
        onReturnFocus={() => textareaRef.current?.focus()}
        onClose={() => setPickerSession(null)} onDiscover={() => { setPickerSession(null); void startTask('discover'); }}
        onSave={async items => {
          await w.guard(async () => {
            if (liveWorkbench.current.ownerId !== w.ownerId || liveWorkbench.current.activeId !== pickerSession) return;
            await w.patchData(pickerSession, { taskMode: 'research', scope: w.data.scope === 'mixed' ? 'mixed' : 'selected', inputIntent: 'research', selectedRepositories: items });
            if (!isCurrentSession(pickerSession)) return;
            setPickerSession(null); setInputIntent('research');
            requestAnimationFrame(() => textareaRef.current?.focus());
          });
        }} />}
      <input ref={importRef} type="file" accept="application/json,.json" className="hidden" onChange={(e) => {
        const file = e.target.files?.[0]; e.target.value = '';
        if (file) void w.guard(async () => { if (file.size > 25 * 1024 * 1024) throw new Error(t('workbench.backupTooLarge')); await w.importBackup(JSON.parse(await file.text())); });
      }} />

      <Dialog open={Boolean(editor)} onOpenChange={(open) => !open && setEditor(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <div className="flex items-center gap-2">
              {editor?.kind === 'session' ? (
                <Pencil className="h-4 w-4 text-primary" />
              ) : editor?.kind === 'newProject' ? (
                <FolderPlus className="h-4 w-4 text-primary" />
              ) : (
                <FolderOpen className="h-4 w-4 text-primary" />
              )}
              <DialogTitle className="text-base font-semibold">
                {t(editor?.kind === 'session' ? 'workbench.rename' : 'workbench.project')}
              </DialogTitle>
            </div>
            <DialogDescription className="text-xs text-muted-foreground">
              {editor?.kind === 'session'
                ? (isZh ? '修改会话标题以便更清晰地检索历史研究记录。' : 'Rename conversation for easier searching.')
                : (isZh ? '项目用于归集特定主题的研究会话与关联仓库，便于沉淀领域结论与跨仓库调研。' : 'Projects group research conversations and repositories for a specific topic.')} {/* i18n-allow-literal */}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <div className="space-y-1">
              <label className="text-xs font-medium text-foreground">
                {editor?.kind === 'session' ? (isZh ? '会话标题' : 'Conversation Title') : (isZh ? '项目名称' : t('workbench.name'))} <span className="text-destructive">*</span> {/* i18n-allow-literal */}
              </label>
              <Input
                value={editor?.title ?? ''}
                autoFocus
                placeholder={editor?.kind === 'session' ? (isZh ? '输入会话标题…' : 'Enter conversation title...') : (isZh ? '例如：2026 前端框架与性能横向对比' : 'e.g., 2026 Frontend Framework Comparison')} /* i18n-allow-literal */
                aria-label={t('workbench.name')}
                onChange={(e) => setEditor((x) => x && ({ ...x, title: e.target.value }))}
                className="text-xs h-8"
              />
            </div>
            {editor?.kind === 'project' && (
              <>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-foreground">{t('workbench.instructions')}</label>
                  <Textarea
                    value={projectInstructions}
                    placeholder={isZh ? '指导说明与约束，例如：重点关注 2024 年后的技术演进，优先推荐轻量与自托管方案…' : 'Instructions & constraints, e.g., focus on modern lightweight architectures...'} /* i18n-allow-literal */
                    onChange={(e) => setProjectInstructions(e.target.value)}
                    className="min-h-20 text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-foreground">{t('workbench.conclusions')}</label>
                  <Textarea
                    value={projectConclusions}
                    placeholder={isZh ? '已确认的项目结论，例如：首选 Zustand 配合 React 19 Actions 作为标准轻量架构方案…' : 'Confirmed conclusions, e.g., prefer Zustand with React 19 Actions...'} /* i18n-allow-literal */
                    onChange={(e) => setProjectConclusions(e.target.value)}
                    className="min-h-20 text-xs"
                  />
                </div>
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground pt-1">
                  <FolderOpen className="h-3.5 w-3.5 text-primary/70" />
                  <span>{editor.project?.repositories.length ?? 0} {t('workbench.repositories')}</span>
                </p>
              </>
            )}
          </div>
          <DialogFooter className="gap-2 pt-2 border-t border-border/50">
            {editor?.project && (
              <Button
                type="button"
                variant="destructive"
                size="sm"
                disabled={busy}
                onClick={() => void w.guard(async () => { await w.deleteProject(editor.project!); setEditor(null); })}
              >
                <Archive className="mr-1.5 h-3.5 w-3.5" />{t('workbench.deleteProject')}
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setEditor(null)}
            >
              {isZh ? '取消' : 'Cancel'} {/* i18n-allow-literal */}
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={!editor?.title.trim()}
              onClick={() => void w.guard(async () => {
                if (!editor) return;
                if (editor.kind === 'newProject') await w.createProject(editor.title);
                else if (editor.session) await w.patchSession(editor.session.id, { title: editor.title.trim() });
                else if (editor.project) await w.saveProject({ ...editor.project, name: editor.title.trim(), instructions: projectInstructions, conclusions: projectConclusions });
                setEditor(null);
              })}
            >
              {editor?.kind === 'newProject' ? (isZh ? '创建项目' : t('workbench.newProject')) : t('workbench.save')} {/* i18n-allow-literal */}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
