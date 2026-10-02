import type { AssetFilter } from '../types';
import { PRESET_FILTERS } from '../constants/presetFilters';
import { normalizeRepoKey } from './releaseSources';

/**
 * 关键词条目的去重键：trim 后小写（关键词匹配本身大小写不敏感，
 * "Mac" 与 "mac" 视为同一条，保留首个的书写形式）。
 */
const keywordKey = (value: string): string => value.trim().toLowerCase();

/**
 * 净化字符串数组：过滤非字符串元素、trim、剔除空/纯空白项、按 key 去重（保留首个）。
 * 空字符串关键词必须剔除——`includes("")` 恒为 true，`keywords: [""]` 会变相
 * 匹配所有 Release，击穿"畸形全空 filter 不意外匹配"的防御。
 */
const sanitizeStringArray = (value: unknown, key: (item: string) => string): string[] | undefined => {
  if (!Array.isArray(value)) return undefined;

  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const trimmed = item.trim();
    if (!trimmed) continue;
    const dedupeKey = key(trimmed);
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    result.push(trimmed);
  }
  return result;
};

/**
 * 规范化外部（本地持久化 / 后端同步 / 备份导入）传入的资产过滤器：
 * - 丢弃缺少必填字段（非空 id、name、keywords 数组）的畸形条目，保证下游
 *   ReleaseTimeline 的关键词匹配读取 keywords 不会抛错；
 * - keywords / excludeKeywords / includeRepos / alwaysExcludeRepos 统一净化：
 *   过滤非字符串元素、trim、剔除空/纯空白项、去重（仓库按 normalizeRepoKey
 *   不区分大小写去重，关键词按 trim 后小写去重，均保留首个的展示文本）；
 * - 按 AssetFilter 的已知字段重建条目，顺带丢弃未知键——包括 #405 曾短暂
 *   引入、已被 includeRepos 取代的反向语义字段 `excludeRepos`，避免废弃
 *   数据随设置同步无限往返，也防止旧字段被重新解释为 `alwaysExcludeRepos` 语义。
 */
export const normalizeAssetFilters = (filters: unknown): AssetFilter[] => {
  if (!Array.isArray(filters)) return [];

  return filters
    .filter((filter): filter is Record<string, unknown> => !!filter && typeof filter === 'object')
    .map(filter => {
      if (
        typeof filter.id !== 'string' || filter.id.length === 0 ||
        typeof filter.name !== 'string' ||
        !Array.isArray(filter.keywords)
      ) {
        return null;
      }

      const keywords = sanitizeStringArray(filter.keywords, keywordKey);
      if (!keywords) return null;

      const normalized: AssetFilter = {
        id: filter.id,
        name: filter.name,
        keywords,
      };

      const excludeKeywords = sanitizeStringArray(filter.excludeKeywords, keywordKey);
      if (excludeKeywords) normalized.excludeKeywords = excludeKeywords;
      const includeRepos = sanitizeStringArray(filter.includeRepos, normalizeRepoKey);
      if (includeRepos) normalized.includeRepos = includeRepos;
      const alwaysExcludeRepos = sanitizeStringArray(filter.alwaysExcludeRepos, normalizeRepoKey);
      if (alwaysExcludeRepos) normalized.alwaysExcludeRepos = alwaysExcludeRepos;
      if (typeof filter.isPreset === 'boolean') normalized.isPreset = filter.isPreset;
      if (typeof filter.icon === 'string') normalized.icon = filter.icon;

      return normalized;
    })
    .filter((filter): filter is AssetFilter => filter !== null);
};

/** Strip automatic source archive suffixes only for matching; explicit source rules still work. */
export const normalizeMatchedLinkName = (lowerName: string, isSourceCode: boolean): string =>
  isSourceCode ? lowerName.replace(/\.(?:zip|tar\.gz)(?=\)$)/, '') : lowerName;

export interface AssetFilterEvaluation {
  matchesRelease: boolean;
  /** Indices address the complete download list, including body and source links. */
  matchedLinkIndexes: Set<number>;
}

