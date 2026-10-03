import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import MarkdownRenderer from '../components/MarkdownRenderer';
import mermaid from 'mermaid';

vi.mock('../store/useAppStore', () => ({
  useAppStore: vi.fn((selector) => {
    const state = {
      language: 'zh',
      theme: 'dark',
      githubToken: null,
      setReadmeModalOpen: vi.fn(),
    };
    return selector ? selector(state) : state;
  }),
}));

vi.mock('mermaid', () => ({
  default: {
    initialize: vi.fn(),
    parse: vi.fn().mockResolvedValue(true),
    render: vi.fn().mockResolvedValue({ svg: '<svg>diagram</svg>' }),
  },
}));

describe('MarkdownRenderer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('incremental output', () => {
    it('keeps an open fence plain, then highlights all newly completed code', () => {
      const { container, rerender } = render(<MarkdownRenderer isGenerating content={'```js\nconst x ='} />);
      expect(container.querySelector('.hljs')).toBeNull();
      rerender(<MarkdownRenderer isGenerating content={'```js\nconst x = 42;\n```'} />);
      expect(container.querySelector('.hljs')).toHaveTextContent('const x = 42;');
      expect(container.querySelector('.hljs-number')).toHaveTextContent('42');
      rerender(<MarkdownRenderer content={'```js\nconst x = 43;\n```'} />);
      expect(container.querySelector('.hljs-number')).toHaveTextContent('43');
    });
    it('renders unknown languages as escaped, copyable text', () => {
      const { container } = render(<MarkdownRenderer content={'```unknown-lang\n<script>unsafe()</script>\n```'} />);
      expect(container.querySelector('code')).toHaveTextContent('<script>unsafe()</script>');
      expect(container.querySelector('script')).toBeNull();
      expect(screen.getByRole('button', { name: '复制代码' })).toBeEnabled();
    });
    it('defers Mermaid until generation ends and falls back to source on invalid syntax', async () => {
      const { container, rerender } = render(<MarkdownRenderer isGenerating content={'```mermaid\ngraph TD\nA--'} />);
      expect(mermaid.render).not.toHaveBeenCalled();
      expect(container.querySelector('code')).toHaveTextContent('graph TD');
      vi.mocked(mermaid.render).mockRejectedValueOnce(new Error('internal parser dump'));
      rerender(<MarkdownRenderer content={'```mermaid\ngraph TD\nA--\n```'} />);
      await waitFor(() => expect(mermaid.render).toHaveBeenCalledOnce());
      await waitFor(() => expect(container.querySelector('pre')).toHaveTextContent('graph TD'));
      expect(screen.queryByText('internal parser dump')).not.toBeInTheDocument();
    });
  });

  describe('Basic Rendering', () => {
    it('should render plain text', () => {
      render(<MarkdownRenderer content="Hello World" />);
      expect(screen.getByText('Hello World')).toBeInTheDocument();
    });

    it('should render headings with correct hierarchy', () => {
      const { container } = render(
        <MarkdownRenderer content="# Heading 1" />
      );
      expect(container.querySelector('h1')).toHaveTextContent('Heading 1');
    });

    it('should render h4-h6 headings', () => {
      const { container } = render(
        <MarkdownRenderer content="#### Heading 4" />
      );
      expect(container.querySelector('h4')).toHaveTextContent('Heading 4');
    });

    it('should render bold text', () => {
      const { container } = render(<MarkdownRenderer content="**bold text**" />);
      expect(container.querySelector('strong')).toHaveTextContent('bold text');
    });

    it('should render italic text', () => {
      const { container } = render(<MarkdownRenderer content="*italic text*" />);
      expect(container.querySelector('em')).toHaveTextContent('italic text');
    });

    it('should render inline code', () => {
      const { container } = render(<MarkdownRenderer content="`inline code`" />);
      const code = container.querySelector('code');
      expect(code).toHaveTextContent('inline code');
      expect(code).not.toHaveClass('language-');
    });

    it('should render code blocks with language', () => {
      const { container } = render(
        <MarkdownRenderer content={'```javascript\nconsole.log("hello");\n```'} />
      );
      expect(container.querySelector('.language-javascript')).toBeInTheDocument();
    });

    it('should render unordered lists', () => {
      const { container } = render(
        <MarkdownRenderer content="- Item 1" />
      );
      expect(container.querySelector('ul')).toBeInTheDocument();
      expect(container.querySelector('li')).toBeInTheDocument();
    });

    it('should render ordered lists', () => {
      const { container } = render(
        <MarkdownRenderer content="1. Item 1" />
      );
      expect(container.querySelector('ol')).toBeInTheDocument();
      expect(container.querySelector('li')).toBeInTheDocument();
    });

    it('should render blockquotes', () => {
      const { container } = render(<MarkdownRenderer content="> quoted text" />);
      expect(container.querySelector('blockquote')).toHaveTextContent('quoted text');
    });

    it('should render horizontal rule', () => {
      const { container } = render(<MarkdownRenderer content="---" />);
      expect(container.querySelector('hr')).toBeInTheDocument();
    });

    it('should render tables', () => {
      const content = `| Header 1 | Header 2 |
|----------|----------|
| Cell 1   | Cell 2   |`;
      const { container } = render(<MarkdownRenderer content={content} />);
      expect(container.querySelector('table')).toBeInTheDocument();
      expect(container.querySelector('thead')).toBeInTheDocument();
      expect(container.querySelector('tbody')).toBeInTheDocument();
    });
  });

  describe('Links', () => {
    it('should render external links with target _blank', () => {
      const { container } = render(
        <MarkdownRenderer content="[External Link](https://example.com)" />
      );
      const link = container.querySelector('a');
      expect(link).toHaveAttribute('href', 'https://example.com');
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    });

    it('should render mailto links without target _blank', () => {
      const { container } = render(
        <MarkdownRenderer content="[Email](mailto:test@example.com)" />
      );
      const link = container.querySelector('a');
      expect(link).toHaveAttribute('href', 'mailto:test@example.com');
      expect(link).not.toHaveAttribute('target', '_blank');
    });

    it('should handle anchor links with headingIds', () => {
      const headingIds = new Map<string, string>();
      headingIds.set('section-1', 'heading-0');
      
      const { container } = render(
        <MarkdownRenderer 
          content="[Jump to Section](#section-1)" 
          headingIds={headingIds}
        />
      );
      const link = container.querySelector('a');
      expect(link).toHaveAttribute('href', '#section-1');
      expect(link).not.toHaveAttribute('target', '_blank');
    });

    it('should resolve relative links with baseUrl', () => {
      const { container } = render(
        <MarkdownRenderer 
          content="[Relative Link](./docs/guide.md)"
          baseUrl="https://github.com/user/repo"
        />
      );
      const link = container.querySelector('a');
      expect(link?.getAttribute('href')).toContain('github.com');
    });
  });

  describe('Images', () => {
    it('should render images', () => {
      const { container } = render(
        <MarkdownRenderer content="![Alt text](https://example.com/image.png)" />
      );
      const img = container.querySelector('img');
      expect(img).toHaveAttribute('src', 'https://example.com/image.png');
      expect(img).toHaveAttribute('alt', 'Alt text');
    });

    it('should resolve relative image URLs with baseUrl', () => {
      const { container } = render(
        <MarkdownRenderer 
          content="![Image](./images/logo.png)"
          baseUrl="https://github.com/user/repo"
        />
      );
      const img = container.querySelector('img');
      expect(img?.getAttribute('src')).toContain('github.com');
    });
  });

  describe('Code Blocks', () => {
    it('should render GitHub-native code blocks without manual line numbers', () => {
      const content = '```javascript\nline1\nline2\nline3\nline4\n```';
      const { container } = render(<MarkdownRenderer content={content} />);
      expect(container.querySelector('pre')).toBeInTheDocument();
      expect(container.querySelector('code.language-javascript')).toBeInTheDocument();
      // No synthetic line-number column
      const pre = container.querySelector('pre');
      expect(pre?.querySelectorAll('span[aria-hidden="true"]')).toHaveLength(0);
    });

    it('should provide a hover copy button for code blocks', () => {
      const content = '```javascript\nconsole.log("hello");\n```';
      const { container } = render(<MarkdownRenderer content={content} />);
      expect(container.querySelector('button[aria-label="复制代码"]')).toBeInTheDocument();
    });

    it('should normalize language aliases', () => {
      const { container } = render(
        <MarkdownRenderer content={'```sh\necho "hello"\n```'} />
      );
      expect(container.querySelector('.language-bash')).toBeInTheDocument();
    });

    it('should render mermaid fences as diagrams', async () => {
      const { container } = render(
        <MarkdownRenderer content={'```mermaid\nflowchart TD\nA-->B\n```'} />
      );
      await waitFor(() => {
        expect(container.querySelector('.mermaid')).toBeInTheDocument();
      });
      expect(container.querySelector('.mermaid')).toHaveTextContent('diagram');
    });
  });

  describe('GitHub Flavored Markdown', () => {
    it('should render task lists', () => {
      const { container } = render(
        <MarkdownRenderer content="- [x] Task 1" />
      );
      const checkboxes = container.querySelectorAll('input[type="checkbox"]');
      expect(checkboxes).toHaveLength(1);
      expect(checkboxes[0]).toHaveAttribute('checked');
    });

    it('should render strikethrough', () => {
      const { container } = render(<MarkdownRenderer content="~~strikethrough~~" />);
      expect(container.querySelector('del')).toHaveTextContent('strikethrough');
    });

    it('should render tables with alignment', () => {
      const content = `| Left | Center | Right |
|:-----|:------:|------:|
| L1   | C1     | R1    |`;
      const { container } = render(<MarkdownRenderer content={content} />);
      expect(container.querySelector('table')).toBeInTheDocument();
    });
  });

  describe('Performance Optimizations', () => {
    it('should not re-render when content is the same', () => {
      const { rerender } = render(<MarkdownRenderer content="Test content" />);
      const initialElement = screen.getByText('Test content');
      
      rerender(<MarkdownRenderer content="Test content" />);
      const afterElement = screen.getByText('Test content');
      
      expect(initialElement).toBe(afterElement);
    });

    it('should handle empty content gracefully', () => {
      const { container } = render(<MarkdownRenderer content="" />);
      expect(container.querySelector('.markdown-body')).toBeInTheDocument();
    });
  });

  describe('shouldRender prop', () => {
    it('should show loading state when shouldRender is false', () => {
      render(<MarkdownRenderer content="Test" shouldRender={false} />);
      expect(screen.getByText('Loading…')).toBeInTheDocument();
    });
  });

  describe('enableHtml prop', () => {
    it('should render HTML when enableHtml is true', () => {
      const { container } = render(
        <MarkdownRenderer 
          content='<strong>HTML content</strong>' 
          enableHtml={true} 
        />
      );
      expect(container.querySelector('strong')).toBeInTheDocument();
    });
  });

  describe('Heading IDs', () => {
    it('should assign IDs to headings from headingIds map', () => {
      const headingIds = new Map<string, string>();
      headingIds.set('Test Heading', 'custom-id-123');

      const { container } = render(
        <MarkdownRenderer
          content="# Test Heading"
          headingIds={headingIds}
        />
      );
      const h1 = container.querySelector('h1');
      expect(h1).toHaveAttribute('id', 'custom-id-123');
    });

    it('should generate unique IDs for headings not in map', () => {
      const { container } = render(
        <MarkdownRenderer content="# New Heading" />
      );
      const h1 = container.querySelector('h1');
      expect(h1?.getAttribute('id')).toMatch(/^heading-extra-\d+$/);
    });

    it('should disambiguate duplicate headings by occurrence count', () => {
      const headingIds = new Map<string, string>();
      headingIds.set('Setup', 'heading-0');
      headingIds.set('Setup__1', 'heading-1');

      const { container } = render(
        <MarkdownRenderer
          content={'# Setup\n\n# Setup'}
          headingIds={headingIds}
        />
      );
      const [first, second] = Array.from(container.querySelectorAll('h1'));
      expect(first).toHaveAttribute('id', 'heading-0');
      expect(second).toHaveAttribute('id', 'heading-1');
    });
  });

  describe('GitHub Alerts', () => {
    const alertContent = '> [!NOTE]\n> Useful information';

    it('should render GitHub alerts as markdown-alert blocks', () => {
      const { container } = render(<MarkdownRenderer content={alertContent} />);
      const alert = container.querySelector('.markdown-alert.markdown-alert-note');
      expect(alert).toBeInTheDocument();
      expect(alert?.querySelector('.markdown-alert-title')).toHaveTextContent('NOTE');
      expect(alert?.querySelector('svg.octicon')).toBeInTheDocument();
    });

    it('should keep alerts intact when HTML sanitization is enabled', () => {
      const { container } = render(
        <MarkdownRenderer content={alertContent} enableHtml={true} />
      );
      const alert = container.querySelector('.markdown-alert.markdown-alert-note');
      expect(alert).toBeInTheDocument();
      expect(alert?.querySelector('svg.octicon path')).toHaveAttribute('d');
    });

    it('should still render plain blockquotes untouched', () => {
      const { container } = render(<MarkdownRenderer content="> quoted text" />);
      expect(container.querySelector('blockquote')).toHaveTextContent('quoted text');
      expect(container.querySelector('.markdown-alert')).not.toBeInTheDocument();
    });
  });

  describe('Gemoji shortcodes', () => {
    it('should convert :smile: to its unicode emoji', () => {
      const { container } = render(<MarkdownRenderer content="Great job! :smile:" />);
      // :smile: → U+1F604 (😄); written as a codepoint so the assertion
      // can't silently pass for a visually similar emoji
      expect(container.querySelector('p')).toHaveTextContent('Great job! \u{1F604}');
    });
  });

  describe('breaks prop', () => {
    const twoLines = 'line one\nline two';

    it('should join single newlines into one paragraph by default (GitHub parity)', () => {
      const { container } = render(<MarkdownRenderer content={twoLines} />);
      expect(container.querySelectorAll('p')).toHaveLength(1);
      expect(container.querySelector('br')).toBeNull();
    });

    it('should convert single newlines to <br> when breaks is true', () => {
      const { container } = render(<MarkdownRenderer content={twoLines} breaks={true} />);
      expect(container.querySelector('br')).not.toBeNull();
    });
  });

  describe('Math (KaTeX)', () => {
    it('uses a Safari-compatible inline math detector', () => {
      const source = readFileSync('src/components/MarkdownRenderer.tsx', 'utf8');

      expect(source).not.toContain('(?<!');
    });

    it('should lazily load KaTeX and render display math', async () => {
      const { container } = render(<MarkdownRenderer content="$$E=mc^2$$" />);
      await waitFor(() => {
        expect(container.querySelector('.katex')).toBeInTheDocument();
      }, { timeout: 5000 });
    }, 10000);

    it('should not load math support for plain documents', async () => {
      const { container } = render(<MarkdownRenderer content="Just $5 and text" />);
      // Give the effect a tick; no katex nodes should ever appear
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(container.querySelector('.katex')).toBeNull();
    });
  });
});

