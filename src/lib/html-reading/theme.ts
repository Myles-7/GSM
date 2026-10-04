import { DEFAULT_THEME_PRESET_ID, THEME_PRESETS } from '../../constants/themePresets';
import { normalizeThemeTokens, themeTokenStyle } from '../../utils/themeTokens';
import type { ReadingSettings, ReadingTheme } from './model';

const SYSTEM_SANS = 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif';
const SYSTEM_MONO = 'ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace';
const paletteKeys = new Set([...Object.keys(THEME_PRESETS[0].lightColors), 'primary-emphasis']);
const hsl = /^(-?\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)%\s+(\d+(?:\.\d+)?)%$/;
const validColor = (value: string): boolean => {
  const match = hsl.exec(value.trim());
  return !!match && Number.isFinite(Number(match[1])) && Number(match[2]) <= 100 && Number(match[3]) <= 100;
};
const font = (value: string | undefined, fallback: string) =>
  value && /^[\w\s,"'-]+$/.test(value) ? `${value}, ${fallback}` : fallback;

/** Freeze only the desktop's declared, validated theme tokens; never serialize DOM styles. */
export function createReadingTheme(
  state: { themePreset?: unknown; theme?: unknown; themeTokens?: unknown },
  mode: ReadingSettings['theme'] = 'desktop',
): ReadingTheme {
  const preset = THEME_PRESETS.find(item => item.id === state.themePreset)
    ?? THEME_PRESETS.find(item => item.id === DEFAULT_THEME_PRESET_ID)!;
  const tokens = normalizeThemeTokens(state.themeTokens);
  const palette = (raw: typeof preset.lightColors) => {
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(raw)) if (paletteKeys.has(key) && validColor(value)) result[key] = value;
    const overrides = themeTokenStyle(tokens, result.background);
    for (const [name, value] of Object.entries(overrides.variables)) {
      const key = name.replace(/^--/, '');
      if (value && paletteKeys.has(key) && validColor(value)) result[key] = value;
    }
    return result;
  };
  const light = palette(preset.lightColors), dark = palette(preset.darkColors);
  const radius = themeTokenStyle(tokens).variables['--radius'] ?? preset.radius ?? '0.5rem';
  const opacity = Math.min(0.35, Math.max(0, preset.shadowOpacity ?? 0.1));
  const shadowColor = preset.shadowColor && validColor(preset.shadowColor) ? preset.shadowColor : '0 0% 0%';
  const systemDark = typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;
  return {
    presetId: preset.id, label: preset.labelZh,
    mode: mode === 'system' ? (systemDark ? 'dark' : 'light') : mode === 'dark' || mode === 'desktop' && state.theme === 'dark' ? 'dark' : 'light',
    light, dark,
    radius: /^\d+(?:\.\d+)?(?:rem|px)$/.test(radius) ? radius : '0.5rem',
    shadow: preset.id === DEFAULT_THEME_PRESET_ID ? '0 1px 2px rgba(0, 0, 0, 0.035)' : `0 1px 3px hsl(${shadowColor} / ${opacity})`,
    fontSans: font(preset.fontSans, SYSTEM_SANS), fontMono: font(preset.fontMono, SYSTEM_MONO),
    reducedMotion: tokens.animation === 'reduced',
  };
}
