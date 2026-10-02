import { describe, expect, it } from 'vitest';
import { conversationMarkdown } from './conversationMarkdown';

describe('conversation Markdown export', () => {
  it('retains review, requirement, claim and source versions without local URI links', () => {
    const text = conversationMarkdown([{
      id: 'm', sessionId: 's', role: 'assistant', content: 'Offline only.', status: 'complete',
      answerPhase: 'final', quality: 'model-reviewed', evidenceIds: ['e'], createdAt: '',
      claims: [{ text: 'Offline only.', quote: 'Offline', evidenceId: 'e' }],
      coverage: [{ requirement: 'Cloud sync?', status: 'answered', answerExcerpt: 'Offline only.' }],
      missing: ['Mobile support unknown'],
    }], [{
      id: 'e', source: 'local', repoFullName: 'local/notes', path: 'README.md', contentHash: 'hash',
      excerpt: 'Offline', retrievedAt: '2026-09-29', url: 'local-evidence:private',
    }]);
    expect(text).toContain('review: model-reviewed');
    expect(text).toContain('answered: Cloud sync?');
    expect(text).toContain('Mobile support unknown');
    expect(text).toContain('Version: hash');
    expect(text).toContain('Evidence: e');
    expect(text).not.toContain('local-evidence:');
  });
  it('does not imply old or interrupted answers have been reviewed', () => {
    const text = conversationMarkdown([{ id: 'm', sessionId: 's', role: 'assistant', content: 'Preview',
      status: 'aborted', answerPhase: 'draft', evidenceIds: [], createdAt: '' }], []);
    expect(text).toContain('Status: aborted; phase: draft; review: not-recorded');
  });
});
