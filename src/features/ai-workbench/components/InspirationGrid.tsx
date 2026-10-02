import { useState, useEffect, useCallback } from 'react';
import { Dices, RotateCcw, Pencil, X, Check, Plus, Trash2, Sparkles } from 'lucide-react';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Badge } from '../../../components/ui/badge';
import { useAppStore } from '../../../store/useAppStore';

export type WorkbenchScope = 'github' | 'selected' | 'library' | 'local' | 'mixed' | 'project';

export interface InspirationCard {
  id: string;
  title: string;
  description: string;
  scope: WorkbenchScope;
  prompts: string[];
  altPrompts: string[];
}

export const DEFAULT_INSPIRATION_CARDS_ZH: InspirationCard[] = [
  {
    id: 'tech-compare',
    title: '⚖️ 技术选型与横向对比',
    description: '对比成熟度、包体积与长期维护风险',
    scope: 'selected',
    prompts: [
      '对比 Zustand 与 Redux Toolkit 的性能与体积',
      '2026 前端跨端方案选型 (Tauri 2.0 vs Electron)',
    ],
    altPrompts: [
      '对比 vLLM 与 Ollama 本地部署吞吐性能',
      'Next.js App Router 与 Remix 现代架构对比',
    ],
  },
  {
    id: 'trend-radar',
    title: '🚀 开源趋势与黑马挖掘',
    description: '穿透全网 GitHub 动态，捕捉高潜黑马与技术拐点',
    scope: 'github',
    prompts: [
      '本周 GitHub 增长最快的 AI Agent 开源工具库',
      '星数 <1000 但近一月极活跃的轻量 Rust CLI',
    ],
    altPrompts: [
      '盘点近期国内外爆火的开源多模态项目',
      '查找支持本地离线运行的最强开源小模型',
    ],
  },
  {
    id: 'star-governance',
    title: '📦 Star 资产智能治理',
    description: '唤醒沉睡资产，清理归档项目，智能分类打标',
    scope: 'library',
    prompts: [
      '盘点已 Star 仓库中最近 6 个月停止维护的项目',
      '将未分类的 200+ 仓库按 AI/前端/运维自动归纳',
    ],
    altPrompts: [
      '找出我 Star 列表中关于「网络抓包」的高星项目',
      '根据当前 Star 资产生成我的技术兴趣偏好雷达',
    ],
  },
  {
    id: 'local-diagnosis',
    title: '💻 本地工程架构诊断',
    description: '绑定本地代码库，深度审计潜在瓶颈与架构重构建议',
    scope: 'local',
    prompts: [
      '扫描当前绑定工程的架构瓶颈并推荐最佳依赖',
      '排查本地仓库潜在的安全性漏洞与可重构点',
    ],
    altPrompts: [
      '分析当前本地项目 README 与实际代码结构差异',
      '根据本地代码技术栈推荐可用的开源中间件',
    ],
  },
  {
    id: 'foss-alternatives',
    title: '🔄 开源自托管替代品',
    description: '寻找商业 SaaS 的开源平替，数据自主可控',
    scope: 'github',
    prompts: [
      '寻找 Notion 的完全自托管高星开源替代品',
      '为 Redis 寻找低内存占用、支持持久化的开源方案',
    ],
    altPrompts: [
      '推荐类似 Sentry 的轻量级自托管前端监控库',
      '寻找替代 Postman 的现代化开源 API 调试工具',
    ],
  },
  {
    id: 'source-deep-dive',
    title: '🔬 顶级开源源码精读',
    description: '直击底层关键链路，拆解架构大师的设计模式',
    scope: 'github',
    prompts: [
      '深入解析 vLLM 中 PagedAttention 核心实现原理',
      '剖析 React 19 Actions 的底层调度与通信链路',
    ],
    altPrompts: [
      '拆解 Docker 核心 Namespace 与 Cgroups 隔离代码',
      '解析 LangChain Agent 执行主循环的调度状态机',
    ],
  },
];

