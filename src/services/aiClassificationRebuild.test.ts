import { describe, expect, it } from 'vitest';
import type { Repository } from '../types';
import { buildAIClassification } from './aiClassificationRebuild';
import { classificationSourceFingerprint, refineClassificationGroup } from './classificationEngine';
import { purposeCatalog, technologyCatalog, validateClassificationCatalog } from './classificationCatalog';

const repo = (id: number, patch: Partial<Repository> = {}): Repository => ({
  id, name: `repo-${id}`, full_name: `owner/repo-${id}`, description: null,
  html_url: `https://github.com/owner/repo-${id}`, stargazers_count: 0, forks_count: 0, forks: 0,
  language: null, created_at: '2026-01-01', updated_at: '2026-01-01', pushed_at: '2026-01-01',
  owner: { login: 'owner', avatar_url: '' }, topics: [], ...patch,
});

describe('AI classification rebuild', () => {
  it('keeps purpose and technology projections separate', () => {
    const result = buildAIClassification([
      repo(1, { description: 'A command line developer tool', ai_summary: 'CLI for code workflows', ai_tags: ['developer'], language: 'TypeScript' }),
      repo(2, { description: 'A machine learning model runner', ai_summary: 'Run LLM inference', ai_tags: ['llm'], language: 'Python', ai_platforms: ['PyTorch'] }),
    ], 'zh');
    expect(result.purpose.customCategories.map(category => category.sourceKey)).toContain('developer');
    expect(result.technology.customCategories.map(category => category.sourceKey)).toContain('ml');
    expect(result.assignments['1'].purpose.categoryId).not.toBe(result.assignments['1'].technology.categoryId);
  });

  it('keeps weak evidence in a stable fallback category with low confidence', () => {
    const one = buildAIClassification([repo(1)], 'zh');
    const two = buildAIClassification([repo(1)], 'zh');
    expect(one.purpose.customCategories.map(category => category.id)).toEqual(two.purpose.customCategories.map(category => category.id));
    expect(one.assignments['1'].purpose.categoryId).toContain('other');
    expect(one.insights['1'].purpose.confidence).toBe('low');
  });

  it('keeps purpose independent from language and exposes secondary facets', () => {
    const result = buildAIClassification([repo(4, { language: 'Python', ai_summary: 'A personal note and knowledge base', ai_tags: ['notes', 'knowledge'] })], 'zh');
    expect(result.assignments['4'].purpose.categoryId).toContain('knowledge');
    expect(result.insights['4'].purpose.facets.length).toBeGreaterThanOrEqual(0);
  });

  it('creates finer technical categories for explicit platforms and protocols', () => {
    const result = buildAIClassification([
      repo(5, { ai_summary: 'MCP server with tool calling', ai_platforms: ['MCP'], language: 'TypeScript' }),
      repo(6, { ai_summary: 'React web interface', ai_platforms: ['React'], language: 'TypeScript' }),
    ], 'zh');
    expect(result.technology.customCategories.map(category => category.sourceKey)).toEqual(expect.arrayContaining(['protocol', 'web']));
    expect(result.assignments['5'].technology.subcategoryId).toContain('mcp');
    expect(new Set(result.technology.customCategories.map(category => category.id)).size).toBe(result.technology.customCategories.length);
    expect(new Set(result.technology.subcategories.map(category => category.id)).size).toBe(result.technology.subcategories.length);
  });

  it('is deterministic for the same repository input', () => {
    const input = [repo(3, { ai_summary: 'Web application with API', topics: ['react', 'api'], language: 'TypeScript' })];
    const first = buildAIClassification(input, 'en');
    const second = buildAIClassification(input, 'en');
    expect(first.purpose.customCategories.map(category => ({ id: category.id, name: category.name, keywords: category.keywords })))
      .toEqual(second.purpose.customCategories.map(category => ({ id: category.id, name: category.name, keywords: category.keywords })));
    expect(first.technology.subcategories).toEqual(second.technology.subcategories);
  });

  it('builds a large local library without losing stable identities', () => {
    const input = Array.from({ length: 1000 }, (_, index) => repo(index + 10, {
      ai_summary: index % 2 ? 'React web application' : 'Python data analysis tool',
      ai_tags: index % 2 ? ['frontend'] : ['analytics'],
      language: index % 2 ? 'TypeScript' : 'Python',
    }));
    const result = buildAIClassification(input, 'zh');
    expect(Object.keys(result.assignments)).toHaveLength(1000);
    expect(result.purpose.customCategories.every(category => !category.icon.includes('folder'))).toBe(true);
  });

  it('splits 60 mixed agents into evidence-based sibling groups', () => {
    const uses = ['coding agent for software engineering', 'browser agent for browser automation', 'multi-agent collaboration'];
    const input = Array.from({ length: 60 }, (_, i) => repo(i + 100, { ai_summary: uses[Math.floor(i / 20)] }));
    const result = buildAIClassification(input, 'zh');
    const counts = new Map<string, number>();
    for (const member of Object.values(result.assignments)) counts.set(member.purpose.subcategoryId!, (counts.get(member.purpose.subcategoryId!) ?? 0) + 1);
    expect([...counts]).toEqual(expect.arrayContaining([
      ['ai-purpose-ai-agent-coding', 20], ['ai-purpose-ai-agent-browser', 20], ['ai-purpose-ai-agent-multi', 20],
    ]));
    expect(counts.size).toBe(3);
    expect(Object.values(result.insights).every(row => row.purpose.evidence.some(value => value.includes('ai_summary:')))).toBe(true);
  });

  it('never partitions 60 identical projects just to satisfy the target', () => {
    const input = Array.from({ length: 60 }, (_, i) => repo(i + 200, { ai_summary: 'Agent orchestration framework' }));
    const result = buildAIClassification(input, 'zh');
    expect(new Set(Object.values(result.assignments).map(row => row.purpose.subcategoryId)).size).toBe(1);
    expect(result.insights['200'].purpose.refinementReason).toContain('相近');
  });

  it('requires two groups of four and 60 percent coverage before splitting', () => {
    const input = Array.from({ length: 40 }, (_, i) => repo(i + 300, { ai_summary: i < 4 ? 'coding agent' : i < 8 ? 'browser agent' : 'agent platform' }));
    const result = buildAIClassification(input, 'zh');
    expect(new Set(Object.values(result.assignments).map(row => row.purpose.subcategoryId)).size).toBe(1);
    expect(result.insights['300'].purpose.refinementReason).toContain('60%');
  });

  it('uses an explicit general subgroup for unmatched leaf evidence', () => {
    const result = buildAIClassification([repo(400, { ai_summary: '大模型人工智能平台' }), repo(401)], 'zh');
    expect(result.assignments['400'].purpose.subcategoryId).toBe('ai-purpose-ai-general');
    expect(result.insights['400'].purpose.confidence).toBe('low');
    expect(result.assignments['401'].purpose.subcategoryId).toBe('ai-purpose-other-general');
    expect(result.insights['401'].purpose.evidence).toEqual([]);
  });

  it('lets concrete technical evidence outrank platform and language fallback', () => {
    const result = buildAIClassification([
      repo(410, { ai_platforms: ['Electron', 'Windows', 'macOS', 'Linux'], language: 'TypeScript' }),
      repo(411, { ai_platforms: ['Tauri', 'Windows', 'macOS'], language: 'Rust' }),
      repo(412, { ai_platforms: ['FastAPI', 'Windows'], language: 'Python' }),
      repo(413, { ai_platforms: ['React Native'], language: 'TypeScript' }),
    ], 'zh');
    expect(result.assignments['410'].technology.subcategoryId).toBe('ai-technology-desktop-electron');
    expect(result.assignments['411'].technology.subcategoryId).toBe('ai-technology-desktop-tauri');
    expect(result.assignments['412'].technology.subcategoryId).toBe('ai-technology-backend-python');
    expect(result.assignments['413'].technology.subcategoryId).toBe('ai-technology-mobile-react-native');
  });

  it('does not infer from a project name or treat deployment platforms as purpose', () => {
    const result = buildAIClassification([repo(420, { name: 'coding-agent', full_name: 'ai/coding-agent', language: 'Python', ai_platforms: ['Windows', 'Linux'] })], 'zh');
    expect(result.assignments['420'].purpose.categoryId).toBe('ai-purpose-other');
    expect(result.insights['420'].purpose.confidence).toBe('low');
  });

  it('does not infer the Go runtime from English prose', () => {
    const result = buildAIClassification([repo(421, { ai_summary: 'Go to your dashboard and organize everything' }), repo(422, { language: 'Go' })], 'en');
    expect(result.assignments['421'].technology.categoryId).not.toBe('ai-technology-runtime');
    expect(result.assignments['422'].technology.subcategoryId).toBe('ai-technology-runtime-go');
  });

  it('keeps fingerprints independent of timestamps, array order and duplicate evidence', () => {
    const first = repo(430, { ai_tags: ['agent', 'RAG', 'agent'], analyzed_at: 'old', topics: ['mcp', 'cli'] });
    const second = { ...first, ai_tags: ['rag', 'agent'], analyzed_at: 'new', topics: ['cli', 'mcp'] };
    expect(classificationSourceFingerprint([first])).toBe(classificationSourceFingerprint([second]));
    expect(classificationSourceFingerprint([first])).not.toBe(classificationSourceFingerprint([{ ...first, description: 'New use case' }]));
    expect(classificationSourceFingerprint([first])).not.toContain('agent');
  });

  it('rejects duplicate taxonomy rules and retains exactly one membership in each dimension', () => {
    expect(() => validateClassificationCatalog([...purposeCatalog, purposeCatalog[0]])).toThrow('Duplicate');
    expect(() => validateClassificationCatalog(technologyCatalog)).not.toThrow();
    const result = buildAIClassification([repo(440, { ai_summary: 'Agent with CLI and RAG', topics: ['react', 'mcp'] })], 'zh');
    for (const scheme of ['purpose', 'technology'] as const) {
      const member = result.assignments['440'][scheme];
      expect(result[scheme].subcategories.some(group => group.id === member.subcategoryId && group.parentId === member.categoryId)).toBe(true);
      expect(result.insights['440'][scheme].facets.length).toBeLessThanOrEqual(6);
      expect(result.insights['440'][scheme].facets.every(facet => facet.evidence.length > 0)).toBe(true);
    }
  });

  it('refines only requested existing members without changing saved insight objects', () => {
    const input = Array.from({ length: 40 }, (_, i) => repo(i + 500, { ai_summary: i < 20 ? 'coding agent' : 'browser agent',
      classificationInsights: { purpose: { confidence: 'medium', evidence: ['original'], facets: [] } } }));
    const before = JSON.stringify(input);
    const result = refineClassificationGroup(input, 'purpose', { id: 'ai-purpose-ai-agent', parentId: 'ai-purpose-ai', name: '智能体', icon: '🤖' }, 'zh');
    expect(result.changed).toBe(true);
    expect(result.groups).toHaveLength(2);
    expect(JSON.stringify(input)).toBe(before);
    const again = refineClassificationGroup(input, 'purpose', result.groups[0], 'zh');
    expect(again.changed).toBe(false);
  });
});