/** Exclude before include; negative-only keyword rules require a surviving real asset.
 * Only matching filters contribute indices into the complete normalized link list. */
export const evaluateAssetFilter = (
  filter: Pick<AssetFilter, 'keywords'> & Partial<AssetFilter>,
  lowerRepoKey: string,
  lowerAllLinkNames: readonly string[],
  lowerRealAssetNames: readonly string[],
): AssetFilterEvaluation => {
  const none = { matchesRelease: false, matchedLinkIndexes: new Set<number>() };
  const all = () => ({ matchesRelease: true, matchedLinkIndexes: new Set(lowerAllLinkNames.map((_, index) => index)) });
  if ((filter.alwaysExcludeRepos ?? []).some(name => normalizeRepoKey(name) === lowerRepoKey)) {
    return none;
  }
  if ((filter.includeRepos ?? []).some(name => normalizeRepoKey(name) === lowerRepoKey)) {
    return all();
  }

  // 防御未经过 normalizeAssetFilters 的数据：空字符串关键词经 includes("") 恒为
  // true，会让包含词击穿匹配、排除词隐藏全部 Release，这里先剔除。
  const keywords = (filter.keywords ?? []).map(keyword => keyword.trim().toLowerCase()).filter(Boolean);
  const excludeKeywords = (filter.excludeKeywords ?? []).map(keyword => keyword.trim().toLowerCase()).filter(Boolean);
  const hasKeywords = keywords.length > 0;
  const hasExcludeKeywords = excludeKeywords.length > 0;

  if (hasKeywords || hasExcludeKeywords) {
    const matchScope = hasKeywords ? lowerAllLinkNames : lowerRealAssetNames;
    const hits = (name: string) => (!hasKeywords || keywords.some(keyword => name.includes(keyword)))
      && !excludeKeywords.some(keyword => name.includes(keyword));
    if (!matchScope.some(hits)) return none;
    return { matchesRelease: true, matchedLinkIndexes: new Set(lowerAllLinkNames.flatMap((name, index) => hits(name) ? [index] : [])) };
  }

  if (!hasKeywords && !hasExcludeKeywords) {
    // 仓库白名单（includeRepos）存在时不命中其之外的仓库；仅排除列表是有意
    // 支持的负向仓库过滤器：除排除仓库外的仓库均命中（第 2 节规则 7）
    if ((filter.includeRepos ?? []).length === 0 && (filter.alwaysExcludeRepos ?? []).length > 0) {
      return all();
    }
  }

  return none;
};

/** Compatibility for consumers that only need Release visibility. */
export const filterMatchesRelease = (
  filter: Pick<AssetFilter, 'keywords'> & Partial<AssetFilter>,
  lowerRepoKey: string,
  lowerAllLinkNames: string[],
  lowerRealAssetNames: string[],
): boolean => evaluateAssetFilter(filter, lowerRepoKey, lowerAllLinkNames, lowerRealAssetNames).matchesRelease;

export function evaluateReleaseFilters(
  selectedIds: readonly string[],
  filters: readonly AssetFilter[],
  repoName: string,
  links: readonly { name: string; isSourceCode?: boolean }[],
  realAssets: readonly { name: string }[],
): AssetFilterEvaluation {
  if (selectedIds.length === 0) {
    return { matchesRelease: true, matchedLinkIndexes: new Set(links.map((_, index) => index)) };
  }
  const names = links.map(link => normalizeMatchedLinkName(link.name.toLowerCase(), Boolean(link.isSourceCode)));
  const assetNames = realAssets.map(asset => asset.name.toLowerCase());
  const result: AssetFilterEvaluation = { matchesRelease: false, matchedLinkIndexes: new Set() };
  for (const id of selectedIds) {
    const filter = filters.find(item => item.id === id) ?? PRESET_FILTERS.find(item => item.id === id);
    if (!filter) continue;
    const evaluation = evaluateAssetFilter(filter, normalizeRepoKey(repoName), names, assetNames);
    result.matchesRelease ||= evaluation.matchesRelease;
    evaluation.matchedLinkIndexes.forEach(index => result.matchedLinkIndexes.add(index));
  }
  return result;
}
