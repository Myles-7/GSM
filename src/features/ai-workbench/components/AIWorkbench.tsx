import { useEffect, useRef, useState } from 'react';
import {
  Archive, Bot, Check, ChevronDown, ClipboardList, Copy, Download, ExternalLink, FolderGit2, FolderOpen, FolderPlus,
  Github, History, LayoutGrid, Loader2, MessageSquare, MoreHorizontal, PanelLeft, PanelRight, Pencil, Pin, Plus, RefreshCw,
  RotateCcw, Send, ShieldCheck, SlidersHorizontal, Square, Trash2, Upload, X,
} from 'lucide-react';
import { useAIWorkbench } from '../hooks/useAIWorkbench';
import { useAIOrganization } from '../../../hooks/useAIOrganization';
import { AIOrganizationPanel } from '../../../components/AIOrganizationPanel';
import { useT } from '../../../i18n/useT';
import type { RepositoryChatSession } from '../../../types/repositoryChat';
import type { WorkbenchCandidate, WorkbenchProject, WorkbenchProposal } from '../../../types/aiWorkbench';
import { RequirementsEditor } from './RequirementsEditor';
import { InspirationGrid } from './InspirationGrid';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Textarea } from '../../../components/ui/textarea';
import { Badge } from '../../../components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '../../../components/ui/popover';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '../../../components/ui/select';
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
import { mergeWorkbenchCandidates } from '../../../services/workbenchOverview';
import type { WorkbenchInputIntent } from '../../../types/aiWorkbench';
import './workbench-layout.css';

