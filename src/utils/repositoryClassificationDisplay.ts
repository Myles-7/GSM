import type { Repository } from '../types';
import { normalizeClassificationLabel, repositoryClassificationInsight, repositoryFacets } from './classificationFacets';

/** Keep the existing tag priority while sharing the same alias rules as filters. */
export function mergeClassificationLabels(tags: readonly string[], facets: readonly string[], limit = 3): string[] {
  const labels: string[] = [];
  const seen = new Set<string>();
  for (const value of [...tags, ...facets]) {
    const label = value.trim();
    const key = normalizeClassificationLabel(label);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    labels.push(label);
    if (labels.length >= limit) break;
  }
  return labels;
}

/** Details retain every saved facet, including long labels omitted from filters. */
export function repositoryDetailFacetLabels(repository: Repository): string[] {
  const details = repository.ai_details;
  return mergeClassificationLabels([], [
    ...repositoryFacets(repository).filter(facet => facet.group !== 'confidence').map(facet => facet.label),
    ...repositoryFacets(repository, 'technology').filter(facet => facet.group !== 'confidence').map(facet => facet.label),
    ...(details?.technologies ?? []), ...(details?.platforms ?? []), ...(repository.ai_platforms ?? []),
    ...(details?.software_forms ?? []), ...(details?.deployment_modes ?? []),
    ...(['purpose', 'technology'] as const).flatMap(scheme => repositoryClassificationInsight(repository, scheme)?.facets.map(facet => facet.label) ?? []),
  ], Infinity);
}
