import { describe, expect, it } from 'vitest';
import { imageExtensionForMimeType } from './imageDownload';

describe('image download extensions from v0.8.5', () => {
  it.each([
    ['image/png', 'png'], ['image/gif', 'gif'], ['image/webp', 'webp'],
    ['image/jpeg', 'jpg'], ['image/svg+xml', 'svg'], ['IMAGE/SVG+XML; charset=utf-8', 'svg'],
    ['image/vnd.microsoft.icon', 'ico'], ['image/x-icon', 'ico'], ['image/tiff', 'tiff'],
    ['image/avif', 'avif'], ['image/png;charset=utf-8', 'png'], ['text/plain;charset=utf-8', 'png'],
    ['application/octet-stream', 'png'], ['', 'png'], [null, 'png'], [undefined, 'png'],
  ])('%s -> %s', (mime, expected) => {
    expect(imageExtensionForMimeType(mime)).toBe(expected);
  });
  it.each(['image/x-weird+yaml', 'image/../a:b', 'image/ ;foo=bar', 'nonsense'])('never includes unsafe filename characters: %s', mime => {
    expect(imageExtensionForMimeType(mime)).toMatch(/^[a-z0-9]+$/);
  });
});