export const DEFAULT_INSPIRATION_CARDS_EN: InspirationCard[] = [
  {
    id: 'tech-compare',
    title: '⚖️ Tech Selection & Comparison',
    description: 'Compare maturity, bundle footprint, and maintenance risks',
    scope: 'selected',
    prompts: [
      'Compare Zustand vs Redux Toolkit performance and bundle size',
      '2026 cross-platform frontend stack (Tauri 2.0 vs Electron)',
    ],
    altPrompts: [
      'Compare vLLM vs Ollama throughput on local machines',
      'Next.js App Router vs Remix modern architecture comparison',
    ],
  },
  {
    id: 'trend-radar',
    title: '🚀 Open Source Trends & Breakthroughs',
    description: 'Explore GitHub velocity, spot emerging tools and paradigm shifts',
    scope: 'github',
    prompts: [
      'Fastest growing AI Agent libraries on GitHub this week',
      'Lightweight Rust CLIs with <1000 stars active in the past month',
    ],
    altPrompts: [
      'Overview of trending multimodal open source repositories',
      'Find top local offline-capable small language models',
    ],
  },
  {
    id: 'star-governance',
    title: '📦 Star Portfolio Governance',
    description: 'Revitalize saved stars, clean archived repos, categorize with AI',
    scope: 'library',
    prompts: [
      'Find starred repositories unmaintained for over 6 months',
      'Categorize 200+ uncategorized stars into AI / Frontend / DevOps',
    ],
    altPrompts: [
      'Find packet-sniffing and network inspection tools in my stars',
      'Generate a tech interest radar from my current star portfolio',
    ],
  },
  {
    id: 'local-diagnosis',
    title: '💻 Local Project Architecture Audit',
    description: 'Inspect local codebases, discover bottlenecks and replacement packages',
    scope: 'local',
    prompts: [
      'Scan current project architecture bottlenecks and suggest dependencies',
      'Audit local codebase for security concerns and refactoring candidates',
    ],
    altPrompts: [
      'Analyze drift between local README and actual codebase layout',
      'Recommend open source middleware suited for local tech stack',
    ],
  },
  {
    id: 'foss-alternatives',
    title: '🔄 Self-Hosted FOSS Alternatives',
    description: 'Find high-star open source replacements for commercial SaaS',
    scope: 'github',
    prompts: [
      'Find top self-hosted open source alternatives to Notion',
      'Low-memory persistent open source alternatives to Redis',
    ],
    altPrompts: [
      'Lightweight self-hosted frontend error tracking like Sentry',
      'Modern open-source API testing tools replacing Postman',
    ],
  },
  {
    id: 'source-deep-dive',
    title: '🔬 Masterclass Source Code Walkthrough',
    description: 'Dissect mission-critical paths and architectural patterns',
    scope: 'github',
    prompts: [
      'Analyze PagedAttention implementation principles in vLLM',
      'Trace React 19 Actions scheduling and transition pipelines',
    ],
    altPrompts: [
      'Deconstruct Docker Namespace and Cgroups isolation internals',
      'Examine the execution state machine of LangChain Agent loops',
    ],
  },
];

export const INSPIRATION_STORAGE_KEY = 'gsm_custom_inspiration_cards';

interface InspirationGridProps {
  onSelectPrompt: (prompt: string, scope: WorkbenchScope) => void;
}

