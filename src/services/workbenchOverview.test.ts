import { describe, expect, it, vi } from 'vitest';
import type { Repository } from '../types';
import type { WorkbenchCandidate } from '../types/aiWorkbench';
import { mergeWorkbenchCandidates, sameWorkbenchRequirements, summarizeWorkbenchCandidates, workbenchOverviewMarkdown } from './workbenchOverview';

const requirements = { purpose: 'Research tools', required: [], preferred: [], excluded: [], questions: [], queries: ['research'] };
const candidate = (index: number): WorkbenchCandidate => ({
  repository: { id: index, name: `notes-${index}`, full_name: `public/notes-${index}`, description: 'A local Markdown editor for reading research notes. Cloud sync is not available.',
    ai_summary: undefined, topics: ['markdown'], language: 'TypeScript', custom_category: 'Manual category' } as Repository,
  summary: 'Existing description', reasons: [], limitations: [], sources: [`https://github.com/public/notes-${index}`], status: 'candidate',
});
const generated = (input: { user: string }) => {
  const { projects } = JSON.parse(input.user) as { projects: { name: string }[] };
  return JSON.stringify({ summary: 'Local research notes tools.', items: projects.map(project => ({ name: project.name,
    summary: 'Local Markdown editor for research notes; no cloud sync.', category: 'Research notes', categoryDescription: 'Reading and organizing notes', kind: 'tool', insufficient: false })) });
};

describe('workbench overview', () => {
  it('covers all 120 projects in bounded batches without deep retrieval or modifying repository categories', async () => {
    let active = 0, peak = 0;
    const generateChatText = vi.fn(async (input: { user: string }) => {
      active++; peak = Math.max(active, peak);
      await new Promise(resolve => setTimeout(resolve, 1));
      active--; return generated(input);
    });
    const readReadme = vi.fn();
    const updates: WorkbenchCandidate[][] = [];
    const result = await summarizeWorkbenchCandidates({ candidates: Array.from({ length: 120 }, (_, i) => candidate(i)), requirements,
      language: 'en', ai: { generateChatText }, concurrency: 5, readReadme, onUpdate: items => { updates.push(items); } });
    expect(generateChatText).toHaveBeenCalledTimes(15);
    expect(peak).toBe(5);
    expect(readReadme).not.toHaveBeenCalled();
    expect(result.every(item => item.overview?.status === 'ready')).toBe(true);
    expect(result.every(item => item.repository.custom_category === 'Manual category')).toBe(true);
    expect(updates[updates.length - 1]?.map(item => item.repository.id)).toEqual(Array.from({ length: 120 }, (_, i) => i));
  });

  it('rejects duplicate or invented project IDs and retries failed items without redoing successful items', async () => {
    const generateChatText = vi.fn().mockResolvedValueOnce(JSON.stringify({ summary: 'Wrong', items: [{
      name: 'invented/project', summary: 'Unknown', category: 'Tools', categoryDescription: '', kind: 'tool', insufficient: false,
    }] })).mockImplementation(generated);
    const initial = await summarizeWorkbenchCandidates({ candidates: [candidate(1)], requirements, language: 'en',
      ai: { generateChatText }, concurrency: 2, onUpdate: vi.fn() });
    expect(initial[0].overview?.status).toBe('failed');
    const ready = candidate(2); ready.overview = { summary: 'Kept', category: 'Research notes', categoryDescription: '', kind: 'tool', status: 'ready', basis: 'metadata' };
    const repaired = await summarizeWorkbenchCandidates({ candidates: [...initial, ready], requirements, language: 'en',
      ai: { generateChatText }, concurrency: 2, onUpdate: vi.fn() });
    expect(JSON.parse(generateChatText.mock.calls[1][0].user).projects).toHaveLength(1);
    expect(repaired[1].overview?.summary).toBe('Kept');
    expect(repaired[0].overview?.status).toBe('ready');
  });

  it('reads only necessary README material and keeps its provenance', async () => {
    const item = candidate(1); item.repository.description = ''; item.summary = 'No repository description; awaiting verification.';
    const readReadme = vi.fn().mockResolvedValue('# Notes\nA local research note editor.');
    const result = await summarizeWorkbenchCandidates({ candidates: [item], requirements, language: 'zh', ai: { generateChatText: vi.fn(async input => generated(input)) },
      concurrency: 1, readReadme, onUpdate: vi.fn() });
    expect(readReadme).toHaveBeenCalledOnce();
    expect(result[0].overview?.basis).toBe('readme');
    expect(result[0].sources).toContain('https://github.com/public/notes-1#readme');
  });

  it('does not emit late results after cancellation', async () => {
    const controller = new AbortController(), onUpdate = vi.fn();
    const generateChatText = vi.fn(async (input: { user: string }) => { controller.abort(); return generated(input); });
    await expect(summarizeWorkbenchCandidates({ candidates: [candidate(1)], requirements, language: 'en',
      ai: { generateChatText }, concurrency: 1, signal: controller.signal, onUpdate })).rejects.toThrow();
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it('merges page overlaps case-insensitively without losing order, provenance or earlier introductions', () => {
    const first = candidate(1); first.overview = { summary: 'Short', category: 'Notes', categoryDescription: '', kind: 'tool', status: 'ready', basis: 'metadata' };
    const overlap = candidate(1); overlap.repository.full_name = 'Public/Notes-1'; overlap.reasons = ['New query'];
    const result = mergeWorkbenchCandidates([first, candidate(2)], [overlap, candidate(3)]);
    expect(result.map(item => item.repository.id)).toEqual([1, 2, 3]);
    expect(result[0].overview?.summary).toBe('Short');
    expect(result[0].reasons).toContain('New query');
    expect(workbenchOverviewMarkdown(result, 'Tools')).toContain('## Notes (1)');
    expect(sameWorkbenchRequirements(requirements, { ...requirements, queries: ['another'] })).toBe(true);
    expect(sameWorkbenchRequirements(requirements, { ...requirements, excluded: ['cloud'] })).toBe(false);
    const changed = candidate(1); changed.repository.description = 'A different product purpose.';
    expect(mergeWorkbenchCandidates([first], [changed])[0].overview).toBeUndefined();
  });
});
