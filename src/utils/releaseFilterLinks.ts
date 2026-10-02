import type { Release } from '../types';
import { effectiveReleaseTime } from './releaseAssets';
import { buildReleaseDownloadLinks } from './releaseDownloadLinks';

/** Keep filtering and rendering on the same complete link list in both views. */
export function buildReleaseFilterLinks(release: Release) {
  const links = buildReleaseDownloadLinks(release).map(link => ({
    ...link,
    size: link.size ?? 0,
    downloadCount: release.assets.find(asset => asset.id === link.assetId)?.download_count ?? 0,
    updatedAt: link.isSourceCode ? effectiveReleaseTime(release) : link.updatedAt,
  }));
  for (const match of (release.body ?? '').matchAll(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g)) {
    const [, name, url] = match;
    if ((url.includes('/download/') || url.includes('/releases/') || name.toLowerCase().includes('download')
      || /\.(exe|dmg|deb|rpm|apk|ipa|zip|tar\.gz|msi|pkg|appimage)$/i.test(url))
      && !links.some(link => link.url === url || link.name === name)) {
      links.push({ id: `body-${release.id}-${links.length}`, name, url, size: 0,
        isSourceCode: false, downloadCount: 0, updatedAt: effectiveReleaseTime(release) });
    }
  }
  return links;
}
