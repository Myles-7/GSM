import { describe, expect, it } from 'vitest';
import { THEME_PRESETS } from '../../constants/themePresets';
import { themeTokenStyle } from '../../utils/themeTokens';
import { createReadingTheme } from './theme';

describe('reading theme snapshots', () => {
  it('inherits both palettes and the current desktop mode', () => {
    const preset = THEME_PRESETS.find(item => item.id === 'claude')!;
    const theme = createReadingTheme({ themePreset: preset.id, theme: 'dark' });
    expect(theme).toMatchObject({ presetId: 'claude', mode: 'dark', light: preset.lightColors, dark: preset.darkColors });
    expect(theme.fontSans).toContain('system-ui');
    expect(theme.fontMono).toContain('ui-monospace');
  });
  it('uses the same accent contrast and radius rules as desktop in both modes', () => {
    const tokens = { accentColor: '#16a34a', radius: 'large', animation: 'reduced', fontScale: 1 };
    const theme = createReadingTheme({ themeTokens: tokens });
    for (const palette of [theme.light, theme.dark]) {
      const variables = themeTokenStyle(tokens as never, palette.background).variables;
      expect(palette.primary).toBe(variables['--primary']);
      expect(palette['primary-emphasis']).toBe(variables['--primary-emphasis']);
    }
    expect(theme).toMatchObject({ radius: '0.75rem', reducedMotion: true });
  });
  it('falls back from corrupt user tokens without embedding arbitrary CSS or urls', () => {
    const theme = createReadingTheme({ themePreset: 'missing', themeTokens: { accentColor: '</style><script>secret</script>', radius: 'url(https://secret)', animation: 'bad' } });
    expect(theme).toMatchObject({ presetId: 'default', mode: 'light', radius: '0.5rem', reducedMotion: false });
    expect(JSON.stringify(theme)).not.toMatch(/secret|url\(|<script|<\/style/i);
    expect(createReadingTheme({ theme: 'dark' }, 'light').mode).toBe('light');
  });
  it('exports only allowed color properties for every desktop preset', () => {
    for (const preset of THEME_PRESETS) {
      const theme = createReadingTheme({ themePreset: preset.id });
      expect(Object.keys(theme.light).sort()).toEqual(Object.keys(THEME_PRESETS[0].lightColors).sort());
      expect(Object.values(theme.dark).every(value => /^-?\d+(?:\.\d+)?\s+\d+(?:\.\d+)?%\s+\d+(?:\.\d+)?%$/.test(value))).toBe(true);
      expect(theme.shadow).not.toContain('url(');
    }
  });
  it('matches the desktop default subtle shadow rather than adding a heavier card shadow', () => {
    expect(createReadingTheme({}).shadow).toBe('0 1px 2px rgba(0, 0, 0, 0.035)');
  });
});
