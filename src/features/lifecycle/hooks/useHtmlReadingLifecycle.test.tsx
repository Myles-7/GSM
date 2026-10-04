import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => {
  class ReadingGenerationError extends Error {
    constructor(message: string, public code: 'noContent' | 'size' | 'accountChanged' | 'cancelled', public retryable = false) { super(message); }
  }
  class ReadingSizeError extends ReadingGenerationError {
    constructor(message: string) { super(message, 'size'); }
  }
  return {
    generate: vi.fn(), send: vi.fn(), failed: vi.fn(async () => ({})), configure: vi.fn(async () => ({})),
    listener: null as null | ((request: { accountId: string; requestId: string }) => void),
    GenerationError: ReadingGenerationError, SizeError: ReadingSizeError,
  };
});
vi.mock('../../../store/useAppStore', () => ({ useAppStore: (selector: (state: unknown) => unknown) => selector({ hasHydrated: true, isAuthenticated: true, user: { id: 42 } }) }));
vi.mock('../../../lib/html-reading/storage', () => ({ loadReadingData: async () => ({ settings: {} }) }));
vi.mock('../../../services/htmlReading', () => ({ readingAccount: () => '42', prepareReadingSend: async () => [], generatePreparedReadingSnapshot: mocks.generate, ReadingGenerationError: mocks.GenerationError, ReadingSizeError: mocks.SizeError }));
import { useHtmlReadingLifecycle } from './useHtmlReadingLifecycle';
beforeEach(() => {
  mocks.generate.mockReset(); mocks.send.mockReset(); mocks.failed.mockClear(); mocks.configure.mockClear(); mocks.listener = null;
  window.electronAPI = { htmlReading: { onGenerate: (listener: typeof mocks.listener) => { mocks.listener = listener; return () => { mocks.listener = null; }; }, configure: mocks.configure, send: mocks.send, failed: mocks.failed } } as unknown as Window['electronAPI'];
});
it('records a scheduled size failure with corrective instructions and never submits mail', async () => {
  mocks.generate.mockRejectedValue(new mocks.SizeError('HTML 超过上限，本次未发送。请减少历史期数后重新生成。'));
  renderHook(() => useHtmlReadingLifecycle()); await waitFor(() => expect(mocks.configure).toHaveBeenCalled());
  mocks.listener!({ accountId: '42', requestId: 'scheduled' });
  await waitFor(() => expect(mocks.failed).toHaveBeenCalledWith('scheduled', expect.stringContaining('减少历史期数'), { code: 'size', retryable: false }));
  expect(mocks.send).not.toHaveBeenCalled();
});
it('does not write an unrelated exception containing credentials into the delivery record', async () => {
  mocks.generate.mockRejectedValue(Error('TOKEN=synthetic-secret'));
  renderHook(() => useHtmlReadingLifecycle()); await waitFor(() => expect(mocks.configure).toHaveBeenCalled());
  mocks.listener!({ accountId: '42', requestId: 'scheduled' });
  await waitFor(() => expect(mocks.failed).toHaveBeenCalledWith('scheduled', '生成失败，请在每日 HTML 中查看记录。', { code: 'generation', retryable: false }));
  expect(mocks.send).not.toHaveBeenCalled();
});
