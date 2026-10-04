/** Fixed Lucide-style paths. The reader never accepts SVG from project data. */
const paths = {
  repository: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20M6.5 3H20v19H6.5A2.5 2.5 0 0 1 4 19.5v-14A2.5 2.5 0 0 1 6.5 3Z"/>',
  compass: '<circle cx="12" cy="12" r="10"/><path d="m16.2 7.8-2.8 5.6-5.6 2.8 2.8-5.6Z"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  export: '<path d="M12 3v12m-4-4 4 4 4-4M5 15v5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-5"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M20.9 13A9 9 0 0 1 11 3.1 9 9 0 1 0 20.9 13Z"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  arrow: '<path d="m12 19-7-7 7-7m-7 7h14"/>',
  close: '<path d="m18 6-12 12M6 6l12 12"/>',
  chevron: '<path d="m9 18 6-6-6-6"/>',
  heart: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z"/>',
  bookmark: '<path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2Z"/>',
  star: '<path d="m12 3 2.8 5.7 6.3.9-4.5 4.4 1 6.2-5.6-3-5.6 3 1-6.2L3 9.6l6.2-.9Z"/>',
  check: '<path d="m20 6-11 11-5-5"/>',
  external: '<path d="M15 3h6v6m0-6-9 9M9 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-4"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4m0-4h.01"/>',
  filter: '<path d="M4 7h16M7 12h10M10 17h4"/>',
} as const;
export type ReadingIcon = keyof typeof paths;
export const readingIconSprite = `<svg xmlns="http://www.w3.org/2000/svg" aria-hidden="true" class="icon-sprite">${Object.entries(paths).map(([key, value]) => `<symbol id="i-${key}" viewBox="0 0 24 24">${value}</symbol>`).join('')}</svg>`;
export const readingIcon = (name: ReadingIcon) => `<svg class="icon" aria-hidden="true" viewBox="0 0 24 24"><use href="#i-${name}"></use></svg>`;
