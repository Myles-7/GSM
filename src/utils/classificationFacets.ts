import type { Repository } from '../types';
import type { ClassificationSchemeId } from '../types/classification';
import { classificationPurposeMembership } from '../store/helpers/classificationSchemes';

export type FacetGroup = 'technology' | 'platform' | 'scenario' | 'confidence';
export interface RepositoryFacet { id: string; label: string; group: FacetGroup }
export type FacetSelection = Partial<Record<FacetGroup, string[]>>;
export const FACET_GROUPS: FacetGroup[] = ['technology', 'platform', 'scenario', 'confidence'];
type EvidenceFacetGroup = Exclude<FacetGroup, 'confidence'>;
const aliases: Record<string, string> = {
  'react native': 'reactnative', 'react-native': 'reactnative', reactnative: 'reactnative',
  'next.js': 'nextjs', 'next js': 'nextjs', 'node.js': 'nodejs', 'node js': 'nodejs', node: 'nodejs',
  js: 'javascript', ts: 'typescript', python3: 'python', 'python 3': 'python', py: 'python',
  'c sharp': 'c#', 'c-sharp': 'c#', csharp: 'c#', 'c plus plus': 'c++',
  'model context protocol': 'mcp', 'mac os': 'macos', 'mac os x': 'macos', osx: 'macos', 'os x': 'macos', darwin: 'macos',
  windows: 'windows', win: 'windows', 'win32': 'windows', '桌面': 'desktop', '桌面应用': 'desktop',
  '网页': 'web', 'web app': 'web', webapp: 'web', 'command line': 'cli', 'command-line': 'cli', '命令行': 'cli',
  '软件库': 'library', '插件': 'plugin', '模型': 'model', 'self hosted': 'self-hosted', '自托管': 'self-hosted',
};
const normalize = (value: string) => { const key = value.normalize('NFKC').trim().toLocaleLowerCase().replace(/\s+/g, ' '); return aliases[key] ?? key; };
export const normalizeClassificationLabel = normalize;
const technologyLabels = new Set(['python', 'javascript', 'typescript', 'rust', 'go', 'golang', 'java', 'kotlin', 'swift', 'dart', 'ruby', 'php', 'c', 'c++', 'c#', '.net', 'dotnet', 'react', 'reactnative', 'nextjs', 'vue', 'nuxt', 'svelte', 'angular', 'solidjs', 'astro', 'nodejs', 'electron', 'tauri', 'qt', 'pyqt', 'pyside', 'gtk', 'wpf', 'winui', 'swiftui', 'uikit', 'flutter', 'fastapi', 'django', 'flask', 'express', 'nestjs', 'fastify', 'hono', 'spring', 'pytorch', 'tensorflow', 'onnx', 'langchain', 'langgraph', 'autogen', 'crewai', 'mcp', 'rest', 'graphql', 'grpc', 'oauth', 'openid', 'saml', 'jwt', 'websocket', 'http', 'https', 'docker', 'kubernetes', 'postgresql', 'mysql', 'sqlite', 'redis', 'mongodb', 'ollama', 'vllm', 'llama.cpp', 'triton', 'llamaindex', 'haystack', 'litellm', 'transformers', 'hugging face', 'scikit-learn', 'xgboost', 'pandas', 'numpy', 'scipy', 'polars', 'matplotlib', 'plotly', 'jupyter', 'playwright', 'puppeteer', 'selenium', 'vitest', 'jest', 'pytest', 'eslint', 'airflow', 'dagster', 'prefect', 'kafka', 'flink', 'spark', 'scrapy', 'css', 'html', 'tailwind', 'tailwindcss', 'sass', 'less', 'vite', 'webpack', 'esbuild', 'cmake', 'terraform', 'ansible', 'pulumi', 'prometheus', 'grafana', 'opentelemetry', 'elasticsearch', 'opensearch', 'meilisearch', 'qdrant', 'milvus', 'chroma', 'weaviate', 'ffmpeg', 'opencv', 'pillow', 'three.js', 'webgl', 'webgpu']);
const platformLabels = new Set(['windows', 'macos', 'linux', 'ubuntu', 'debian', 'android', 'ios', 'ipados', 'desktop', 'web', 'browser', 'cli', 'library', 'plugin', 'model', 'agent', 'local', 'self-hosted', 'managed', 'container', 'server', 'cloud', 'cross-platform', '跨平台', '移动端', 'mobile']);
/** Correct mixed legacy ai_platforms values using concrete, recognized labels only. */
export function inferFacetGroup(label: string, defaultGroup: EvidenceFacetGroup = 'scenario'): EvidenceFacetGroup {
  const key = normalize(label);
  if (technologyLabels.has(key)) return 'technology';
  if (platformLabels.has(key)) return 'platform';
  return defaultGroup;
}
const facet = (requestedGroup: FacetGroup, label: string): RepositoryFacet => {
  const group = requestedGroup === 'confidence' ? requestedGroup : inferFacetGroup(label, requestedGroup);
  return { group, label: label.trim(), id: `${group}:${normalize(label)}` };
};

