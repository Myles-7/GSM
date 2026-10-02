import { describe, expect, it } from 'vitest';
import { isExternalDiscoveryChannelId, normalizeDiscoveryFeedUrl, normalizeExternalDiscoveryChannels, normalizeExternalFeedKind } from './externalFeedConfig';

describe('external feed configuration', () => {
  it('canonicalizes HTTPS feeds and strips fragments', () => {
    expect(normalizeDiscoveryFeedUrl(' https://EXAMPLE.com:443/feed.json#part ')).toBe('https://example.com/feed.json');
    expect(normalizeDiscoveryFeedUrl('https://8.8.8.8/feed')).toBe('https://8.8.8.8/feed');
    expect(normalizeDiscoveryFeedUrl('https://[2606:4700:4700::1111]/feed')).not.toBeNull();
  });

  it.each([
    'http://example.com/feed', 'file:///feed', 'https://user:pass@example.com/feed',
    'https://localhost/feed', 'https://localhost./feed', 'https://a.local/feed',
    'https://intranet/feed', 'https://a.internal/feed', 'https://a.home.arpa/feed',
    'https://127.0.0.1/feed', 'https://127.1/feed', 'https://2130706433/feed',
    'https://0x7f000001/feed', 'https://10.0.0.1/feed', 'https://172.16.0.1/feed',
    'https://192.168.0.1/feed', 'https://169.254.169.254/feed', 'https://100.64.0.1/feed',
    'https://198.18.0.1/feed', 'https://192.0.2.1/feed', 'https://224.0.0.1/feed',
    'https://[::1]/feed', 'https://[::ffff:8.8.8.8]/feed', 'https://[fc00::1]/feed',
    'https://[fe80::1]/feed', 'https://[2001:db8::1]/feed', 'https://[2002:7f00:1::]/feed',
    'https://[2001::1]/feed', 'https://[2001:20::1]/feed', 'https://[3fff::1]/feed',
    'https://bad..example.com/feed', 'https://-bad.example.com/feed', 'https://example.com/a\nb',
  ])('rejects non-public or malformed URL %s', url => {
    expect(normalizeDiscoveryFeedUrl(url)).toBeNull();
  });

  it('normalizes only external entries, de-duplicates and caps at ten', () => {
    const feed = { id: 'external:one', name: ' One ', sourceUrl: 'https://example.com/feed#part', sourceKind: 'rss', extra: { revision: 7 } };
    const normalized = normalizeExternalDiscoveryChannels([
      { id: 'trending', name: 'Trending' }, feed,
      { ...feed, id: 'external:duplicate' },
      { ...feed, id: 'external:private', sourceUrl: 'https://localhost/feed' },
      { ...feed, id: 'external:bad-kind', sourceUrl: 'https://example.com/bad', sourceKind: 'html' },
      ...Array.from({ length: 20 }, (_, i) => ({ id: `external:${i}`, name: `${i}`, sourceUrl: `https://example.com/${i}`, enabled: false })),
    ]);
    expect(normalized).toHaveLength(10);
    expect(normalized[0]).toMatchObject({ id: 'external:one', name: 'One', nameEn: 'One', sourceKind: 'rss', sourceUrl: 'https://example.com/feed', extra: { revision: 7 } });
    expect(normalized[1].enabled).toBe(false);
    expect(normalizeExternalDiscoveryChannels(null)).toEqual([]);
    expect(normalizeExternalFeedKind('json')).toBe('json');
    expect(normalizeExternalFeedKind('rss')).toBe('rss');
    expect(isExternalDiscoveryChannelId('external:one')).toBe(true);
    expect(isExternalDiscoveryChannelId('custom:one')).toBe(false);
  });

  it.each(['json', 'rss'] as const)('preserves explicit %s kind through persisted JSON round trips', kind => {
    const normalized = normalizeExternalDiscoveryChannels([{
      id: 'external:one', name: 'One', sourceUrl: 'https://example.com/feed', sourceKind: kind,
    }]);
    expect(normalized[0].sourceKind).toBe(kind);
    const restored = normalizeExternalDiscoveryChannels(JSON.parse(JSON.stringify(normalized)));
    expect(restored).toEqual(normalized);
    expect(restored[0].sourceKind).toBe(kind);
  });

  it('keeps an absent kind undefined before and after persistence without introducing a default', () => {
    const normalized = normalizeExternalDiscoveryChannels([{
      id: 'external:one', name: 'One', sourceUrl: 'https://example.com/feed',
    }]);
    expect(normalized[0].sourceKind).toBeUndefined();
    const persisted = JSON.parse(JSON.stringify(normalized));
    expect(persisted[0]).not.toHaveProperty('sourceKind');
    expect(normalizeExternalDiscoveryChannels(persisted)[0].sourceKind).toBeUndefined();
    for (const value of [undefined, null, 'html', 'atom', 'JSON', 1]) {
      expect(normalizeExternalFeedKind(value)).toBeUndefined();
    }
  });
});
