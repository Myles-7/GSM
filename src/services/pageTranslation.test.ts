import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PageTranslationController } from './pageTranslation';

describe('global page translation', () => {
  let controller: PageTranslationController;
  const translate = vi.fn(async (texts: string[]) => texts.map((text) => `中文:${text}`));
  const flush = async () => { await vi.advanceTimersByTimeAsync(400); };
  beforeEach(() => {
    vi.useFakeTimers();
    translate.mockClear();
    controller = new PageTranslationController(translate);
  });
  afterEach(() => {
    controller.stop();
    document.body.innerHTML = '';
    vi.useRealTimers();
  });
  it('translates navigation, lists, README, labels, and dynamically mounted portals', async () => {
    document.body.innerHTML = '<nav>Repositories</nav><main><p>Project description</p><article>Getting started</article></main><button title="Open settings">Settings</button>';
    controller.start(document.body);
    await flush();
    expect(document.querySelector('nav')?.textContent).toBe('中文:Repositories');
    expect(document.querySelector('article')?.textContent).toBe('中文:Getting started');
    expect(document.querySelector('button')?.title).toBe('中文:Open settings');
    const portal = document.createElement('div');
    portal.setAttribute('role', 'dialog');
    portal.textContent = 'Release details';
    document.body.append(portal);
    await flush();
    expect(portal.textContent).toBe('中文:Release details');
    controller.stop();
    expect(document.querySelector('nav')?.textContent).toBe('Repositories');
    expect(portal.textContent).toBe('Release details');
    expect(document.querySelector('button')?.title).toBe('Open settings');
  });
  it('does not send code, input values, editors, credentials or excluded text', async () => {
    document.body.innerHTML = `
      <code>secret code</code><pre>terminal command</pre>
      <input value="private input" placeholder="Search repositories">
      <input type="password" value="private password" title="private password hint">
      <textarea>private note</textarea><div contenteditable>private draft</div>
      <div translate="no">ignored content</div><div data-sensitive>private key</div>
      <span>github_pat_privateToken123</span><span>owner/repository</span>
      <span>https://example.test</span><span>这是中文</span>`;
    controller.start(document.body);
    await flush();
    expect(translate.mock.calls.flatMap(([texts]) => texts)).toEqual(['Search repositories']);
    expect(document.querySelector('input')?.value).toBe('private input');
  });
  it('deduplicates repeated text and uses a session cache after switching back', async () => {
    document.body.innerHTML = '<p>Hello world</p><p>Hello world</p>';
    controller.start(document.body);
    await flush();
    expect(translate).toHaveBeenCalledWith(['Hello world']);
    expect([...document.querySelectorAll('p')].map((p) => p.textContent)).toEqual(['中文:Hello world', '中文:Hello world']);
    controller.stop();
    controller.start(document.body);
    await flush();
    expect(translate).toHaveBeenCalledTimes(1);
  });
  it('ignores late responses after restoring original', async () => {
    let resolve!: (texts: string[]) => void;
    controller = new PageTranslationController(() => new Promise((done) => { resolve = done; }));
    document.body.innerHTML = '<p>Hello world</p>';
    controller.start(document.body);
    controller.stop();
    resolve(['你好']);
    await flush();
    expect(document.querySelector('p')?.textContent).toBe('Hello world');
    expect(controller.getSnapshot()).toBe('original');
  });
  it('translates React-style text updates and preserves the latest original', async () => {
    document.body.innerHTML = '<p>Hello world</p>';
    const text = document.querySelector('p')!.firstChild!;
    controller.start(document.body);
    await flush();
    text.nodeValue = 'Updated description';
    await flush();
    expect(text.nodeValue).toBe('中文:Updated description');
    controller.stop();
    expect(text.nodeValue).toBe('Updated description');
  });
  it('does not overwrite an update made while a request is pending', async () => {
    let resolve!: (texts: string[]) => void;
    controller = new PageTranslationController(() => new Promise((done) => { resolve = done; }));
    document.body.innerHTML = '<p>Old description</p>';
    controller.start(document.body);
    document.querySelector('p')!.firstChild!.nodeValue = '新的中文内容';
    resolve(['旧的描述']);
    await flush();
    expect(document.querySelector('p')?.textContent).toBe('新的中文内容');
  });
  it('keeps failures as original and retries only on request', async () => {
    const failing = vi.fn< (texts: string[]) => Promise<string[]> >().mockRejectedValueOnce(new Error('offline'))
      .mockImplementation(async (texts) => texts.map(() => '你好'));
    controller = new PageTranslationController(failing);
    document.body.innerHTML = '<p>Hello world</p>';
    controller.start(document.body);
    await flush();
    expect(controller.getSnapshot()).toBe('error');
    expect(document.querySelector('p')?.textContent).toBe('Hello world');
    await flush();
    expect(failing).toHaveBeenCalledTimes(1);
    controller.retry();
    await flush();
    expect(document.querySelector('p')?.textContent).toBe('你好');
  });
  it('batches with at most two concurrent requests and covers long paragraphs', async () => {
    let active = 0;
    let maximum = 0;
    controller = new PageTranslationController(async (texts) => {
      maximum = Math.max(maximum, ++active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      active--;
      return texts.map(() => '译文');
    });
    document.body.innerHTML = Array.from({ length: 90 }, (_, i) => `<p>Project ${i}</p>`).join('') + `<p>${'Long paragraph '.repeat(600)}</p>`;
    controller.start(document.body);
    await vi.advanceTimersByTimeAsync(1000);
    expect(maximum).toBe(2);
    expect([...document.querySelectorAll('p')].every((p) => p.textContent === '译文')).toBe(true);
  });
  it('restores translated text when its ancestor becomes excluded', async () => {
    document.body.innerHTML = '<section><p>Hello world</p></section>';
    controller.start(document.body);
    await flush();
    document.querySelector('section')!.setAttribute('translate', 'no');
    await flush();
    expect(document.querySelector('p')?.textContent).toBe('Hello world');
  });
});
