import React, { memo, useEffect, useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import { safeWriteText } from '../utils/clipboardUtils';
import { Button } from './ui/button';
import { Copy, Check } from 'lucide-react';

type MermaidModule = (typeof import('mermaid'))['default'];

let mermaidPromise: Promise<MermaidModule> | null = null;

/** Lazily import the ~1MB mermaid package once and reuse the module promise. */
const loadMermaid = (): Promise<MermaidModule> => {
  mermaidPromise ||= import('mermaid').then((m) => m.default);
  return mermaidPromise;
};

let initializedTheme: 'light' | 'dark' | null = null;
let renderCounter = 0;

/**
 * Renders a ```mermaid fenced block as an SVG diagram.
 *
 * The ~1MB mermaid package is loaded lazily on the first diagram; the SVG is
 * produced by mermaid.render() with securityLevel 'strict' (mermaid sanitizes
 * its own output), so injecting it via dangerouslySetInnerHTML is safe.
 */
const MermaidBlock: React.FC<{ code: string }> = ({ code }) => {
  const theme = useAppStore((state) => state.theme);
  const uiLanguage = useAppStore((state) => state.language);
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setSvg(null); setError(null);
    loadMermaid()
      .then(async (mermaid) => {
        if (initializedTheme !== theme) {
          mermaid.initialize({
            startOnLoad: false, suppressErrorRendering: true,
            securityLevel: 'strict',
            theme: theme === 'dark' ? 'dark' : 'default',
          });
          initializedTheme = theme;
        }
        await mermaid.parse(code); // throws ParseError on invalid syntax
        renderCounter += 1;
        const { svg: rendered } = await mermaid.render(`mermaid-svg-${renderCounter}`, code);
        if (!cancelled) {
          setSvg(rendered);
          setError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setSvg(null);
          setError(err instanceof Error ? err.message : String(err));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [code, theme]);

  if (error) {
    return (
      <div
        data-translate="false"
        role="alert"
        className="my-3 rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive"
      >
        <p className="font-semibold">
          {uiLanguage === 'zh' ? 'Mermaid 图表渲染失败' : 'Failed to render Mermaid diagram'}
        </p>
        <pre className="mt-2 whitespace-pre-wrap break-words font-mono text-xs">{code}</pre>
        <Button variant="ghost" size="sm" onClick={() => void safeWriteText(code).then(result => { setCopied(result.success); setCopyFailed(!result.success); })}>
          {copied ? <Check className="mr-1 h-4 w-4" /> : <Copy className="mr-1 h-4 w-4" />}{uiLanguage.startsWith('zh') ? copied ? '已复制' : '复制源文' : copied ? 'Copied' : 'Copy source'}
        </Button>{copyFailed && <p role="alert">{uiLanguage.startsWith('zh') ? '复制失败，请手动选择源文' : 'Copy failed. Select the source manually.'}</p>}
      </div>
    );
  }

  if (!svg) {
    return <div data-translate="false" className="my-3 h-16 animate-pulse rounded-md bg-muted dark:bg-muted/40" />;
  }

  return (
    <div
      data-translate="false"
      className="mermaid my-3 flex justify-center overflow-x-auto"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
};

MermaidBlock.displayName = 'MermaidBlock';

export default memo(MermaidBlock);
