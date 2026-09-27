import { translatePageTexts } from './pageTranslationClient';

export type PageTranslationStatus = 'original' | 'translating' | 'translated' | 'error';
type TranslateBatch = (texts: string[]) => Promise<string[]>;
type Entry = { node: Text | Element; attribute?: string; original: string; translated?: string };
const ATTRIBUTES = ['title', 'aria-label', 'alt', 'placeholder'];
const EXCLUDED = [
  'script', 'style', 'noscript', 'pre', 'code', 'kbd', 'samp', 'textarea',
  'svg', 'math', 'canvas', 'iframe', '[contenteditable]:not([contenteditable="false"])',
  '[translate="no"]', '.notranslate', '[data-translation-ignore]', '[data-sensitive]',
  '.katex', '.mermaid', '[hidden]', '[aria-hidden="true"]',
].join(',');

function eligible(value: string): boolean {
  return /[a-zA-Z]{2}/.test(value) &&
    !/https?:\/\/|[\w.+-]+@[\w.-]+\.\w+|(?:gh[pousr]_|github_pat_|sk-)[\w-]+|bearer\s+\S+/i.test(value) &&
    !/^[\w.-]+\/[\w./-]+$/.test(value.trim());
}

/**
 * Translate text nodes in place: never replace elements/innerHTML owned by React.
 * Original values are restored only when they still match our last write.
 */
export class PageTranslationController {
  private entries = new Map<Node, Map<string, Entry>>();
  private cache = new Map<string, string>();
  private failed = new Set<string>();
  private pending = new Set<string>();
  private observer?: MutationObserver;
  private timer?: ReturnType<typeof setTimeout>;
  private generation = 0;
  private active = 0;
  private root?: HTMLElement;
  private status: PageTranslationStatus = 'original';
  private listeners = new Set<() => void>();

  constructor(private translateBatch: TranslateBatch = translatePageTexts) {}
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  getSnapshot = () => this.status;
  private report(status: PageTranslationStatus) {
    if (status === this.status) return;
    this.status = status;
    this.listeners.forEach((listener) => listener());
  }
  private read(entry: Entry) {
    return entry.attribute
      ? (entry.node as Element).getAttribute(entry.attribute)
      : entry.node.nodeValue;
  }
  private write(entry: Entry, value: string) {
    if (entry.attribute) (entry.node as Element).setAttribute(entry.attribute, value);
    else entry.node.nodeValue = value;
  }
  private allowed(node: Node) {
    const element = node instanceof Element ? node : node.parentElement;
    return !!element && !element.closest(EXCLUDED) &&
      !(element instanceof HTMLInputElement && element.type === 'password');
  }
  private remember(node: Text | Element, value: string, attribute = '') {
    const existing = this.entries.get(node)?.get(attribute);
    if (existing && (value === existing.translated || value === existing.original)) return;
    this.entries.get(node)?.delete(attribute);
    if (!eligible(value) || !this.allowed(node)) return;
    if (!this.entries.has(node)) this.entries.set(node, new Map());
    this.entries.get(node)!.set(attribute, { node, attribute, original: value });
  }
  private schedule = () => {
    if (this.timer || !this.root) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.scan();
    }, 100);
  };
  start(root: HTMLElement) {
    this.stop();
    this.root = root;
    this.observer = new MutationObserver(this.schedule);
    this.observer.observe(root, {
      subtree: true, childList: true, characterData: true, attributes: true,
      attributeFilter: [...ATTRIBUTES, 'class', 'hidden', 'aria-hidden', 'translate', 'contenteditable', 'data-sensitive', 'data-translation-ignore'],
    });
    this.scan();
  }
  stop() {
    this.generation++;
    this.observer?.disconnect();
    clearTimeout(this.timer);
    this.timer = undefined;
    for (const entries of this.entries.values()) for (const entry of entries.values()) {
      if (entry.translated !== undefined && this.read(entry) === entry.translated) {
        this.write(entry, entry.original);
      }
    }
    this.entries.clear();
    this.pending.clear();
    this.failed.clear();
    this.active = 0;
    this.root = undefined;
    this.report('original');
  }
  retry() {
    this.failed.clear();
    this.scan();
  }
  private scan() {
    const root = this.root;
    if (!root) return;
    for (const [node, entries] of this.entries) {
      if (!root.contains(node)) { this.entries.delete(node); continue; }
      if (!this.allowed(node)) {
        for (const entry of entries.values()) {
          if (entry.translated !== undefined && this.read(entry) === entry.translated) this.write(entry, entry.original);
        }
        this.entries.delete(node);
      }
    }
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    let node: Node | null = root;
    while (node) {
      if (node instanceof Text) this.remember(node, node.data);
      else if (node instanceof Element && this.allowed(node)) {
        for (const attribute of ATTRIBUTES) {
          const value = node.getAttribute(attribute);
          if (value) this.remember(node, value, attribute);
        }
      }
      node = walker.nextNode();
    }
    const queue = new Set<string>();
    const liveOriginals = new Set<string>();
    for (const entries of this.entries.values()) for (const entry of entries.values()) {
      liveOriginals.add(entry.original);
      const current = this.read(entry);
      if (current !== entry.original || entry.translated === current) continue;
      const cached = this.cache.get(entry.original);
      if (cached !== undefined) {
        entry.translated = cached;
        if (cached !== current) this.write(entry, cached);
      } else if (!this.pending.has(entry.original) && !this.failed.has(entry.original)) {
        queue.add(entry.original);
      }
    }
    for (const text of this.failed) if (!liveOriginals.has(text)) this.failed.delete(text);
    const texts = [...queue];
    while (texts.length && this.active < 2) {
      const batch: string[] = [];
      let chars = 0;
      while (texts.length && batch.length < 40 && (!batch.length || chars + texts[0].length <= 6000)) {
        const text = texts.shift()!;
        batch.push(text);
        chars += text.length;
      }
      if (!batch.length) break;
      batch.forEach((text) => this.pending.add(text));
      this.active++;
      void this.run(batch, this.generation);
    }
    this.report(this.active ? 'translating' : this.failed.size ? 'error' : 'translated');
  }
  private async run(batch: string[], generation: number) {
    try {
      const results = await this.translateBatch(batch);
      if (generation !== this.generation) return;
      if (results.length !== batch.length || results.some((text) => typeof text !== 'string' || !text)) throw new Error('Invalid translation');
      batch.forEach((text, index) => this.cache.set(text, results[index]));
      while (this.cache.size > 2000) this.cache.delete(this.cache.keys().next().value!);
    } catch {
      if (generation !== this.generation) return;
      batch.forEach((text) => this.failed.add(text));
    } finally {
      if (generation === this.generation) {
        this.active--;
        batch.forEach((text) => this.pending.delete(text));
        this.schedule();
      }
    }
  }
}

export const pageTranslation = new PageTranslationController();