describe('Markdown desktop resource stability', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('malformed anchor fragments do not throw and still scroll to their target', () => {
    const { container } = render(<MarkdownRenderer
      content={'# Coverage\n\n[Jump](#100%-coverage)'}
      headingIds={new Map([['Coverage', 'target-coverage'], ['100%-coverage', 'target-coverage']])} />);
    const scroll = vi.spyOn(container.querySelector('h1')!, 'scrollIntoView');
    fireEvent.click(container.querySelector('a')!);
    expect(scroll).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });
  });

  it('protocol-relative links and image URLs use HTTPS, never the desktop file scheme', () => {
    const { container } = render(<MarkdownRenderer content={'[Link](//example.com/link)\n\n![Image](//cdn.example/image.svg)'} />);
    expect(container.querySelector('a')).toHaveAttribute('href', 'https://example.com/link');
    expect(container.querySelector('img')).toHaveAttribute('src', 'https://cdn.example/image.svg');
  });

  it('picture keeps sources and image as direct children and resolves MIME/media/srcset', () => {
    const { container } = render(<MarkdownRenderer enableHtml baseUrl="https://github.com/o/r/issues/123"
      content={'<picture><source media="(prefers-color-scheme: dark)" type="image/svg+xml" srcset="./dark.svg 1x, //cdn.example/dark.svg 2x"><img src="/light.svg" alt="Theme"></picture>'} />);
    const picture = container.querySelector('picture')!;
    expect(picture).toBeInTheDocument();
    expect(picture.children).toHaveLength(2);
    expect(picture.children[0].tagName).toBe('SOURCE');
    expect(picture.children[1].tagName).toBe('IMG');
    expect(picture.children[0]).toHaveAttribute('type', 'image/svg+xml');
    expect(picture.children[0]).toHaveAttribute('media', '(prefers-color-scheme: dark)');
    expect(picture.children[0]).toHaveAttribute('srcset', 'https://github.com/o/r/raw/HEAD/dark.svg 1x, https://cdn.example/dark.svg 2x');
    expect(picture.children[1]).toHaveAttribute('src', 'https://github.com/o/r/raw/HEAD/light.svg');
  });

  it('img srcset also resolves every candidate while dropping unsafe schemes', () => {
    const { container } = render(<MarkdownRenderer enableHtml baseUrl="https://github.com/o/r"
      content={'<img src="fallback.png" srcset="file:///secret 1x, ./high.png 2x, javascript:alert(1) 3x" sizes="100vw" alt="Candidates">'} />);
    expect(container.querySelector('img')).toHaveAttribute('srcset', 'https://github.com/o/r/raw/HEAD/high.png 2x');
    expect(container.querySelector('img')).toHaveAttribute('sizes', '100vw');
  });

  it('HTML sanitization strips executable elements, unsafe URLs and handlers', () => {
    const { container } = render(<MarkdownRenderer enableHtml
      content={'<script>alert(1)</script><iframe src="https://evil.example"></iframe><img src="https://cdn.example/a.png" onerror="alert(1)"><a href="javascript:alert(1)">Unsafe</a><source srcset="data:image/png;base64,AAAA 1x, https://cdn.example/safe.png 2x" onload="alert(1)">'} />);
    expect(container.querySelector('script,iframe')).toBeNull();
    expect(container.querySelector('[onerror],[onload]')).toBeNull();
    expect(container.querySelector('a[href^="javascript:"]')).toBeNull();
    expect(container.querySelector('source')).toHaveAttribute('srcset', 'https://cdn.example/safe.png 2x');
  });

  it('lightbox and download follow currentSrc including a dark source reselection', async () => {
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:fixture');
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const downloads: string[] = [];
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { downloads.push(this.download); });
    vi.mocked(window.fetch).mockResolvedValue(new Response('<svg/>', { headers: { 'Content-Type': 'image/svg+xml;charset=utf-8' } }));
    try {
      const { container } = render(<MarkdownRenderer enableHtml baseUrl="https://github.com/o/r"
        content={'<picture><source media="(prefers-color-scheme: dark)" srcset="dark.svg"><img src="light.svg" alt="Theme"></picture>'} />);
      const image = container.querySelector('img')!;
      Object.defineProperty(image, 'currentSrc', { configurable: true, value: 'https://github.com/o/r/raw/HEAD/dark.svg' });
      Object.defineProperty(image, 'naturalWidth', { configurable: true, value: 600 });
      fireEvent.load(image);
      fireEvent.click(image);
      const preview = document.querySelector('img[draggable="false"]')!;
      expect(preview).toHaveAttribute('src', 'https://github.com/o/r/raw/HEAD/dark.svg');
      Object.defineProperty(image, 'currentSrc', { configurable: true, value: 'https://cdn.example/reselected-dark.svg' });
      fireEvent.load(image);
      expect(preview).toHaveAttribute('src', 'https://cdn.example/reselected-dark.svg');
      fireEvent.click(document.querySelector('button[title="下载图片"]')!);
      await waitFor(() => expect(window.fetch).toHaveBeenCalledWith('https://cdn.example/reselected-dark.svg'));
      await waitFor(() => expect(downloads).toEqual(['Theme.svg']));
      expect(revoke).toHaveBeenCalledWith('blob:fixture');
    } finally { create.mockRestore(); revoke.mockRestore(); click.mockRestore(); }
  });

  it('an image URL change clears old errors and stale selected resources', () => {
    const { container, rerender } = render(<MarkdownRenderer content="![Image](https://cdn.example/old.png)" />);
    fireEvent.error(container.querySelector('img')!);
    expect(container.querySelector('img')).toBeNull();
    rerender(<MarkdownRenderer content="![Image](https://cdn.example/new.png)" />);
    expect(container.querySelector('img')).toHaveAttribute('src', 'https://cdn.example/new.png');
  });

  it('a picture with no fallback image remains valid inert markup', () => {
    const { container } = render(<MarkdownRenderer enableHtml content='<picture><source srcset="//cdn.example/a.svg" type="image/svg+xml"></picture>' />);
    expect(container.querySelector('picture > source')).toHaveAttribute('srcset', 'https://cdn.example/a.svg');
    expect(container.querySelector('img')).toBeNull();
  });

  it('failed download fallback opens the selected resource without saving an HTTP error body', async () => {
    const downloads: Array<{ href: string; target: string; rel: string }> = [];
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      downloads.push({ href: this.href, target: this.target, rel: this.rel });
    });
    vi.mocked(window.fetch).mockResolvedValue(new Response('not an image', { status: 404 }));
    try {
      const { container } = render(<MarkdownRenderer content="![Theme](https://cdn.example/fallback.svg)" />);
      const image = container.querySelector('img')!;
      Object.defineProperty(image, 'currentSrc', { configurable: true, value: 'https://cdn.example/selected.svg' });
      fireEvent.load(image);
      fireEvent.click(container.querySelector('img')!);
      fireEvent.click(document.querySelector('button[title="下载图片"]')!);
      await waitFor(() => expect(downloads).toEqual([{
        href: 'https://cdn.example/selected.svg', target: '_blank', rel: 'noopener noreferrer',
      }]));
    } finally { click.mockRestore(); }
  });
});
