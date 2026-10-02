



import { useT } from '../i18n/useT';
import { Input } from './ui/input';
import { Button } from './ui/button';
import React, { memo, useState, useCallback, useContext, useEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import ReactMarkdown, { type Components, type ExtraProps } from 'react-markdown';
import type { PluggableList } from 'unified';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import remarkAlert from 'remark-github-blockquote-alert';
import remarkGemoji from 'remark-gemoji';
import { Copy, Check, Download } from 'lucide-react';
import hljs from 'highlight.js';
import MermaidBlock from './MermaidBlock';
import { githubMarkdownSchema } from '../utils/sanitizeSchema';
import { imageExtensionForMimeType } from '../utils/imageDownload';
import { decodeAnchorFragment, resolveMarkdownHref, resolveMarkdownImageSrc, resolveMarkdownSrcSet } from '../utils/markdownResources';
import 'highlight.js/styles/github.min.css';
import '../styles/github-markdown.scoped.css';
import { useAppStore } from '../store/useAppStore';
import { useShallow } from 'zustand/react/shallow';
import { safeWriteText, getClipboardErrorMessage } from '../utils/clipboardUtils';

interface MarkdownRendererProps {
  content: string;
  className?: string;
  shouldRender?: boolean;
  enableHtml?: boolean;
  baseUrl?: string;
  headingIds?: Map<string, string>;
  fontSize?: 'small' | 'medium' | 'large';
  /** Convert single newlines to <br> (GitHub READMEs do not; AI summaries rely on it). */
  breaks?: boolean;
  /**
   * 可选的行内 code 自定义渲染（如仓库问答的引用 Badge）：返回 ReactNode 时替换
   * 默认的 <code>（含 0、''、false 等合法节点）；返回 null/undefined 时保持原样式。
   */
  renderInlineCode?: (text: string) => React.ReactNode | null;
}

// GitHub-style remark pipeline: GFM tables/tasklists/strikethrough, [!NOTE]-style
// alerts, :emoji: shortcodes. remarkBreaks is opt-in via the `breaks` prop.
const BASE_REMARK_PLUGINS = [remarkGfm, remarkAlert, remarkGemoji];
const REHYPE_PLUGINS_NO_HTML: never[] = [];

// Matches $$display$$, \(inline\), \[display\] and $inline$ math so KaTeX is
// only loaded for documents that actually use it.
const MATH_PATTERN =
  /\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\)|\$(?!\s)(?:\\.|[^$\\\n])*?[^\s$\\\n]\$/;

interface MathPlugins {
  remark: typeof import('remark-math')['default'];
  rehype: typeof import('rehype-katex')['default'];
}

// react-markdown 会把 AST 节点作为 `node` prop 传给自定义组件，
// 展开到原生 DOM 元素前需要剥掉这个非 DOM 属性
function stripAstNode<T extends { node?: unknown }>(props: T): Omit<T, 'node'> {
  const rest = { ...props };
  delete (rest as { node?: unknown }).node;
  return rest;
}

