import { describe, expect, it } from 'vitest';
import { parseAnswerQualityReview } from './answerQuality';
import type { ToolEvidence } from '../types/repositoryChat';

const evidence: ToolEvidence = { id: 'e1', source: 'github', repoFullName: 'a/b', path: 'README.md',
  url: 'https://example.com', excerpt: 'Runs on Windows. Cloud sync is not supported.', retrievedAt: '2026-09-28' };
const report = {
  answer: 'Runs on Windows. Cloud sync is not supported.',
  claims: [{ text: 'Runs on Windows.', evidenceId: 'e1', quote: 'Runs on Windows.' }],
  coverage: [{ requirement: 'Platform', status: 'answered', answerExcerpt: 'Runs on Windows.' }],
  missing: [],
};

describe('answer quality validation', () => {
  it('requires same-repository verbatim evidence for comparison cells', () => {
    const cell = { repository: 'a/b', requirement: 'Cloud sync', status: 'unsupported', evidenceId: 'e1', quote: 'Cloud sync is not supported.' };
    expect(parseAnswerQualityReview(JSON.stringify({ ...report, comparison: [cell] }), [evidence])?.comparison).toEqual([cell]);
    expect(parseAnswerQualityReview(JSON.stringify({ ...report, comparison: [{ ...cell, repository: 'another/repo' }] }), [evidence])).toBeNull();
    expect(parseAnswerQualityReview(JSON.stringify({ ...report, comparison: [{ ...cell, quote: '' }] }), [evidence])).toBeNull();
    expect(parseAnswerQualityReview(JSON.stringify({ ...report, comparison: [{ repository: 'another/repo', requirement: 'Cloud sync', status: 'unknown' }] }), [evidence])).not.toBeNull();
  });
  it('accepts a source-grounded structured review', () => {
    expect(parseAnswerQualityReview(JSON.stringify(report), [evidence])).toEqual(report);
  });
  it('rejects a real citation ID carrying a fabricated supporting quote', () => {
    expect(parseAnswerQualityReview(JSON.stringify({ ...report,
      claims: [{ text: 'Runs on Windows.', evidenceId: 'e1', quote: 'Cloud sync is supported.' }] }), [evidence])).toBeNull();
  });
  it('rejects claims or requirement coverage absent from the delivered answer', () => {
    expect(parseAnswerQualityReview(JSON.stringify({ ...report,
      coverage: [{ requirement: 'Cloud', status: 'answered', answerExcerpt: 'Works offline' }] }), [evidence])).toBeNull();
    expect(parseAnswerQualityReview(JSON.stringify({ ...report,
      claims: [{ text: 'Works offline', evidenceId: 'e1', quote: 'Runs on Windows.' }] }), [evidence])).toBeNull();
  });
  it('rejects invented evidence, empty reviews, malformed JSON and unknown fields', () => {
    for (const raw of ['not json', JSON.stringify({ ...report, claims: [], missing: [] }),
      JSON.stringify({ ...report, verified: true }), JSON.stringify({ ...report,
        claims: [{ text: 'Runs on Windows.', evidenceId: 'invented', quote: 'Runs on Windows.' }] })]) {
      expect(parseAnswerQualityReview(raw, [evidence])).toBeNull();
    }
  });
  it('preserves an explicit unknown instead of forcing an invented claim', () => {
    const unknown = { answer: 'Mobile support is unknown.', claims: [],
      coverage: [{ requirement: 'Mobile', status: 'unknown', answerExcerpt: 'Mobile support is unknown.' }],
      missing: ['Mobile support'] };
    expect(parseAnswerQualityReview(JSON.stringify(unknown), [evidence])).toEqual(unknown);
  });
});
