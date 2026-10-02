import { describe, expect, it } from 'vitest';
import type { Release } from '../types';
import { buildReleaseFilterLinks } from './releaseFilterLinks';
import { evaluateReleaseFilters } from './assetFilters';

const release: Release = {
  id: 1, name: 'Release 1', tag_name: 'v1', body: '[Mac download](https://example.com/mac.dmg)\n[duplicate](https://example.com/app.exe)\n[Home](https://example.com)',
  published_at: '2026-01-01T00:00:00Z', html_url: 'https://github.com/owner/repo/releases/tag/v1',
  repository: { id: 123, name: 'repo', full_name: 'owner/repo' },
  zipball_url: 'https://api.github.com/repos/owner/repo/zipball/v1',
  assets: [{ id: 55, name: 'app.exe', browser_download_url: 'https://example.com/app.exe', download_count: 4,
    size: 42, content_type: 'application/octet-stream', updated_at: '2026-01-02T00:00:00Z', created_at: '2026-01-01T00:00:00Z' }],
};
describe('complete Release filter/download links', () => {
  it('shares ordered uploaded, source and body links while retaining authenticated downloads', () => {
    const links = buildReleaseFilterLinks(release);
    expect(links.map(link => link.name)).toEqual(['app.exe', 'Source code (v1.zip)', 'Mac download']);
    expect(links[0]).toMatchObject({ assetId: 55, downloadCount: 4, size: 42,
      authenticatedPath: '/repos/owner/repo/releases/assets/55', updatedAt: '2026-01-02T00:00:00Z' });
    expect(links[1]).toMatchObject({ isSourceCode: true, updatedAt: '2026-01-02T00:00:00.000Z',
      authenticatedPath: '/repos/owner/repo/zipball/v1' });
    const result = evaluateReleaseFilters(['mac'], [{ id: 'mac', name: 'Mac', keywords: ['mac'] }], 'owner/repo', links, release.assets);
    expect([...result.matchedLinkIndexes]).toEqual([2]);
    expect(links[2].url).toBe('https://example.com/mac.dmg');
  });
});
