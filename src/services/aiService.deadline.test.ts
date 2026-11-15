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

  it('lets a plain OpenAI-compatible connection test finish after ten seconds', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn(() => new Promise(resolve => setTimeout(() =>
      resolve(Response.json({ choices: [{ message: { content: 'OK' } }] })), 20_000)));
    vi.stubGlobal('fetch', fetch);
    const pending = new AIService(config, 'en').testConnection();
    await vi.advanceTimersByTimeAsync(20_000);
    await expect(pending).resolves.toMatchObject({ success: true });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('times out the connection test at thirty seconds and propagates explicit cancellation', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn<typeof globalThis.fetch>(() => new Promise<Response>(() => {}));
    vi.stubGlobal('fetch', fetch);
    const service = new AIService(config, 'en');
    const pending = service.testConnection();
    await vi.advanceTimersByTimeAsync(30_000);
    await expect(pending).resolves.toMatchObject({ success: false, errorType: 'timeout', message: expect.stringContaining('30s') });
    expect(fetch.mock.calls[0][1]?.signal?.aborted).toBe(true);

    const controller = new AbortController();
    const reason = new DOMException('User stopped', 'AbortError');
    const canceled = service.testConnection(controller.signal);
    const rejection = expect(canceled).rejects.toBe(reason);
    controller.abort(reason);
    await rejection;
  });
});

describe('HTTP 200 gateway rejections', () => {
  const rejection = { error: { code: 'throttling_error', message: 'Too many requests. Authorization: Bearer fixture-secret' } };

  it.each(['text', 'tools'] as const)('keeps %s status and backoff without exposing upstream text', async mode => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(rejection, { headers: { 'retry-after-ms': '1500', 'retry-after': '8' } })));
    const service = new AIService(config, 'en');
    const pending = mode === 'text' ? service.generateChatText({ system: '', user: 'fixture' })
      : service.generateWithTools({ system: '', messages: [], tools: [] });
    await expect(pending).rejects.toMatchObject({ name: 'AIRequestError', status: 429, retryAfterMs: 1500, isRateLimit: true });
    await expect(pending).rejects.not.toThrow('fixture-secret');
  });

  it('reports an explicit gateway HTTP status in the connection test', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ error: { status: '401', message: 'upstream network diagnostic' } })));
    await expect(new AIService(config, 'en').testConnection()).resolves.toMatchObject({ success: false, statusCode: 401, errorType: 'auth' });
  });

  it.each(['json', 'headerless-json', 'headerless-sse'] as const)('recognizes %s fallback errors without emitting a chunk', async transport => {
    const raw = transport === 'headerless-sse' ? `data: ${JSON.stringify(rejection)}\n\n` : JSON.stringify(rejection);
    const headers = new Headers({ 'retry-after': '2' });
    if (transport === 'json') headers.set('content-type', 'application/json');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(new TextEncoder().encode(raw), { headers })));
    const onChunk = vi.fn();
    const pending = new AIService(config, 'en').generateChatTextStream({ system: '', user: 'fixture', onChunk });
    await expect(pending).rejects.toMatchObject({ name: 'AIRequestError', status: 429, retryAfterMs: 2000 });
    expect(onChunk).not.toHaveBeenCalled();
  });

  it('cancels a still-open SSE response and preserves an interrupted answer', async () => {
    const cancel = vi.fn();
    const onChunk = vi.fn();
    const frames = `data: {"choices":[{"delta":{"content":"visible partial"}}]}\n\ndata: ${JSON.stringify(rejection)}\n\n`;
    const body = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new TextEncoder().encode(frames)); },
      cancel,
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body, { headers: { 'content-type': 'text/event-stream', 'retry-after': '3' } })));
    const pending = new AIService(config, 'en').generateChatTextStream({ system: '', user: 'fixture', onChunk });
    await expect(pending).rejects.toMatchObject({ name: 'AIStreamInterruptedError',
      partialText: 'visible partial', status: 429, retryAfterMs: 3000, providerOutcome: 'unknown' });
    expect(onChunk).toHaveBeenCalledExactlyOnceWith('visible partial');
    expect(cancel).toHaveBeenCalledOnce();
  });
});
