import { describe, expect, it } from 'vitest';
import type { Repository } from '../types';
import { beginRepositoryAnalysisWrite } from './repositoryAnalysisWrites';

describe('concurrent repository analysis writes', () => {
  it('preserves newer shared fields but permits the earlier detail result to commit its own field', () => {
    const repo = { id: 19, ai_summary: 'old', custom_description: 'user edit' } as Repository;
    const detail = beginRepositoryAnalysisWrite(1, 19, true);
    const summary = beginRepositoryAnalysisWrite(1, 19);
    const latest = summary(repo, { ...repo, ai_summary: 'new summary' });
    const result = detail(latest, { ...repo, ai_summary: 'stale detail summary', ai_details: { version: 1 } } as Repository);
    expect(result.ai_summary).toBe('new summary');
    expect(result.ai_details).toEqual({ version: 1 });
    expect(result.custom_description).toBe('user edit');
  });
  it('prevents older summaries replacing newer details and separates accounts', () => {
    const repo = { id: 20, ai_summary: 'old' } as Repository;
    const first = beginRepositoryAnalysisWrite(1, 20);
    const second = beginRepositoryAnalysisWrite(1, 20, true);
    beginRepositoryAnalysisWrite(2, 20);
    const latest = second(repo, { ...repo, ai_summary: 'new detail' });
    expect(first(latest, { ...repo, ai_summary: 'late summary' }).ai_summary).toBe('new detail');
  });
});
