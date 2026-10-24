import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AIConfig } from '../types';
import { AIService } from './aiService';

const config: AIConfig = { id: 'audit', name: 'Audit', apiType: 'openai',
  baseUrl: 'https://provider.invalid/v1', apiKey: 'synthetic', model: 'o3', isActive: true };
afterEach(() => vi.unstubAllGlobals());

describe('AI provider audit regressions', () => {
  it.each([false, true])('uses Responses reasoning parameters without temperature (stream=%s)', async stream => {
    const fetch = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ status: 'completed', output_text: 'Answer' }),
      { headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetch);
    const service = new AIService({ ...config, apiType: 'openai-responses', reasoningEffort: 'high' });
    const options = { system: '', user: 'Question', maxTokens: 4096, onChunk: vi.fn() };
    await (stream ? service.generateChatTextStream(options) : service.generateChatText(options));
    const body = JSON.parse(String(fetch.mock.calls[0][1].body));
    expect(body).toMatchObject({ reasoning: { effort: 'high' }, max_output_tokens: 4096 });
    expect(body).not.toHaveProperty('temperature');
    expect(body).not.toHaveProperty('reasoning_effort');
  });
  it.each([false, true])('uses Chat Completions reasoning parameters (stream=%s)', async stream => {
    const fetch = vi.fn().mockImplementation(async () => new Response(JSON.stringify({
      choices: [{ message: { content: 'Answer' }, finish_reason: 'stop' }],
    }), { headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetch);
    const service = new AIService({ ...config, reasoningEffort: 'high' });
    const options = { system: '', user: 'Question', maxTokens: 4096, onChunk: vi.fn() };
    await (stream ? service.generateChatTextStream(options) : service.generateChatText(options));
    const body = JSON.parse(String(fetch.mock.calls[0][1].body));
    expect(body).toMatchObject({ reasoning_effort: 'high', max_completion_tokens: 4096 });
    expect(body).not.toHaveProperty('reasoning');
    expect(body).not.toHaveProperty('max_tokens');
    expect(body).not.toHaveProperty('temperature');
  });

  it('does not present DeepSeek reasoning as a final answer when content is absent', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: '', reasoning_content: 'Internal unfinished reasoning' }, finish_reason: 'stop' }],
    }))));
    await expect(new AIService({ ...config, apiType: 'deepseek', model: 'deepseek-reasoner' })
      .generateChatText({ system: '', user: 'Question' })).rejects.toThrow('No content');
  });

  it('rejects truncated tool arguments before they can execute', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{
      finish_reason: 'length', message: { tool_calls: [{ id: 'call-1', type: 'function',
        function: { name: 'read_file', arguments: '{"path":' } }] },
    }] }))));
    await expect(new AIService({ ...config, supportsToolCalls: true }).generateWithTools({
      system: '', messages: [{ role: 'user', content: 'Read source' }],
      tools: [{ name: 'read_file', description: 'Read', parameters: { type: 'object' } }],
    })).rejects.toMatchObject({ name: 'AIStreamInterruptedError' });
  });
});