export function repositoryClassificationInsight(repository: Repository, scheme: ClassificationSchemeId) {
  const saved = repository.classificationInsights?.[scheme];
  const member = scheme === 'purpose' ? classificationPurposeMembership(repository) : repository.classifications?.technology;
  return saved && (saved.categoryId === undefined || saved.categoryId === member?.categoryId)
    && (saved.subcategoryId === undefined || saved.subcategoryId === member?.subcategoryId) ? saved : undefined;
}
/** Project persisted analysis evidence; absence of analysis never implies low confidence. */
export function repositoryFacets(repository: Repository, scheme: ClassificationSchemeId = 'purpose'): RepositoryFacet[] {
  const details = repository.ai_details;
  const insight = repositoryClassificationInsight(repository, scheme);
  const scenarioTags = details?.tags?.length ? details.tags : repository.ai_tags ?? [];
  const hasSavedScenarios = insight?.facets?.some(item => item.group === 'scenario');
  const scenarioValues = scenarioTags.length ? scenarioTags : hasSavedScenarios ? [] : details?.scenarios ?? [];
  const values: RepositoryFacet[] = [
    ...(details?.technologies ?? []).map(label => facet('technology', label)),
    ...(details?.platforms ?? []).map(label => facet('platform', label)),
    ...(repository.ai_platforms ?? []).map(label => facet('platform', label)),
    ...scenarioValues.map(label => facet('scenario', label)),
    ...(details?.software_forms ?? []).map(label => facet('platform', label)),
    ...(details?.deployment_modes ?? []).map(label => facet('platform', label)),
    ...(insight?.facets ?? []).map(item => facet(item.group ?? (scheme === 'technology' ? 'technology' : 'scenario'), item.label)),
    ...(insight?.confidence ? [facet('confidence', insight.confidence)] : []),
  ];
  return [...new Map(values.filter(item => item.label && item.label.length <= 55).map(item => [item.id, item])).values()];
}

export function repositoryFacetLabels(repository: Repository): string[] {
  return [...new Set(repositoryFacets(repository).filter(item => item.group !== 'confidence').map(item => item.label))];
}
export function repositoryFacetMatches(repository: Repository, label: string): boolean {
  return repositoryFacets(repository).some(item => normalize(item.label) === normalize(label));
}
/** OR within a dimension, AND between dimensions. */
export function matchesFacetSelection(repository: Repository, selection: FacetSelection, scheme: ClassificationSchemeId = 'purpose'): boolean {
  const ids = new Set(repositoryFacets(repository, scheme).map(item => item.id));
  return FACET_GROUPS.every(group => !selection[group]?.length || selection[group]!.some(id => ids.has(id)));
}
export function classificationFacetOptions(repositories: Repository[], scheme: ClassificationSchemeId = 'purpose'): (RepositoryFacet & { count: number })[] {
  const options = new Map<string, RepositoryFacet & { count: number }>();
  for (const repository of repositories) for (const item of repositoryFacets(repository, scheme)) {
    const previous = options.get(item.id);
    options.set(item.id, { ...item, count: (previous?.count ?? 0) + 1 });
  }
  return [...options.values()].sort((a, b) => FACET_GROUPS.indexOf(a.group) - FACET_GROUPS.indexOf(b.group) || b.count - a.count || a.label.localeCompare(b.label));
}
