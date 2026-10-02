import { useState, useRef } from 'react';
import {
  Loader2, Plus, RotateCcw, Search, Sparkles, X,
  SlidersHorizontal, Clock, Target, ChevronDown,
  CheckCircle2, Ban, Star, Save, ExternalLink, Calendar,
  ShieldAlert, GitFork, Archive, BookmarkCheck, History
} from 'lucide-react';
import { Modal } from '../../../components/Modal';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '../../../components/ui/popover';
import { useAppStore } from '../../../store/useAppStore';
import { useCustomChannelEditor } from '../hooks/useCustomChannelEditor';
import type { CustomDiscoveryChannel, RuleOverrides } from '../custom/model';
import { issueLabel, progressLabel } from '../custom/taskStatus';
import { cn } from '../../../lib/utils';

const PRESET_EMOJIS = ['🎯', '🤖', '⚡', '🛠', '🔍', '📦', '🚀', '💡', '✨', '🌐', '🔥', '📚', '🎨', '🛡', '💻', '📈', '🔮', '🧩'];
const COMMON_LANGUAGES = ['TypeScript', 'JavaScript', 'Python', 'Go', 'Rust', 'Java', 'C#', 'C++', 'Swift', 'Kotlin', 'Dart'];

export function CustomChannelEditor({ channel, onClose }: { channel?: CustomDiscoveryChannel; onClose: () => void }) {
  const zh = useAppStore(s => s.language.startsWith('zh'));
  const setCurrentView = useAppStore(s => s.setCurrentView);
  const l = (cnText: string, enText: string) => zh ? cnText : enText;
  const e = useCustomChannelEditor(channel, onClose);

  const [activeTab, setActiveTab] = useState<'requirements' | 'rules' | 'automation'>('requirements');
  const [template, setTemplate] = useState('');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [emojiPopoverOpen, setEmojiPopoverOpen] = useState(false);

  // New tag addition state
  const [newTagKind, setNewTagKind] = useState<'required' | 'excluded' | 'preferred' | 'branch'>('required');
  const [newTagText, setNewTagText] = useState('');
  const tagInputRef = useRef<HTMLInputElement>(null);

  // Custom language input state
  const [customLangInput, setCustomLangInput] = useState('');
  const [showCustomLangInput, setShowCustomLangInput] = useState(false);

  // Custom days input state
  const [customDaysActive, setCustomDaysActive] = useState(false);

  const patch = <K extends keyof RuleOverrides>(key: K, value: RuleOverrides[K]) => {
    const next = { ...e.overrides };
    if (value === undefined) delete next[key];
    else Object.assign(next, { [key]: value });
    e.changeOverrides(next);
  };

  const templates = [
    [l('指定产品生态', 'Product ecosystem'), l('查找 codex 相关的项目', 'Find projects related to codex')],
    [l('开发工具', 'Developer tools'), l('关注 AI 编程助手、代码检索和审查工具，排除教程和示例项目', 'AI coding assistants, code search and review tools; exclude tutorials and demos')],
    [l('本地 AI', 'Local AI'), l('关注能本地运行的 AI 效率工具，Windows 优先，不要教程和资源合集', 'Local AI productivity tools, Windows preferred; exclude tutorials and resource lists')],
    [l('新项目', 'New projects'), l('关注近 30 天新建的 AI Agent 项目，至少 20 Stars', 'AI agent projects created in the last 30 days with at least 20 stars')],
  ];

  const branches = e.rules?.plan.branches || e.overrides.branches || e.plan?.branches || [];

  const handleAddSemanticTag = () => {
    const val = (newTagText || tagInputRef.current?.value || '').trim();
    if (!val) return;
    if (newTagKind === 'branch') {
      e.addBranch(val);
    } else {
      e.addCondition(newTagKind, val);
    }
    setNewTagText('');
    if (tagInputRef.current) tagInputRef.current.value = '';
  };

  const handlePickEmoji = (emoji: string) => {
    const trimmed = e.name.trim();
    const emojiRegex = /^(\p{Extended_Pictographic}|\p{Emoji_Presentation})\s*/u;
    if (emojiRegex.test(trimmed)) {
      e.setName(trimmed.replace(emojiRegex, `${emoji} `));
    } else {
      e.setName(trimmed ? `${emoji} ${trimmed}` : emoji);
    }
    setEmojiPopoverOpen(false);
  };

  const currentEmojiMatch = e.name.match(/^(\p{Extended_Pictographic}|\p{Emoji_Presentation})/u);
  const currentEmoji = currentEmojiMatch ? currentEmojiMatch[0] : '🎯';

  const close = () => { e.cancel(); onClose(); };

  const navigateToAiSettings = () => {
    sessionStorage.setItem('gsm:pending-settings-tab', 'ai');
    setCurrentView?.('settings');
    window.dispatchEvent(new CustomEvent('gsm:navigate-to-settings-tab', { detail: { tab: 'ai' } }));
    close();
  };

  const handlePreview = () => {
    setDrawerOpen(true);
    void e.previewCandidates();
  };

  // Language state calculation
  const currentEffectiveLanguage = e.overrides.language !== undefined
    ? e.overrides.language
    : (e.plan?.filters.language ?? null);
  const isLanguageOverridden = e.overrides.language !== undefined;

  // Stars state calculation
  const effectiveMinStars = e.overrides.minStars !== undefined
    ? e.overrides.minStars
    : (e.plan?.filters.minStars ?? null);
  const isMinStarsOverridden = e.overrides.minStars !== undefined;

  const effectiveMaxStars = e.overrides.maxStars !== undefined
    ? e.overrides.maxStars
    : (e.plan?.filters.maxStars ?? null);
  const isMaxStarsOverridden = e.overrides.maxStars !== undefined;

  // Created within days calculation
  const effectiveDays = e.overrides.createdWithinDays !== undefined
    ? e.overrides.createdWithinDays
    : (e.plan?.filters.createdWithinDays ?? null);
  const isDaysOverridden = e.overrides.createdWithinDays !== undefined;

  // Sort calculation
  const effectiveSort = e.overrides.sort ?? e.plan?.retrieval?.sort?.value ?? 'relevance';
  const isSortOverridden = e.overrides.sort !== undefined;

  // Exclusions calculation
  const effectiveForks = e.overrides.excludeForks ?? e.plan?.retrieval?.excludeForks?.value ?? true;
  const effectiveArchived = e.overrides.excludeArchived ?? e.plan?.retrieval?.excludeArchived?.value ?? true;
  const effectiveStarred = e.overrides.excludeStarred ?? e.plan?.retrieval?.excludeStarred?.value ?? true;
  const effectiveRecommended = e.overrides.excludeRecommended ?? e.plan?.retrieval?.excludeRecommended?.value ?? true;

  // Scope calculation
  const effectiveScope = e.overrides.scope ?? e.plan?.retrieval?.scope?.value ?? 'all';

  const footer = (
    <div className="flex flex-wrap items-center justify-between gap-2 w-full">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" disabled={e.saving} onClick={close}>
          {l('取消', 'Cancel')}
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={!e.canSave || e.previewing}
          onClick={handlePreview}
          className="gap-1.5"
        >
          <Search className="h-3.5 w-3.5 text-primary" />
          <span>{l('预览候选', 'Preview')}</span>
        </Button>
      </div>

      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={!e.canSave || e.saving}
          onClick={() => void e.save(false)}
          className="gap-1.5"
        >
          {e.saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
          <span>{l('保存配置', 'Save config')}</span>
        </Button>

        <Button
          size="sm"
          disabled={!e.canSave || e.saving}
          aria-label={l('保存频道', 'Save channel')}
          title={l('保存配置并立即开始检索', 'Save config and run discovery immediately')}
          onClick={() => void e.save(true)}
          className="gap-1.5 shadow-sm"
        >
          {e.saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
          <span>{l('保存并立即执行', 'Save & Run')}</span>
        </Button>
      </div>
    </div>
  );

  return (
    <Modal
      isOpen
      onClose={close}
      title={channel ? l('编辑自定义频道', 'Edit custom channel') : l('新建自定义频道', 'New custom channel')}
      maxWidth="max-w-3xl"
      scrollable
      footer={footer}
    >
      <div className="space-y-4">
        {/* Step Navigation Tabs */}
        <div className="flex border-b border-border/80 bg-muted/20 px-1 pt-1 gap-1" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'requirements'}
            onClick={() => setActiveTab('requirements')}
            className={cn(
              "flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-all cursor-pointer rounded-t-sm",
              activeTab === 'requirements'
                ? "border-primary text-primary font-semibold bg-background"
                : "border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/40"
            )}
          >
            <Target className="h-3.5 w-3.5" />
            <span>{l('🎯 需求与 AI 解析', '🎯 Requirements & AI')}</span>
            {e.plan && <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'rules'}
            onClick={() => setActiveTab('rules')}
            className={cn(
              "flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-all cursor-pointer rounded-t-sm",
              activeTab === 'rules'
                ? "border-primary text-primary font-semibold bg-background"
                : "border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/40"
            )}
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
            <span>{l('🎛 规则与筛选', '🎛 Rules & Filters')}</span>
            {Object.keys(e.overrides).length > 0 && <span className="h-1.5 w-1.5 rounded-full bg-primary" />}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'automation'}
            onClick={() => setActiveTab('automation')}
            className={cn(
              "flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-all cursor-pointer rounded-t-sm",
              activeTab === 'automation'
                ? "border-primary text-primary font-semibold bg-background"
                : "border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/40"
            )}
          >
            <Clock className="h-3.5 w-3.5" />
            <span>{l('⏰ 调度与自动化', '⏰ Schedule & Automation')}</span>
          </button>
        </div>

        {/* TAB 1: 需求与 AI 解析 */}
        <div role="tabpanel" hidden={activeTab !== 'requirements'} className={activeTab === 'requirements' ? 'space-y-4 pt-1' : 'hidden'}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="min-w-0 space-y-1">
              <label className="text-sm font-medium text-foreground">{l('频道名称', 'Channel name')}</label>
              <div className="flex gap-2">
                <Popover open={emojiPopoverOpen} onOpenChange={setEmojiPopoverOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="h-9 w-9 shrink-0 text-base border-border hover:bg-accent"
                      title={l('选择 Emoji', 'Pick emoji')}
                      aria-label={l('选择 Emoji', 'Pick emoji')}
                    >
                      {currentEmoji}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-56 p-2 shadow-md" align="start">
                    <div className="grid grid-cols-6 gap-1 text-center">
                      {PRESET_EMOJIS.map(emoji => (
                        <button
                          key={emoji}
                          type="button"
                          className="h-8 w-8 rounded text-base hover:bg-accent transition-colors flex items-center justify-center cursor-pointer"
                          onClick={() => handlePickEmoji(emoji)}
                        >
                          {emoji}
                        </button>
                      ))}
                    </div>
                  </PopoverContent>
                </Popover>
                <Input
                  aria-label={l('频道名称', 'Channel name')}
                  maxLength={60}
                  disabled={e.saving}
                  value={e.name}
                  onChange={v => e.setName(v.target.value)}
                  placeholder={l('例如：AI 效率工具', 'e.g. AI Tools')}
                />
              </div>
            </div>

            <div className="min-w-0 space-y-1">
              <label className="text-sm font-medium text-foreground">{l('需求模板', 'Request template')}</label>
              <select
                aria-label={l('需求模板', 'Request template')}
                className="ui-field h-9 w-full min-w-0 rounded-md border border-border bg-background px-2 text-sm"
                value={template}
                disabled={e.saving}
                onChange={v => {
                  const val = v.target.value;
                  setTemplate(val);
                  if (val !== '') {
                    const selectedTpl = templates[Number(val)];
                    if (selectedTpl) {
                      e.changeInstruction(selectedTpl[1]);
                      if (!e.name.trim()) {
                        e.setName(selectedTpl[0]);
                      }
                    }
                  }
                }}
              >
                <option value="">{l('不使用模板', 'No template')}</option>
                {templates.map(([name], i) => (
                  <option key={i} value={i}>{name}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="space-y-2">
            <label className="block space-y-1 text-sm font-medium text-foreground">
              {l('你想关注什么', 'What would you like to follow?')}
              <textarea
                aria-label={l('你想关注什么', 'What would you like to follow?')}
                className="ui-field min-h-24 w-full resize-y rounded-md border border-border bg-background p-3 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                maxLength={4000}
                value={e.instruction}
                disabled={e.saving}
                placeholder={l('例如：查找 codex 相关的项目，关注能本地运行的 AI 效率工具，排除教程合集', 'For example: find projects related to codex, exclude tutorials')}
                onChange={v => e.changeInstruction(v.target.value)}
              />
            </label>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                disabled={e.parsing || e.saving || !e.instruction.trim()}
                onClick={() => void e.parse()}
                className="gap-1.5 shadow-sm"
              >
                {e.parsing ? (
                  <Loader2 className="h-4 w-4 animate-spin text-primary" />
                ) : (
                  <Sparkles className="h-4 w-4 text-primary animate-pulse" />
                )}
                <span>{l('解析需求', 'Parse request')}</span>
              </Button>

              {(e.parsing || e.previewing) && (
                <div className="flex items-center gap-2 rounded-md bg-muted/60 px-2.5 py-1 text-xs text-muted-foreground">
                  <span role="status">
                    {e.parsing
                      ? l('正在解析需求', 'Parsing request')
                      : e.progress
                        ? progressLabel(e.progress, zh)
                        : l('正在检索候选', 'Searching candidates')} · {e.elapsed}s
                  </span>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-5 w-5"
                    title={l('取消任务', 'Cancel task')}
                    aria-label={l('取消任务', 'Cancel task')}
                    onClick={e.cancel}
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              )}

              {e.plan && e.stale && (
                <span className="text-xs text-destructive font-medium">
                  {l('需求已变更，请重新解析', 'Request changed; parse again')}
                </span>
              )}
            </div>
          </div>

          {/* Interactive Color Semantic Tags */}
          {e.plan && (
            <div className="space-y-3 rounded-lg border border-border/80 bg-muted/20 p-3.5">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <h4 className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                    <Sparkles className="h-3.5 w-3.5 text-primary" />
                    <span>{l('交互式语义规则标签', 'Interactive Semantic Rule Tags')}</span>
                  </h4>
                  <p className="text-[11px] text-muted-foreground">
                    {l('AI 已解析条件转换为可操作彩色药丸标签。点击 ✕ 删除，也可直接在下方追加。', 'Parsed conditions shown as color pills. Click ✕ to delete or append below.')}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  {e.canResetConditions && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 px-1.5 text-xs text-muted-foreground hover:text-foreground gap-1"
                      title={l('恢复初始条件', 'Reset conditions')}
                      onClick={e.resetPlanConditions}
                    >
                      <RotateCcw className="h-3 w-3" />
                      <span>{l('重置条件', 'Reset conditions')}</span>
                    </Button>
                  )}
                  {e.overrides.branches && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 px-1.5 text-xs text-muted-foreground hover:text-foreground gap-1"
                      title={l('恢复解析词项', 'Restore parsed terms')}
                      aria-label={l('恢复解析词项', 'Restore parsed terms')}
                      onClick={() => patch('branches', undefined)}
                    >
                      <RotateCcw className="h-3 w-3" />
                      <span>{l('重置检索词', 'Reset terms')}</span>
                    </Button>
                  )}
                </div>
              </div>

              {/* Tags Display Area */}
              <div className="space-y-2.5">
                {/* Required (Green) */}
                {e.plan.required.length > 0 && (
                  <div className="space-y-1">
                    <span className="text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                      {l('必要条件 (Required):', 'Required:')}
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      {e.plan.required.map((r, idx) => (
                        <span
                          key={idx}
                          className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-300"
                        >
                          <CheckCircle2 className="h-3 w-3 text-emerald-600 dark:text-emerald-400 shrink-0" />
                          <span>{r.text}</span>
                          <button
                            type="button"
                            aria-label={`${l('删除必要条件', 'Delete required condition')} ${r.text}`}
                            onClick={() => e.removeCondition('required', idx)}
                            className="ml-0.5 rounded-full p-0.5 hover:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 cursor-pointer"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Excluded (Red) */}
                {e.plan.excluded.length > 0 && (
                  <div className="space-y-1">
                    <span className="text-[11px] font-medium text-rose-600 dark:text-rose-400">
                      {l('排除类型 (Excluded):', 'Excluded:')}
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      {e.plan.excluded.map((r, idx) => (
                        <span
                          key={idx}
                          className="inline-flex items-center gap-1.5 rounded-full border border-rose-500/30 bg-rose-500/10 px-2.5 py-1 text-xs font-medium text-rose-700 dark:text-rose-300"
                        >
                          <Ban className="h-3 w-3 text-rose-600 dark:text-rose-400 shrink-0" />
                          <span>{r.text}</span>
                          <button
                            type="button"
                            aria-label={`${l('删除排除条件', 'Delete excluded condition')} ${r.text}`}
                            onClick={() => e.removeCondition('excluded', idx)}
                            className="ml-0.5 rounded-full p-0.5 hover:bg-rose-500/20 text-rose-600 dark:text-rose-400 cursor-pointer"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Preferred (Purple) */}
                {e.plan.preferred.length > 0 && (
                  <div className="space-y-1">
                    <span className="text-[11px] font-medium text-purple-600 dark:text-purple-400">
                      {l('加权偏好 (Preferred):', 'Preferred:')}
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      {e.plan.preferred.map((r, idx) => (
                        <span
                          key={idx}
                          className="inline-flex items-center gap-1.5 rounded-full border border-purple-500/30 bg-purple-500/10 px-2.5 py-1 text-xs font-medium text-purple-700 dark:text-purple-300"
                        >
                          <Star className="h-3 w-3 text-purple-600 dark:text-purple-400 fill-purple-500/20 shrink-0" />
                          <span>{r.text}</span>
                          <button
                            type="button"
                            aria-label={`${l('删除加权偏好', 'Delete preferred condition')} ${r.text}`}
                            onClick={() => e.removeCondition('preferred', idx)}
                            className="ml-0.5 rounded-full p-0.5 hover:bg-purple-500/20 text-purple-600 dark:text-purple-400 cursor-pointer"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Branches (Blue) */}
                {branches.length > 0 && (
                  <div className="space-y-1">
                    <span className="text-[11px] font-medium text-sky-600 dark:text-sky-400">
                      {l('检索词分支 (Branches):', 'Search Branches:')}
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      {branches.map((b, idx) => (
                        <span
                          key={idx}
                          className="inline-flex items-center gap-1.5 rounded-full border border-sky-500/30 bg-sky-500/10 px-2.5 py-1 text-xs font-medium text-sky-700 dark:text-sky-300"
                        >
                          <Search className="h-3 w-3 text-sky-600 dark:text-sky-400 shrink-0" />
                          <span>{b.terms.join(' | ')}</span>
                          <button
                            type="button"
                            disabled={branches.length <= 1}
                            aria-label={`${l('删除词项', 'Remove term')} ${idx + 1}`}
                            onClick={() => e.removeBranch(idx)}
                            className="ml-0.5 rounded-full p-0.5 hover:bg-sky-500/20 text-sky-600 dark:text-sky-400 disabled:opacity-30 cursor-pointer"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Quick Add Tag Bar */}
              <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-border/40">
                <select
                  aria-label={l('规则类别', 'Rule Category')}
                  className="h-8 rounded-md border border-border bg-background px-2 text-xs"
                  value={newTagKind}
                  onChange={v => setNewTagKind(v.target.value as any)}
                >
                  <option value="required">🟢 {l('必要条件 (Required)', 'Required')}</option>
                  <option value="excluded">🔴 {l('排除类型 (Excluded)', 'Excluded')}</option>
                  <option value="preferred">🟣 {l('加权偏好 (Preferred)', 'Preferred')}</option>
                  <option value="branch">🔵 {l('检索词分支 (Branch)', 'Search Branch')}</option>
                </select>

                <Input
                  ref={tagInputRef}
                  className="h-8 flex-1 min-w-44 text-xs"
                  placeholder={l('输入规则或关键词，回车快速追加...', 'Type rule text, press Enter to add...')}
                  value={newTagText}
                  onChange={v => setNewTagText(v.target.value)}
                  onKeyDown={v => {
                    if (v.key === 'Enter') {
                      v.preventDefault();
                      handleAddSemanticTag();
                    }
                  }}
                />

                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs gap-1"
                  onClick={handleAddSemanticTag}
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>{l('添加标签', 'Add Tag')}</span>
                </Button>
              </div>

              {/* Collapsible Evidence */}
              <details className="text-xs text-muted-foreground pt-1">
                <summary className="cursor-pointer hover:text-foreground">
                  {l('查看需求原文依据', 'View original evidence')}
                </summary>
                <div className="mt-2 space-y-1.5 rounded-md bg-muted/40 p-2.5">
                  {[...e.plan.required, ...e.plan.excluded, ...e.plan.preferred].map((r, i) => (
                    <p key={i} className="break-words">
                      <span className="font-medium text-foreground">{r.text}</span>: “{r.source}”
                    </p>
                  ))}
                  {Object.entries(e.plan.retrieval ?? {}).map(([key, value]) => value && (
                    <p key={key} className="break-words">
                      “{value.source}”{e.overrides[key as keyof RuleOverrides] !== undefined && ` · ${l('已被手动选项覆盖', 'Overridden manually')}`}
                    </p>
                  ))}
                </div>
              </details>
            </div>
          )}
        </div>

        {/* TAB 2: 规则与筛选 (彻底移除复合下拉框，采用现代参数表单) */}
        <div role="tabpanel" hidden={activeTab !== 'rules'} className={activeTab === 'rules' ? 'space-y-4 pt-1' : 'hidden'}>
          {/* 1. 编程语言选择 */}
          <div className="space-y-2.5 rounded-lg border border-border/80 bg-muted/20 p-3.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-foreground">{l('编程语言', 'Programming Language')}</span>
                {isLanguageOverridden ? (
                  <span className="rounded bg-primary/10 px-2 py-0.5 text-[10px] text-primary font-medium">
                    {l('手动指定', 'Manual')}
                  </span>
                ) : e.plan?.filters.language ? (
                  <span className="rounded bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-600 dark:text-emerald-400 font-medium">
                    ✨ {l(`AI 建议: ${e.plan.filters.language}`, `AI suggestion: ${e.plan.filters.language}`)}
                  </span>
                ) : null}
              </div>

              {isLanguageOverridden && (
                <button
                  type="button"
                  onClick={() => patch('language', undefined)}
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground underline cursor-pointer"
                >
                  <RotateCcw className="h-3 w-3" />
                  <span>{l('恢复 AI 建议', 'Reset to AI suggestion')}</span>
                </button>
              )}
            </div>

            {/* Language Pills */}
            <div className="flex flex-wrap gap-1.5" role="group" aria-label={l('编程语言', 'Programming Language')}>
              <button
                type="button"
                aria-pressed={currentEffectiveLanguage === null}
                onClick={() => patch('language', null)}
                className={cn(
                  "rounded-full px-3 py-1 text-xs font-medium border transition-all cursor-pointer",
                  currentEffectiveLanguage === null
                    ? "bg-primary text-primary-foreground border-primary shadow-xs"
                    : "bg-background border-border text-muted-foreground hover:text-foreground hover:border-foreground/40"
                )}
              >
                {l('不限语言', 'Any Language')}
              </button>

              {COMMON_LANGUAGES.map(lang => {
                const isSelected = currentEffectiveLanguage?.toLowerCase() === lang.toLowerCase();
                const isAiRecommended = e.plan?.filters.language?.toLowerCase() === lang.toLowerCase();

                return (
                  <button
                    key={lang}
                    type="button"
                    aria-pressed={isSelected}
                    onClick={() => patch('language', isSelected ? null : lang)}
                    className={cn(
                      "rounded-full px-2.5 py-1 text-xs font-medium border transition-all cursor-pointer inline-flex items-center gap-1",
                      isSelected
                        ? "bg-primary text-primary-foreground border-primary shadow-xs"
                        : "bg-background border-border text-muted-foreground hover:text-foreground hover:border-foreground/40"
                    )}
                  >
                    <span>{lang}</span>
                    {isAiRecommended && !isSelected && (
                      <span className="text-[10px] text-emerald-500 font-bold">✨</span>
                    )}
                  </button>
                );
              })}

              {!showCustomLangInput ? (
                <button
                  type="button"
                  onClick={() => setShowCustomLangInput(true)}
                  className="rounded-full px-2.5 py-1 text-xs font-medium border border-dashed border-border text-muted-foreground hover:text-foreground hover:border-foreground/40 transition-colors cursor-pointer inline-flex items-center gap-1"
                >
                  <Plus className="h-3 w-3" />
                  <span>{l('其他语言...', 'Other...')}</span>
                </button>
              ) : (
                <div className="inline-flex items-center gap-1">
                  <Input
                    className="h-7 w-28 text-xs px-2"
                    placeholder={l('输入语言', 'Language')}
                    value={customLangInput}
                    onChange={v => setCustomLangInput(v.target.value)}
                    onKeyDown={v => {
                      if (v.key === 'Enter') {
                        v.preventDefault();
                        if (customLangInput.trim()) {
                          patch('language', customLangInput.trim());
                          setCustomLangInput('');
                          setShowCustomLangInput(false);
                        }
                      }
                    }}
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 px-2 text-xs"
                    onClick={() => {
                      if (customLangInput.trim()) {
                        patch('language', customLangInput.trim());
                        setCustomLangInput('');
                      }
                      setShowCustomLangInput(false);
                    }}
                  >
                    {l('确定', 'OK')}
                  </Button>
                </div>
              )}
            </div>

            {/* Currently Active Language Tag if custom */}
            {currentEffectiveLanguage && !COMMON_LANGUAGES.some(l => l.toLowerCase() === currentEffectiveLanguage.toLowerCase()) && (
              <div className="pt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                <span>{l('已选其他语言:', 'Selected other language:')}</span>
                <span className="inline-flex items-center gap-1 rounded bg-primary/10 text-primary font-medium px-2 py-0.5">
                  {currentEffectiveLanguage}
                  <button
                    type="button"
                    onClick={() => patch('language', null)}
                    className="hover:text-destructive cursor-pointer"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              </div>
            )}
          </div>

          {/* 2. Stars 限制数值与开关 */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {/* 最低 Stars */}
            <div className="rounded-lg border border-border/80 bg-muted/20 p-3.5 space-y-2.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <Star className="h-4 w-4 text-primary" />
                  <span className="text-sm font-semibold text-foreground">{l('最低 Stars 门槛', 'Minimum Stars')}</span>
                  {isMinStarsOverridden ? (
                    <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary font-medium">
                      {effectiveMinStars === null ? l('手动: 不限', 'Manual: Any') : `${effectiveMinStars}+`}
                    </span>
                  ) : e.plan?.filters.minStars != null ? (
                    <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-600 dark:text-emerald-400 font-medium">
                      ✨ {e.plan.filters.minStars}+
                    </span>
                  ) : null}
                </div>

                {isMinStarsOverridden && (
                  <button
                    type="button"
                    onClick={() => patch('minStars', undefined)}
                    className="text-xs text-muted-foreground hover:text-foreground underline cursor-pointer"
                  >
                    {l('恢复', 'Reset')}
                  </button>
                )}
              </div>

              {/* Pill buttons for minStars */}
              <div className="flex flex-wrap gap-1.5" role="group" aria-label={l('最低 Stars 限制', 'Minimum stars limit')}>
                <button
                  type="button"
                  aria-pressed={effectiveMinStars === null}
                  onClick={() => patch('minStars', null)}
                  className={cn(
                    "rounded-full px-2.5 py-1 text-xs font-medium border transition-all cursor-pointer",
                    effectiveMinStars === null
                      ? "bg-primary text-primary-foreground border-primary shadow-xs"
                      : "bg-background border-border text-muted-foreground hover:text-foreground hover:border-foreground/40"
                  )}
                >
                  {l('不限 Stars', 'No min limit')}
                </button>

                {[10, 50, 100, 500, 1000].map(cnt => {
                  const isSelected = effectiveMinStars === cnt;
                  return (
                    <button
                      key={cnt}
                      type="button"
                      aria-pressed={isSelected}
                      onClick={() => patch('minStars', isSelected ? null : cnt)}
                      className={cn(
                        "rounded-full px-2 py-1 text-xs font-medium border transition-all cursor-pointer",
                        isSelected
                          ? "bg-primary text-primary-foreground border-primary shadow-xs"
                          : "bg-background border-border text-muted-foreground hover:text-foreground hover:border-foreground/40"
                      )}
                    >
                      {cnt}+
                    </button>
                  );
                })}
              </div>

              {effectiveMinStars !== null ? (
                <div className="flex items-center gap-2 pt-0.5">
                  <span className="text-xs text-muted-foreground">{l('自定义数值:', 'Custom:')}</span>
                  <Input
                    aria-label={l('最低 Stars 数值', 'Minimum stars value')}
                    type="number"
                    min={0}
                    className="h-8 w-24 text-xs"
                    value={effectiveMinStars}
                    onChange={v => patch('minStars', Math.max(0, Number(v.target.value) || 0))}
                  />
                  <span className="text-xs text-muted-foreground">★ {l('或更多', 'stars or more')}</span>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground pt-0.5">
                  {l('当前不设最低门槛，允许包含任意 Stars 的新项目。', 'No minimum star barrier; all repos eligible.')}
                </p>
              )}
            </div>

            {/* 最高 Stars */}
            <div className="rounded-lg border border-border/80 bg-muted/20 p-3.5 space-y-2.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <Star className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-semibold text-foreground">{l('最高 Stars 上限', 'Maximum Stars')}</span>
                  {isMaxStarsOverridden ? (
                    <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary font-medium">
                      {effectiveMaxStars === null ? l('手动: 不限', 'Manual: Any') : `≤${effectiveMaxStars}`}
                    </span>
                  ) : e.plan?.filters.maxStars != null ? (
                    <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-600 dark:text-emerald-400 font-medium">
                      ✨ ≤{e.plan.filters.maxStars}
                    </span>
                  ) : null}
                </div>

                {isMaxStarsOverridden && (
                  <button
                    type="button"
                    onClick={() => patch('maxStars', undefined)}
                    className="text-xs text-muted-foreground hover:text-foreground underline cursor-pointer"
                  >
                    {l('恢复', 'Reset')}
                  </button>
                )}
              </div>

              {/* Pill buttons for maxStars */}
              <div className="flex flex-wrap gap-1.5" role="group" aria-label={l('最高 Stars 限制', 'Maximum stars limit')}>
                <button
                  type="button"
                  aria-pressed={effectiveMaxStars === null}
                  onClick={() => patch('maxStars', null)}
                  className={cn(
                    "rounded-full px-2.5 py-1 text-xs font-medium border transition-all cursor-pointer",
                    effectiveMaxStars === null
                      ? "bg-primary text-primary-foreground border-primary shadow-xs"
                      : "bg-background border-border text-muted-foreground hover:text-foreground hover:border-foreground/40"
                  )}
                >
                  {l('不限最高 Stars', 'No max limit')}
                </button>

                {[500, 1000, 5000, 10000].map(cnt => {
                  const isSelected = effectiveMaxStars === cnt;
                  return (
                    <button
                      key={cnt}
                      type="button"
                      aria-pressed={isSelected}
                      onClick={() => patch('maxStars', isSelected ? null : cnt)}
                      className={cn(
                        "rounded-full px-2 py-1 text-xs font-medium border transition-all cursor-pointer",
                        isSelected
                          ? "bg-primary text-primary-foreground border-primary shadow-xs"
                          : "bg-background border-border text-muted-foreground hover:text-foreground hover:border-foreground/40"
                      )}
                    >
                      ≤{cnt}
                    </button>
                  );
                })}
              </div>

              {effectiveMaxStars !== null ? (
                <div className="flex items-center gap-2 pt-0.5">
                  <span className="text-xs text-muted-foreground">{l('自定义数值:', 'Custom:')}</span>
                  <Input
                    aria-label={l('最高 Stars 数值', 'Maximum stars value')}
                    type="number"
                    min={0}
                    className="h-8 w-24 text-xs"
                    value={effectiveMaxStars}
                    onChange={v => patch('maxStars', Math.max(0, Number(v.target.value) || 0))}
                  />
                  <span className="text-xs text-muted-foreground">★ {l('或更少', 'stars or fewer')}</span>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground pt-0.5">
                  {l('当前不设最高上限，欢迎成名热门项目。', 'No maximum limit; popular projects included.')}
                </p>
              )}
            </div>
          </div>

          {/* 3. 创建时间与排序偏好 */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {/* 创建时间 */}
            <div className="rounded-lg border border-border/80 bg-muted/20 p-3.5 space-y-2.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
                  <Calendar className="h-4 w-4 text-primary" />
                  <span>{l('创建时间（新项目筛选）', 'Created Within')}</span>
                </div>
                {isDaysOverridden && (
                  <button
                    type="button"
                    onClick={() => patch('createdWithinDays', undefined)}
                    className="text-xs text-muted-foreground hover:text-foreground underline cursor-pointer"
                  >
                    {l('恢复', 'Reset')}
                  </button>
                )}
              </div>

              <div className="flex flex-wrap gap-1.5" role="group" aria-label={l('创建于最近（天）', 'Created within (days)')}>
                {[
                  { label: l('不限时间', 'Any time'), value: null },
                  { label: l('7 天内', 'Last 7d'), value: 7 },
                  { label: l('30 天内', 'Last 30d'), value: 30 },
                  { label: l('90 天内', 'Last 90d'), value: 90 },
                  { label: l('1 年内', 'Last 1y'), value: 365 },
                ].map(item => {
                  const isSelected = !customDaysActive && effectiveDays === item.value;
                  return (
                    <button
                      key={String(item.value)}
                      type="button"
                      aria-pressed={isSelected}
                      onClick={() => {
                        setCustomDaysActive(false);
                        patch('createdWithinDays', item.value);
                      }}
                      className={cn(
                        "rounded-full px-2.5 py-1 text-xs font-medium border transition-all cursor-pointer",
                        isSelected
                          ? "bg-primary text-primary-foreground border-primary shadow-xs"
                          : "bg-background border-border text-muted-foreground hover:text-foreground hover:border-foreground/40"
                      )}
                    >
                      {item.label}
                    </button>
                  );
                })}

                <button
                  type="button"
                  aria-pressed={customDaysActive || (effectiveDays !== null && ![7, 30, 90, 365].includes(effectiveDays))}
                  onClick={() => setCustomDaysActive(true)}
                  className={cn(
                    "rounded-full px-2.5 py-1 text-xs font-medium border transition-all cursor-pointer",
                    customDaysActive || (effectiveDays !== null && ![7, 30, 90, 365].includes(effectiveDays))
                      ? "bg-primary text-primary-foreground border-primary shadow-xs"
                      : "bg-background border-border text-muted-foreground hover:text-foreground hover:border-foreground/40"
                  )}
                >
                  {l('自定义天数', 'Custom')}
                </button>
              </div>

              {(customDaysActive || (effectiveDays !== null && ![7, 30, 90, 365].includes(effectiveDays))) && (
                <div className="flex items-center gap-2 pt-1">
                  <Input
                    aria-label={l('自定义天数数值', 'Custom days value')}
                    type="number"
                    min={1}
                    max={36500}
                    className="h-8 w-24 text-xs"
                    value={effectiveDays ?? 60}
                    onChange={v => patch('createdWithinDays', Math.max(1, Number(v.target.value) || 1))}
                  />
                  <span className="text-xs text-muted-foreground">{l('天以内新建的仓库', 'days')}</span>
                </div>
              )}
            </div>

            {/* 排序偏好 */}
            <div className="rounded-lg border border-border/80 bg-muted/20 p-3.5 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-foreground">{l('排序偏好', 'Sort Preference')}</span>
                {isSortOverridden && (
                  <button
                    type="button"
                    onClick={() => patch('sort', undefined)}
                    className="text-xs text-muted-foreground hover:text-foreground underline cursor-pointer"
                  >
                    {l('恢复', 'Reset')}
                  </button>
                )}
              </div>

              <div className="grid grid-cols-3 gap-1.5" role="group" aria-label={l('排序偏好', 'Sort preference')}>
                {[
                  { id: 'relevance', label: l('智能相关性', 'Relevance'), icon: '🎯' },
                  { id: 'stars', label: l('Stars 最多', 'Stars'), icon: '⭐' },
                  { id: 'updated', label: l('最近活跃', 'Updated'), icon: '🕒' },
                ].map(s => {
                  const isSelected = effectiveSort === s.id;
                  const isAiChoice = e.plan?.retrieval?.sort?.value === s.id;

                  return (
                    <button
                      key={s.id}
                      type="button"
                      aria-pressed={isSelected}
                      onClick={() => patch('sort', s.id as RuleOverrides['sort'])}
                      className={cn(
                        "flex flex-col items-center justify-center p-2 rounded-md border text-center transition-all cursor-pointer",
                        isSelected
                          ? "bg-primary text-primary-foreground border-primary font-medium shadow-xs"
                          : "bg-background border-border text-muted-foreground hover:text-foreground hover:border-foreground/40"
                      )}
                    >
                      <span className="text-sm">{s.icon}</span>
                      <span className="text-xs mt-1">{s.label}</span>
                      {isAiChoice && !isSelected && (
                        <span className="text-[10px] text-emerald-500 font-semibold mt-0.5">✨ AI</span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* 4. 排除规则（4 个清晰的卡片开关） */}
          <div className="rounded-lg border border-border/80 bg-muted/20 p-3.5 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                <ShieldAlert className="h-4 w-4 text-primary" />
                <span>{l('排除与去重规则', 'Exclusions & Deduplication')}</span>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              {/* 排除 Fork */}
              <label className={cn(
                "flex items-start gap-2.5 p-2.5 rounded-md border transition-all cursor-pointer",
                effectiveForks ? "bg-background border-border/80" : "bg-muted/40 border-border/40 opacity-75"
              )}>
                <input
                  type="checkbox"
                  checked={effectiveForks}
                  onChange={v => patch('excludeForks', v.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-border text-primary focus:ring-primary"
                  aria-label={l('排除 Fork 仓库', 'Exclude forks')}
                />
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                    <GitFork className="h-3.5 w-3.5 text-muted-foreground" />
                    <span>{l('排除 Fork 仓库', 'Exclude Fork Repositories')}</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    {l('过滤派生项目，仅保留原始原创仓库', 'Filter out derived projects')}
                  </p>
                </div>
              </label>

              {/* 排除归档 */}
              <label className={cn(
                "flex items-start gap-2.5 p-2.5 rounded-md border transition-all cursor-pointer",
                effectiveArchived ? "bg-background border-border/80" : "bg-muted/40 border-border/40 opacity-75"
              )}>
                <input
                  type="checkbox"
                  checked={effectiveArchived}
                  onChange={v => patch('excludeArchived', v.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-border text-primary focus:ring-primary"
                  aria-label={l('排除归档仓库', 'Exclude archived')}
                />
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                    <Archive className="h-3.5 w-3.5 text-muted-foreground" />
                    <span>{l('排除归档仓库', 'Exclude Archived Repositories')}</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    {l('忽略已进入只读归档状态的停更项目', 'Ignore read-only archived projects')}
                  </p>
                </div>
              </label>

              {/* 排除已 Star */}
              <label className={cn(
                "flex items-start gap-2.5 p-2.5 rounded-md border transition-all cursor-pointer",
                effectiveStarred ? "bg-background border-border/80" : "bg-muted/40 border-border/40 opacity-75"
              )}>
                <input
                  type="checkbox"
                  checked={effectiveStarred}
                  onChange={v => patch('excludeStarred', v.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-border text-primary focus:ring-primary"
                  aria-label={l('排除已 Star 仓库', 'Exclude already starred')}
                />
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                    <BookmarkCheck className="h-3.5 w-3.5 text-muted-foreground" />
                    <span>{l('排除已 Star 仓库', 'Exclude Already Starred')}</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    {l('不重复推荐您已标星认可过的项目', 'Do not recommend repos you already starred')}
                  </p>
                </div>
              </label>

              {/* 排除本频道已推荐 */}
              <label className={cn(
                "flex items-start gap-2.5 p-2.5 rounded-md border transition-all cursor-pointer",
                effectiveRecommended ? "bg-background border-border/80" : "bg-muted/40 border-border/40 opacity-75"
              )}>
                <input
                  type="checkbox"
                  checked={effectiveRecommended}
                  onChange={v => patch('excludeRecommended', v.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-border text-primary focus:ring-primary"
                  aria-label={l('排除本频道已推荐', 'Exclude already recommended')}
                />
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                    <History className="h-3.5 w-3.5 text-muted-foreground" />
                    <span>{l('排除本频道已推荐', 'Exclude Already Recommended')}</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    {l('避免历史期次已呈现过的项目反复上榜', 'Prevent previously presented repos from repeating')}
                  </p>
                </div>
              </label>
            </div>
          </div>

          {/* 5. 检索字段范围 (Scope) */}
          <div className="rounded-lg border border-border/80 bg-muted/20 p-3.5 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-foreground">{l('检索字段匹配范围', 'Search Fields Scope')}</span>
              {e.overrides.scope !== undefined && (
                <button
                  type="button"
                  onClick={() => patch('scope', undefined)}
                  className="text-xs text-muted-foreground hover:text-foreground underline cursor-pointer"
                >
                  {l('恢复', 'Reset')}
                </button>
              )}
            </div>

            <div className="grid grid-cols-3 gap-2" role="group" aria-label={l('检索字段匹配范围', 'Search Fields Scope')}>
              {[
                { id: 'all', label: l('智能匹配 (全部)', 'All fields'), desc: l('名称、描述与 README', 'Name, desc & README') },
                { id: 'metadata', label: l('基础元数据', 'Metadata only'), desc: l('仅名称、描述与主题', 'Name, desc, topics') },
                { id: 'readme', label: l('深入匹配', 'Deep match'), desc: l('深度匹配 README 全文', 'README content') },
              ].map(item => {
                const isSelected = effectiveScope === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    aria-pressed={isSelected}
                    onClick={() => patch('scope', item.id === 'all' && e.overrides.scope === undefined ? undefined : item.id as RuleOverrides['scope'])}
                    className={cn(
                      "p-2 rounded-md border text-left transition-all cursor-pointer",
                      isSelected
                        ? "bg-primary text-primary-foreground border-primary shadow-xs"
                        : "bg-background border-border text-muted-foreground hover:text-foreground hover:border-foreground/40"
                    )}
                  >
                    <div className="text-xs font-medium">{item.label}</div>
                    <div className={cn("text-[10px] mt-0.5", isSelected ? "text-primary-foreground/80" : "text-muted-foreground")}>
                      {item.desc}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* TAB 3: 调度与自动化 */}
        <div role="tabpanel" hidden={activeTab !== 'automation'} className={activeTab === 'automation' ? 'space-y-4 pt-1' : 'hidden'}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-border/80 bg-muted/20 p-3.5 space-y-2">
              <label className="space-y-1 text-sm font-medium text-foreground block">
                {l('每日上限', 'Daily limit')}
                <Input
                  type="number"
                  min={1}
                  max={50}
                  value={e.limit}
                  onChange={v => e.setLimit(Math.max(1, Math.min(50, Number(v.target.value) || 1)))}
                />
              </label>
              <div className="flex flex-wrap gap-1 pt-1">
                {[5, 10, 15, 20, 30].map(cnt => (
                  <button
                    key={cnt}
                    type="button"
                    onClick={() => e.setLimit(cnt)}
                    className={cn(
                      "rounded border px-2 py-0.5 text-xs transition-colors cursor-pointer",
                      e.limit === cnt
                        ? "bg-primary text-primary-foreground border-primary font-medium"
                        : "bg-background border-border/60 text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {cnt}
                  </button>
                ))}
              </div>
            </div>

            <div className="rounded-lg border border-border/80 bg-muted/20 p-3.5 space-y-2">
              <label className="space-y-1 text-sm font-medium text-foreground block">
                {l('更新时间（本地）', 'Update time (local)')}
                <select
                  className="ui-field h-9 w-full min-w-0 rounded-md border border-border bg-background px-2 text-sm"
                  value={e.hour}
                  onChange={v => e.setHour(Number(v.target.value))}
                >
                  {Array.from({ length: 24 }, (_, h) => (
                    <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>
                  ))}
                </select>
              </label>
              <p className="text-xs text-muted-foreground pt-1">
                {l('每天到达该时间时，系统将在后台自动运行本频道的候选检索与更新。', 'Daily automatic candidate search and analysis runs at this scheduled hour.')}
              </p>
            </div>
          </div>

          <div className="rounded-lg border border-border/80 bg-muted/20 p-3.5 space-y-3">
            <h4 className="text-xs font-semibold text-foreground">{l('AI 增强开关', 'AI Enhancements')}</h4>
            <div className="space-y-2.5">
              <label className="flex items-start gap-2.5 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 rounded border-border text-primary focus:ring-primary"
                  checked={e.ai}
                  onChange={v => e.setAI(v.target.checked)}
                />
                <div>
                  <span className="font-medium text-foreground">{l('AI 精筛 (AI Screening)', 'AI Screening')}</span>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {l('开启后利用 AI 自动研读仓库 README，检验各项语义规则。关闭时无法验证的语义条件会保留为待核实。', 'Uses AI to evaluate candidate READMEs. If disabled, semantic rules stay unverified.')}
                  </p>
                </div>
              </label>

              <label className="flex items-start gap-2.5 text-sm cursor-pointer border-t border-border/40 pt-2.5">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 rounded border-border text-primary focus:ring-primary"
                  checked={e.autoAnalyze}
                  onChange={v => e.setAutoAnalyze(v.target.checked)}
                />
                <div>
                  <span className="font-medium text-foreground">{l('自动 AI 深度分析（每轮最多 10 个）', 'Automatic AI deep analysis (up to 10 per run)')}</span>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {l('每轮生成新推荐后，自动在后台触发 AI 深度多维度评析。', 'Triggers AI multi-dimensional deep analysis in the background once recommendations are generated.')}
                  </p>
                </div>
              </label>
            </div>
          </div>
        </div>

        {/* Global Conflicts & Alerts */}
        {e.conflicts.length > 0 && (
          <div role="alert" className="rounded-md bg-destructive/10 p-2.5 text-sm text-destructive font-medium">
            {e.conflicts.join('；')}
          </div>
        )}

        {e.issue && (
          <div role="alert" className="flex items-center justify-between gap-2 rounded-md bg-destructive/10 p-2.5 text-sm text-destructive">
            <span>{issueLabel(e.issue, zh)}</span>
            {e.issue.kind === 'auth' && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 shrink-0 text-xs border-destructive/30 hover:bg-destructive/10"
                onClick={navigateToAiSettings}
              >
                {l('前往 AI 配置', 'Configure AI')}
              </Button>
            )}
          </div>
        )}

        {/* Realtime Candidate Drawer */}
        {(drawerOpen || e.previewing || e.preview) && (
          <div className="rounded-lg border border-primary/30 bg-card shadow-sm transition-all overflow-hidden mt-4">
            <div className="flex items-center justify-between bg-muted/50 px-3.5 py-2 border-b border-border/60">
              <div className="flex items-center gap-2">
                <Search className="h-4 w-4 text-primary" />
                <span className="text-xs font-semibold text-foreground">
                  {l('候选仓库实时预览', 'Candidate Realtime Preview')}
                </span>
                {e.preview && (
                  <span className="rounded-full bg-primary/10 px-2 py-0.2 text-[10px] font-semibold text-primary">
                    {e.preview.candidates.length} {l('候选', 'candidates')}
                  </span>
                )}
              </div>

              <div className="flex items-center gap-1.5">
                {e.previewing && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 px-2 text-xs text-muted-foreground"
                    onClick={e.cancel}
                  >
                    <X className="h-3 w-3 mr-1" />
                    {l('取消', 'Cancel')}
                  </Button>
                )}
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-6 w-6 text-muted-foreground hover:text-foreground"
                  onClick={() => setDrawerOpen(false)}
                  title={l('收起抽屉', 'Collapse')}
                  aria-label={l('收起抽屉', 'Collapse')}
                >
                  <ChevronDown className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>

            <div className="p-3 max-h-60 overflow-y-auto space-y-2">
              {e.previewing && (
                <div className="flex items-center justify-center gap-2 py-6 text-xs text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin text-primary" />
                  <span>
                    {e.progress ? progressLabel(e.progress, zh) : l('正在检索候选仓库...', 'Searching candidates...')} · {e.elapsed}s
                  </span>
                </div>
              )}

              {e.preview && e.preview.candidates.length === 0 && e.preview.complete && !e.previewing && (
                <p className="py-6 text-center text-xs text-muted-foreground">
                  {l('本次预览没有匹配候选', 'No candidates in this preview')}
                </p>
              )}

              {e.preview && !e.preview.complete && (
                <p className="text-[11px] text-amber-600 dark:text-amber-400">
                  {l('预览部分完成，不影响保存频道。', 'Preview incomplete. You can still save the channel.')}
                </p>
              )}

              {e.preview?.candidates.map(repo => (
                <div key={repo.id} className="rounded-md border border-border/40 bg-muted/20 p-2.5 text-xs space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <a
                      href={repo.html_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-semibold text-foreground hover:underline inline-flex items-center gap-1 truncate"
                    >
                      <span>{repo.full_name}</span>
                      <ExternalLink className="h-3 w-3 opacity-60 shrink-0" />
                    </a>
                    <div className="flex items-center gap-2 shrink-0 text-[11px] text-muted-foreground">
                      {repo.language && (
                        <span className="rounded bg-background px-1.5 py-0.2 border border-border/40 font-medium">
                          {repo.language}
                        </span>
                      )}
                      <span className="flex items-center gap-0.5 text-amber-600 dark:text-amber-400 font-medium">
                        ★ {repo.stargazers_count.toLocaleString()}
                      </span>
                    </div>
                  </div>
                  {repo.description && (
                    <p className="text-muted-foreground line-clamp-2 text-[11px]">
                      {repo.description}
                    </p>
                  )}
                </div>
              ))}

              {e.preview?.issues.map((issue, i) => (
                <div key={i} role="alert" className="flex items-center justify-between gap-2 rounded-md bg-destructive/10 p-2 text-xs text-destructive">
                  <span>{issueLabel(issue, zh)}</span>
                  {issue.kind === 'auth' && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-6 shrink-0 text-[10px] border-destructive/30 hover:bg-destructive/10"
                      onClick={navigateToAiSettings}
                    >
                      {l('前往 AI 配置', 'Configure AI')}
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
