import { describe, expect, it } from 'vitest';
import { describeAgyRecoveryError } from './agyErrors';

describe('AGY errors shown after parallel batches', () => {
  it('explains and deduplicates repeated batch timeouts', () => {
    expect(describeAgyRecoveryError('AGY_TIMEOUT; AGY_TIMEOUT')).toBe(describeAgyRecoveryError('AGY_TIMEOUT'));
  });
  it('retains different errors while explaining each', () => {
    const text = describeAgyRecoveryError('AGY_TIMEOUT；AGY_PROCESS_FAILED');
    expect(text).toContain('未在设定时间内完成');
    expect(text).toContain('进程异常退出');
  });
  it('does not change an already explained error containing punctuation', () => {
    const explained = describeAgyRecoveryError('AGY_TIMEOUT');
    expect(describeAgyRecoveryError(explained)).toBe(explained);
  });
  it('explains capacity failures and preserves uncertainty about sent requests', () => {
    const text = describeAgyRecoveryError('AGY_SERVICE_UNAVAILABLE');
    expect(text).toContain('容量不足');
    expect(text).toContain('不会自动重发或切换模型');
    expect(text).toContain('计费');
  });
});
