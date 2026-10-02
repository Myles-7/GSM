import { beforeEach, describe, expect, it } from 'vitest';
import { canReuseResearch, loadResearchCheckpoint, saveResearchCheckpoint, type ResearchCheckpointEntry } from './workbenchResearchCheckpoint';

const entry = (): ResearchCheckpointEntry => ({ repository: 'owner/repo', version: 'sha1', savedAt: Date.now(),
  result: { content: 'Supported answer', evidences: [{ id: 'e', source: 'github', repoFullName: 'owner/repo',
    path: 'README.md', refSha: 'sha1', excerpt: 'Evidence', retrievedAt: '', url: 'https://github.com/owner/repo/blob/sha1/README.md' }] } });
beforeEach(() => localStorage.clear());
describe('research checkpoint versions', () => {
  it('reuses only exact versions with pinned file evidence', () => {
    expect(canReuseResearch(entry(), 'sha1')).toBe(true);
    expect(canReuseResearch(entry(), 'sha2')).toBe(false);
    const record = entry();
    record.result.evidences[0].path = 'release-v1.md';
    expect(canReuseResearch(record, 'sha1')).toBe(false);
    record.result.evidences[0].source = 'local';
    expect(canReuseResearch(record, 'sha1')).toBe(false);
  });
  it('isolates owner, session, model and question contexts', () => {
    expect(saveResearchCheckpoint('one', 'session', 'question-model', [entry()])).toBe(true);
    expect(loadResearchCheckpoint('one', 'session', 'question-model')).toHaveLength(1);
    expect(loadResearchCheckpoint('two', 'session', 'question-model')).toEqual([]);
    expect(loadResearchCheckpoint('one', 'other', 'question-model')).toEqual([]);
    expect(loadResearchCheckpoint('one', 'session', 'new-question')).toEqual([]);
  });
  it('expires stale checkpoints and tolerates corrupt local storage', () => {
    saveResearchCheckpoint('one', 's', 'c', [{ ...entry(), savedAt: 1 }]);
    expect(loadResearchCheckpoint('one', 's', 'c')).toEqual([]);
    localStorage.setItem('gsm:research-checkpoint:one:s', '{');
    expect(loadResearchCheckpoint('one', 's', 'c')).toEqual([]);
  });
});
