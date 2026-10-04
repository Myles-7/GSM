import { afterEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { defaultSettings, emptyReadingState, parseReadingReturn, type ReadingItem, type ReadingSnapshot, type ReadingTheme } from './model';
import { readingThemeCss, renderReadingHtml } from './render';

interface ReaderTestDom { window: Window & typeof globalThis }
interface ReaderVirtualConsole { on(name: string, callback: (error: unknown) => void): void }
const { JSDOM, VirtualConsole } = createRequire(import.meta.url)('jsdom') as {
  JSDOM: new (html: string, options: { url: string; runScripts: string; pretendToBeVisual: boolean; virtualConsole: ReaderVirtualConsole; beforeParse(window: Window & typeof globalThis): void }) => ReaderTestDom;
  VirtualConsole: new () => ReaderVirtualConsole;
};

const item = (id: number): ReadingItem => ({ id, name: `acme/tool-${id}`, url: `https://github.com/acme/tool-${id}`, categoryId: 'tools', category: '开发工具', summary: '一个帮助开发者整理研究资料、管理项目笔记并生成结构化内容的开源工具。支持离线使用与 Markdown 导出，适合个人知识管理。', description: 'Original description', tags: ['工具', '笔记', '离线', 'extra'], language: 'TypeScript', stars: 4000, updated: '2026-10-02T00:00:00Z', analysis: [{ key: 'features', title: '主要功能', kind: 'list', text: '', values: ['本地笔记', '<script>unsafe</script>'] }, { key: 'quickstart', title: '快速开始', kind: 'steps', text: '', steps: [{ description: '安装', command: 'npm install\nnpm start' }] }], sources: [{ label: 'README', url: 'https://github.com/acme/tool#readme' }], generatedAt: '2026-10-01T00:00:00Z', reason: '', state: emptyReadingState() });
const fixture = (count = 2): ReadingSnapshot => ({ version: 2, id: 'reader-fixture', accountId: '42', generatedAt: '2026-10-03T00:00:00Z', title: '项目阅读', settings: structuredClone(defaultSettings), items: Object.fromEntries(Array.from({ length: count }, (_, i) => [String(i + 1), item(i + 1)])), sections: [{ id: 'repositories', title: '收藏仓库', kind: 'repositories', updatedAt: '', items: [], entries: Array.from({ length: count }, (_, i) => ({ repoId: i + 1 })) }, { id: 'trending', title: '趋势', kind: 'builtin', updatedAt: '', items: [], entries: [{ repoId: 1, reason: 'Discovery context' }] }, { id: 'custom', title: '研究工具', kind: 'custom', updatedAt: '', items: [], editions: [{ id: 'latest', date: '2026-10-03', generatedAt: '', complete: true, entries: [{ repoId: 1, reason: 'Latest reason' }] }, { id: 'past', date: '2026-10-02', generatedAt: '', complete: false, entries: [{ repoId: 2 }] }] }] });
const windows: ReaderTestDom[] = [];
const load = (snapshot: ReadingSnapshot, options: { scrollEvents?: boolean } = {}) => {
  const errors: unknown[] = [];
  const console = new VirtualConsole(); console.on('jsdomError', error => { if (!String(error).includes('Could not parse CSS')) errors.push(error); });
  const dom = new JSDOM(renderReadingHtml(snapshot), { url: 'https://reader.test/file.html', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: console, beforeParse(window) { window.scrollTo = () => { if (options.scrollEvents) window.dispatchEvent(new window.Event('scroll')); }; window.matchMedia = () => ({ matches: false } as MediaQueryList); window.HTMLDialogElement.prototype.showModal = function() { this.setAttribute('open', ''); }; window.HTMLDialogElement.prototype.close = function() { this.removeAttribute('open'); }; } });
  windows.push(dom); return { dom, document: dom.window.document, errors };
};
const click = (document: Document, selector: string) => { const element = document.querySelector(selector) as HTMLElement; expect(element, selector).toBeTruthy(); element.click(); };
const exported = (document: Document) => { click(document, '#export'); return parseReadingReturn((document.getElementById('return-text') as HTMLTextAreaElement).value); };
const restoreFile = async (dom: ReaderTestDom, data: unknown) => { const input = dom.window.document.getElementById('restore') as HTMLInputElement; const text = JSON.stringify(data); Object.defineProperty(input, 'files', { configurable: true, value: [{ size: text.length, text: async () => text }] }); input.dispatchEvent(new dom.window.Event('change')); await new Promise(resolve => setTimeout(resolve, 15)); };
afterEach(() => { windows.splice(0).forEach(dom => dom.window.close()); });

describe('standalone desktop reading view', () => {
  it('expands search on demand without clearing queries, and keeps full detail identity once', () => {
    const { document, dom, errors } = load(fixture());
    expect(document.getElementById('search-row')?.hidden).toBe(true);
    click(document, '#search-toggle');
    expect(document.getElementById('search-row')?.hidden).toBe(false);
    expect(document.getElementById('search-toggle')?.getAttribute('aria-expanded')).toBe('true');
    const input = document.getElementById('search') as HTMLInputElement;
    input.value = 'tool-2'; input.dispatchEvent(new dom.window.Event('input'));
    click(document, '#search-toggle');
    expect(document.getElementById('search-row')?.hidden).toBe(true);
    expect(document.querySelectorAll('.project')).toHaveLength(1);
    click(document, '#search-toggle'); expect(input.value).toBe('tool-2');
    click(document, '[data-open="2"]');
    expect(document.getElementById('detail-title')?.textContent).toBe('acme/tool-2');
    expect(document.querySelector('#detail-hero .detail-identity')).toBeNull();
    expect(document.getElementById('detail-tabs')?.parentElement?.id).toBe('detail-page');
    expect(document.getElementById('section-description')?.closest('dialog')?.id).toBe('information');
    expect(document.getElementById('theme')?.closest('dialog')?.id).toBe('information');
    expect(errors).toEqual([]);
  });
  it('renders only a first batch, then keeps at most 120 real cards for 5,000 projects', () => {
    const snapshot = fixture(5000); const html = renderReadingHtml(snapshot);
    expect((html.match(/<article class="project"/g) || []).length).toBe(40);
    const { document, errors } = load(snapshot);
    expect(document.querySelectorAll('.project')).toHaveLength(40);
    for (let i = 0; i < 6; i++) click(document, '#load-more');
    expect(document.querySelectorAll('.project')).toHaveLength(120);
    expect(Number((document.querySelector('.project') as HTMLElement).dataset.id)).toBeGreaterThan(40);
    expect(document.getElementById('result-count')?.textContent).toBe('5000 个项目');
    expect(errors).toEqual([]);
  });
  it('opens full screen structured analysis, with commands and no empty maintenance tab', () => {
    const { document, errors } = load(fixture());
    expect(document.querySelector('.card-main')?.textContent).not.toContain('Original description');
    expect(document.querySelector('.project')?.querySelectorAll('.tags span')).toHaveLength(3);
    click(document, '[data-open="1"]');
    expect(document.getElementById('detail-page')?.hidden).toBe(false);
    expect(document.querySelectorAll('#detail-content ul li')).toHaveLength(2);
    expect(document.querySelector('#detail-content script')).toBeNull();
    expect(document.querySelector('[data-tab="maintenance"]')).toBeNull();
    expect(document.querySelector('.sources')?.hasAttribute('open')).toBe(false);
    click(document, '[data-tab="usage"]');
    expect(document.querySelector('pre code')?.textContent).toBe('npm install\nnpm start');
    const data = exported(document); expect(data.operations).toMatchObject([{ repoId: 1, field: 'read', base: false, value: true }]);
    expect(errors).toEqual([]);
  });
  it('uses per-channel reason and mirrors reading state in repository and discovery', () => {
    const { document } = load(fixture());
    click(document, '[data-action="interest"][data-repo="1"]'); click(document, '[data-action="candidate"][data-repo="1"]');
    click(document, '[data-page="discovery"]');
    expect(document.querySelector('[data-action="interest"][data-repo="1"]')?.getAttribute('aria-pressed')).toBe('true');
    expect(document.querySelector('[data-action="candidate"][data-repo="1"]')?.getAttribute('aria-pressed')).toBe('true');
    expect(document.querySelector('.project')?.textContent).not.toContain('Discovery context');
    click(document, '[data-open="1"]'); expect(document.getElementById('detail-content')?.textContent).toContain('Discovery context');
  });
  it('keeps searches independently and opens latest custom edition by default', () => {
    const { document, dom } = load(fixture());
    const input = document.getElementById('search') as HTMLInputElement; input.value = 'tool-2'; input.dispatchEvent(new dom.window.Event('input'));
    expect(document.querySelectorAll('.project')).toHaveLength(1);
    click(document, '[data-page="discovery"]'); expect(input.value).toBe('');
    const custom = [...document.querySelectorAll('#channel-tabs button')].find(element => element.textContent === '研究工具') as HTMLElement; custom.click();
    expect((document.getElementById('edition-select') as HTMLSelectElement).value).toBe('latest');
    const select = document.getElementById('edition-select') as HTMLSelectElement; select.value = 'past'; select.dispatchEvent(new dom.window.Event('change'));
    expect(document.querySelector('.project')?.getAttribute('data-id')).toBe('2');
    click(document, '[data-page="repositories"]'); expect(input.value).toBe('tool-2');
  });
  it('does not return inherited resume positions after programmatic scroll events', async () => {
    const snapshot = fixture(); snapshot.resume = [{ viewId: 'repositories', repoId: 2 }]; snapshot.activeViewId = 'repositories';
    const { document } = load(snapshot, { scrollEvents: true }); await new Promise(resolve => setTimeout(resolve, 120)); const before = exported(document);
    expect(before.version).toBe(2); if (before.version === 2) { expect(before.positions).toEqual([]); expect(before.activeView).toBeNull(); }
  });
  it('returns stable operation and position ids when exported repeatedly without edits', () => {
    const { document } = load(fixture()); click(document, '[data-open="1"]');
    const first = exported(document), second = exported(document); expect(first).toEqual(second);
  });
  it('preserves a newer note when restoring older return JSON', async () => {
    const { document, dom } = load(fixture()); click(document, '[data-open="1"]');
    const note = document.querySelector('textarea[data-field="note"]') as HTMLTextAreaElement;
    note.value = 'old note'; note.dispatchEvent(new dom.window.Event('input', { bubbles: true })); const older = exported(document);
    note.value = 'new note'; note.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    await restoreFile(dom, older);
    expect((document.querySelector('textarea[data-field="note"]') as HTMLTextAreaElement).value).toBe('new note');
    expect(document.getElementById('notice')?.textContent).toContain('本地修改已保留');
    expect(exported(document).operations.find(op => op.field === 'note')?.value).toBe('new note');
  });
  it.each(['numeric string', 'unknown key'])('rejects invalid strict return data: %s', async kind => {
    const { document, dom } = load(fixture()); click(document, '[data-open="1"]'); const value = exported(document);
    const tampered = structuredClone(value) as unknown as { operations: Array<Record<string, unknown>> }; if (kind === 'numeric string') tampered.operations[0].repoId = '1'; else tampered.operations[0].unexpected = true;
    await restoreFile(dom, tampered); expect(document.getElementById('notice')?.textContent).toContain('不匹配');
    expect(exported(document)).toEqual(value);
  });
  it('rejects same IDs with different local content before restoring any fields', async () => {
    const { document, dom } = load(fixture()); click(document, '[data-open="1"]'); const before = exported(document);
    const tampered = structuredClone(before); tampered.operations[0].repoId = 2;
    await restoreFile(dom, tampered);
    expect(document.getElementById('notice')?.textContent).toContain('ID 与本地内容不一致');
    expect(exported(document)).toEqual(before);
  });
  it('exports a new explicit reversal when a previously exported field returns to its original value', () => {
    const { document } = load(fixture()); click(document, '[data-action="candidate"][data-repo="1"]'); const first = exported(document);
    click(document, '[data-action="candidate"][data-repo="1"]'); const reversed = exported(document);
    expect(reversed.operations).toHaveLength(1); expect(reversed.operations[0]).toMatchObject({ field: 'candidate', base: false, value: false }); expect(reversed.operations[0].id).not.toBe(first.operations[0].id);
  });
  it('returns to the most recently visited discovery channel', () => {
    const { document } = load(fixture()); click(document, '[data-page="discovery"]');
    ([...document.querySelectorAll('#channel-tabs button')].find(element => element.textContent === '研究工具') as HTMLElement).click();
    ([...document.querySelectorAll('#channel-tabs button')].find(element => element.textContent === '趋势') as HTMLElement).click();
    click(document, '[data-page="repositories"]'); click(document, '[data-page="discovery"]');
    expect(document.getElementById('section-title')?.textContent).toBe('趋势');
  });
  it('respects disabled auto-read operations and renders legacy snapshots with v1 return', () => {
    const snapshot = fixture(); snapshot.version = 1; snapshot.settings.operations.read = false; snapshot.items = undefined; snapshot.sections = [{ id: 'repositories', title: '仓库', updatedAt: '', items: [item(1)] }];
    const { document } = load(snapshot); click(document, '[data-open="1"]');
    const data = exported(document); expect(data.version).toBe(1); expect(data.operations).toEqual([]);
  });
  it('supports manual read, full summaries, collapsed original text and adjacent navigation without stacking detail history', async () => {
    const snapshot=fixture(3);snapshot.settings.autoRead=false;snapshot.items!['1'].summary='长摘要。'.repeat(900);
    const {document,dom,errors}=load(snapshot);
    expect(document.querySelector('.summary')?.textContent).toBe(snapshot.items!['1'].summary);
    click(document,'[data-open="1"]');
    expect(document.querySelector('.folded-block summary')?.textContent).toBe('原始介绍');
    expect(exported(document).operations).toEqual([]);click(document,'#close-export');await new Promise(resolve=>setTimeout(resolve,30));
    click(document,'#detail-options-open');click(document,'#next-project');await new Promise(resolve=>setTimeout(resolve,30));
    expect(document.getElementById('detail-title')?.textContent).toBe('acme/tool-2');
    expect(dom.window.history.state.detail).toBe(2);
    await new Promise<void>(resolve => {
      dom.window.addEventListener('popstate', () => resolve(), { once: true });
      dom.window.history.back();
    });
    expect(document.getElementById('detail-page')?.hidden).toBe(true);
    expect(errors).toEqual([]);
  });
  it('filters reading states locally and preserves them after reload', () => {
    const snapshot=fixture(3);snapshot.items!['1'].state.read=true;snapshot.items!['2'].state.interest='interested';
    const {document}=load(snapshot);click(document,'#reading-view-open');
    ([...document.querySelectorAll('#drawer-content button')].find(el=>el.textContent==='未读') as HTMLElement).click();
    expect(document.querySelectorAll('.project')).toHaveLength(2);
    expect(document.querySelector('[data-open="1"]')).toBeNull();
    click(document,'#reading-view-open');
    ([...document.querySelectorAll('#drawer-content button')].find(el=>el.textContent==='感兴趣') as HTMLElement).click();
    expect(document.querySelectorAll('.project')).toHaveLength(1);
    click(document,'[data-action="interest"][data-repo="2"]');
    expect(document.querySelectorAll('.project')).toHaveLength(0);
  });
  it('applies each view profile and preserves other channel contexts', () => {
    const snapshot=fixture();snapshot.settings.repositoryProfile={cardFields:['summary'],detailModes:{quickstart:'omit'}};snapshot.settings.channelProfiles={trending:{detailModes:{features:'collapsed'}}};
    const {document}=load(snapshot);expect(document.querySelector('.project .tags')).toBeNull();click(document,'[data-open="1"]');
    expect(document.querySelector('[data-tab="usage"]')).toBeNull();
    expect(document.getElementById('detail-content')?.textContent).toContain('其他入选频道');
    click(document,'[data-page="discovery"]');click(document,'[data-open="1"]');
    expect([...document.querySelectorAll('.folded-block summary')].map(el=>el.textContent)).toContain('主要功能');
  });
  it('keeps exported existing notes collapsed while preserving the note editor and return base',()=>{
    const snapshot=fixture();snapshot.settings.fields.notes=true;snapshot.settings.defaultProfile={detailModes:{notes:'collapsed'}};snapshot.items!['1'].state.note='已有阅读笔记';
    const {document}=load(snapshot);click(document,'[data-open="1"]');const fold=document.querySelector('#detail-reading .folded-block');expect(fold?.hasAttribute('open')).toBe(false);expect(fold?.querySelector('textarea')?.value).toBe('已有阅读笔记');expect(exported(document).operations.every(op=>op.field!=='note')).toBe(true);
  });
  it('strips CSS injection, remote CSS and unsafe links from rendering', () => {
    const theme: ReadingTheme = { presetId: 'x', label: 'x', mode: 'light', light: { primary: '150 50% 45%', background: '0 0% 100%;}@import url(https://evil)' }, dark: { primary: '150 50% 50%' }, radius: '1rem;}</style>', shadow: 'url(https://evil)', fontSans: 'x;</style><script>', fontMono: 'ui-monospace', reducedMotion: false };
    const css = readingThemeCss(theme); expect(css).toContain('--primary:150 50% 45%'); expect(css).not.toContain('evil'); expect(css).not.toContain('</style>');
    const snapshot = fixture(); snapshot.items!['1'].summary = '</script><img src=x onerror=alert(1)>'; snapshot.items!['1'].url = 'javascript:alert(1)';
    const { document, errors } = load(snapshot); click(document, '[data-open="1"]');
    expect(document.querySelector('#detail-content img')).toBeNull(); expect(document.getElementById('detail-github')?.hidden).toBe(true); expect(errors).toEqual([]);
  });
});
