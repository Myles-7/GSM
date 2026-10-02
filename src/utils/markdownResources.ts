/** v0.8.5 resource fixes, kept separate from the renderer's presentation. */
export function decodeAnchorFragment(fragment: string): string {
  try { return decodeURIComponent(fragment); } catch { return fragment; }
}

function repoBaseUrl(baseUrl?: string): string | undefined {
  if (!baseUrl) return undefined;
  try {
    const url = new URL(baseUrl);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return undefined;
    if (!['github.com', 'www.github.com', 'raw.githubusercontent.com'].includes(url.hostname)) return undefined;
    const [owner, repo] = url.pathname.split('/').filter(Boolean);
    return owner && repo ? `https://github.com/${owner}/${repo}` : undefined;
  } catch { return undefined; }
}

function resolveResource(value: string, baseUrl: string | undefined, kind: 'raw' | 'blob'): string {
  if (value.startsWith('//')) return `https:${value}`;
  if (/^https?:\/\//i.test(value) || value.startsWith('#') || /^(mailto|tel):/i.test(value)) return value;
  const repoBase = repoBaseUrl(baseUrl);
  if (repoBase) {
    try { return new URL(value.replace(/^\//, ''), `${repoBase}/${kind}/HEAD/`).href; } catch { return value; }
  }
  return value;
}

export const resolveMarkdownImageSrc = (src: string, baseUrl?: string): string =>
  resolveResource(src, baseUrl, 'raw');
export const resolveMarkdownHref = (href: string, baseUrl?: string): string =>
  resolveResource(href, baseUrl, 'blob');

const SRC_SET_SPACE = /[\t\n\f\r ]/;
function parseSrcSet(srcSet: string): Array<{ url: string; descriptor: string }> {
  const candidates: Array<{ url: string; descriptor: string }> = [];
  let position = 0;
  while (position < srcSet.length) {
    while (position < srcSet.length && (SRC_SET_SPACE.test(srcSet[position]) || srcSet[position] === ',')) position++;
    if (position >= srcSet.length) break;
    let url = '';
    while (position < srcSet.length && !SRC_SET_SPACE.test(srcSet[position])) url += srcSet[position++];
    let descriptor = '';
    if (url.endsWith(',')) {
      url = url.replace(/,+$/, '');
    } else {
      const start = position;
      let parens = 0;
      while (position < srcSet.length) {
        const char = srcSet[position];
        if (char === '(') parens++;
        else if (char === ')') parens = Math.max(parens - 1, 0);
        else if (char === ',' && parens === 0) break;
        position++;
      }
      descriptor = srcSet.slice(start, position).trim();
    }
    if (url) candidates.push({ url, descriptor });
  }
  return candidates;
}

/** Commas can be part of candidate URLs; srcset bypasses react-markdown's URL transform. */
export function resolveMarkdownSrcSet(srcSet: string | undefined, baseUrl?: string): string | undefined {
  if (!srcSet) return srcSet;
  return parseSrcSet(srcSet).flatMap(({ url, descriptor }) => {
    if (/^(?!https?:)[a-z][a-z0-9+.-]*:/i.test(url)
      || Array.from(url).some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) return [];
    const resolved = resolveMarkdownImageSrc(url, baseUrl);
    return [descriptor ? `${resolved} ${descriptor}` : resolved];
  }).join(', ');
}
