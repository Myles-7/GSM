import { describe, expect, it } from 'vitest';
import type { Gist } from '../types';
import { recallGists, selectAnalysisContext } from './analysisContext';

describe('analysis context selection', () => {
  it('keeps late capabilities and installation after a long sponsor section', () => {
    const source = '# Notes\nA local editor.\n## Sponsors\n' + 'Sponsor '.repeat(4000)
      + '\n## Features\nFull text search. No cloud sync.\n## Installation\n```sh\nnpm install\nnpm start\n```';
    const result = selectAnalysisContext(source);
    expect(result).toContain('No cloud sync.');
    expect(result).toContain('npm install\nnpm start');
    expect(result).not.toContain('Sponsor Sponsor');
    expect(result.length).toBeLessThanOrEqual(12_000);
  });
  it.each([500, 2000, 12000, 36000])('respects the %i character budget', budget => {
    const text = Array.from({ length: 30 }, (_, i) => `## Features ${i}\n${'Text '.repeat(2000)}`).join('\n');
    expect(selectAnalysisContext(text, budget).length).toBeLessThanOrEqual(budget);
  });
  it('does not treat shell comments inside a fenced code block as headings', () => {
    const source = '# Install\n```sh\n# sponsor is a variable\nexport sponsor=yes\n```';
    expect(selectAnalysisContext(source)).toContain('# sponsor is a variable\nexport sponsor=yes');
  });
  it('handles empty and short inputs without inventing facts', () => {
    expect(selectAnalysisContext('')).toBe('');
    expect(selectAnalysisContext('Windows only. No mobile app.')).toBe('Windows only. No mobile app.');
  });
  it('omits incomplete commands and fenced blocks when excerpts hit the budget', () => {
    const source = '## Installation\nUse the documented package.\n```sh\nnpm install '
      + 'package-name '.repeat(100) + '\n```\n## Features\nOffline.\n' + 'Other text.\n'.repeat(100);
    const result = selectAnalysisContext(source, 300);
    expect(result).not.toContain('npm install');
    expect(result).not.toContain('```');
    expect(result).toContain('Use the documented package.');
  });
  it('recalls a relevant gist beyond the first 120 entries without dropping any record', () => {
    const gists = Array.from({ length: 150 }, (_, i) => ({ id: String(i), description: i === 149 ? 'Python SQLite backup' : 'Color theme', files: {} } as Gist));
    const result = recallGists(gists, 'SQLite backup');
    expect(result[0].id).toBe('149');
    expect(result).toHaveLength(150);
    expect(gists[0].id).toBe('0');
  });
});
