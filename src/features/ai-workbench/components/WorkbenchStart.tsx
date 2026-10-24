import { ArrowUpRight, Compass, Cpu, FolderKanban, Layers, Library, Scale, ShieldCheck, Sparkles, Tag, Terminal, Wrench, type LucideIcon } from 'lucide-react';
import type { WorkbenchTaskMode } from '../../../types/aiWorkbench';
import { useAppStore } from '../../../store/useAppStore';

interface ScenarioTemplate {
  id: string;
  icon: LucideIcon;
  tagZh: string;
  tagEn: string;
  titleZh: string;
  titleEn: string;
  promptZh: string;
  promptEn: string;
}

const SCENARIO_TEMPLATES: Record<WorkbenchTaskMode, ScenarioTemplate[]> = {
  discover: [
    {
      id: 'discover-selfhosted',
      icon: Compass,
      tagZh: '替代品寻源',
      tagEn: 'Alternatives',
      titleZh: '寻找轻量级自托管替代方案',
      titleEn: 'Lightweight Self-Hosted Alternatives',
      promptZh: '寻找轻量化、支持 Docker 一键自托管的知识库与文档协作开源替代项目，优先推荐近期活跃维护且对个人免费友好的方案。',
      promptEn: 'Find lightweight, Docker self-hosted open-source alternatives for knowledge base and document collaboration that are actively maintained.',
    },
    {
      id: 'discover-agent-mcp',
      icon: Cpu,
      tagZh: '前沿生态',
      tagEn: 'Agent & MCP',
      titleZh: '发掘实用 Agent 与 MCP 工具链',
      titleEn: 'Explore Agent & MCP Toolchains',
      promptZh: '推荐实用的 MCP Server、Coding Agent 或终端 AI 辅助开发开源工具，要求提供清晰的接入文档、工具列表与典型使用场景。',
      promptEn: 'Recommend practical MCP Servers, Coding Agents, or terminal AI developer tools with clear documentation and real-world use cases.',
    },
    {
      id: 'discover-stack',
      icon: Layers,
      tagZh: '工程选型',
      tagEn: 'Tech Stack',
      titleZh: '特定技术栈组件与架构寻源',
      titleEn: 'Component & Architecture Sourcing',
      promptZh: '寻找适合 React + TypeScript 桌面或 Web 应用的高性能图谱可视化与状态管理开源库，对比生态成熟度、包体积与维护活跃度。',
      promptEn: 'Find high-performance graph visualization and state management libraries for React + TypeScript apps, comparing maturity and bundle size.',
    },
    {
      id: 'discover-productivity',
      icon: Terminal,
      tagZh: '生产力工具',
      tagEn: 'Productivity',
      titleZh: '本地优先与隐私安全开发工具',
      titleEn: 'Local-First Developer Tools',
      promptZh: '查找支持本地离线运行、保护数据隐私的文档解析（PDF/Markdown）或本地 RAG 检索开源工具，支持跨平台桌面端运行。',
      promptEn: 'Find local-first, offline-capable document parsing (PDF/Markdown) or local RAG retrieval open-source tools with cross-platform support.',
    },
  ],
  research: [
    {
      id: 'research-compare',
      icon: Scale,
      tagZh: '多维对比',
      tagEn: 'Comparison',
      titleZh: '同领域候选仓库横向对比',
      titleEn: 'Side-by-Side Repository Comparison',
      promptZh: '对比所选仓库的核心定位、适用场景、技术栈差异与优缺点，并给出不同使用规模下的选型建议。',
      promptEn: 'Compare the core positioning, use cases, tech stack differences, pros and cons of the selected repositories, with selection advice.',
    },
    {
      id: 'research-architecture',
      icon: Layers,
      tagZh: '架构深潜',
      tagEn: 'Architecture',
      titleZh: '核心架构与关键实现机制拆解',
      titleEn: 'Core Architecture & Mechanism Deep Dive',
      promptZh: '深入剖析所选项目的核心架构设计、关键目录结构、数据流转链路以及最具借鉴意义的实现细节。',
      promptEn: 'Analyze the core architecture design, directory structure, data flow, and key implementation details of the selected repositories.',
    },
    {
      id: 'research-adoption',
      icon: ShieldCheck,
      tagZh: '落地评估',
      tagEn: 'Adoption',
      titleZh: '接入成本、协议与二次开发评估',
      titleEn: 'Integration Cost & License Assessment',
      promptZh: '评估该项目的部署依赖、配置复杂度、扩展接口设计、开源协议限制以及二次开发维护成本。',
      promptEn: 'Evaluate deployment dependencies, configuration complexity, extension APIs, license constraints, and maintenance costs.',
    },
    {
      id: 'research-quickstart',
      icon: Wrench,
      tagZh: '源码导读',
      tagEn: 'Code Guide',
      titleZh: '快速上手与核心源码入口导读',
      titleEn: 'Quickstart & Core Entry-Point Guide',
      promptZh: '梳理该项目的快速启动步骤、核心入口文件与关键 API 调用链，帮助我快速跑通并读懂核心源码。',
      promptEn: 'Outline the quickstart steps, core entry files, and key API call chains to help me run and understand the codebase quickly.',
    },
  ],
  organize: [
    {
      id: 'organize-category',
      icon: FolderKanban,
      tagZh: '分类重构',
      tagEn: 'Categorize',
      titleZh: '按技术领域与核心用途智能归类',
      titleEn: 'Categorize by Tech Domain & Purpose',
      promptZh: '按核心技术领域与实际用途（如 AI Agent、前端工程、后端基础、开发工具等）为未分类的收藏仓库生成分类与标签整理提案。',
      promptEn: 'Generate categorization and tagging proposals for uncategorized starred repositories by technical domain and practical purpose.',
    },
    {
      id: 'organize-summary',
      icon: Sparkles,
      tagZh: '摘要补全',
      tagEn: 'Summaries',
      titleZh: '提炼一句话中文核心用途描述',
      titleEn: 'Generate Concise One-Line Summaries',
      promptZh: '为缺少个人备注或描述不清的收藏仓库提炼精准的中文一句话核心用途描述，方便日后按场景快速检索。',
      promptEn: 'Create concise one-sentence descriptions for starred repositories that lack custom notes or clear descriptions.',
    },
    {
      id: 'organize-tags',
      icon: Tag,
      tagZh: '标签治理',
      tagEn: 'Tag Hygiene',
      titleZh: '多维技术标签体系规范化',
      titleEn: 'Standardize Multi-Dimensional Tags',
      promptZh: '梳理当前收藏库的标签体系，合并同义或重复标签，并为各仓库补充标准化的技术栈、平台与场景标签。',
      promptEn: 'Clean up and standardize the tag system across starred repositories, merging duplicates and adding tech-stack and scenario tags.',
    },
    {
      id: 'organize-audit',
      icon: Library,
      tagZh: '馆藏盘点',
      tagEn: 'Library Audit',
      titleZh: '盘点功能重叠与低活跃度项目',
      titleEn: 'Audit Overlapping & Inactive Projects',
      promptZh: '找出收藏库中功能高度重叠的同类项目或长期停更的过时项目，给出保留优选与分类精简建议。',
      promptEn: 'Identify functionally overlapping or long-unmaintained repositories in my stars and suggest which ones to keep or reorganize.',
    },
  ],
};

