import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve('examples/plugins/repo-info-card/ui/index.js'), 'utf8');
const html = readFileSync(resolve('examples/plugins/repo-info-card/ui/index.html'), 'utf8');

describe('Info Card output sanitizer', () => {
  it('strips resources, URL attributes, style, handlers and unknown tags in copied HTML too', () => {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const sandbox = { document: doc, window: { parent: {}, addEventListener: () => {} }, DOMParser,
      TextEncoder, setTimeout, clearTimeout, console };
    const result = runInNewContext(`${source}
      sanitizeFragment('<div id="card" style="background:url(https://evil.example)" onclick="evil()">' +
        '<script>evil()</script><img src="https://evil.example">' +
        '<a href="java&#x0A;script:evil()" ping="https://evil.example">safe text</a>' +
        '<custom-resource src="https://evil.example">plain</custom-resource>' +
        '<svg><use href="https://evil.example"/></svg><p class="title evil">Title</p></div>', '1x1')`, sandbox);
    expect(result).toContain('safe text');
    expect(result).toContain('class="title"');
    expect(result).not.toMatch(/evil|script|style=|href=|src=|ping=|custom-resource|<svg|<img/);
    expect(result).toContain('data-canvas="1x1"');
  });
  it('requires a single safe div root rather than trusting the model prompt', () => {
    const sandbox = { document: new DOMParser().parseFromString(html, 'text/html'),
      window: { parent: {}, addEventListener: () => {} }, DOMParser, TextEncoder, setTimeout, clearTimeout };
    expect(() => runInNewContext(`${source}\nsanitizeFragment('<img id="card" src="evil">', '1x1')`, sandbox)).toThrow();
  });
});
