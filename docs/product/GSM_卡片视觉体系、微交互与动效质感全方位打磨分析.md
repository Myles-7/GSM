# GithubStarsManager 卡片视觉体系、微交互与动效质感全方位打磨分析

## 1. 背景与核心定位

GithubStarsManager（GSM）桌面端核心交互范式为**轻量卡片流（Visual-Centric）**，以鼠标操控与高密度信息浏览为主。面对海量 Star 仓库的日常检索与整理，用户重点追求现代化精致质感：克制的投影与高光、精准的圆角层叠几何、高阶透气的呼吸感骨架屏、平滑不掉帧的折叠展开微动效，以及符合 WCAG 无障碍标准的清晰标签色彩编码。

本分析报告系统审查当前卡片体系（[RepositoryCard.tsx](file:///d:/桌面/GSM/src/components/RepositoryCard.tsx)、[tailwind.config.js](file:///d:/桌面/GSM/tailwind.config.js)、[index.css](file:///d:/桌面/GSM/src/index.css)、[RepositoryGrid.tsx](file:///d:/桌面/GSM/src/features/repositories/components/RepositoryGrid.tsx)、[RepositoryGroups.tsx](file:///d:/桌面/GSM/src/features/repositories/components/RepositoryGroups.tsx)、[RepositoryLanguageStars.tsx](file:///d:/桌面/GSM/src/components/RepositoryLanguageStars.tsx) 与抽屉组件），诊断视觉硬伤并提供可落地的工程级重构实现规范。

---

## 2. 【视觉不一致清单】（Visual Inconsistencies & Rough Edges）

依据设计工程规范，下表详细梳理当前卡片在阴影、圆角、内边距、字体层级等维度上的粗糙细节与修复方案：

| Before | After | Why |
| :--- | :--- | :--- |
| `transition-[color,background-color,border-color,box-shadow] duration-200` 与 `.ui-card` 内置 `150ms` 冲突 | `transition: transform 200ms cubic-bezier(0.23, 1, 0.32, 1), box-shadow 200ms cubic-bezier(0.23, 1, 0.32, 1), border-color 150ms ease-out;` | 避免多重过渡声明冲突；精确指定变换属性，规避主线程样式重算与模糊过渡 |
| Hover 时仅扩展大阴影 `--ui-shadow-float`，无物理位移反馈 | Hover 时配合 `translateY(-2.5px)` 微上浮与双层阴影；`:active` 时添加 `scale(0.995)` | 无位移的单纯阴影扩散显得扁平生硬；符合真实物理世界的轻微受力反馈与按压阻尼感 |
| 外卡片 `rounded-lg (8px)`，内部按钮 `rounded-md (6px)`，内边距 `p-4 (16px)` | 外卡片 `rounded-xl (12px)`，内按钮 `rounded-lg (8px)`，标签 `rounded-md (6px)` | 遵循嵌套圆角几何法则 $R_{outer} = R_{inner} + P$。外 8px 与内 6px 配合 16px 内边距会产生明显的同心圆畸变 |
| 描述文本套用 `-mx-1 px-1 hover:bg-muted` 产生局部闪烁灰块 | 移除描述段落的局部背景 Hover 变色，直接由整卡 Hover 驱动文本微亮度增强 | 局部段落 Hover 灰块切割了卡片整体性，产生视觉噪音与闪烁感 |
| 底部更新时间用 `text-sm`，甚至大于正文描述（`text-[13px]`） | 底部元数据统一为 `text-xs (12px)`，描述正文使用 `text-[13px] leading-[1.6]` | 修复视觉层级倒挂：辅助时间元数据绝不能比核心描述文本拥有更高级别的字号 |
| 仓库名与作者名皆为 `text-sm`，仅颜色有细微明暗差异 | 标题 `text-sm font-semibold text-foreground`，Owner 改为 `text-xs font-medium text-muted-foreground` | 强化主副标题视觉层级区分，提升扫读效率 |
| 网格与列表模式下右侧操作栏按钮尺寸不一（网格 `h-7 w-7` 间距 2px，列表 `h-8 w-8`） | 统一为 `h-8 w-8`（或紧凑网格统一触控靶区 `h-7.5 w-7.5 gap-1`） | 保持跨视图交互心智一致性，防止网格下 2px 极小间距引发鼠标误触 |
| 深色模式下为纯黑无光泽底色加生硬边框，阴影几乎不可见 | 引入深色微光边框 `border-border/60 dark:border-white/[0.08]` 及顶部天光反射 `inset 0 1px 0 rgba(255,255,255,0.06)` | 深色模式下黑色阴影失效，必须通过表面天光反射与微光边框表达卡片深度 |
| 语言色点直接硬编码 Hex（如 JavaScript `#f1e05a`）在浅色卡片上几近隐形 | 增加 `ring-1 ring-black/10 dark:ring-white/10` 或动态明度校正 | 纯白底上的黄色点对比度仅 ~1.25:1，违背 WCAG 3:1 图形边界可访问性标准 |
| `RepositoryGrid` 使用 `ResizeObserver` 动态赋列，初次渲染从 `columns=1` 跃迁 | 采用 CSS Grid 纯 CSS 方案 `grid-template-columns: repeat(auto-fill, minmax(310px, 1fr))` | 彻底消除 JS 测量导致的初次渲染单列闪烁（CLS 布局抖动） |
| 分组折叠直接 `if (collapsed) return null;` 突兀销毁 DOM | 基于 CSS Grid `grid-template-rows: 0fr -> 1fr` 实现平滑折叠过渡 | 避免分类切换与折叠时视口高度瞬间坍缩，提供平滑视觉过渡 |
| 骨架屏仅有简单的 `text-skeleton`，网格卡片加载时无占位 | 建立与 `RepositoryCard` 1:1 几何占位的 Shimmer 流光呼吸骨架屏 | 消除加载状态与实体卡片渲染时的跳动，保持视觉占位节奏一致 |

---

## 3. 【动效打磨规范】（Motion & Micro-interaction Engineering）

### 3.1 动效缓动与持续时间配置（Easing Tokens）
在 [tailwind.config.js](file:///d:/桌面/GSM/tailwind.config.js) 与 [index.css](file:///d:/桌面/GSM/src/index.css) 中定义符合物理规律的定制贝塞尔曲线，禁止在 UI 交互中使用迟缓的 `ease-in`：

```css
/* src/index.css */
:root {
  /* 响应迅速、回弹自然的微交互曲线（Emil Kowalski 推荐） */
  --ease-spring-out: cubic-bezier(0.23, 1, 0.32, 1);
  /* 侧滑抽屉/面板专属顺滑减速曲线 */
  --ease-drawer-out: cubic-bezier(0.32, 0.72, 0, 1);

  /* 现代卡片微投影分层 */
  --card-shadow-resting: 0 1px 3px rgba(0, 0, 0, 0.04), 0 1px 2px rgba(0, 0, 0, 0.02);
  --card-shadow-hover: 0 8px 24px -4px rgba(0, 0, 0, 0.08), 0 4px 12px -2px rgba(0, 0, 0, 0.04);
  --card-glow-dark: 0 0 0 1px rgba(255, 255, 255, 0.08), 0 8px 24px -4px rgba(0, 0, 0, 0.5);
}
```

```javascript
// tailwind.config.js 扩展
extend: {
  transitionTimingFunction: {
    'spring-out': 'cubic-bezier(0.23, 1, 0.32, 1)',
    'drawer-out': 'cubic-bezier(0.32, 0.72, 0, 1)',
  },
  transitionDuration: {
    '180': '180ms',
    '220': '220ms',
  },
}
```

---

### 3.2 卡片 Hover / Active 触感规范
```css
/* 现代精致卡片交互类 */
.repository-card-modern {
  position: relative;
  background-color: hsl(var(--card));
  border-radius: 0.75rem; /* 12px */
  border: 1px solid hsl(var(--border) / 0.8);
  box-shadow: var(--card-shadow-resting);
  /* 精确监听硬件加速属性 */
  transition:
    transform 200ms var(--ease-spring-out),
    box-shadow 200ms var(--ease-spring-out),
    border-color 150ms ease-out,
    background-color 150ms ease-out;
  will-change: transform;
}

/* 仅在支持高精度鼠标悬停的设备上触发浮起，避免移动端滚动误触发跳动 */
@media (hover: hover) and (pointer: fine) {
  .repository-card-modern:hover {
    transform: translateY(-2.5px);
    box-shadow: var(--card-shadow-hover);
    border-color: hsl(var(--ring) / 0.4);
  }
}

/* 按压瞬间的紧实阻尼反馈 */
.repository-card-modern:active {
  transform: translateY(-0.5px) scale(0.995);
  transition-duration: 80ms;
}

/* 深色模式下的微光与边缘天光反射 */
.dark .repository-card-modern {
  box-shadow: inset 0 1px 0 0 rgba(255, 255, 255, 0.06);
  border-color: rgba(255, 255, 255, 0.08);
}
.dark .repository-card-modern:hover {
  border-color: rgba(255, 255, 255, 0.2);
  box-shadow: inset 0 1px 0 0 rgba(255, 255, 255, 0.12), var(--card-glow-dark);
}
```

---

### 3.3 分组平滑折叠展开微动效（CSS Grid Trick）
解决 [RepositoryGroups.tsx](file:///d:/桌面/GSM/src/features/repositories/components/RepositoryGroups.tsx) 中 `if (collapsed) return null;` 突兀闪现的问题，采用无需 JS 测量高度的 0-重排 CSS Grid 方案：

```css
/* 分组折叠动画容器 */
.smooth-collapse-grid {
  display: grid;
  grid-template-rows: 1fr;
  transition: grid-template-rows 220ms var(--ease-spring-out), opacity 180ms ease-out;
  opacity: 1;
}

.smooth-collapse-grid.is-collapsed {
  grid-template-rows: 0fr;
  opacity: 0;
  pointer-events: none;
}

.smooth-collapse-inner {
  overflow: hidden;
  min-height: 0;
}
```

```tsx
// 在 RepositoryGroups 中的应用范例
<div className={`smooth-collapse-grid ${collapsed.has(section.key) ? 'is-collapsed' : ''}`}>
  <div className="smooth-collapse-inner">
    <GroupBatch repositories={ordered} ... />
  </div>
</div>
```

---

### 3.4 详情抽屉平滑滑入微动效（Drawer Motion）
针对 [RepositoryDetailsPanel.tsx](file:///d:/桌面/GSM/src/components/RepositoryDetailsPanel.tsx) 错误复用 `Dialog` 导致居中缩放抖动的缺陷，改用纯 GPU `transform` 侧滑进出：

```css
/* 详情抽屉遮罩 */
.drawer-backdrop {
  opacity: 0;
  transition: opacity 220ms ease-out;
  backdrop-filter: blur(2px);
}
.drawer-backdrop[data-state='open'] {
  opacity: 1;
}

/* 详情抽屉面板：Enter 240ms 弹簧减速，Exit 180ms 快速退场 */
.details-drawer-panel {
  transform: translateX(100%);
  transition: transform 240ms var(--ease-drawer-out);
  will-change: transform;
}

.details-drawer-panel[data-state='open'] {
  transform: translateX(0);
}

.details-drawer-panel[data-state='closed'] {
  transform: translateX(100%);
  transition: transform 180ms cubic-bezier(0.4, 0, 1, 1);
}
```

---

### 3.5 呼吸感流光骨架屏（Shimmer Mesh）
替换现有简单的 `animate-pulse`，引入均匀平移的微光扫过效果：

```css
@keyframes shimmerSweep {
  0% { transform: translateX(-100%); }
  100% { transform: translateX(100%); }
}

.skeleton-shimmer {
  position: relative;
  overflow: hidden;
  background-color: hsl(var(--muted) / 0.6);
}

.skeleton-shimmer::after {
  content: '';
  position: absolute;
  inset: 0;
  transform: translateX(-100%);
  background: linear-gradient(
    90deg,
    transparent 0%,
    hsl(var(--foreground) / 0.05) 50%,
    transparent 100%
  );
  animation: shimmerSweep 1.8s infinite cubic-bezier(0.4, 0, 0.2, 1);
}
```

```tsx
// 几何 1:1 对齐的卡片骨架屏组件
export function RepositoryCardSkeleton() {
  return (
    <div className="repository-card-modern p-4 flex flex-col h-[220px]">
      <div className="flex items-start gap-2.5 mb-3">
        <div className="skeleton-shimmer w-8 h-8 rounded-full shrink-0" />
        <div className="flex-1 space-y-1.5">
          <div className="skeleton-shimmer h-4 w-3/4 rounded-md" />
          <div className="skeleton-shimmer h-3 w-1/3 rounded-md" />
        </div>
      </div>
      <div className="space-y-2 mb-4 flex-1">
        <div className="skeleton-shimmer h-3 w-full rounded-md" />
        <div className="skeleton-shimmer h-3 w-4/5 rounded-md" />
      </div>
      <div className="flex gap-1.5 mb-4">
        <div className="skeleton-shimmer h-5 w-14 rounded-md" />
        <div className="skeleton-shimmer h-5 w-16 rounded-md" />
      </div>
      <div className="pt-2 border-t border-border/40 flex justify-between items-center mt-auto">
        <div className="skeleton-shimmer h-3.5 w-20 rounded-md" />
        <div className="skeleton-shimmer h-3.5 w-16 rounded-md" />
      </div>
    </div>
  );
}
```

---

## 4. 【标签与元数据色彩系统】（Tag & Metadata Color Architecture）

建立清晰的三级语义色彩系统，满足 WCAG 2.1 AA 标准（文本对背景对比度 $\ge 4.5:1$，图形边缘 $\ge 3:1$）：

```
┌──────────────────────────────────────────────────────────────┐
│                    标签与元数据色彩层级                        │
├──────────────────────────────────────────────────────────────┤
│ 1. 软件架构形态 (CLI, Agent, Lib) ── 结构化冷调 (Indigo/Sky)  │
│ 2. 仓库 Topics / 业务分类       ── 低调中性质感 (Slate/Zinc)  │
│ 3. 编程语言色点 (Language Dots)  ── 自适应微光环 (Adaptive)   │
│ 4. 状态徽章 (AI / Analyzed)      ── 呼吸光感 (Emerald/Violet) │
└──────────────────────────────────────────────────────────────┘
```

### 4.1 多语言色点对比度强化方案
针对浅色白底上的亮色（JavaScript `#f1e05a`）与深色底上的暗色（Ruby `#701516`、C `#555555`）：

```tsx
// src/components/AdaptiveLanguageDot.tsx
import React from 'react';

const LANGUAGE_PALETTE: Record<string, { light: string; dark: string; borderNeeded?: boolean }> = {
  JavaScript: { light: '#c99a00', dark: '#f1e05a', borderNeeded: true },
  TypeScript: { light: '#3178c6', dark: '#4895ef' },
  Python:     { light: '#2b5b84', dark: '#4584b6' },
  Java:       { light: '#a65d07', dark: '#e76f51' },
  'C++':      { light: '#d6336c', dark: '#f34b7d' },
  C:          { light: '#495057', dark: '#adb5bd' },
  'C#':       { light: '#1971c2', dark: '#38b000' },
  Go:         { light: '#0084a8', dark: '#00add8' },
  Rust:       { light: '#a7522c', dark: '#dea584' },
  Ruby:       { light: '#701516', dark: '#ff5c5c' },
  Shell:      { light: '#5c940d', dark: '#89e051' },
  HTML:       { light: '#d9381e', dark: '#e34c26' },
  CSS:        { light: '#1864ab', dark: '#4dabf7' },
  Vue:        { light: '#2f9e44', dark: '#4fc08d' },
  React:      { light: '#0c8599', dark: '#61dafb' },
};

export function AdaptiveLanguageDot({ language }: { language: string }) {
  const config = LANGUAGE_PALETTE[language];
  const color = config?.light || '#6b7280';
  const darkColor = config?.dark || '#9ca3af';

  return (
    <span
      className="inline-block h-2 w-2 rounded-full shrink-0 ring-1 ring-black/10 dark:ring-white/15"
      style={{
        backgroundColor: 'var(--lang-dot-color)',
        ['--lang-dot-color' as string]: color,
      }}
      data-dark-color={darkColor}
      aria-hidden="true"
    />
  );
}
```

### 4.2 标签层级 CSS 规范
```css
/* 1. 软件架构/形态标签（高阶属性） */
.tag-software-form {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.125rem 0.4375rem;
  font-size: 0.6875rem; /* 11px */
  font-weight: 510;
  border-radius: 0.375rem; /* 6px */
  background-color: hsl(var(--primary) / 0.08);
  color: hsl(var(--primary));
  border: 1px solid hsl(var(--primary) / 0.18);
}

/* 2. 普通 Topic 标签（中性温和，不抢视觉） */
.tag-topic {
  display: inline-flex;
  align-items: center;
  padding: 0.125rem 0.375rem;
  font-size: 0.6875rem; /* 11px */
  font-weight: 450;
  border-radius: 0.375rem; /* 6px */
  background-color: hsl(var(--muted) / 0.7);
  color: hsl(var(--muted-foreground));
  border: 1px solid hsl(var(--border) / 0.6);
  transition: background-color 140ms ease, color 140ms ease;
}
.tag-topic:hover {
  background-color: hsl(var(--accent));
  color: hsl(var(--foreground));
}

/* 3. 用户手动打标（强化识别） */
.tag-custom {
  border-left: 2px solid hsl(var(--primary));
}
```

---

## 5. 【卡片组件重构示例】（Refactored Modern RepositoryCard）

以下为重塑后的现代化轻量卡片组件，全面融入精致投影、自适应微光边框、符合人体工程学的内边距与无毛刺动效：

```tsx
import React, { useMemo } from 'react';
import {
  GripVertical,
  Star,
  ExternalLink,
  Calendar,
  Sparkles,
  Bot,
  ArrowRight,
  PackageOpen,
  CheckSquare,
  Square,
  MoreHorizontal
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { Button } from './ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';
import { AdaptiveLanguageDot } from './AdaptiveLanguageDot';
import type { Repository } from '../types';

interface ModernRepositoryCardProps {
  repository: Repository;
  isSelected?: boolean;
  onSelect?: (id: number) => void;
  selectionMode?: boolean;
  onViewDetails?: (repo: Repository) => void;
  searchQuery?: string;
}

export const ModernRepositoryCard: React.FC<ModernRepositoryCardProps> = ({
  repository,
  isSelected = false,
  onSelect,
  selectionMode = false,
  onViewDetails,
}) => {
  const isAnalyzed = Boolean(repository.analyzed_at && !repository.analysis_failed);

  const displayTags = useMemo(() => {
    if (repository.custom_tags && repository.custom_tags.length > 0) {
      return repository.custom_tags.slice(0, 3).map((t) => ({ tag: t, isCustom: true }));
    }
    return (repository.topics || []).slice(0, 3).map((t) => ({ tag: t, isCustom: false }));
  }, [repository.custom_tags, repository.topics]);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => {
        if (selectionMode && onSelect) onSelect(repository.id);
        else onViewDetails?.(repository);
      }}
      className={`
        repository-card-modern group relative flex flex-col h-full cursor-pointer
        p-4 select-none
        ${isSelected ? 'ring-2 ring-primary border-primary bg-primary/[0.02]' : ''}
      `}
    >
      {/* 1. 顶部栏：所有者头像、仓库名与右上角微操作区 */}
      <div className="flex items-start gap-2.5 mb-2.5">
        <img
          src={repository.owner.avatar_url}
          alt={repository.owner.login}
          className="w-8 h-8 rounded-full shrink-0 ring-1 ring-border/50 object-cover"
          loading="lazy"
        />

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 leading-tight">
            <h3 className="text-sm font-semibold text-foreground tracking-tight truncate">
              {repository.name}
            </h3>
            {isAnalyzed && (
              <span className="inline-flex shrink-0 text-primary" title="AI 分析就绪">
                <Sparkles className="w-3 h-3 animate-pulse" />
              </span>
            )}
          </div>
          <p className="text-xs font-medium text-muted-foreground truncate mt-0.5">
            {repository.owner.login}
          </p>
        </div>

        {/* 悬停快捷操作区（紧凑、精致、防误触） */}
        <div
          className="flex items-center gap-0.5 opacity-90 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity duration-150"
          onClick={(e) => e.stopPropagation()}
        >
          <a
            href={repository.html_url}
            target="_blank"
            rel="noopener noreferrer"
            title="在 GitHub 上查看"
            className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors"
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 rounded-lg text-muted-foreground hover:text-foreground"
            title="更多操作"
          >
            <MoreHorizontal className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>

      {/* 2. 正文描述区（固定3-4行行高平整展示） */}
      <div className="flex-1 mb-3">
        <Tooltip>
          <TooltipTrigger asChild>
            <p className="text-[13px] leading-[1.6] text-muted-foreground line-clamp-3 [text-wrap:pretty]">
              {repository.custom_description || repository.ai_summary || repository.description || '暂无描述信息'}
            </p>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-md text-xs">
            {repository.custom_description || repository.ai_summary || repository.description}
          </TooltipContent>
        </Tooltip>
      </div>

      {/* 3. 标签展示区 */}
      {displayTags.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 mb-3">
          {displayTags.map(({ tag, isCustom }) => (
            <span
              key={tag}
              className={`tag-topic ${isCustom ? 'tag-custom font-medium' : ''}`}
            >
              #{tag}
            </span>
          ))}
        </div>
      )}

      {/* 4. 底部沉底元数据栏（严格遵循信息从属原则，统一 11~12px 弱化修饰） */}
      <div className="mt-auto pt-2.5 border-t border-border/50 flex items-center justify-between text-xs text-muted-foreground">
        <div className="flex items-center gap-3 min-w-0">
          {/* 语言色点 */}
          {repository.language && (
            <span className="flex items-center gap-1.5 truncate">
              <AdaptiveLanguageDot language={repository.language} />
              <span className="truncate max-w-[80px]">{repository.language}</span>
            </span>
          )}

          {/* Stars 计数 */}
          <span className="flex items-center gap-1 shrink-0 font-mono text-[11px]">
            <Star className="w-3 h-3 text-muted-foreground/80" />
            <span>{repository.stargazers_count?.toLocaleString()}</span>
          </span>

          {/* 更新相对时间 */}
          <span className="hidden sm:flex items-center gap-1 shrink-0 text-muted-foreground/70">
            <Calendar className="w-3 h-3" />
            <span>
              {formatDistanceToNow(new Date(repository.pushed_at || repository.updated_at), { addSuffix: true })}
            </span>
          </span>
        </div>

        {/* 详情入口或选择模式复选框 */}
        <div className="flex items-center gap-1 shrink-0 ml-2" onClick={(e) => e.stopPropagation()}>
          {selectionMode ? (
            <button
              type="button"
              onClick={() => onSelect?.(repository.id)}
              className="p-1 rounded text-primary hover:bg-primary/10 transition-colors"
            >
              {isSelected ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4 text-muted-foreground" />}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => onViewDetails?.(repository)}
              className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[11px] font-medium text-muted-foreground hover:text-primary hover:bg-primary/5 transition-all"
            >
              <span>详情</span>
              <ArrowRight className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
```

---

## 6. 系统实施与落地路径

1. **Step 1 - 基础视觉 Token 统一**：
   在 [index.css](file:///d:/桌面/GSM/src/index.css) 中注入 `--ease-spring-out`、`--card-shadow-resting`、`--card-shadow-hover` 及深色天光高光变量，使全站卡片基底具备现代 SaaS 质感。
2. **Step 2 - 网格 CLS 修复与骨架屏补全**：
   将 [RepositoryGrid.tsx](file:///d:/桌面/GSM/src/features/repositories/components/RepositoryGrid.tsx) 切换为原生 CSS Grid 自适应，同时挂载 `RepositoryCardSkeleton` 流光占位组件。
3. **Step 3 - 色彩系统与 WCAG 无障碍加固**：
   引入 `AdaptiveLanguageDot` 替换原硬编码色点；统一分类与软件形态 Badge 的背景/字阶对比度。
4. **Step 4 - 抽屉与折叠容器动效升级**：
   在 [RepositoryDetailsPanel.tsx](file:///d:/桌面/GSM/src/components/RepositoryDetailsPanel.tsx) 和 [RepositoryGroups.tsx](file:///d:/桌面/GSM/src/features/repositories/components/RepositoryGroups.tsx) 中替换生硬显隐逻辑，注入 CSS Grid 平滑折叠和 240ms 弹簧滑入抽屉。
