import { beforeEach, describe, expect, it, vi } from 'vitest';
const { client } = vi.hoisted(() => ({
  client: {
    service: { use: vi.fn() },
    selectLanguageTag: { show: true },
    storage: { get: vi.fn(), set: vi.fn() },
    request: { api: { connectTest: 'connectTest.json', init: 'init.json' }, translateText: vi.fn() },
  },
}));
vi.mock('i18n-jsautotranslate', () => ({ default: client }));
import { translatePageTexts } from './pageTranslationClient';

beforeEach(() => {
  client.request.translateText.mockReset();
  client.request.translateText.mockImplementation((options, done) =>
    done({ result: 1, text: options.texts.map((text: string) => `译文:${text.trim()}`) }));
});
describe('translate.js client adapter', () => {
  it('uses translate.js Edge service without vendor probes or persistent text cache', async () => {
    expect(await translatePageTexts(['  Hello world  ', 'Hello world'])).toEqual(['  译文:Hello world  ', '译文:Hello world']);
    expect(client.service.use).toHaveBeenCalledWith('client.edge');
    expect(client.request.api.connectTest).toBe('');
    expect(client.request.api.init).toBe('');
    expect(client.storage.get('anything')).toBeNull();
    expect(client.selectLanguageTag.show).toBe(false);
  });
  it('deduplicates input and splits long paragraphs into bounded requests', async () => {
    const long = 'Long paragraph '.repeat(700);
    const result = await translatePageTexts([long, long, 'Another description']);
    expect(result).toHaveLength(3);
    expect(result[0]).toBe(result[1]);
    const sent: string[] = [];
    for (const [request] of client.request.translateText.mock.calls) {
      expect(request.texts.reduce((sum: number, text: string) => sum + text.length, 0)).toBeLessThanOrEqual(6000);
      sent.push(...request.texts);
    }
    expect(new Set(sent).size).toBe(sent.length);
  });
  it('rejects incomplete responses and errors', async () => {
    client.request.translateText.mockImplementationOnce((_options, done) => done({ result: 1, text: [] }));
    await expect(translatePageTexts(['Hello world'])).rejects.toThrow('Translation unavailable');
    client.request.translateText.mockImplementationOnce((_options, _done, fail) => fail());
    await expect(translatePageTexts(['Hello world'])).rejects.toThrow('Translation unavailable');
  });
  it('times out if the translation service never calls back', async () => {
    vi.useFakeTimers();
    try {
      client.request.translateText.mockImplementationOnce(() => {});
      const result = expect(translatePageTexts(['Hello world'])).rejects.toThrow('Translation timed out');
      await vi.advanceTimersByTimeAsync(20001);
      await result;
    } finally {
      vi.useRealTimers();
    }
  });
});
