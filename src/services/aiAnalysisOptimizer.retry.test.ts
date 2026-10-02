import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AIConfig, Repository } from '../types';
import { AIAnalysisOptimizer } from './aiAnalysisOptimizer';
import { AIRequestError, AIService } from './aiService';
import { generateAgyText } from './agyClient';

vi.mock('./backendAdapter', () => ({ backend: { isAvailable: false } }));
vi.mock('./agyClient', () => ({ generateAgyText: vi.fn() }));

const valid = '{"summary":"A command-line tool for organizing local files.","tags":["cli"],"platforms":["windows"]}';
const repo = { id: 1, name: 'files', full_name: 'acme/files', topics: [] } as unknown as Repository;
const config = {
  id: 'test', name: 'Test', apiType: 'openai', baseUrl: 'http://localhost:0',
  apiKey: '', model: 'test', isActive: true,
} as AIConfig;

beforeEach(() => { vi.useFakeTimers(); vi.mocked(generateAgyText).mockReset(); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe.each(['http', 'agy'] as const)('%s bounded analysis retries', transport => {
  function setup(outputs: (string | Error | DOMException)[], maxRetries = 3) {
    const prompts: string[] = [];
    const next = (user: string) => {
      prompts.push(user);
      const output = outputs.shift();
      if (output === undefined) throw new Error('Unexpected extra model call');
      if (typeof output !== 'string') throw output;
      return output;
    };
    const fetch = vi.fn(async (_url: string, options: RequestInit) => {
      const body = JSON.parse(String(options.body));
      return new Response(JSON.stringify({ choices: [{ message: { content: next(body.messages[1].content) } }] }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetch);
    vi.mocked(generateAgyText).mockImplementation(async (_config, options) => next(options.user));
    const service = new AIService(transport === 'http' ? config : {
      ...config, provider: 'agy-cli', deviceBound: true, agyMode: 'model', agyEffort: 'low',
    } as AIConfig, 'en');
    const optimizer = new AIAnalysisOptimizer({
      maxRetries, retryDelayBaseMs: 1,
      rateLimiter: { maxConcurrency: 0, requestsPerMinute: 0, cooldownThreshold: 0, maxRetryAfterMs: 1 },
    });
    return {
      prompts, fetch,
      async run() {
        const pending = optimizer.analyzeWithRetry({ repo, readmeContent: '# File organizer', retries: 0 }, service, []);
        await vi.runAllTimersAsync();
        return pending;
      },
    };
  }

  const transient = () => transport === 'http'
    ? new AIRequestError('Service unavailable', 503) : new Error('AGY_TIMEOUT');

  it.each([
    ['transient then repair', () => [transient(), 'invalid', valid]],
    ['repair then transient', () => ['invalid', transient(), valid]],
  ] as const)('uses at most three calls for %s', async (order, outputs) => {
    const test = setup(outputs());
    expect((await test.run()).success).toBe(true);
    expect(test.prompts).toHaveLength(3);
    if (order === 'repair then transient') expect(test.prompts[2]).toBe(test.prompts[1]);
    else expect(test.prompts[2]).not.toBe(test.prompts[1]);
    expect(test.fetch).toHaveBeenCalledTimes(transport === 'http' ? 3 : 0);
    expect(generateAgyText).toHaveBeenCalledTimes(transport === 'agy' ? 3 : 0);
  });

  it('does not reset the repair budget after a transient failure', async () => {
    const test = setup(['invalid', transient(), 'still invalid', valid]);
    expect((await test.run()).success).toBe(false);
    expect(test.prompts).toHaveLength(3);
  });

  it('stops after one structured repair without an outer retry', async () => {
    const test = setup(['invalid', 'still invalid', valid]);
    expect((await test.run()).success).toBe(false);
    expect(test.prompts).toHaveLength(2);
  });

  it('caps transient retries at one even with legacy maxRetries=3', async () => {
    const test = setup([transient(), transient(), valid]);
    expect((await test.run()).success).toBe(false);
    expect(test.prompts).toHaveLength(2);
  });

  it('honors disabled transient retries', async () => {
    const test = setup([transient(), valid], 0);
    expect((await test.run()).success).toBe(false);
    expect(test.prompts).toHaveLength(1);
  });

  it.each([
    new DOMException('Canceled', 'AbortError'),
    new AIRequestError('Unauthorized', 401),
    new AIRequestError('Forbidden, rate limit', 403),
    new AIRequestError('Invalid request', 400),
    new AIRequestError('Not found', 404),
    new AIRequestError('Not implemented', 501),
    new Error('AGY_AUTH_REQUIRED'),
    new Error('AGY_QUOTA_EXHAUSTED'),
    new Error('AGY_MODEL_EFFORT_CONFLICT'),
    new Error('AGY_DISABLED'),
    new Error('AGY_OUTPUT_LIMIT'),
    new Error('AGY_CANCELED'),
    new Error('AGY_SESSION_CHANGED'),
    new Error('Permanent configuration failure'),
  ])('never retries permanent or canceled errors: %s', async error => {
    const test = setup([error, valid]);
    expect(await test.run()).toMatchObject({ success: false, error });
    expect(test.prompts).toHaveLength(1);
  });

  it('does not retry auth failure during structured repair', async () => {
    const error = transport === 'http' ? new AIRequestError('Unauthorized', 401) : new Error('AGY_AUTH_REQUIRED');
    const test = setup(['invalid', error, valid]);
    expect(await test.run()).toMatchObject({ success: false, error });
    expect(test.prompts).toHaveLength(2);
  });
});
