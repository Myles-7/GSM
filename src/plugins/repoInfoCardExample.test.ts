import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

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
        '<svg><use href="https://evil.example"/></svg><p class="title evil">Title</p></div>', {id:'1x1',w:1200,h:1200})`, sandbox);
    expect(result).toContain('safe text');
    expect(result).toContain('class="title"');
    expect(result).not.toMatch(/evil|script|style=|href=|src=|ping=|custom-resource|<svg|<img/);
    expect(result).toContain('data-canvas="1x1"');
  });
  it('requires a single safe div root rather than trusting the model prompt', () => {
    const sandbox = { document: new DOMParser().parseFromString(html, 'text/html'),
      window: { parent: {}, addEventListener: () => {} }, DOMParser, TextEncoder, setTimeout, clearTimeout };
    expect(() => runInNewContext(`${source}\nsanitizeFragment('<img id="card" src="evil">', {id:'1x1',w:1200,h:1200})`, sandbox)).toThrow();
  });
});

describe('Info Card retained GSM session and export guards', () => {
  function fixture() {
    const document = new DOMParser().parseFromString(html, 'text/html');
    const listeners = new Map<string, () => void>();
    const parent = { postMessage: vi.fn() };
    const sandbox = { document, window: { parent, location: { origin: 'plugin-page://card' },
      addEventListener: (name: string, callback: () => void) => listeners.set(name, callback) },
      DOMParser, TextEncoder, setTimeout, clearTimeout, console };
    const plugin = runInNewContext(`${source}
      ({state, request, generate, exportPngBase64, setToken: value => { token=value; },
        setRequest: value => { request=value; }})`, sandbox);
    plugin.setToken('original');
    return { plugin, listeners, parent };
  }

  it('rejects oversized bridge requests and clears pending requests on pagehide', async () => {
    const {plugin, listeners, parent} = fixture();
    await expect(plugin.request('clipboard.write', {text:'x'.repeat(1024 * 1024)})).rejects.toThrow(/budget/);
    expect(parent.postMessage).not.toHaveBeenCalled();
    const pending = plugin.request('ai.generate', {user:'test'});
    listeners.get('pagehide')!();
    await expect(pending).rejects.toThrow(/session changed/);
  });

  it('ignores a generation result from a revoked session', async () => {
    const {plugin} = fixture();
    let complete!: (text: string) => void;
    plugin.state.repository = {id:1, full_name:'owner/repo'};
    plugin.state.fragment = '<div id="card">preserved</div>';
    plugin.setRequest(() => new Promise(resolve => { complete = resolve; }));
    const operation = plugin.generate();
    plugin.setToken('replacement');
    complete('<div id="card">late</div>');
    await operation;
    expect(plugin.state.fragment).toContain('preserved');
  });

  it('rejects a direct PNG export when the selected canvas differs from the generated snapshot', async () => {
    const {plugin} = fixture();
    plugin.state.fragment = '<div id="card">safe</div>';
    plugin.state.fragmentCanvas = {id:'1x1',w:1200,h:1200};
    plugin.state.canvasId = '5x2';
    await expect(plugin.exportPngBase64()).rejects.toThrow();
  });
});