/** GitHub-native fenced code block: hljs highlighting plus a hover copy button. */
const CodeBlock: React.FC<{
  children: React.ReactNode;
  language: string;
}> = ({ children, language }) => {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);
  const codeRef = useRef<HTMLElement>(null);
  const { language: uiLanguage } = useAppStore(useShallow((state) => ({
    language: state.language,
  })));

  const normalizedLanguage = useMemo(() => {
    if (!language) return '';
    const langLower = language.toLowerCase();
    const langMap: Record<string, string> = {
      'sh': 'bash',
      'shell': 'bash',
      'zsh': 'bash',
      'fish': 'bash',
      'ksh': 'bash',
      'csh': 'bash',
      'tcsh': 'bash',
      'yml': 'yaml',
      'py': 'python',
      'js': 'javascript',
      'ts': 'typescript',
      'tsx': 'typescript',
      'jsx': 'javascript',
      'rb': 'ruby',
      'cs': 'csharp',
      'kt': 'kotlin',
      'rs': 'rust',
      'go': 'go',
      'md': 'markdown',
    };
    return langMap[langLower] || langLower;
  }, [language]);

  const codeText = useMemo(() => {
    if (typeof children === 'string') {
      return children.replace(/\n$/, '');
    }
    return String(children).replace(/\n$/, '');
  }, [children]);

  useEffect(() => {
    if (codeRef.current) {
      try {
        hljs.highlightElement(codeRef.current);
      } catch (error) {
        console.warn('highlight.js failed:', error);
      }
    }
  }, [children, normalizedLanguage]);

  const handleCopy = useCallback(async () => {
    setCopyError(null);

    const result = await safeWriteText(codeText);

    if (result.success) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } else {
      console.error('Failed to copy:', result.error);
      setCopyError(result.error || getClipboardErrorMessage('write', uiLanguage));
    }
  }, [codeText, uiLanguage]);

  const displayLang = useMemo(() => {
    if (!language) return '';
    return normalizedLanguage ? normalizedLanguage.toUpperCase() : language.toUpperCase();
  }, [language, normalizedLanguage]);

  return (
    <div className="dark group relative my-3 overflow-hidden rounded-lg border border-border/70 bg-zinc-950/95 text-zinc-100 shadow-xs dark:border-border/60">
      {copyError && (
        <div
          data-translate="false"
          role="alert"
          className="absolute top-10 right-2 z-20 max-w-xs rounded-md border border-border bg-background px-3 py-2 text-xs text-foreground shadow-lg dark:bg-card"
        >
          {copyError}
        </div>
      )}
      <div className="flex h-8 items-center justify-between border-b border-white/10 bg-zinc-900/90 px-3 text-xs select-none dark:bg-zinc-900/95">
        <div className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f56]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#ffbd2e]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#27c93f]" />
          {displayLang && (
            <span className="ml-2 font-mono text-[11px] font-medium tracking-wider text-zinc-400">
              {displayLang}
            </span>
          )}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={handleCopy}
          aria-label={uiLanguage === 'zh' ? '复制代码' : 'Copy code'}
          title={copyError || (uiLanguage === 'zh' ? '复制代码' : 'Copy code')}
          className={`h-6 px-2 text-xs text-zinc-400 transition-colors hover:bg-white/10 hover:text-white ${
            copyError ? 'text-destructive' : copied ? 'text-emerald-400' : ''
          }`}
        >
          {copied ? (
            <span className="flex items-center gap-1 text-[11px] text-emerald-400">
              <Check className="h-3.5 w-3.5" />
              <span>{uiLanguage === 'zh' ? '已复制' : 'Copied'}</span>
            </span>
          ) : (
            <span className="flex items-center gap-1 text-[11px]">
              <Copy className="h-3.5 w-3.5" />
              <span>{uiLanguage === 'zh' ? '复制' : 'Copy'}</span>
            </span>
          )}
        </Button>
      </div>
      <pre className="!my-0 !rounded-t-none !border-0 !bg-transparent p-3 font-mono text-[13px] leading-relaxed text-zinc-100 overflow-x-auto">
        <code ref={codeRef} className={normalizedLanguage ? `language-${normalizedLanguage}` : undefined}>
          {codeText}
        </code>
      </pre>
    </div>
  );
};

/** Anchor that externalizes non-anchor links and keeps in-page TOC jumps smooth. */
const MarkdownLink: React.FC<{ href?: string; children?: React.ReactNode; baseUrl?: string; headingIds?: Map<string, string> }> = ({
  href,
  children,
  baseUrl,
  headingIds
}) => {
  if (!href) return <>{children}</>;

  const isMailto = href.startsWith('mailto:');
  const isTel = href.startsWith('tel:');

  const resolvedHref = resolveMarkdownHref(href, baseUrl);
  const isHashLink = href.startsWith('#');
  const isSpecialLink = isMailto || isTel;

  const handleAnchorClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    e.stopPropagation();
    if (isHashLink && headingIds) {
      e.preventDefault();
      const anchorText = decodeAnchorFragment(href.substring(1));
      const targetId = headingIds.get(anchorText);
      if (targetId) {
        const targetElement = document.getElementById(targetId);
        if (targetElement) {
          targetElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
          return;
        }
      }
      const elementById = document.getElementById(anchorText);
      if (elementById) {
        elementById.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }
  };

  return (
    <a
      href={resolvedHref}
      target={isHashLink || isSpecialLink ? undefined : "_blank"}
      rel={isHashLink || isSpecialLink ? undefined : "noopener noreferrer"}
      onClick={handleAnchorClick}
    >
      {children}
    </a>
  );
};

