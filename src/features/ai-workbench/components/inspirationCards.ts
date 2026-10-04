import type { WorkbenchScope } from '../../../types/aiWorkbench';

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
