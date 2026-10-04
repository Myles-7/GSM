import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ test: vi.fn(), toast: vi.fn() }));
vi.mock('../../../store/useAppStore', () => ({ useAppStore: (select: (s: object) => unknown) => select({ language: 'en' }) }));
vi.mock('../../../hooks/useDialog', () => ({ useDialog: () => ({ toast: mocks.toast }) }));
vi.mock('../../../services/aiService', () => ({ AIService: class { testConnection = mocks.test; } }));
import { useAIConfigActions } from './useAIConfigActions';
describe('connection test cancellation', () => {
  it('settles an unresponsive test and retains the previous success record', async () => {
    const config = { id: 'test', name: 'Fixture', model: 'fixture', baseUrl: 'https://example.com', apiKey: 'fixture', isActive: true };
    mocks.test.mockResolvedValueOnce({ success: true });
    const { result } = renderHook(useAIConfigActions);
    await act(async () => { await result.current.testConfig(config); });
    const previous = result.current.results.test;
    mocks.toast.mockClear(); mocks.test.mockImplementation(() => new Promise(() => {}));
    let pending!: Promise<void>;
    act(() => { pending = result.current.testConfig(config); });
    await waitFor(() => expect(mocks.test).toHaveBeenCalledTimes(2));
    await act(async () => { result.current.cancelTest(); await pending; });
    expect(result.current.testingId).toBeNull();
    expect(result.current.results.test).toBe(previous);
    expect(mocks.toast).not.toHaveBeenCalled();
    expect(mocks.test.mock.lastCall?.[0].aborted).toBe(true);
  });
});
