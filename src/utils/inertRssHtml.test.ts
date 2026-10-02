import { describe, expect, it, vi } from 'vitest';
import { extractInertRssHtml } from './inertRssHtml';

describe('inert RSS HTML extraction', () => {
  it('extracts decoded text and authored link attributes without inserting live DOM nodes', () => {
    const before = document.body.innerHTML;
    expect(extractInertRssHtml('<p>Hello &amp; <b>world</b></p><a href="https://github.com/o/r?a=1&amp;b=2">Repo</a>'))
      .toEqual({ text: 'Hello & worldRepo', links: ['https://github.com/o/r?a=1&b=2'] });
    expect(document.body.innerHTML).toBe(before);
  });
  it('uses only a template, never an active div, parser document or DOM insertion', () => {
    const create = vi.spyOn(document, 'createElement');
    const parser = vi.spyOn(DOMParser.prototype, 'parseFromString');
    const append = vi.spyOn(document.body, 'appendChild');
    extractInertRssHtml('<img src="https://resource.invalid/image"><iframe src="https://resource.invalid/frame"></iframe><link rel="stylesheet" href="https://resource.invalid/css">');
    expect(create.mock.calls).toEqual([['template']]);
    expect(parser).not.toHaveBeenCalled();
    expect(append).not.toHaveBeenCalled();
    create.mockRestore(); parser.mockRestore(); append.mockRestore();
  });
  it('discards scripts, styles and embedded frame text while retaining visible content', () => {
    expect(extractInertRssHtml('<script>throw "secret"</script><style>secret</style><iframe>secret</iframe><template><a href="secret">hidden</a></template><a href="//github.com/o/r">visible</a>'))
      .toEqual({ text: 'visible', links: ['//github.com/o/r'] });
  });
});
