import { ExternalFeedError } from './externalFeedErrors';
import { MAX_EXTERNAL_REPOSITORIES, MAX_EXTERNAL_RESPONSE_BYTES } from './externalFeedConfig';

const NON_REPOSITORY_OWNERS = new Set([
  'topics', 'trending', 'features', 'marketplace', 'collections', 'explore', 'sponsors',
  'orgs', 'apps', 'search', 'settings', 'notifications', 'login', 'join', 'pricing',
  'security', 'events', 'about', 'contact', 'docs', 'site', 'new', 'import', 'gist',
  'gists', 'labs', 'customer-stories', 'readme', 'maintainer', 'sponsored', 'enterprise', 'team',
]);

function repositoryName(value: string, xml = false): string | null {
  let name = value.trim();
  if (/^https?:\/\//i.test(name)) {
    try {
      const url = new URL(name);
      if (url.hostname !== 'github.com' || url.username || url.password || url.port
        || (!xml && (url.protocol !== 'https:' || url.search || url.hash))) return null;
      const parts = url.pathname.split('/').filter(Boolean);
      if (parts.length < 2 || (!xml && parts.length !== 2)) return null;
      name = parts.slice(0, 2).join('/');
    } catch { return null; }
  }
  const parts = name.split('/');
  if (parts.length !== 2 || !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(parts[0])
    || !/^[A-Za-z0-9_.-]{1,100}$/.test(parts[1]) || parts[1] === '.' || parts[1] === '..'
    || NON_REPOSITORY_OWNERS.has(parts[0].toLowerCase())) return null;
  return name;
}

export function parseDiscoveryFeedRepositories(input: unknown): string[] {
  if (!input || typeof input !== 'object' || !Array.isArray((input as { repositories?: unknown }).repositories)) {
    throw new ExternalFeedError('invalid-format');
  }
  const entries = (input as { repositories: unknown[] }).repositories;
  if (!entries.length) throw new ExternalFeedError('no-repositories');
  if (entries.length > MAX_EXTERNAL_REPOSITORIES) throw new ExternalFeedError('too-many-repositories');
  const names = new Map<string, string>();
  for (const entry of entries) {
    const name = typeof entry === 'string' ? repositoryName(entry) : null;
    if (!name) throw new ExternalFeedError('invalid-format');
    if (!names.has(name.toLowerCase())) names.set(name.toLowerCase(), name);
  }
  return [...names.values()];
}

export function parseDiscoveryRssRepositories(input: string): string[] {
  if (new TextEncoder().encode(input).byteLength > MAX_EXTERNAL_RESPONSE_BYTES) throw new ExternalFeedError('too-large');
  if (/<!\s*(?:DOCTYPE|ENTITY)/i.test(input)) throw new ExternalFeedError('invalid-format');
  // application/xml is inert. No HTML parsing, DOM insertion or resource fetching.
  const doc = new DOMParser().parseFromString(input, 'application/xml');
  const root = doc.documentElement;
  if (!root || doc.getElementsByTagNameNS('*', 'parsererror').length
    || !['rss', 'feed', 'RDF'].includes(root.localName)
    || (root.localName === 'rss' && !root.getElementsByTagName('channel').length)
    || (root.localName === 'RDF' && root.namespaceURI !== 'http://www.w3.org/1999/02/22-rdf-syntax-ns#')
    || (root.localName === 'feed' && root.namespaceURI !== 'http://www.w3.org/2005/Atom')) {
    throw new ExternalFeedError('invalid-format');
  }
  const names = new Map<string, string>();
  const entries = Array.from(root.getElementsByTagNameNS('*', root.localName === 'feed' ? 'entry' : 'item'));
  for (const entry of entries) {
    const walker = doc.createTreeWalker(entry, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT | NodeFilter.SHOW_CDATA_SECTION);
    let node: Node | null = entry;
    while (node) {
      const values = node.nodeType === Node.ELEMENT_NODE
        ? Array.from((node as Element).attributes, attribute => attribute.value)
        : [node.nodeValue ?? ''];
      for (const value of values) {
        for (const match of value.matchAll(/https?:\/\/github\.com\/[^\s<>"'`]+/gi)) {
          const name = repositoryName(match[0].replace(/[.,;!?)\]}]+$/, ''), true);
          if (name && !names.has(name.toLowerCase())) names.set(name.toLowerCase(), name);
          if (names.size === MAX_EXTERNAL_REPOSITORIES) return [...names.values()];
        }
      }
      node = walker.nextNode();
    }
  }
  if (!names.size) throw new ExternalFeedError('no-repositories');
  return [...names.values()];
}
