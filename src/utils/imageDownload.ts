const MIME_EXTENSION_OVERRIDES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/svg+xml': 'svg',
  'image/x-icon': 'ico',
  'image/vnd.microsoft.icon': 'ico',
  'image/bmp': 'bmp',
  'image/tiff': 'tiff',
  'image/avif': 'avif',
};

/** Structured subtypes and MIME parameters are not usable file extensions. */
export const imageExtensionForMimeType = (mimeType: string | null | undefined): string => {
  const normalized = (mimeType ?? '').split(';')[0].trim().toLowerCase();
  const override = MIME_EXTENSION_OVERRIDES[normalized];
  if (override) return override;
  const subtype = normalized.startsWith('image/') ? normalized.slice('image/'.length) : '';
  return subtype.split('+')[0].replace(/[^a-z0-9]/g, '') || 'png';
};
