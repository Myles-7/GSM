import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseDiscoveryFeedRepositories, parseDiscoveryRssRepositories } from './externalFeedParsers';

afterEach(() => vi.restoreAllMocks());

describe('JSON feed parser', () => {
  it('accepts names and canonical GitHub links, preserving order and deduplicating case', () => {
    expect(parseDiscoveryFeedRepositories({ repositories: ['Owner/repo', 'https://github.com/owner/REPO/', 'other/next'] }))
      .toEqual(['Owner/repo', 'other/next']);
  });
  it.each([null, [], {}, { repositories: [] }, { repositories: [null] }, { repositories: ['topics/react'] },
    { repositories: ['a/..'] }, { repositories: ['bad_owner/repo'] },
    { repositories: ['https://github.com/a/b/issues'] }, { repositories: ['https://github.com/a/b?q=1'] },
    { repositories: ['http://github.com/a/b'] }, { repositories: ['https://github.com.evil.com/a/b'] },
    { repositories: ['https://user@github.com/a/b'] }])('rejects invalid JSON schema or link %#', input => {
    expect(() => parseDiscoveryFeedRepositories(input)).toThrow();
  });
  it('enforces the raw 30-entry limit before deduplication', () => {
    expect(parseDiscoveryFeedRepositories({ repositories: Array(30).fill('owner/repo') })).toEqual(['owner/repo']);
    expect(() => parseDiscoveryFeedRepositories({ repositories: Array(31).fill('owner/repo') })).toThrow('30');
  });
});

describe('XML feed parser', () => {
  it('extracts RSS links, guid, attributes and inert CDATA in source order', () => {
    const xml = `<rss><channel><item><link>https://github.com/one/repo/issues/1</link>
      <guid>http://github.com/two/repo?utm=1</guid>
      <description><![CDATA[<img src="https://evil.example/image"><a href="https://github.com/three/repo">repo</a>]]></description>
      </item><item><link href="https://github.com/four/repo"/>
      <description>https://github.com/ONE/REPO and https://github.com/topics/react.</description></item></channel></rss>`;
    expect(parseDiscoveryRssRepositories(xml)).toEqual(['one/repo', 'two/repo', 'three/repo', 'four/repo']);
  });
  it('accepts namespaced Atom alternate links and RSS 1.0', () => {
    expect(parseDiscoveryRssRepositories(`<feed xmlns="http://www.w3.org/2005/Atom">
      <entry><link href="https://github.com/owner/atom"/><content>https://github.com/owner/second</content></entry></feed>`))
      .toEqual(['owner/atom', 'owner/second']);
    expect(parseDiscoveryRssRepositories(`<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns="http://purl.org/rss/1.0/">
      <item><link>https://github.com/owner/rss1</link></item></rdf:RDF>`)).toEqual(['owner/rss1']);
  });
  it.each([
    '<html><body>https://github.com/owner/repo</body></html>',
    '<rss><channel><item></channel></rss>', '<feed><entry/></feed>',
    '<rss/>', '<rss><channel><item>https://github.com/topics/react</item></channel></rss>',
    '<!DOCTYPE rss SYSTEM "https://evil.example/entities"><rss><channel/></rss>',
    '<!DOCTYPE rss [<!ENTITY x SYSTEM "file:///private">]><rss><channel><item>&x;</item></channel></rss>',
  ])('rejects malformed, non-feed or entity XML %#', xml => {
    expect(() => parseDiscoveryRssRepositories(xml)).toThrow();
  });
  it('caps RSS output at 30 and caps UTF-8 bytes', () => {
    const entries = Array.from({ length: 35 }, (_, i) => `<item>https://github.com/owner/repo-${i}</item>`).join('');
    expect(parseDiscoveryRssRepositories(`<rss><channel>${entries}</channel></rss>`)).toHaveLength(30);
    expect(() => parseDiscoveryRssRepositories('x'.repeat(128001))).toThrow('128000');
    expect(() => parseDiscoveryRssRepositories('\u00e9'.repeat(64001))).toThrow('128000');
  });
  it('does not invoke resource/network APIs or insert XML content into the live DOM', () => {
    const fetch = vi.spyOn(globalThis, 'fetch');
    const xhr = vi.spyOn(XMLHttpRequest.prototype, 'open');
    const append = vi.spyOn(document.body, 'appendChild');
    const before = document.body.innerHTML;
    parseDiscoveryRssRepositories(`<rss xmlns:x="http://www.w3.org/1999/xhtml"><channel><item>
      <x:img src="https://evil.example/image"/><x:iframe src="https://evil.example/frame"/>
      <x:script src="https://evil.example/script">globalThis.xmlExecuted = true</x:script>
      <link>https://github.com/owner/repo</link></item></channel></rss>`);
    expect(fetch).not.toHaveBeenCalled();
    expect(xhr).not.toHaveBeenCalled();
    expect(append).not.toHaveBeenCalled();
    expect(document.body.innerHTML).toBe(before);
    expect('xmlExecuted' in globalThis).toBe(false);
  });
});