const PictureSourcesContext = React.createContext<React.ReactNode>(null);

const truncateUrl = (url: string, maxLength: number = 50): string => {
  if (url.length <= maxLength) return url;
  try {
    const urlObj = new URL(url);
    const path = urlObj.pathname;
    if (path.length > 20) {
      return `${urlObj.host}${path.substring(0, 20)}...`;
    }
    return `${urlObj.host}${path}`;
  } catch {
    return url.substring(0, maxLength) + '…';
  }
};

/** Image with skeleton loading, error fallback, relative-URL resolution and a lightbox. */
const MarkdownImage: React.FC<{ src?: string; srcSet?: string; sizes?: string; alt?: string; baseUrl?: string }> = ({
  src,
  srcSet,
  sizes,
  alt,
  baseUrl
}) => {
    const t = useT('app');
  const [hasError, setHasError] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isZoomed, setIsZoomed] = useState(false);
  const [isInsideLink, setIsInsideLink] = useState(false);
  const [parentLinkHref, setParentLinkHref] = useState<string | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [naturalWidth, setNaturalWidth] = useState<number>(0);
  const [naturalHeight, setNaturalHeight] = useState<number>(0);
  const [zoomScale, setZoomScale] = useState(1);
  const [zoomPos, setZoomPos] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [imageSizeKnown, setImageSizeKnown] = useState(false);
  const dragStartRef = useRef({ x: 0, y: 0, posX: 0, posY: 0 });
  const imgRef = useRef<HTMLImageElement>(null);
  const zoomOverlayRef = useRef<HTMLDivElement>(null);

  const imageUrl = useMemo(() => resolveMarkdownImageSrc(src || '', baseUrl), [src, baseUrl]);
  const resolvedSrcSet = useMemo(() => resolveMarkdownSrcSet(srcSet, baseUrl), [srcSet, baseUrl]);
  const pictureSources = useContext(PictureSourcesContext);
  const [selectedImageUrl, setSelectedImageUrl] = useState(imageUrl);

  useEffect(() => {
    setSelectedImageUrl(imageUrl);
    setHasError(false);
    setIsLoading(true);
    setImageSizeKnown(false);
    setNaturalWidth(0);
    setNaturalHeight(0);
  }, [imageUrl, resolvedSrcSet]);

  useEffect(() => {
    if (!src) return;
    if (imgRef.current) {
      const parent = imgRef.current.closest('a');
      setIsInsideLink(!!parent);
      setParentLinkHref(parent?.getAttribute('href') ?? null);
    }
  }, [src]);

  const closeZoom = useCallback(() => {
    setIsZoomed(false);
    setZoomScale(1);
    setZoomPos({ x: 0, y: 0 });
  }, []);

  useEffect(() => {
    if (!isZoomed) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeZoom();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isZoomed, closeZoom]);

  useEffect(() => {
    if (!isZoomed || !zoomOverlayRef.current) return;

    const overlay = zoomOverlayRef.current;
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.15 : 0.15;
      setZoomScale(prev => Math.min(5, Math.max(0.5, prev + delta)));
    };

    overlay.addEventListener('wheel', handleWheel, { passive: false });
    return () => overlay.removeEventListener('wheel', handleWheel);
  }, [isZoomed]);

  const handleImageClick = useCallback((e: React.MouseEvent) => {
    if (isInsideLink && parentLinkHref) {
      if (e.ctrlKey || e.metaKey) {
        window.open(parentLinkHref, '_blank', 'noopener,noreferrer');
        return;
      }
    }
    e.preventDefault();
    e.stopPropagation();
    setIsZoomed(true);
  }, [isInsideLink, parentLinkHref]);

  const handleDownload = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (isDownloading) return;

    setIsDownloading(true);
    let objectUrl: string | null = null;
    try {
      const response = await fetch(selectedImageUrl);
      if (!response.ok) throw new Error('Image download failed');
      const blob = await response.blob();
      objectUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objectUrl;
      const extension = imageExtensionForMimeType(blob.type);
      const fileName = alt
        ? `${alt.replace(/[/\\?%*:|"<>]/g, '_')}.${extension}`
        : `image-${Date.now()}.${extension}`;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch {
      try {
        const a = document.createElement('a');
        a.href = selectedImageUrl;
        a.download = alt ? alt.replace(/[/\\?%*:|"<>]/g, '_') : 'image';
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      } catch {
        // fallback failed
      }
    } finally {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      setIsDownloading(false);
    }
  }, [selectedImageUrl, alt, isDownloading]);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (zoomScale > 1 && e.touches.length === 1) {
      setIsDragging(true);
      const touch = e.touches[0];
      dragStartRef.current = {
        x: touch.clientX,
        y: touch.clientY,
        posX: zoomPos.x,
        posY: zoomPos.y
      };
    }
  }, [zoomScale, zoomPos]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (isDragging && zoomScale > 1 && e.touches.length === 1) {
      const touch = e.touches[0];
      const dx = touch.clientX - dragStartRef.current.x;
      const dy = touch.clientY - dragStartRef.current.y;
      setZoomPos({
        x: dragStartRef.current.posX + dx,
        y: dragStartRef.current.posY + dy
      });
    }
  }, [isDragging, zoomScale]);

  const handleTouchEnd = useCallback(() => {
    setTimeout(() => setIsDragging(false), 50);
  }, []);

  const handleImageLoad = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
    setSelectedImageUrl(e.currentTarget.currentSrc || imageUrl);
    setIsLoading(false);
    const w = (e.target as HTMLImageElement).naturalWidth;
    const h = (e.target as HTMLImageElement).naturalHeight;
    setNaturalWidth(w);
    setNaturalHeight(h);
    setImageSizeKnown(true);
  }, [imageUrl]);

  const handleImageError = useCallback(() => {
    setHasError(true);
    setIsLoading(false);
  }, []);

  const handleRetry = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setHasError(false);
    setIsLoading(true);
    setImageSizeKnown(false);
  }, []);

  const isSmallImage = imageSizeKnown && naturalWidth > 0 && naturalWidth < 300;

  const renderMedia = (className: string, style: React.CSSProperties) => {
    const image = (
      <img ref={imgRef} src={imageUrl} srcSet={resolvedSrcSet} sizes={sizes} alt={alt || ''}
        className={className} style={style}
        onLoad={handleImageLoad} onError={handleImageError} onClick={handleImageClick} />
    );
    // Source selection only works when the image is a direct picture child.
    return pictureSources === null ? image : <picture>{pictureSources}{image}</picture>;
  };

  if (!src) return null;

  if (hasError) {
    return (
      <span className="my-2 px-3 py-2 bg-muted dark:bg-muted/40 rounded border border-border dark:border-border flex items-center gap-2 text-xs">
        <svg className="w-4 h-4 text-muted-foreground dark:text-muted-foreground flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
        <span className="text-muted-foreground dark:text-muted-foreground">
          {t('markdownRenderer.image-failed')}
        </span>
        {alt && <span className="text-muted-foreground dark:text-muted-foreground/70 truncate max-w-[120px]">{alt}</span>}
        <Button
          variant="ghost"
          onClick={handleRetry}
          className="ml-auto px-2 py-0.5 text-xs text-primary hover:text-primary/80 transition-colors flex-shrink-0"
        >
          {t('markdownRenderer.retry')}
        </Button>
      </span>
    );
  }

  return (
    <>
      {isSmallImage ? (
        <span className="inline-flex items-center my-1">
          {isLoading && (
            <span className="w-20 h-7 bg-muted dark:bg-muted/40 rounded animate-pulse inline-block" />
          )}
          <span className="relative inline-block">
            {renderMedia(`
                h-auto rounded
                ${isInsideLink
                  ? 'hover:opacity-80'
                  : 'hover:opacity-80 transition-opacity duration-200 cursor-pointer'
                }
                ${isLoading ? 'opacity-0 absolute' : 'opacity-100'}
                min-h-[16px]
              `, {
                maxWidth: `${naturalWidth}px`,
                width: `${naturalWidth}px`,
                objectFit: 'contain'
              })}
          </span>
        </span>
      ) : (
        <span className="my-4 flex flex-col items-center group/img">
          {isLoading && (
            <span className="w-full max-w-md h-16 bg-muted dark:bg-card rounded-lg flex items-center justify-center animate-pulse gap-2">
              <svg className="w-5 h-5 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              <span className="text-xs text-muted-foreground dark:text-muted-foreground/70">{t('markdownRenderer.loading')}</span>
            </span>
          )}

          <span className={`relative inline-block rounded-xl overflow-hidden shadow-sm hover:shadow-lg transition-shadow duration-300 ${isLoading ? 'hidden' : ''}`}>
            {renderMedia(`
                h-auto rounded-xl
                ${isInsideLink
                  ? 'hover:brightness-95 transition-all duration-200'
                  : 'hover:brightness-95 transition-all duration-200 cursor-pointer'
                }
              `, {
                maxHeight: '65vh',
                maxWidth: '100%',
                width: 'auto',
                objectFit: 'contain'
              })}
            <span className="absolute inset-0 rounded-xl ring-1 ring-inset ring-foreground/5 dark:ring-foreground/10 pointer-events-none" />
          </span>

          {!isLoading && !hasError && (
            <span data-translate="false" className="text-center mt-2 text-xs text-muted-foreground dark:text-muted-foreground opacity-0 group-hover/img:opacity-100 transition-opacity duration-200 flex items-center gap-3">
              <span>
                {isInsideLink
                  ? (t('markdownRenderer.click-to-zoom-ctrl-click-to-open-link'))
                  : (t('markdownRenderer.click-to-zoom'))
                }
              </span>
              {naturalWidth > 0 && (
                <span className="text-muted-foreground">|</span>
              )}
              {naturalWidth > 0 && (
                <span>{naturalWidth} × {naturalHeight}</span>
              )}
            </span>
          )}

          {!isLoading && !hasError && isInsideLink && parentLinkHref && (
            <span
              data-translate="false"
              className="text-center mt-1 text-xs text-primary dark:text-primary opacity-0 group-hover/img:opacity-100 transition-opacity flex items-center justify-center gap-1 cursor-pointer"
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                window.open(parentLinkHref, '_blank', 'noopener,noreferrer');
              }}
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
              </svg>
              <span className="truncate max-w-[200px]" title={parentLinkHref}>
                {truncateUrl(parentLinkHref)}
              </span>
            </span>
          )}
        </span>
      )}

      {isZoomed && createPortal(
        <div
          ref={zoomOverlayRef}
          className="fixed inset-0 z-[99999] bg-overlay/90 backdrop-blur-sm flex items-center justify-center cursor-default select-none"
          onClick={() => {
            if (!isDragging) {
              closeZoom();
            }
          }}
        >
          <div className="absolute top-0 left-0 right-0 z-10 flex items-center justify-between px-4 py-3 bg-gradient-to-b from-overlay/60 to-transparent pointer-events-none">
            <div className="flex items-center gap-2 pointer-events-auto">
              {alt && (
                <span className="text-overlay-foreground/70 text-sm truncate max-w-[300px]">{alt}</span>
              )}
              {naturalWidth > 0 && (
                <span className="text-overlay-foreground/50 text-xs">{naturalWidth} × {naturalHeight}</span>
              )}
            </div>
            <div className="flex items-center gap-2 pointer-events-auto">
              {isInsideLink && parentLinkHref && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={(e) => {
                    e.stopPropagation();
                    window.open(parentLinkHref, '_blank', 'noopener,noreferrer');
                  }}
                  className="h-8 w-8 p-0 bg-overlay-foreground/10 hover:bg-overlay-foreground/20 text-overlay-foreground/80 hover:text-overlay-foreground rounded-lg transition-colors backdrop-blur-sm"
                  title={t('markdownRenderer.open-link')}
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                </Button>
              )}
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={(e) => {
                  e.stopPropagation();
                  handleDownload(e);
                }}
                disabled={isDownloading}
                className="h-8 w-8 p-0 bg-overlay-foreground/10 hover:bg-overlay-foreground/20 text-overlay-foreground/80 hover:text-overlay-foreground rounded-lg transition-colors backdrop-blur-sm"
                title={t('markdownRenderer.download-image')}
              >
                <Download className={`w-4 h-4 ${isDownloading ? 'animate-bounce' : ''}`} />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={(e) => {
                  e.stopPropagation();
                  setZoomScale(prev => Math.min(5, prev + 0.5));
                }}
                className="h-8 w-8 p-0 bg-overlay-foreground/10 hover:bg-overlay-foreground/20 text-overlay-foreground/80 hover:text-overlay-foreground rounded-lg transition-colors backdrop-blur-sm text-sm font-bold"
                title={t('markdownRenderer.zoom-in')}
              >
                +
              </Button>
              <span className="text-overlay-foreground/60 text-xs min-w-[3rem] text-center">
                {Math.round(zoomScale * 100)}%
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={(e) => {
                  e.stopPropagation();
                  setZoomScale(prev => Math.max(0.5, prev - 0.5));
                }}
                className="h-8 w-8 p-0 bg-overlay-foreground/10 hover:bg-overlay-foreground/20 text-overlay-foreground/80 hover:text-overlay-foreground rounded-lg transition-colors backdrop-blur-sm text-sm font-bold"
                title={t('markdownRenderer.zoom-out')}
              >
                −
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={(e) => {
                  e.stopPropagation();
                  setZoomScale(1);
                  setZoomPos({ x: 0, y: 0 });
                }}
                className="h-8 w-8 p-0 bg-overlay-foreground/10 hover:bg-overlay-foreground/20 text-overlay-foreground/80 hover:text-overlay-foreground rounded-lg transition-colors backdrop-blur-sm text-xs"
                title={t('markdownRenderer.reset')}
              >
                1:1
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8 p-0 bg-overlay-foreground/10 hover:bg-overlay-foreground/20 text-overlay-foreground/80 hover:text-overlay-foreground rounded-lg transition-colors backdrop-blur-sm"
                onClick={(e) => {
                  e.stopPropagation();
                  closeZoom();
                }}
                title={t('markdownRenderer.close-esc')}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </Button>
            </div>
          </div>

          <div
            className="flex items-center justify-center w-full h-full"
            onMouseDown={(e) => {
              if (zoomScale > 1) {
                setIsDragging(true);
                dragStartRef.current = {
                  x: e.clientX,
                  y: e.clientY,
                  posX: zoomPos.x,
                  posY: zoomPos.y
                };
              }
            }}
            onMouseMove={(e) => {
              if (isDragging && zoomScale > 1) {
                const dx = e.clientX - dragStartRef.current.x;
                const dy = e.clientY - dragStartRef.current.y;
                setZoomPos({
                  x: dragStartRef.current.posX + dx,
                  y: dragStartRef.current.posY + dy
                });
              }
            }}
            onMouseUp={() => {
              setTimeout(() => setIsDragging(false), 50);
            }}
            onMouseLeave={() => {
              setIsDragging(false);
            }}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
          >
            <img
              src={selectedImageUrl}
              alt={alt || ''}
              className="max-w-[90vw] max-h-[85vh] object-contain rounded-lg shadow-2xl transition-transform duration-100"
              style={{
                transform: `scale(${zoomScale}) translate(${zoomPos.x / zoomScale}px, ${zoomPos.y / zoomScale}px)`,
                cursor: zoomScale > 1 ? (isDragging ? 'grabbing' : 'grab') : 'default'
              }}
              onClick={(e) => e.stopPropagation()}
              draggable={false}
            />
          </div>

          <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 text-overlay-foreground/50 text-xs pointer-events-none flex items-center gap-3">
            <span>{t('markdownRenderer.scroll-to-zoom-drag-to-pan')}</span>
            <span className="text-overlay-foreground/30">|</span>
            <span>{t('markdownRenderer.esc-or-click-background-to-close')}</span>
          </div>
        </div>,
        document.body
      )}
    </>
  );
};

