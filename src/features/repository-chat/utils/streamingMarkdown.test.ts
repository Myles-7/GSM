import { describe, expect, it } from 'vitest';
import { stabilizeStreamingMarkdown } from './streamingMarkdown';

const fence = '```';

describe('repository chat streaming preview', () => {
  it('temporarily closes a fence without changing literal links or inline code inside it', () => {
    const preview = fence + 'ts\nconst text = "[unfinished `code";';
    expect(stabilizeStreamingMarkdown(preview)).toBe(preview + '\n' + fence);
  });

  it('withholds unfinished citation and link tokens while keeping complete spans and tables', () => {
    expect(stabilizeStreamingMarkdown('See ``foo ` bar`` then `/README.md -')).toBe('See ``foo ` bar`` then ');
    expect(stabilizeStreamingMarkdown('See [docs](https://example.invalid/')).toBe('See ');
    const complete = '| Path | Note |\n| --- | --- |\n| `/README.md - 3` | Ready |';
    expect(stabilizeStreamingMarkdown(complete)).toBe(complete);
  });
});
