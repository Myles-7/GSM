import { Clock3, Languages } from 'lucide-react';
import type { Repository } from '../types';
import { useAppStore } from '../store/useAppStore';
import { applyRepositoryAnalysisAsset, repositoryAnalysisFreshness, useRepositoryAnalysisAssets } from '../services/repositoryAnalysisAssets';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip';

export function RepositoryAnalysisFreshness({ repository }: { repository: Repository }) {
  const language = useAppStore(state => state.language);
  const account = useAppStore(state => state.user?.id);
  const config = useAppStore(state => state.aiConfigs?.find(item => item.id === state.activeAIConfig));
  useRepositoryAnalysisAssets(state => state.assets);
  const projected = account === undefined ? repository : applyRepositoryAnalysisAsset(String(account), repository, language);
  const freshness = repositoryAnalysisFreshness(projected, language, config);
  if (!projected.ai_details) return null;
  const zh = language.startsWith('zh');
  const analysisLanguage = freshness.language === 'und' ? (zh ? '历史分析语言未知' : 'Unknown legacy language') : freshness.language;
  const details = projected.ai_details;
  const provenance = `${zh ? '模型' : 'Model'}: ${details.model}; ${zh ? '生成时间' : 'Generated'}: ${new Date(details.generated_at).toLocaleString(language)}`;
  const reasons = [
    freshness.repositoryChanged ? (zh ? '仓库已有新提交' : 'Repository has new commits') : '',
    freshness.configChanged ? (zh ? 'AI 配置已改变' : 'AI configuration changed') : '',
    freshness.schemaChanged ? (zh ? '分析格式或提示词已改变' : 'Analysis schema or prompt changed') : '',
  ].filter(Boolean);
  const indicator = (label: string, icon: React.ReactNode) => <TooltipProvider delayDuration={200}>
    <Tooltip><TooltipTrigger asChild><span tabIndex={0} role="img" aria-label={label} title={label}
      className="inline-flex h-6 w-6 shrink-0 items-center justify-center text-muted-foreground">{icon}</span></TooltipTrigger>
      <TooltipContent className="max-w-72 break-words">{label}</TooltipContent>
    </Tooltip>
  </TooltipProvider>;
  return <span className="inline-flex shrink-0 items-center">
    {freshness.fallback && indicator(`${zh ? `分析语言：${analysisLanguage}；当前语言：${language}` : `Analysis language: ${analysisLanguage}; current language: ${language}`}; ${provenance}`, <Languages className="h-3.5 w-3.5" />)}
    {reasons.length > 0 && indicator(`${zh ? '已有分析可能过时' : 'Saved analysis may be stale'}: ${reasons.join('; ')}; ${provenance}`, <Clock3 className="h-3.5 w-3.5" />)}
  </span>;
}
