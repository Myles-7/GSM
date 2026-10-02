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
    expect(issueLabel(issue, true)).not.toContain(code);
    expect(issueLabel(issue, false)).not.toContain(code);
    expect(issueLabel(issue, true)).not.toBe(issueLabel(issue, false));
  });
});