const download = (filename: string, content: string, type: string) => {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = filename; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
const selectClass = 'h-8 min-w-0 max-w-full rounded-md border border-border bg-background px-2 text-xs';
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
    <section className="space-y-3 border-y border-border py-4">
      <h2 className="text-sm font-semibold">{t('workbench.operationPreview')}</h2>
      {proposal.operations.length === 0 && <p className="text-sm text-muted-foreground">{t('workbench.noMatches')}</p>}
      {selected.map((op) => (
        <article key={op.id} className="rounded-md border border-border p-3 text-xs bg-card/40">
          <label className="flex items-start gap-2">
            <input type="checkbox" checked={op.selected} disabled={disabled || !['proposed', 'failed', 'success', 'unknown', 'running'].includes(op.status)}
              onChange={(e) => setSelection({ ...selection, [op.id]: e.target.checked })} />
            <span className="min-w-0 flex-1 break-words font-semibold">{op.repository.full_name}</span>
            <Badge variant={op.status === 'success' ? 'success' : op.status === 'failed' ? 'destructive' : 'outline'} className="text-[10px] font-normal py-0">
              {t(`workbench.${op.status}`)}
            </Badge>
          </label>
          <p className="my-2 break-words text-muted-foreground">{op.reason}</p>
          {op.kind === 'unstar' ? <p className="text-destructive font-medium">{t('workbench.unstar')}</p> : (
            <dl className="grid gap-2">
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
  const [leftOpen, setLeftOpen] = useState(() => { try { return localStorage.getItem('gsm:workbench-history') !== 'false'; } catch { return true; } });
  const [view, setView] = useState<'chat' | 'overview'>('chat');
  const [docked, setDocked] = useState(() => { try { return localStorage.getItem('gsm:workbench-dock') !== 'false'; } catch { return true; } });
  const [resultRatio, setResultRatio] = useState(() => {
    try { const value = Number(localStorage.getItem('gsm:workbench-ratio')); return value >= 35 && value <= 70 ? value : 60; } catch { return 60; }
  });
  const [inputIntent, setInputIntent] = useState<WorkbenchInputIntent>('search');
  const splitRef = useRef<HTMLDivElement>(null);
  const seenResults = useRef(new Set<string>());
  const draftKey = `gsm:workbench-draft:${w.ownerId}:${w.activeId ?? 'new'}`;
  const [loadedDraftKey, setLoadedDraftKey] = useState<string | null>(null);
  const [mobileLeft, setMobileLeft] = useState(false);
  const [tab, setTab] = useState<'results' | 'selected'>('results');
  const [batchId, setBatchId] = useState('');
  const [manage, setManage] = useState(false);
  const [mobileToolbarOpen, setMobileToolbarOpen] = useState(false);
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

  const batch = w.data.searchBatches.find((b) => b.id === batchId) ?? w.data.searchBatches[w.data.searchBatches.length - 1];
  const busy = w.task.running;
  const activeBusy = busy && w.task.sessionId === w.activeId;
  const readonly = Boolean(w.active?.deletedAt || w.active?.archived);
  const visibleSessions = w.sessions.filter((s) => `${s.title} ${s.repoFullName}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  const currentScopeLabel =
    w.data.scope === 'local'
      ? t('localResearch.local')
      : w.data.scope === 'mixed'
        ? t('research.mixed')
        : t(`workbench.scope-${w.data.scope}`);
  const currentModelLabel = w.aiConfigs.find((c) => c.id === w.modelId)?.name ?? t('workbench.model');
  const currentDepthLabel = t(`workbench.${w.data.depth}`);
  const candidates: WorkbenchCandidate[] = tab === 'results' ? batchId === 'all'
    ? mergeWorkbenchCandidates(...w.data.searchBatches.map(item => item.candidates)) : batch?.candidates ?? []
    : w.data.selectedRepositories.map((repository) =>
      [...w.data.searchBatches].reverse().flatMap((b) => b.candidates).find((c) => c.repository.id === repository.id)
      ?? ({ repository, summary: repository.description ?? '', reasons: [], limitations: [], sources: [], status: 'candidate' }));

  const hasNewCandidates = candidates.length > 0 || w.data.searchBatches.some((b) => b.candidates.length > 0);
  const hasPendingRequirements = Boolean(w.data.requirements && !readonly);
  const hasProposals = w.proposals.length > 0;
  const hasPendingProposals = hasPendingRequirements || hasProposals;

  useEffect(() => {
    try { setDraft(localStorage.getItem(draftKey) ?? ''); } catch { setDraft(''); }
    setLoadedDraftKey(draftKey);
    setBatchId('');
  }, [draftKey]);
  useEffect(() => {
    if (w.active?.id === w.activeId) setInputIntent(w.data.inputIntent ?? (w.data.searchBatches.length ? 'results' : 'search'));
  }, [w.activeId, w.active?.id]);
  useEffect(() => {
    if (loadedDraftKey !== draftKey) return;
    try { if (draft) localStorage.setItem(draftKey, draft); else localStorage.removeItem(draftKey); } catch { /* Storage can be unavailable. */ }
  }, [draft, draftKey, loadedDraftKey]);
  useEffect(() => {
    try { localStorage.setItem('gsm:workbench-ratio', String(resultRatio)); localStorage.setItem('gsm:workbench-dock', String(docked)); localStorage.setItem('gsm:workbench-history', String(leftOpen)); } catch { /* Keep the current layout in memory. */ }
  }, [resultRatio, docked, leftOpen]);
  useEffect(() => {
    if (!w.activeId || w.active?.id !== w.activeId || !hasNewCandidates || seenResults.current.has(w.activeId)) return;
    seenResults.current.add(w.activeId);
    if (w.data.scope === 'github') setInputIntent('results');
    if (document.activeElement !== textareaRef.current && !window.getSelection()?.toString()) setView('overview');
  }, [w.activeId, w.active?.id, hasNewCandidates]);
  const resizeResults = (clientX: number) => {
    const rect = splitRef.current?.getBoundingClientRect();
    if (rect) setResultRatio(Math.max(35, Math.min(70, (clientX - rect.left) / rect.width * 100)));
  };

  const checkScrollState = () => {
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
  };

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
  }, [w.activeId, w.messages.length, hasPendingProposals]);

  // Streaming follow: only follow if user was already near bottom
  useEffect(() => {
    if (follow && busy && activeBusy) {
      messagesEndRef.current?.scrollIntoView({ block: 'end' });
    }
  }, [w.messages, busy, activeBusy, follow]);

  // Update proposal capsule visibility when proposals change
  useEffect(() => {
    checkScrollState();
  }, [hasPendingProposals, w.proposals.length, w.data.requirements]);

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
    <div key={s.id} className={`flex min-w-0 items-center rounded-md ${s.id === w.activeId ? 'bg-accent' : 'hover:bg-muted'}`}>
      <button className="flex min-w-0 flex-1 items-center gap-2 px-2 py-2 text-left text-xs" onClick={() => {
        if (w.mode !== 'legacy') { w.select(s.id); setMobileLeft(false); }
      }} disabled={w.mode === 'legacy'}>
        {s.pinned && <Pin className="h-3 w-3 shrink-0" />}
        {busy && s.id === w.task.sessionId && <Loader2 className="h-3 w-3 shrink-0 animate-spin" />}
        <span className="truncate">{s.title}</span>
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
        <Button className="min-w-0 flex-1" size="sm" variant="secondary" onClick={() => void w.guard(() => w.createSession())}><Plus className="h-4 w-4" />{t('workbench.newChat')}</Button>
        <Button size="icon" variant="ghost" className="h-8 w-8" title={t('workbench.newProject')} aria-label={t('workbench.newProject')} onClick={() => setEditor({ kind: 'newProject', title: '' })}><FolderPlus className="h-4 w-4" /></Button>
      </div>
      <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('workbench.searchHistory')} aria-label={t('workbench.searchHistory')} className="h-8 text-xs" />
      <select className={selectClass} aria-label={t('workbench.history')} value={w.mode} onChange={(e) => w.setMode(e.target.value as typeof w.mode)}>
        {(['active', 'archived', 'trash', 'legacy'] as const).map((mode) => <option key={mode} value={mode}>{t(`workbench.${mode}`)}</option>)}
      </select>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {w.mode === 'active' && w.projects.filter((p) => !p.deletedAt && (p.name.toLowerCase().includes(query.toLowerCase()) || visibleSessions.some((s) => s.projectId === p.id))).map((p) => (
          <section key={p.id} className="mb-3">
            <div className="flex items-center gap-1">
              <button className="min-w-0 flex-1 truncate px-2 py-2 text-left text-xs font-semibold" onClick={() => editProject(p)}>{p.name}</button>
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

  const results = <WorkbenchResults workbench={w} candidates={candidates} tab={tab} onTabChange={setTab}
    batch={batch} batchId={batchId} onBatchChange={setBatchId} resolveLanguage={repository => resolveRepoLanguage(repository, t)}
    onAsk={() => { setInputIntent('results'); setView('chat'); requestAnimationFrame(() => textareaRef.current?.focus()); }}
    onResearch={repositories => {
      setView('chat'); setInputIntent('research');
      void w.guard(() => w.send(t('overview.researchQuestion'), false, false, { intent: 'research', repositories }));
    }} />;
  return (
    <div className={`flex flex-col overflow-hidden bg-background text-foreground transition-all duration-150 ${isKeyboardOpen ? 'h-[100dvh] min-h-0' : 'h-[calc(100dvh-4.5rem)] min-h-[420px]'}`}>
      <header className={`flex shrink-0 items-center gap-2 border-b border-border transition-all ${isKeyboardOpen ? 'h-9 px-2' : 'h-11 px-3'}`}>
        <Button size="icon" variant="ghost" className="hidden h-8 w-8 lg:inline-flex" aria-label={t('workbench.history')} title={t('workbench.history')} onClick={() => setLeftOpen(!leftOpen)}><PanelLeft className="h-4 w-4" /></Button>
        <Button size="icon" variant="ghost" className="relative h-8 w-8 lg:hidden" aria-label={t('workbench.history')} onClick={() => setMobileLeft(true)}>
          <PanelLeft className="h-4 w-4" />
          {hasPendingProposals && (
            <span
              data-testid="badge-mobile-left"
              className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-amber-500 ring-2 ring-background animate-pulse"
              aria-label={isZh ? '有未确认提案' : 'Pending proposals'} /* i18n-allow-literal */
            />
          )}
        </Button>
        <Bot className="h-4 w-4 shrink-0 text-primary" />
        <h1 className="min-w-0 flex-1 truncate text-sm font-semibold">{w.active?.title ?? t('workbench.title')}</h1>
        <div className="flex shrink-0 items-center border-b border-border" role="tablist" aria-label={t('workbench.title')}>
          {(['chat', 'overview'] as const).map(item => <button key={item} type="button" role="tab" aria-selected={view === item} aria-label={t(`overview.${item === 'chat' ? 'chat' : 'view'}`)}
            className={`flex h-8 items-center gap-1.5 border-b-2 px-2 text-xs ${view === item ? 'border-primary font-semibold' : 'border-transparent text-muted-foreground'}`}
            onClick={() => setView(item)}>{item === 'chat' ? <MessageSquare className="h-3.5 w-3.5" /> : <LayoutGrid className="h-3.5 w-3.5" />}<span className="hidden sm:inline">{t(`overview.${item === 'chat' ? 'chat' : 'view'}`)}</span>{item === 'overview' && hasNewCandidates && <span className="text-[10px] text-muted-foreground">{candidates.length}</span>}</button>)}
        </div>
        {view === 'overview' && <Button size="icon" variant="ghost" className="hidden h-8 w-8 xl:inline-flex" title={t('overview.dock')} aria-label={t('overview.dock')} aria-pressed={docked} onClick={() => setDocked(!docked)}><PanelRight className="h-4 w-4" /></Button>}
        {view === 'overview' && <Button size="icon" variant="ghost" className="hidden h-8 w-8 xl:inline-flex" title={t('overview.resetLayout')} aria-label={t('overview.resetLayout')} onClick={() => { setResultRatio(60); setDocked(true); setLeftOpen(true); }}><RotateCcw className="h-4 w-4" /></Button>}
        {w.project && !isKeyboardOpen && <button className="hidden max-w-40 truncate text-xs text-muted-foreground sm:block" onClick={() => editProject(w.project!)}>{w.project.name}</button>}
        <Button size="icon" variant="ghost" className="h-8 w-8" title={t('workbench.exportMarkdown')} aria-label={t('workbench.exportMarkdown')} disabled={!w.messages.length}
          onClick={() => download('conversation.md', conversationMarkdown(w.messages, w.evidence), 'text/markdown')}><Download className="h-4 w-4" /></Button>
        <Button size="icon" variant="ghost" className="relative h-8 w-8" title={t('workbench.repositories')} aria-label={t('workbench.repositories')} onClick={() => { setView('overview'); setTab('selected'); }}>
          <FolderGit2 className="h-4 w-4" />
          {(hasNewCandidates || hasPendingProposals) && (
            <span
              data-testid="badge-mobile-right"
              className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-amber-500 ring-2 ring-background animate-pulse"
              aria-label={isZh ? '有候选仓库或提案' : 'New candidates or proposals'} /* i18n-allow-literal */
            />
          )}
        </Button>
      </header>
      <div className="flex min-h-0 flex-1">
        {leftOpen && <aside className="hidden w-[220px] shrink-0 border-r border-border lg:block">{history}</aside>}
        <div ref={splitRef} className="workbench-split min-h-0 min-w-0 flex-1" data-view={view} data-docked={view === 'overview' && docked} style={{ '--result-ratio': `${resultRatio}%` } as React.CSSProperties}>
          <div className="workbench-results-pane min-h-0 min-w-0">{results}</div>
          <div className="workbench-separator" role="separator" aria-label={t('overview.resize')} aria-orientation="vertical" aria-valuemin={35} aria-valuemax={70} aria-valuenow={Math.round(resultRatio)} tabIndex={0}
            onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId); resizeResults(event.clientX); }}
            onPointerMove={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) resizeResults(event.clientX); }}
            onPointerUp={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
            onKeyDown={event => {
              if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) { event.preventDefault(); setResultRatio(current => event.key === 'Home' ? 35 : event.key === 'End' ? 70 : Math.max(35, Math.min(70, current + (event.key === 'ArrowRight' ? 2 : -2)))); }
            }}><span /></div>
        <main className="workbench-chat-pane min-h-0 min-w-0 flex-col">
          {(w.error || (w.task.error && w.task.sessionId === w.activeId)) && <p role="alert" className="border-b border-destructive/30 px-4 py-2 text-sm text-destructive">{w.error || w.task.error}</p>}
          {busy && <div className="flex items-center gap-2 border-b border-border px-4 py-2 text-xs" role="status">
            <Loader2 className="h-3 w-3 animate-spin" /><span className="min-w-0 flex-1 truncate">{w.task.stage === 'overview' ? t('overview.stage') : t(`workbench.stage-${w.task.stage}`, { defaultValue: w.task.stage })}</span>
            <ResearchTimer task={w.task} />
            {!activeBusy && <Button size="sm" variant="ghost" onClick={() => w.select(w.task.sessionId)}>{t('workbench.returnTask')}</Button>}
            <Button size="icon" variant="ghost" className="h-6 w-6" aria-label={t('workbench.stop')} onClick={w.stop}><Square className="h-3 w-3" /></Button>
          </div>}
          <div className="relative flex min-h-0 flex-1 flex-col">
            <div ref={scrollContainerRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6" onScroll={checkScrollState}>
              <div className="mx-auto max-w-3xl space-y-5">
              {!w.messages.length && !hasNewCandidates && (
                <InspirationGrid
                  onSelectPrompt={(prompt, scope) => {
                    setDraft(prompt);
                    void w.guard(async () => {
                      const record = w.active ?? (await w.createSession());
                      await w.patchData(record.id, { scope: scope as typeof w.data.scope });
                    });
                    textareaRef.current?.focus();
                  }}
                />
              )}
              {w.messages.map((message) =>
                message.role === 'user' ? (
                  <article
                    key={message.id}
                    className="ml-auto w-fit max-w-[88%] sm:max-w-2xl text-sm [overflow-wrap:anywhere] rounded-2xl rounded-tr-sm border border-border/60 bg-muted/60 dark:bg-muted/40 px-4 py-3 shadow-xs"
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
                          className="h-6 w-6 text-muted-foreground hover:text-foreground"
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
                                    className="flex items-center gap-2 rounded-md border border-border/60 bg-muted/20 px-2.5 py-1.5 text-foreground"
                                  >
                                    <FolderGit2 className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
                                    <span className="font-medium truncate">{e.repoFullName}</span>
                                    {e.path && <span className="text-muted-foreground truncate">{e.path}</span>}
                                    {e.lineStart && (
                                      <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                                        (L{e.lineStart}{e.lineEnd && e.lineEnd !== e.lineStart ? `-${e.lineEnd}` : ''})
                                      </span>
                                    )}
                                    <Badge variant="outline" className="ml-auto shrink-0 py-0 text-[10px] font-normal">
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
                                  <Badge variant="outline" className="ml-auto shrink-0 py-0 text-[10px] font-normal">
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
                className="flex items-center gap-1.5 rounded-full border-primary/40 bg-background/95 px-4 py-1.5 text-xs font-medium text-primary shadow-lg backdrop-blur transition-all duration-200 hover:scale-105 hover:bg-primary/10 animate-pulse"
                aria-label={t('workbench.viewNewProposals')}
              >
                <ClipboardList className="h-3.5 w-3.5" />
                <span>{t('workbench.viewNewProposals')}</span>
              </Button>
            </div>
          )}
        </div>
          <form className={`shrink-0 border-t border-border sm:px-5 transition-all duration-150 ${isKeyboardOpen ? 'p-1.5 bg-background' : 'p-3'}`} onSubmit={(e) => {
            e.preventDefault();
            if (!draft.trim() || busy || readonly) return;
            const question = draft; setFollow(true);
            requestAnimationFrame(() => {
              messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
            });
            void w.guard(async () => {
              try {
                await w.send(question, manage, false, { intent: w.data.scope === 'github' ? inputIntent : 'research', candidates });
              } catch (error) {
                const latest = liveWorkbench.current;
                if (String(useAppStore.getState().user?.id ?? '') === w.ownerId && latest.ownerId === w.ownerId
                  && (latest.activeId === w.activeId || latest.activeId === latest.task.sessionId)) setDraft(current => current || question);
                throw error;
              }
              const latest = liveWorkbench.current;
              if (String(useAppStore.getState().user?.id ?? '') === w.ownerId && latest.ownerId === w.ownerId
                && latest.activeId === (w.activeId ?? latest.task.sessionId)) setDraft(current => current === question ? '' : current);
            });
          }}>
            {w.data.selectedRepositories.length > 0 && (
              <div className={`flex items-center gap-1.5 text-xs ${isKeyboardOpen ? 'mb-1 max-h-8 overflow-x-auto flex-nowrap py-0.5' : 'mb-2 max-h-24 overflow-y-auto flex-wrap'}`}>
                <span className="flex items-center gap-1 font-medium text-muted-foreground shrink-0">
                  <FolderGit2 className="h-3.5 w-3.5 text-primary" />
                  <span>{t('workbench.contextPrefix')}</span>
                </span>
                {w.data.selectedRepositories.map((repo) => (
                  <Badge
                    key={repo.id}
                    variant="secondary"
                    className="flex items-center gap-1 rounded-full border border-primary/20 bg-primary/10 pl-2.5 pr-1 py-0.5 text-xs font-normal text-primary transition-all hover:bg-primary/15 shrink-0"
                  >
                    <span className="truncate max-w-[160px] sm:max-w-[240px]">{repo.full_name}</span>
                    <button
                      type="button"
                      disabled={readonly}
                      className="ml-0.5 rounded-full p-0.5 text-muted-foreground hover:bg-primary/20 hover:text-foreground transition-colors"
                      onClick={() => void w.guard(async () => {
                        const sid = w.activeId ?? (await w.createSession()).id;
                        await w.patchData(sid, {
                          selectedRepositories: w.data.selectedRepositories.filter((x) => x.id !== repo.id),
                        });
                      })}
                      aria-label={t('workbench.removeContext')}
                      title={t('workbench.removeContext')}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
                {w.data.selectedRepositories.length > 1 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-6 px-1.5 text-[11px] text-muted-foreground hover:text-destructive shrink-0"
                    disabled={readonly}
                    onClick={() => void w.guard(async () => {
                      const sid = w.activeId ?? (await w.createSession()).id;
                      await w.patchData(sid, { selectedRepositories: [] });
                    })}
                  >
                    {t('workbench.clearAll')}
                  </Button>
                )}
              </div>
            )}
            <Textarea
              ref={textareaRef}
              value={draft}
              disabled={readonly}
              onChange={(e) => setDraft(e.target.value)}
              className={`resize-y transition-all ${isKeyboardOpen ? 'min-h-[42px] max-h-24 py-1.5 text-xs' : 'min-h-20 max-h-40'}`}
              aria-label={t('repositoryChatSheet.question')}
              placeholder={t(w.data.scope === 'github' ? inputIntent === 'results' ? 'overview.askPlaceholder' : 'workbench.emptyQuestion' : 'research.question')}
            />
            {w.data.scope === 'github' && <div className="mt-2 flex flex-wrap items-center gap-2 text-xs" role="group" aria-label={t('overview.brief')}>
              {(['search', 'results'] as const).map(intent => <button type="button" key={intent} aria-pressed={inputIntent === intent} disabled={busy || readonly || (intent === 'results' && !hasNewCandidates)}
                className={`border-b-2 px-1 py-1 ${inputIntent === intent ? 'border-primary font-medium' : 'border-transparent text-muted-foreground'}`}
                onClick={() => { setInputIntent(intent); if (w.activeId) void w.guard(() => w.patchData(w.activeId!, { inputIntent: intent })); }}>{t(intent === 'search' ? 'overview.newSearch' : 'overview.ask')}</button>)}
              {inputIntent === 'search' && <span className="text-muted-foreground">{t('overview.brief')}</span>}
            </div>}
            {(w.data.scope === 'local' || w.data.scope === 'mixed') && !isKeyboardOpen && <div className="mt-2 space-y-2 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                <span className="break-all">{w.data.localProject?.name ?? t('localResearch.local')}</span>
                <span>{t('localResearch.deviceOnly')}</span>
                <Button type="button" size="sm" variant="outline" disabled={busy || readonly} onClick={() => void w.guard(w.chooseLocalProject)}><FolderOpen className="mr-1 h-4 w-4" />{t('localResearch.choose')}</Button>
              </div>
              {!w.localProject && <p role="status">{t('localResearch.rebind')}</p>}
              {w.localProject && <details><summary className="cursor-pointer">{t('localResearch.scope')} ({w.localProject.entries.length})</summary>
                <pre className="max-h-40 overflow-auto whitespace-pre-wrap">{w.localProject.entries.map(item => item.path).join('\n')}</pre></details>}
            </div>}
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {/* Mobile (<640px) compact semantic pill */}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setMobileToolbarOpen(true)}
                disabled={busy || readonly}
                className={`flex sm:hidden h-8 items-center rounded-full border-border/60 bg-muted/40 text-xs text-muted-foreground hover:text-foreground ${isKeyboardOpen ? 'w-8 px-0 justify-center' : 'max-w-[210px] gap-1.5 px-2.5'}`}
                title={isZh ? '参数设置' : 'Parameters'} /* i18n-allow-literal */
              >
                <SlidersHorizontal className="h-3.5 w-3.5 shrink-0" />
                {!isKeyboardOpen && (
                  <>
                    <span className="truncate">
                      {currentScopeLabel} · {currentModelLabel} · {currentDepthLabel}
                    </span>
                    <ChevronDown className="h-3 w-3 shrink-0 opacity-60" />
                  </>
                )}
              </Button>

              {/* Desktop (>=640px) inline Radix Selects */}
              <div className="hidden sm:flex items-center gap-2">
                <Select
                  value={w.data.scope}
                  disabled={busy || readonly}
                  onValueChange={(val) => void w.guard(async () => {
                    const record = w.active ?? (await w.createSession());
                    await w.patchData(record.id, { scope: val as typeof w.data.scope });
                    setManage(false);
                  })}
                >
                  <SelectTrigger className="h-8 max-w-36 text-xs bg-muted/40 hover:bg-muted/70 border-border/60" aria-label={t('workbench.scope')}>
                    <SelectValue placeholder={t('workbench.scope')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="github">{t('workbench.scope-github')}</SelectItem>
                    <SelectItem value="selected">{t('workbench.scope-selected')}</SelectItem>
                    <SelectItem value="project">{t('workbench.scope-project')}</SelectItem>
                    <SelectItem value="library">{t('workbench.scope-library')}</SelectItem>
                    {window.electronAPI?.agy && <SelectItem value="local">{t('localResearch.local')}</SelectItem>}
                    {window.electronAPI?.agy && <SelectItem value="mixed">{t('research.mixed')}</SelectItem>}
                  </SelectContent>
                </Select>

                <Select
                  value={w.modelId || '__default__'}
                  disabled={busy}
                  onValueChange={(val) => w.setSettings({ chatConfigId: val === '__default__' ? null : val })}
                >
                  <SelectTrigger className="h-8 max-w-44 text-xs bg-muted/40 hover:bg-muted/70 border-border/60" aria-label={t('workbench.model')}>
                    <SelectValue placeholder={t('workbench.model')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__default__">{t('workbench.model')}</SelectItem>
                    {w.aiConfigs.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name} · {c.model}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Select
                  value={w.data.depth}
                  disabled={busy || readonly}
                  onValueChange={(val) => void w.guard(async () => {
                    const record = w.active ?? (await w.createSession());
                    await w.patchData(record.id, { depth: val as typeof w.data.depth });
                  })}
                >
                  <SelectTrigger className="h-8 w-24 text-xs bg-muted/40 hover:bg-muted/70 border-border/60" aria-label={t('repositoryChatSheet.task-depth')}>
                    <SelectValue placeholder={t('repositoryChatSheet.task-depth')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="quick">{t('workbench.quick')}</SelectItem>
                    <SelectItem value="standard">{t('workbench.standard')}</SelectItem>
                    <SelectItem value="deep">{t('workbench.deep')}</SelectItem>
                  </SelectContent>
                </Select>

                {w.data.scope === 'library' && (
                  <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer select-none">
                    <input type="checkbox" checked={manage} onChange={(e) => setManage(e.target.checked)} disabled={busy} className="rounded" />
                    <span>{t('workbench.manage')}</span>
                  </label>
                )}
              </div>

              <Button type={busy ? 'button' : 'submit'} size="icon" className="ml-auto h-8 w-8 shrink-0" disabled={!busy && (!draft.trim() || readonly)} onClick={busy ? w.stop : undefined}
                aria-label={t(busy ? 'workbench.stop' : 'workbench.send')} title={t(busy ? 'workbench.stop' : 'workbench.send')}>
                {busy ? <Square className="h-3 w-3" /> : <Send className="h-4 w-4" />}
              </Button>
            </div>
          </form>
        </main>
        </div>
      </div>
      <Sheet open={mobileLeft} onOpenChange={setMobileLeft}><SheetContent side="left" className="w-80 max-w-[90vw] p-0"><SheetHeader className="px-4 pt-4"><SheetTitle>{t('workbench.history')}</SheetTitle></SheetHeader>{history}</SheetContent></Sheet>

      {/* Mobile Toolbar Settings Sheet */}
      <Sheet open={mobileToolbarOpen} onOpenChange={setMobileToolbarOpen}>
        <SheetContent side="bottom" className="rounded-t-2xl p-4 space-y-4 max-h-[85vh] overflow-y-auto">
          <SheetHeader className="pb-2 border-b border-border/60">
            <SheetTitle className="text-sm font-semibold flex items-center justify-between">
              <span className="flex items-center gap-2">
                <SlidersHorizontal className="h-4 w-4 text-primary" />
                <span>{isZh ? '参数与模型配置' : 'Parameter & Model Config'}</span> {/* i18n-allow-literal */}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() => setMobileToolbarOpen(false)}
              >
                {isZh ? '完成' : 'Done'} {/* i18n-allow-literal */}
              </Button>
            </SheetTitle>
          </SheetHeader>
          <div className="space-y-3 pt-1">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">{t('workbench.scope')}</label>
              <Select
                value={w.data.scope}
                disabled={busy || readonly}
                onValueChange={(val) => void w.guard(async () => {
                  const record = w.active ?? (await w.createSession());
                  await w.patchData(record.id, { scope: val as typeof w.data.scope });
                  setManage(false);
                })}
              >
                <SelectTrigger className="h-9 w-full text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="github">{t('workbench.scope-github')}</SelectItem>
                  <SelectItem value="selected">{t('workbench.scope-selected')}</SelectItem>
                  <SelectItem value="project">{t('workbench.scope-project')}</SelectItem>
                  <SelectItem value="library">{t('workbench.scope-library')}</SelectItem>
                  {window.electronAPI?.agy && <SelectItem value="local">{t('localResearch.local')}</SelectItem>}
                  {window.electronAPI?.agy && <SelectItem value="mixed">{t('research.mixed')}</SelectItem>}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">{t('workbench.model')}</label>
              <Select
                value={w.modelId || '__default__'}
                disabled={busy}
                onValueChange={(val) => w.setSettings({ chatConfigId: val === '__default__' ? null : val })}
              >
                <SelectTrigger className="h-9 w-full text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__default__">{t('workbench.model')}</SelectItem>
                  {w.aiConfigs.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name} · {c.model}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">{t('repositoryChatSheet.task-depth')}</label>
              <Select
                value={w.data.depth}
                disabled={busy || readonly}
                onValueChange={(val) => void w.guard(async () => {
                  const record = w.active ?? (await w.createSession());
                  await w.patchData(record.id, { depth: val as typeof w.data.depth });
                })}
              >
                <SelectTrigger className="h-9 w-full text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="quick">{t('workbench.quick')}</SelectItem>
                  <SelectItem value="standard">{t('workbench.standard')}</SelectItem>
                  <SelectItem value="deep">{t('workbench.deep')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {w.data.scope === 'library' && (
              <label className="flex items-center gap-2 text-xs pt-1 cursor-pointer">
                <input type="checkbox" checked={manage} onChange={(e) => setManage(e.target.checked)} disabled={busy} className="rounded" />
                <span>{t('workbench.manage')}</span>
              </label>
            )}
          </div>
        </SheetContent>
      </Sheet>

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