export function WorkbenchStart({
  taskMode,
  onSelectPrompt,
  disabled,
  libraryCount,
}: {
  taskMode: WorkbenchTaskMode;
  onSelectPrompt: (prompt: string) => void;
  disabled: boolean;
  libraryCount: number;
}) {
  const language = useAppStore((state) => state.language);
  const isZh = language !== 'en';
  const cards = SCENARIO_TEMPLATES[taskMode] ?? SCENARIO_TEMPLATES.discover;

  const modeSubtitle = taskMode === 'discover'
    ? (isZh ? '点击下方场景灵感卡片填入提问，可根据你的具体约束修改后发送' : 'Click a scenario card to prefill the prompt, then customize and send') /* i18n-allow-literal */
    : taskMode === 'research'
      ? (isZh ? '选择研究范围后，可点击下方分析模板快速发起多维对比或源码拆解' : 'Select research repositories, then pick a template below for deep comparison or analysis') /* i18n-allow-literal */
      : (isZh ? `当前共 ${libraryCount} 个收藏仓库，点击下方模板可生成可预览的整理提案` : `${libraryCount} starred repositories available — pick a template to generate a reviewable proposal`); /* i18n-allow-literal */

  return (
    <section
      className="mx-auto mt-6 w-full max-w-3xl"
      data-testid="workbench-scenario-grid"
      aria-label={isZh ? '场景灵感模板' : 'Scenario Templates'} /* i18n-allow-literal */
    >
      <div className="mb-3 flex items-center justify-between gap-2 px-1">
        <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Sparkles className="h-3.5 w-3.5 text-primary" />
          <span>{isZh ? '场景灵感模板' : 'Scenario Templates'}</span> {/* i18n-allow-literal */}
        </div>
        <span className="truncate text-[11px] text-muted-foreground/80">{modeSubtitle}</span>
      </div>
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        {cards.map((card) => {
          const Icon = card.icon;
          const tag = isZh ? card.tagZh : card.tagEn;
          const title = isZh ? card.titleZh : card.titleEn;
          const prompt = isZh ? card.promptZh : card.promptEn;
          return (
            <button
              key={card.id}
              type="button"
              disabled={disabled}
              onClick={() => onSelectPrompt(prompt)}
              className="group flex flex-col justify-between rounded-xl border border-border/70 bg-card/70 p-3.5 text-left shadow-2xs transition-all hover:border-primary/40 hover:bg-accent/35 hover:shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
            >
              <div>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1.5 rounded-md bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                    <Icon className="h-3 w-3 shrink-0" />
                    <span>{tag}</span>
                  </span>
                  <span className="inline-flex items-center gap-0.5 text-[11px] text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                    <span>{isZh ? '填入输入框' : 'Fill prompt'}</span> {/* i18n-allow-literal */}
                    <ArrowUpRight className="h-3 w-3" />
                  </span>
                </div>
                <h3 className="text-sm font-semibold text-foreground transition-colors group-hover:text-primary">
                  {title}
                </h3>
                <p className="mt-1.5 line-clamp-2 text-xs leading-5 text-muted-foreground">
                  {prompt}
                </p>
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}
