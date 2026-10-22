import { describe, expect, it } from 'vitest';
import type { Repository } from '../types';
import { mergeClassificationLabels, repositoryDetailFacetLabels } from './repositoryClassificationDisplay';

describe('classification display labels', () => {
  it('merges existing tags before facets, normalizes aliases and limits the combined row to three', () => {
    expect(mergeClassificationLabels([' React Native ', 'JS'], ['react-native', 'JavaScript', 'Python', 'Rust']))
      .toEqual(['React Native', 'JS', 'Python']);
    expect(mergeClassificationLabels(['Ｎｏｄｅ.ｊｓ'], ['node js', 'Node', 'MCP']))
      .toEqual(['Ｎｏｄｅ.ｊｓ', 'MCP']);
  });
  it('retains all detail facets, including long saved labels, while excluding stale insights', () => {
    const long = 'A long stored classification facet that should remain available in repository details';
    const repository = {
      category_id: 'purpose', classifications: { technology: { categoryId: 'tech', locked: false } },
      ai_platforms: ['Browser', 'Linux', 'Windows', 'Desktop'],
      classificationInsights: {
        purpose: { categoryId: 'purpose', confidence: 'low', evidence: [], facets: [{ id: 'long', label: long, score: 7, evidence: [] }] },
        technology: { categoryId: 'old-tech', confidence: 'high', evidence: [], facets: [{ id: 'stale', label: 'Stale facet', score: 7, evidence: [] }] },
      },
    } as unknown as Repository;
    const labels = repositoryDetailFacetLabels(repository);
    expect(labels).toHaveLength(5);
    expect(labels).toContain(long);
    expect(labels).not.toContain('Stale facet');
    expect(labels).not.toContain('low');
  });
});
