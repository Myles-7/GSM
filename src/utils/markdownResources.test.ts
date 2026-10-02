import { describe, expect, it } from 'vitest';
import { decodeAnchorFragment, resolveMarkdownHref, resolveMarkdownImageSrc, resolveMarkdownSrcSet } from './markdownResources';

describe('Markdown resources', () => {
  it.each(['https://github.com/o/r', 'https://github.com/o/r/issues/123', 'https://github.com/o/r/releases/tag/v1', 'https://raw.githubusercontent.com/o/r/main/README.md'])('normalizes repository base %s', base => {
    expect(resolveMarkdownImageSrc('/docs/hero.svg', base)).toBe('https://github.com/o/r/raw/HEAD/docs/hero.svg');
    expect(resolveMarkdownHref('./docs/guide.md', base)).toBe('https://github.com/o/r/blob/HEAD/docs/guide.md');
  });
  it('pins protocol-relative URLs to HTTPS without repository base', () => {
    expect(resolveMarkdownImageSrc('//cdn.example/image.png')).toBe('https://cdn.example/image.png');
    expect(resolveMarkdownHref('//example.com/link')).toBe('https://example.com/link');
  });
  it.each([undefined, 'https://example.com/article', 'not-url', 'file:///o/r', 'https://github.com/user'])('does not manufacture a repository for %s', base => {
    expect(resolveMarkdownImageSrc('image.svg', base)).toBe('image.svg');
  });
  it('preserves external images, mail and fragment links', () => {
    expect(resolveMarkdownImageSrc('https://cdn.example/image.svg', 'https://github.com/o/r')).toBe('https://cdn.example/image.svg');
    expect(resolveMarkdownHref('mailto:alice@example.com')).toBe('mailto:alice@example.com');
    expect(resolveMarkdownHref('#100%-coverage')).toBe('#100%-coverage');
    expect(decodeAnchorFragment('100%-coverage')).toBe('100%-coverage');
    expect(decodeAnchorFragment('hello%20world')).toBe('hello world');
  });
  it('resolves every srcset candidate without splitting CDN URL commas', () => {
    expect(resolveMarkdownSrcSet('https://cdn.example/w_800,q_auto/image.jpg 1x, ./images/hero.svg 2x', 'https://github.com/o/r/issues/1'))
      .toBe('https://cdn.example/w_800,q_auto/image.jpg 1x, https://github.com/o/r/raw/HEAD/images/hero.svg 2x');
  });
  it('handles descriptor-less candidates and width descriptors', () => {
    expect(resolveMarkdownSrcSet('//cdn.example/a.png, /images/b.png 800w', 'https://github.com/o/r'))
      .toBe('https://cdn.example/a.png, https://github.com/o/r/raw/HEAD/images/b.png 800w');
  });
  it('removes non-HTTP schemes even when baseUrl is absent', () => {
    expect(resolveMarkdownSrcSet('javascript:alert(1) 1x, file:///secret 2x, blob:secret 3x, data:image/png;base64,AAAA 4x, //cdn.example/a.png 5x'))
      .toBe('https://cdn.example/a.png 5x');
  });
});
