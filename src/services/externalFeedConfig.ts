import type { ExternalDiscoveryChannel, ExternalDiscoveryChannelId, ExternalFeedKind } from '../types/externalFeed';

export const MAX_EXTERNAL_FEEDS = 10;
export const MAX_EXTERNAL_REPOSITORIES = 30;
export const MAX_EXTERNAL_RESPONSE_BYTES = 128_000;
export const EXTERNAL_FEED_TIMEOUT_MS = 15_000;

export function isExternalDiscoveryChannelId(id: string): id is ExternalDiscoveryChannelId {
  return /^external:[a-z0-9-]{1,64}$/.test(id);
}

export function normalizeExternalFeedKind(value: unknown): ExternalFeedKind | undefined {
  return value === 'json' || value === 'rss' ? value : undefined;
}

function isPublicHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  if (host.startsWith('[')) {
    // Only global unicast IPv6; mapped IPv4, link-local and unique-local fail.
    const match = host.match(/^\[([23][0-9a-f]{3}):([0-9a-f]*):/);
    if (!match) return false;
    const first = parseInt(match[1], 16);
    const second = parseInt(match[2] || '0', 16);
    return first !== 0x2002 && first !== 0x3fff
      && !(first === 0x2001 && (second <= 0x1ff || second === 0xdb8));
  }
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    const [a, b, c] = host.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224
      || (a === 100 && b >= 64 && b <= 127)
      || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99)))
      || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100)))
      || (a === 203 && b === 0 && c === 113));
  }
  return host.length <= 253 && host.includes('.')
    && host.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
    && !/(^|\.)(localhost|local|internal|lan|home|test|invalid|onion|arpa)$/.test(host);
}

export function normalizeDiscoveryFeedUrl(input: string): string | null {
  if (input.length > 2048 || Array.from(input.trim()).some(char => char.charCodeAt(0) <= 32 || char.charCodeAt(0) === 127)) return null;
  try {
    const url = new URL(input.trim());
    if (url.protocol !== 'https:' || url.username || url.password || !isPublicHostname(url.hostname)) return null;
    url.hash = '';
    return url.href;
  } catch {
    return null;
  }
}

export function normalizeExternalDiscoveryChannels(input: unknown): ExternalDiscoveryChannel[] {
  if (!Array.isArray(input)) return [];
  const ids = new Set<string>();
  const urls = new Set<string>();
  const result: ExternalDiscoveryChannel[] = [];
  for (const value of input) {
    if (!value || typeof value !== 'object') continue;
    const item = value as Record<string, unknown>;
    if (typeof item.id !== 'string' || !isExternalDiscoveryChannelId(item.id)
      || typeof item.name !== 'string' || !item.name.trim() || item.name.trim().length > 60
      || typeof item.sourceUrl !== 'string'
      || (item.sourceKind !== undefined && item.sourceKind !== 'json' && item.sourceKind !== 'rss')) continue;
    const sourceUrl = normalizeDiscoveryFeedUrl(item.sourceUrl);
    if (!sourceUrl || ids.has(item.id) || urls.has(sourceUrl)) continue;
    ids.add(item.id);
    urls.add(sourceUrl);
    result.push({ ...item, id: item.id, name: item.name.trim(), nameEn: item.name.trim(), icon: 'search',
      description: '', enabled: item.enabled !== false, sourceUrl,
      sourceKind: normalizeExternalFeedKind(item.sourceKind) });
    if (result.length === MAX_EXTERNAL_FEEDS) break;
  }
  return result;
}
