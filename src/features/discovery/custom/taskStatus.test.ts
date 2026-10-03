import { describe, expect, it } from 'vitest';
import { issueLabel, taskIssue } from './taskStatus';

describe('discovery provider error guidance', () => {
  it.each([
    ['AGY_AUTH_REQUIRED', 'auth'], ['AGY_DISABLED', 'auth'], ['AGY_TEST_REQUIRED', 'auth'],
    ['AGY_PERMISSION_DENIED', 'auth'], ['AGY_RATE_LIMIT', 'rate-limit'],
    ['AGY_TIMEOUT', 'timeout'], ['AGY_INIT_TIMEOUT', 'timeout'], ['AGY_QUEUE_TIMEOUT', 'timeout'],
    ['AGY_CANCELED', 'cancelled'], ['AGY_SESSION_CHANGED', 'cancelled'],
  ])('classifies %s as %s with Chinese and English guidance', (code, kind) => {
    const issue = taskIssue(new Error(code));
    expect(issue.kind).toBe(kind);
    expect(issue.code).toBe(code);
    expect(issueLabel(issue, true).length).toBeGreaterThan(10);
    expect(issueLabel(issue, false).length).toBeGreaterThan(10);
    expect(issueLabel(issue, true)).not.toBe(issueLabel(issue, false));
  });
});

describe('discovery failure diagnosis', () => {
  it.each(['No content received from AI service', 'No content received from AI service (empty body)'])('does not mistake empty generation for authentication: %s', message => {
    expect(taskIssue(new Error(message), 'ai')).toEqual({ kind: 'invalid', source: 'ai' });
  });
  it('does not classify token budget or token counts as authentication', () => {
    expect(taskIssue(new Error('output token limit exceeded')).kind).not.toBe('auth');
  });
  it('preserves CLI error codes with actionable quota and login guidance', () => {
    const quota = taskIssue(new Error('AGY_QUOTA_EXHAUSTED'), 'ai');
    expect(quota.code).toBe('AGY_QUOTA_EXHAUSTED');
    expect(issueLabel(quota, true)).toContain('额度');
    const auth = taskIssue(new Error('AGY_AUTH_REQUIRED'), 'ai');
    expect(auth.kind).toBe('auth');
    expect(issueLabel(auth, false)).toContain('terminal');
  });
  it('still recognizes genuine invalid credentials', () => {
    expect(taskIssue(new Error('Invalid API key')).kind).toBe('auth');
    expect(taskIssue({ status: 401 }).kind).toBe('auth');
  });
});
