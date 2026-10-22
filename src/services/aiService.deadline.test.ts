import { afterEach, describe, expect, it, vi } from 'vitest';
import { AIService } from './aiService';

vi.mock('./backendAdapter', () => ({ backend: { isAvailable: false } }));
vi.mock('../store/useAppStore', () => ({ useAppStore: { getState: () => ({ user: null }) } }));

const config = { id: 'deadline', name: 'Test', model: 'test', apiType: 'openai' as const,
  baseUrl: 'https://provider.invalid', apiKey: 'fixture', isActive: true, supportsToolCalls: true };

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('HTTP AI request lifetime', () => {
  it.each(['text', 'tools'] as const)('bounds %s requests even when the transport ignores cancellation', async mode => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const fetch = vi.fn((_url: string, init?: RequestInit) => {
      signal = init?.signal ?? undefined;
      return new Promise<Response>(() => {});
    });
    vi.stubGlobal('fetch', fetch);
    const service = new AIService(config);
    const pending = mode === 'text'
      ? service.generateChatText({ system: '', user: 'fixture' })
      : service.generateWithTools({ system: '', messages: [], tools: [] });
    const rejected = expect(pending).rejects.toMatchObject({ name: 'TimeoutError', providerOutcome: 'unknown' });
    await vi.advanceTimersByTimeAsync(600_001);
    await rejected;
    expect(signal?.aborted).toBe(true);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it.each(['openai', 'claude', 'gemini'] as const)('decodes %s responses once without collecting discarded debug previews', async apiType => {
    const payload = apiType === 'openai' ? { choices: [{ message: { content: 'answer' } }] }
      : apiType === 'claude' ? { content: [{ type: 'text', text: 'answer' }] }
        : { candidates: [{ content: { parts: [{ text: 'answer' }] } }] };
    const response = new Response(JSON.stringify(payload));
    const clone = vi.spyOn(response, 'clone');
    const json = vi.spyOn(response, 'json');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));
    await expect(new AIService({ ...config, apiType }).generateChatText({ system: '', user: 'fixture' })).resolves.toBe('answer');
    expect(clone).not.toHaveBeenCalled();
    expect(json).toHaveBeenCalledOnce();
  });
});
