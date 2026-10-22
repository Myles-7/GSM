import { describe, expect, it } from 'vitest';
import type { Repository } from '../types';
import { classificationFacetOptions, inferFacetGroup, matchesFacetSelection, repositoryFacetLabels, repositoryFacets } from './classificationFacets';
const repository = (id: number, technologies: string[], platforms: string[], confidence?: 'high' | 'low'): Repository => ({ id, ai_details: { technologies, platforms, scenarios: [] }, classificationInsights: confidence ? { purpose: { confidence, evidence: [], facets: [] } } : {} } as unknown as Repository);
describe('classification evidence facets', () => {
  const first = repository(1, ['React', 'TypeScript'], ['web'], 'high');
  const second = repository(2, ['Python'], ['web'], 'low');
  const third = repository(3, ['React'], ['desktop']);
  it('combines alternatives within a dimension and intersects dimensions', () => {
    const selection = { technology: ['technology:react', 'technology:python'], platform: ['platform:web'] };
    expect([first, second, third].filter(repo => matchesFacetSelection(repo, selection)).map(repo => repo.id)).toEqual([1, 2]);
    expect(matchesFacetSelection(first, { ...selection, confidence: ['confidence:low'] })).toBe(false);
    expect(matchesFacetSelection(second, { ...selection, confidence: ['confidence:low'] })).toBe(true);
  });
  it('counts each repository once and corrects known cross-dimension duplicates', () => {
    const repeated = repository(4, ['React', 'react'], ['React']);
    const options = classificationFacetOptions([first, third, repeated]);
    expect(options.find(item => item.id === 'technology:react')?.count).toBe(3);
    expect(options.find(item => item.id === 'platform:react')).toBeUndefined();
  });
  it('does not turn missing AI analysis into low confidence', () => {
    expect(repositoryFacets({ id: 5 } as Repository).filter(item => item.group === 'confidence')).toEqual([]);
    expect(matchesFacetSelection(third, { confidence: ['confidence:low'] })).toBe(false);
  });
  it('does not reuse a confidence result after a manual classification move', () => {
    const moved = { ...first, category_id: 'new', subcategory_id: 'new-child', classificationInsights: { purpose: { categoryId: 'old', subcategoryId: 'old-child', confidence: 'low', evidence: [], facets: [] } } } as Repository;
    expect(repositoryFacets(moved).some(item => item.group === 'confidence')).toBe(false);
  });
  it('uses confidence and stored facets from the requested scheme', () => {
    const repo = { ...first, classificationInsights: { purpose: { confidence: 'high' as const, evidence: [], facets: [] }, technology: { confidence: 'low' as const, evidence: [], facets: [{ id: 'llm', label: 'LLM', group: 'technology' as const, score: 2, evidence: ['LLM API'] }] } } };
    expect(matchesFacetSelection(repo, { confidence: ['confidence:low'], technology: ['technology:llm'] }, 'technology')).toBe(true);
    expect(matchesFacetSelection(repo, { confidence: ['confidence:low'] }, 'purpose')).toBe(false);
  });
  it('keeps confidence out of repository card facet labels', () => {
    expect(repositoryFacetLabels(first)).not.toContain('high');
    expect(repositoryFacets(first).some(item => item.group === 'confidence')).toBe(true);
  });
  it('normalizes legacy platform labels and stored insight facets into concrete dimensions', () => {
    const repo = { ...first, ai_platforms: ['Python', 'MCP', 'Windows', 'React Native', 'macOS'],
      ai_details: { technologies: ['Python', 'ReactNative'], platforms: ['Windows', 'Mac OS X'] },
      classificationInsights: { purpose: { confidence: 'medium', evidence: [], facets: [
        { id: 'old-python-platform', label: 'python3', group: 'platform', score: 1, evidence: [] },
        { id: 'old-mcp-platform', label: 'model context protocol', group: 'platform', score: 1, evidence: [] },
      ] } } } as unknown as Repository;
    const facets = repositoryFacets(repo);
    expect(facets.filter(item => item.group === 'technology').map(item => item.id)).toEqual(expect.arrayContaining(['technology:python', 'technology:mcp', 'technology:reactnative']));
    expect(facets.filter(item => item.group === 'platform').map(item => item.id).sort()).toEqual(['platform:macos', 'platform:windows']);
    expect(facets.filter(item => item.id === 'technology:python')).toHaveLength(1);
    expect(facets.filter(item => item.id === 'technology:reactnative')).toHaveLength(1);
    expect(inferFacetGroup('custom environment', 'platform')).toBe('platform');
    expect(inferFacetGroup('coding agent', 'scenario')).toBe('scenario');
  });

  it('prefers compact tags to scenario sentences and skips labels longer than 55 characters', () => {
    const repo = { id: 9, ai_tags: ['note taking'], ai_details: { scenarios: ['A complete, unique explanation of a workflow that is too long to be a compact filter label.'] } } as unknown as Repository;
    expect(repositoryFacets(repo).filter(item => item.group === 'scenario').map(item => item.label)).toEqual(['note taking']);
    expect(repositoryFacets({ ...repo, ai_tags: [] })).toEqual([]);
    expect(repositoryFacets({ ...repo, ai_details: undefined, ai_tags: ['x'.repeat(56)] })).toEqual([]);
  });

  it.each(['Ollama', 'vLLM', 'Playwright', 'Airflow', 'CSS', 'Pandas', 'llama.cpp', 'NumPy', 'Dagster'])('recognizes %s as technology even in legacy platform evidence', label => {
    expect(inferFacetGroup(label, 'platform')).toBe('technology');
    expect(repositoryFacets({ ai_platforms: [label] } as Repository)[0].group).toBe('technology');
  });

});
