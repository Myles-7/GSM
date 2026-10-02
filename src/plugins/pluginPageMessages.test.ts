import { describe, expect, it } from 'vitest';
import { pluginPageArgsBudget, pluginPageArgsBytes, validatePluginPageMessage } from './pluginPageMessages';

const frameWindow = {} as Window;
const request = {
  type: 'plugin-page:request', pluginId: 'com.example.page', pageId: 'dashboard',
  requestId: 'request_1', token: 'secret-session-token',
  origin: 'plugin-page://com.example.page',
  method: 'repositories.search', args: { query: 'react', limit: 5 },
};

function event(data: unknown, source: MessageEventSource | null = frameWindow, origin = 'plugin-page://com.example.page'): MessageEvent {
  return { data, source, origin } as MessageEvent;
}

describe('plugin page message validation', () => {
  it('accepts only the current frame, exact browser/payload origin, identity and token', () => {
    const validate = (message: MessageEvent) => validatePluginPageMessage(
      message, frameWindow, 'com.example.page', 'dashboard', 'secret-session-token',
    );
    expect(validate(event(request))).toEqual(request);
    expect(validate(event(request, {} as Window))).toBeNull();
    expect(validate(event(request, frameWindow, 'https://attacker.example'))).toBeNull();
    expect(validate(event({ ...request, token: 'wrong' }))).toBeNull();
    expect(validate(event({ ...request, pluginId: 'com.other.page' }))).toBeNull();
    expect(validate(event({ ...request, pageId: 'other' }))).toBeNull();
    expect(validate(event({ ...request, origin: 'null' }))).toBeNull();
    expect(validate(event({ ...request, origin: undefined }))).toBeNull();
    expect(validate(event(request, frameWindow, 'null'))).toBeNull();
    expect(validate(event({ ...request, requestId: '../invalid' }))).toBeNull();
    expect(validate(event({ ...request, extra: 'x' }))).toBeNull();
  });
  it('counts UTF-8 JSON bytes and applies the binary encoded budget only to binary methods', () => {
    expect(pluginPageArgsBytes({ text: '汉' })).toBe(new TextEncoder().encode('{"text":"汉"}').byteLength);
    expect(pluginPageArgsBytes({ text: '汉'.repeat(400000) })).toBeGreaterThan(1024 * 1024);
    expect(pluginPageArgsBudget('ai.generate')).toBe(1024 * 1024);
    expect(pluginPageArgsBudget('clipboard.writeImage')).toBe(10 * 1024 * 1024);
    expect(pluginPageArgsBudget('downloads.saveFile')).toBe(10 * 1024 * 1024);
  });
});
