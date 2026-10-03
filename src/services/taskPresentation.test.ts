import { describe, expect, it } from 'vitest';
import { taskElapsed, taskPhaseLabel, taskReport } from './taskPresentation';
import type { AITaskRecord } from './aiTaskJournal';
describe('task report projection', () => {
  it('omits prompt, result bodies, credentials and device targets', () => {
    const task = { id: 'test', owner: 'owner', kind: 'research', state: 'failed', updatedAt: '2026-10-02T08:00:00Z',
      title: 'C:\\private\\project', error: 'token=SECRET', target: { view: 'ai', id: 'C:\\private\\source' },
      config: { model: 'test', provider: 'agy-cli' }, items: [{ id: '1', label: 'repo', state: 'failed', error: 'Bearer PRIVATE' }],
      prompt: 'PROMPT_BODY', response: 'RESPONSE_BODY' } as AITaskRecord;
    for (const format of ['json', 'markdown'] as const) {
      const report = taskReport([task], format, false);
      for (const secret of ['SECRET', 'PRIVATE', 'PROMPT_BODY', 'RESPONSE_BODY', 'private', 'target']) expect(report).not.toContain(secret);
    }
  });
  it('does not infer missing start time and translates known stages', () => {
    expect(taskElapsed({ updatedAt: new Date().toISOString() } as AITaskRecord)).toBe('—');
    expect(taskPhaseLabel('verification', true)).toBe('复核回答');
    expect(taskPhaseLabel('verification', false)).toBe('Reviewing answer');
  });

  it('omits conversation titles and item labels derived from user questions', () => {
    const task: AITaskRecord = { id: 'conversation', owner: 'owner', kind: 'research', state: 'complete',
      updatedAt: new Date().toISOString(), title: 'USER_QUESTION_BODY', items: [{ id: 'session', label: 'USER_QUESTION_BODY', state: 'complete' }] };
    for (const format of ['json', 'markdown'] as const) {
      expect(taskReport([task], format, false)).not.toContain('USER_QUESTION_BODY');
      expect(taskReport([task], format, false)).toContain('Workbench research');
    }
  });
});