export function InspirationGrid({ onSelectPrompt }: InspirationGridProps) {
  const language = useAppStore((state) => state.language);
  const isZh = language === 'zh' || language === 'zh-TW';

  const defaultCards = isZh ? DEFAULT_INSPIRATION_CARDS_ZH : DEFAULT_INSPIRATION_CARDS_EN;

  const [cards, setCards] = useState<InspirationCard[]>(() => {
    try {
      const stored = localStorage.getItem(INSPIRATION_STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed;
        }
      }
    } catch {
      // ignore JSON parse error
    }
    return defaultCards;
  });

  const [editingCardId, setEditingCardId] = useState<string | null>(null);

  // Edit draft state
  const [editTitle, setEditTitle] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [editScope, setEditScope] = useState<WorkbenchScope>('github');
  const [editPrompts, setEditPrompts] = useState<string[]>([]);

  // Update cards when language switches if using pure default cards
  useEffect(() => {
    const stored = localStorage.getItem(INSPIRATION_STORAGE_KEY);
    if (!stored) {
      setCards(defaultCards);
    }
  }, [defaultCards]);

  const handleShuffle = useCallback(() => {
    setCards((currentCards) =>
      currentCards.map((card) => {
        if (!card.altPrompts || card.altPrompts.length === 0) return card;
        // Directly swap prompts and altPrompts on every shuffle
        return {
          ...card,
          prompts: card.altPrompts,
          altPrompts: card.prompts,
        };
      }),
    );
  }, []);

  const handleReset = useCallback(() => {
    try {
      localStorage.removeItem(INSPIRATION_STORAGE_KEY);
    } catch {
      // ignore
    }
    setCards(defaultCards);
    setEditingCardId(null);
  }, [defaultCards]);

  const startEdit = useCallback((card: InspirationCard) => {
    setEditingCardId(card.id);
    setEditTitle(card.title);
    setEditDesc(card.description);
    setEditScope(card.scope);
    setEditPrompts([...card.prompts]);
  }, []);

  const cancelEdit = useCallback(() => {
    setEditingCardId(null);
  }, []);

  const saveEdit = useCallback(() => {
    if (!editingCardId) return;
    const cleanPrompts = editPrompts.map((p) => p.trim()).filter(Boolean);
    const updated = cards.map((c) => {
      if (c.id !== editingCardId) return c;
      return {
        ...c,
        title: editTitle.trim() || c.title,
        description: editDesc.trim() || c.description,
        scope: editScope,
        prompts: cleanPrompts.length > 0 ? cleanPrompts : c.prompts,
      };
    });
    setCards(updated);
    try {
      localStorage.setItem(INSPIRATION_STORAGE_KEY, JSON.stringify(updated));
    } catch {
      // ignore
    }
    setEditingCardId(null);
  }, [editingCardId, editTitle, editDesc, editScope, editPrompts, cards]);

  const handleUpdatePrompt = (index: number, val: string) => {
    setEditPrompts((prev) => {
      const next = [...prev];
      next[index] = val;
      return next;
    });
  };

  const handleRemovePrompt = (index: number) => {
    setEditPrompts((prev) => prev.filter((_, i) => i !== index));
  };

  const handleAddPrompt = () => {
    setEditPrompts((prev) => [...prev, '']);
  };

  return (
    <div className="mx-auto w-full max-w-4xl space-y-4 px-2 py-4">
      {/* Header bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 pb-3">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold text-foreground">
            {isZh ? '💡 灵感看板' : '💡 Inspiration Grid'} {/* i18n-allow-literal */}
          </h2>
          <span className="hidden text-xs text-muted-foreground sm:inline">
            {isZh
              ? '选择精选场景开启深度调研，或点击 ✏️ 原位修改卡片'
              : 'Select a curated scenario or click ✏️ to customize'} {/* i18n-allow-literal */}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleShuffle}
            className="h-7 gap-1 px-2.5 text-xs text-muted-foreground hover:text-foreground"
            title={isZh ? '换一批灵感胶囊' : 'Shuffle inspiration prompts'} /* i18n-allow-literal */
          >
            <Dices className="h-3.5 w-3.5" />
            <span>{isZh ? '换一批' : 'Shuffle'}</span> {/* i18n-allow-literal */}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleReset}
            className="h-7 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground"
            title={isZh ? '恢复为官方默认预设' : 'Reset to default presets'} /* i18n-allow-literal */
          >
            <RotateCcw className="h-3.5 w-3.5" />
            <span>{isZh ? '恢复预设' : 'Reset'}</span> {/* i18n-allow-literal */}
          </Button>
        </div>
      </div>

      {/* Bento Grid: 3 cols on desktop (lg), 2 on tablet (md), 1 on mobile */}
      <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2 lg:grid-cols-3">
        {cards.map((card) => {
          const isEditing = editingCardId === card.id;

          if (isEditing) {
            return (
              <div
                key={card.id}
                className="flex flex-col gap-2.5 rounded-xl border-2 border-primary/50 bg-card p-3.5 shadow-sm"
              >
                <div className="flex items-center justify-between border-b border-border/50 pb-1.5">
                  <span className="text-xs font-semibold text-foreground">
                    {isZh ? '✏️ 原位编辑卡片' : '✏️ Edit Card'} {/* i18n-allow-literal */}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={cancelEdit}
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>

                <div className="space-y-1">
                  <span className="text-[11px] text-muted-foreground">
                    {isZh ? '标题' : 'Title'} {/* i18n-allow-literal */}
                  </span>
                  <Input
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    className="h-7 text-xs"
                  />
                </div>

                <div className="space-y-1">
                  <span className="text-[11px] text-muted-foreground">
                    {isZh ? '场景说明' : 'Description'} {/* i18n-allow-literal */}
                  </span>
                  <Input
                    value={editDesc}
                    onChange={(e) => setEditDesc(e.target.value)}
                    className="h-7 text-xs"
                  />
                </div>

                <div className="space-y-1">
                  <span className="text-[11px] text-muted-foreground">
                    {isZh ? '对应 Scope' : 'Target Scope'} {/* i18n-allow-literal */}
                  </span>
                  <select
                    value={editScope}
                    onChange={(e) => setEditScope(e.target.value as WorkbenchScope)}
                    className="h-7 w-full rounded border border-input bg-background px-2 text-xs text-foreground"
                  >
                    <option value="github">{isZh ? 'GitHub 搜索' : 'GitHub Search'}</option> {/* i18n-allow-literal */}
                    <option value="selected">{isZh ? '已选仓库' : 'Selected Repos'}</option> {/* i18n-allow-literal */}
                    <option value="library">{isZh ? '我的收藏' : 'My Library'}</option> {/* i18n-allow-literal */}
                    <option value="local">{isZh ? '本地工程' : 'Local Project'}</option> {/* i18n-allow-literal */}
                    <option value="mixed">{isZh ? '本地 + 所选' : 'Mixed Research'}</option> {/* i18n-allow-literal */}
                    <option value="project">{isZh ? '项目仓库' : 'Project Repos'}</option> {/* i18n-allow-literal */}
                  </select>
                </div>

                <div className="space-y-1.5">
                  <span className="text-[11px] text-muted-foreground">
                    {isZh ? 'Prompt 胶囊' : 'Prompt Pills'} {/* i18n-allow-literal */}
                  </span>
                  <div className="max-h-36 space-y-1.5 overflow-y-auto pr-0.5">
                    {editPrompts.map((p, idx) => (
                      <div key={idx} className="flex items-center gap-1">
                        <Input
                          value={p}
                          onChange={(e) => handleUpdatePrompt(idx, e.target.value)}
                          className="h-7 flex-1 text-xs"
                          placeholder={isZh ? '输入 Prompt 文本' : 'Prompt text'} /* i18n-allow-literal */
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-destructive hover:bg-destructive/10"
                          onClick={() => handleRemovePrompt(idx)}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    ))}
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-6 w-full gap-1 text-[11px]"
                    onClick={handleAddPrompt}
                  >
                    <Plus className="h-3 w-3" />
                    <span>{isZh ? '添加胶囊' : 'Add Capsule'}</span> {/* i18n-allow-literal */}
                  </Button>
                </div>

                <div className="mt-1 flex items-center justify-end gap-2 border-t border-border/50 pt-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2.5 text-xs"
                    onClick={cancelEdit}
                  >
                    {isZh ? '取消' : 'Cancel'} {/* i18n-allow-literal */}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    className="h-7 gap-1 px-3 text-xs"
                    onClick={saveEdit}
                  >
                    <Check className="h-3 w-3" />
                    <span>{isZh ? '保存' : 'Save'}</span> {/* i18n-allow-literal */}
                  </Button>
                </div>
              </div>
            );
          }

          return (
            <article
              key={card.id}
              className="group relative flex flex-col justify-between rounded-xl border border-border/70 bg-card/60 p-3.5 shadow-xs transition-all duration-200 hover:border-primary/40 hover:bg-card/90 hover:shadow-sm"
            >
              <div>
                <div className="flex items-start justify-between gap-1">
                  <h3 className="line-clamp-1 text-xs font-semibold text-foreground sm:text-sm">
                    {card.title}
                  </h3>
                  <div className="flex shrink-0 items-center gap-1">
                    <Badge
                      variant="outline"
                      className="px-1.5 py-0 font-mono text-[10px] font-normal capitalize text-muted-foreground"
                    >
                      {card.scope}
                    </Badge>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:focus:opacity-100"
                      onClick={() => startEdit(card)}
                      aria-label={isZh ? `编辑 ${card.title}` : `Edit ${card.title}`}
                      title={isZh ? '编辑此卡片' : 'Edit card'} /* i18n-allow-literal */
                    >
                      <Pencil className="h-3 w-3 text-muted-foreground hover:text-foreground" />
                    </Button>
                  </div>
                </div>

                <p className="mt-1.5 mb-3 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                  {card.description}
                </p>
              </div>

              <div className="mt-auto flex flex-wrap gap-1.5 pt-1">
                {card.prompts.map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    onClick={() => onSelectPrompt(prompt, card.scope)}
                    className="cursor-pointer rounded-full border border-border/60 bg-muted/50 px-2.5 py-1 text-left text-xs text-foreground transition-all duration-150 hover:border-primary/40 hover:bg-primary/10 hover:text-primary active:scale-[0.98]"
                  >
                    <span className="line-clamp-1 break-all">{prompt}</span>
                  </button>
                ))}
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