const extractTextFromChildren = (children: React.ReactNode): string => {
  const inner = (children: React.ReactNode): string => {
    if (typeof children === 'string') return children;
    if (typeof children === 'number') return String(children);
    if (Array.isArray(children)) return children.map(inner).join('');
    if (React.isValidElement(children)) {
      return inner((children.props as { children?: React.ReactNode }).children);
    }
    return '';
  };
  return inner(children).replace(/\s+/g, ' ').trim();
};

const MarkdownRenderer: React.FC<MarkdownRendererProps> = memo(({
  content,
  className = '',
  shouldRender = true,
  enableHtml = false,
  baseUrl,
  headingIds,
  fontSize = 'medium',
  breaks = false,
  renderInlineCode
}) => {
  const headingCounterRef = useRef(headingIds?.size ?? 0);
  const headingTextCountMapRef = useRef(new Map<string, number>());

  useEffect(() => {
    headingCounterRef.current = headingIds?.size ?? 0;
    headingTextCountMapRef.current = new Map<string, number>();
  }, [content, headingIds]);

  // Math (KaTeX) support is loaded lazily: render pass 1 without math plugins,
  // then re-render with them once the dynamic imports resolve. react-markdown
  // rebuilds its processor every render, so swapping plugin arrays via state is
  // safe. Arrays are memoized to keep references stable across re-renders.
  const [mathPlugins, setMathPlugins] = useState<MathPlugins | null>(null);

  useEffect(() => {
    if (!MATH_PATTERN.test(content)) return;
    let cancelled = false;
    Promise.all([
      import('remark-math'),
      import('rehype-katex'),
      import('./lazyKatexCss'),
    ])
      .then(([remarkMath, rehypeKatex]) => {
        if (!cancelled) {
          setMathPlugins({ remark: remarkMath.default, rehype: rehypeKatex.default });
        }
      })
      .catch((error) => console.warn('Failed to load math support:', error));
    return () => {
      cancelled = true;
    };
  }, [content]);

  const remarkPlugins = useMemo(
    () => [
      ...BASE_REMARK_PLUGINS,
      ...(breaks ? [remarkBreaks] : []),
      ...(mathPlugins ? [mathPlugins.remark] : []),
    ],
    [breaks, mathPlugins]
  );

  const rehypePlugins = useMemo<PluggableList>(() => {
    if (!enableHtml) {
      return mathPlugins ? [mathPlugins.rehype] : REHYPE_PLUGINS_NO_HTML;
    }
    return [
      rehypeRaw,
      [rehypeSanitize, githubMarkdownSchema],
      ...(mathPlugins ? [mathPlugins.rehype] : []),
    ];
  }, [enableHtml, mathPlugins]);

  const fontSizePx = fontSize === 'small' ? '14px' : fontSize === 'large' ? '18px' : '16px';

  const getHeadingId = useCallback((children: React.ReactNode): string | undefined => {
    if (headingIds && headingIds.size > 0) {
      const text = extractTextFromChildren(children);
      const count = headingTextCountMapRef.current.get(text) || 0;
      const mapKey = count === 0 ? text : `${text}__${count}`;
      headingTextCountMapRef.current.set(text, count + 1);
      const id = headingIds.get(mapKey);
      if (id) return id;
    }
    return `heading-extra-${headingCounterRef.current++}`;
  }, [headingIds]);

  // Element cosmetics come from .markdown-body (github-markdown-css); the
  // overrides below only carry behaviour (heading-id handshake, code blocks,
  // images, links, read-only checkboxes).
  const markdownComponents: Components = useMemo(() => ({
    a: (props) => <MarkdownLink {...props} baseUrl={baseUrl} headingIds={headingIds} />,
    img: (props) => <MarkdownImage {...props} baseUrl={baseUrl} />,
    source: ({ srcSet, ...props }) =>
      <source {...stripAstNode(props)} srcSet={resolveMarkdownSrcSet(srcSet, baseUrl)} />,
    picture: ({ children, ...props }) => {
      const nodes = React.Children.toArray(children);
      const sources = nodes.filter(child => React.isValidElement(child)
        && (child.props as React.ComponentPropsWithoutRef<'source'> & ExtraProps).node?.tagName === 'source');
      const rest = nodes.filter(child => !sources.includes(child));
      if (!rest.some(child => React.isValidElement(child))) {
        return <picture {...stripAstNode(props)}>{children}</picture>;
      }
      return <PictureSourcesContext.Provider value={sources}>{rest}</PictureSourcesContext.Provider>;
    },
    h1: ({ children }) => <h1 id={getHeadingId(children)}>{children}</h1>,
    h2: ({ children }) => <h2 id={getHeadingId(children)}>{children}</h2>,
    h3: ({ children }) => <h3 id={getHeadingId(children)}>{children}</h3>,
    h4: ({ children }) => <h4 id={getHeadingId(children)}>{children}</h4>,
    h5: ({ children }) => <h5 id={getHeadingId(children)}>{children}</h5>,
    h6: ({ children }) => <h6 id={getHeadingId(children)}>{children}</h6>,
    p: (outerProps) => {
      const { className, children, ...domProps } = stripAstNode(outerProps);
      const childArray = React.Children.toArray(children);
      const hasImagesOnly = childArray.every(
        child => {
          if (React.isValidElement(child)) {
            if (child.type === MarkdownImage) return true;
            if (child.type === 'img') return true;
          }
          if (typeof child === 'string' && child.trim() === '') return true;
          return false;
        }
      );

      return (
        <p
          {...domProps}
          className={hasImagesOnly ? 'flex flex-wrap items-center justify-center gap-3' : className}
        >
          {children}
        </p>
      );
    },
    code: ({ className, children, ...props }) => {
      // 检查 props 中是否有 'data-code-block' 标记（由 pre 组件添加）
      const isCodeBlock = 'data-code-block' in props || !!className;
      const isInline = !isCodeBlock;
      const match = /language-(\w+)/.exec(className || '');
      const language = match ? match[1] : '';

      if (isInline) {
        const codeText = typeof children === 'string' ? children : extractTextFromChildren(children);
        const rendered = renderInlineCode?.(codeText);
        // 仅 null/undefined 回退默认 <code>，保留回调返回的合法 ReactNode（含 0、''、false）。
        if (rendered !== null && rendered !== undefined) return rendered;
        return <code {...stripAstNode(props)}>{children}</code>;
      }

      const codeText = typeof children === 'string' ? children : String(children);
      if (/^mermaid$/i.test(language)) {
        return <MermaidBlock code={codeText.replace(/\n$/, '')} />;
      }
      return <CodeBlock language={language}>{children}</CodeBlock>;
    },
    pre: ({ children }) => {
      // 给 code 子元素添加标记，表明它是代码块而不是行内代码
      if (React.isValidElement(children) && children.type === 'code') {
        type CodeBlockMarkerProps = React.ComponentPropsWithoutRef<'code'> & { 'data-code-block'?: boolean };
        return <>{React.cloneElement(children as React.ReactElement<CodeBlockMarkerProps>, { 'data-code-block': true })}</>;
      }
      // 对于非 code 子元素（如 ASCII 字符画），保留 pre 标签
      return <pre>{children}</pre>;
    },
    table: (outerProps) => {
      // 宽表格（模型常输出多列对比表）在窄容器内横向滚动，而不是撑破布局或被截断。
      const domProps = stripAstNode(outerProps);
      return (
        <div className="markdown-table-scroll">
          <table {...domProps} />
        </div>
      );
    },
    input: (props) => {
      if (props.type === 'checkbox') {
        return <input {...stripAstNode(props)} readOnly />;
      }
      return <Input {...props} />;
    },
  }), [baseUrl, headingIds, getHeadingId, renderInlineCode]);

  if (!shouldRender) {
    return <div className="h-32 flex items-center justify-center text-muted-foreground dark:text-muted-foreground/70">Loading…</div>;
  }

  return (
    <div className={`markdown-body max-w-none ${className}`} style={{ fontSize: fontSizePx }}>
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={rehypePlugins}
        components={markdownComponents}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
});

MarkdownRenderer.displayName = 'MarkdownRenderer';

export default MarkdownRenderer;
