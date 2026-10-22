import { describe, expect, it } from 'vitest';
import { parseExplorationProfiles, repositoryExplorationSources, explorationCandidates } from './explorationAI';
import { accountFixture, repositoryFixture } from '../features/repositories/exploration/testFixtures';
import type { ExplorationEvidence } from '../features/repositories/exploration/types';

const repo = repositoryFixture(1);
function parse(quote: string, content: string, kind: ExplorationEvidence['kind'] = 'readme', target = 'Codex') {
  const sources: ExplorationEvidence[] = [{ id: 'source', kind, label: 'source', text: content, verified: kind === 'readme', retrievedAt: 'now', url: repo.html_url }];
  return parseExplorationProfiles(JSON.stringify({ projects: [{ repositoryId: 1, summary: '编程能力', topics: [{ label: '编程智能体', citations: [{ sourceId: 'source', quote }] }], entities: [{ label: target, aliases: [], description: '工具生态' }], relations: [{ targetType: 'entity', target, kind: 'interoperable', branch: '工作流集成', reason: '提供集成', citations: [{ sourceId: 'source', quote }] }] }] }), [repo], new Map([[1, sources]]), new Set([1]))[0];
}
describe('AI exploration evidence boundaries', () => {
  it('recalls detailed Codex features for AI without expanding broad resource directories',()=>{
    const repos=[repositoryFixture(1),repositoryFixture(2,{stargazers_count:999999})];
    repos[0].ai_details={version:1,generated_at:'now',repository_pushed_at:null,model:'test',sources:[],problem:null,features:['支持 Codex CLI 配置管理'],scenarios:[],architecture:null,quickstart:[],deployment:null,cost:null,maintenance:null};
    const account=accountFixture(repos);Object.values(account.index!.profiles).forEach(profile=>{profile.topics=[{id:'resources',label:'学习资源'}];});
    expect(explorationCandidates(repos,'Codex',account.index!.profiles).map(repo=>repo.id)).toEqual([1]);
  });
  it('parses compact assignments, reuses the saved summary, and derives evidence locally without inventing relations', () => {
    const source: ExplorationEvidence = { id: 'analysis', kind: 'analysis', label: '已有分析', text: 'Coding agent workflow automation', retrievedAt: 'now', verified: false };
    const result = parseExplorationProfiles('{"assignments":[[1,[["代码智能体工作流自动化","analysis"]]]]}', [repo], new Map([[1, [source]]]), new Set([1]))[0];
    expect(result.summary).toBe(repo.ai_summary); expect(result.topics[0].evidenceIds).toEqual([result.evidence[0].id]);
    expect(result.evidence[0].text).toBe(source.text); expect(result.evidence[0].verified).toBe(false); expect(result.relations).toHaveLength(0);
    const unsupported = parseExplorationProfiles('{"assignments":[[1,[["不存在的能力","missing"]]]]}', [repo], new Map([[1, [source]]]), new Set([1]))[0];
    expect(unsupported.status).toBe('insufficient'); expect(unsupported.topics).toHaveLength(0);
    expect(() => parseExplorationProfiles('{"assignments":[[2,[]]]}', [repo], new Map(), new Set([1]))).toThrow('完整返回');
  });
  it('supplies existing capability, platform and deployment analysis without treating it as verified', () => {
    const sources = repositoryExplorationSources(repositoryFixture(1, { ai_platforms: ['Desktop'], ai_details: { version: 1, generated_at: '2026-10-19', repository_pushed_at: null, model: 'test', sources: [], problem: null, features: [], scenarios: [], architecture: null, quickstart: [], cost: null, maintenance: null,
      summary: '本地知识库', tags: ['RAG'], software_forms: ['desktop'], deployment_modes: ['local'], deployment: 'Docker', technologies: ['Tauri'] } }));
    const analysis = sources.find(row => row.kind === 'analysis')!;
    expect(analysis.text).toContain('Tauri'); expect(analysis.text).toContain('Desktop'); expect(analysis.text).toContain('Docker'); expect(analysis.text).toContain('RAG'); expect(analysis.verified).toBe(false);
  });
  it('accepts supplied literal support quotes and derives URLs from supplied sources', () => {
    const result = parse('Supports Codex integration.', 'Supports Codex integration.');
    expect(result.relations[0]).toMatchObject({ kind: 'interoperable', verified: true }); expect(result.evidence[0].url).toBe(repo.html_url);
    expect(result.topics[0].evidenceIds).toEqual([result.evidence[0].id]);
  });
  it('downgrades existing AI summaries and negative or generic README mentions', () => {
    expect(parse('Supports Codex integration.', 'Supports Codex integration.', 'analysis').relations[0]).toMatchObject({ kind: 'discovery', verified: false });
    expect(parse('Does not support Codex.', 'Does not support Codex.').relations[0].verified).toBe(false);
    expect(parse('Cannot support Codex integration.', 'Cannot support Codex integration.').relations[0].verified).toBe(false);
    expect(parse("This tool can't support Codex.", "This tool can't support Codex.").relations[0].verified).toBe(false);
    expect(parse('Codex and many other tools.', 'Codex and many other tools.').relations[0].verified).toBe(false);
  });
  it('drops invented quotations and never infers facts from names alone', () => {
    const result = parse('Supports Codex.', 'A Python library.');
    expect(result.topics).toHaveLength(0); expect(result.relations).toHaveLength(0); expect(result.status).toBe('insufficient');
  });
  it('rejects incomplete batches and unknown project identities atomically', () => {
    expect(() => parseExplorationProfiles('{"projects":[]}', [repo], new Map(), new Set([1]))).toThrow('完整返回');
  });
  it('verifies cross-batch repository links only against the supplied repository catalog', () => {
    const other = repositoryFixture(2), quote = 'Supports owner/project-2 integration.';
    const sources: ExplorationEvidence[] = [{ id: 'readme', kind: 'readme', label: 'README', text: quote, verified: true, retrievedAt: 'now' }];
    const text = JSON.stringify({ projects: [{ repositoryId: 1, summary: '集成工具', topics: [], entities: [], relations: [{ targetType: 'repository', target: '2', kind: 'interoperable', branch: '工作流集成', reason: '明确集成', citations: [{ sourceId: 'readme', quote }] }] }] });
    const sourceMap = new Map([[1, sources]]), live = new Set([1, 2]);
    expect(parseExplorationProfiles(text, [repo], sourceMap, live)[0].relations).toHaveLength(0);
    expect(parseExplorationProfiles(text, [repo], sourceMap, live, [repo, other])[0].relations[0]).toMatchObject({ verified: true, targetId: '2' });
  });
});
