import { afterEach, describe, expect, it, vi } from 'vitest';
import { APP_LANGUAGES, detectInitialLanguage, isAppLanguage, isKnownLanguage } from './languages';

afterEach(() => vi.unstubAllGlobals());

describe('personal edition language policy', () => {
  it('offers Chinese and English and preserves legacy identifiers for API compatibility', () => {
    expect(APP_LANGUAGES.map((language) => language.code)).toEqual(['zh', 'en']);
    expect(isAppLanguage('ja')).toBe(false);
    expect(isKnownLanguage('ja')).toBe(true);
    expect(isKnownLanguage('invalid')).toBe(false);
  });

  it.each([
    ['zh-CN', 'zh'], ['zh-TW', 'zh'], ['en-US', 'en'], ['ja-JP', 'en'],
  ])('detects %s as %s for fresh installations', (language, expected) => {
    vi.stubGlobal('navigator', { language, languages: [language] });
    expect(detectInitialLanguage()).toBe(expected);
  });
});
