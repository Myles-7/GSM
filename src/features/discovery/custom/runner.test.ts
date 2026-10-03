import { describe, expect, it, vi } from 'vitest';
vi.mock('../../../services/githubApiFactory', () => ({ createGitHubApiService: vi.fn() }));
vi.mock('../../../services/aiService', () => ({ AIService: vi.fn() }));
import { publish } from './runner';
import { emptyData } from './model';
import { makeAssessment, makeChannel, makeEdition } from './fixtures.test-support';

const now = Date.parse('2026-09-28T10:00:00Z');
const setup = () => {
  const data = emptyData();
  const channel = makeChannel();
  data.channels.push(channel);
  data.lease = { owner: 'window-a', expires: now + 120000 };
  return { data, channel, result: { edition: makeEdition(), cursors: [2, 2] } };
};
describe('atomic publication transitions', () => {
  it('publishes once and records deduplication in the same state transition', () => {
    const { data, channel, result } = setup();
    expect(publish(data, channel, result, 'window-a', now)).toBe(true);
    expect(data.channels[0].recommended).toEqual({ '1': '2026-09-28' });
    expect(publish(data, channel, { edition: makeEdition(), cursors: [2, 2] }, 'window-a', now)).toBe(true);
    expect(data.editions).toHaveLength(1);
    expect(data.editions[0].entries).toHaveLength(1);
  });
  it('rejects competing and expired leases', () => {
    const { data, channel, result } = setup();
    expect(publish(data, channel, result, 'window-b', now)).toBe(false);
    expect(publish(data, channel, result, 'window-a', now + 120001)).toBe(false);
    expect(data.editions).toHaveLength(0);
  });
  it('rejects stale rules and deleted or paused channels', () => {
    const { data, channel, result } = setup();
    expect(publish(data, { ...channel, revision: 0 }, result, 'window-a', now)).toBe(false);
    channel.paused = true;
    expect(publish(data, channel, result, 'window-a', now)).toBe(false);
    data.channels = [];
    expect(publish(data, channel, result, 'window-a', now)).toBe(false);
  });
  it('does not consume unknown recommendations or mark partial runs complete', () => {
    const { data, channel, result } = setup();
    result.edition.entries = [];
    result.edition.pending = [{ ...makeAssessment(), verdict: 'unknown' }];
    result.edition.complete = false;
    publish(data, channel, result, 'window-a', now);
    expect(channel.recommended).toEqual({});
    expect(channel.lastCompletedDate).toBeUndefined();
  });
  it('appends within daily limit and preserves already published entries', () => {
    const { data, channel, result } = setup();
    channel.limit = 2;
    publish(data, channel, result, 'window-a', now);
    const next = makeEdition(); next.entries = [makeAssessment(2), makeAssessment(3)];
    publish(data, channel, { edition: next, cursors: [3, 3] }, 'window-a', now);
    expect(data.editions[0].entries.map(e => e.repo.id)).toEqual([1, 2]);
    expect(channel.recommended['3']).toBeUndefined();
  });
  it('keeps history immutable across rule changes and keeps lifetime dedup after retention', () => {
    const { data, channel, result } = setup();
    data.editions.push({ ...makeEdition(), date: '2025-01-01' });
    channel.recommended['9'] = '2025-01-01';
    publish(data, channel, result, 'window-a', now);
    channel.revision = 2;
    const next = { ...makeEdition(), revision: 2, instruction: 'changed', entries: [makeAssessment(2)] };
    publish(data, channel, { edition: next, cursors: [] }, 'window-a', now);
    expect(data.editions).toHaveLength(2);
    expect(data.editions[0].instruction).not.toBe('changed');
    expect(channel.recommended['9']).toBe('2025-01-01');
  });
  it('merges unresolved pending across refresh, removing only positively rejected items', () => {
    const { data, channel, result } = setup();
    result.edition.entries = [];
    result.edition.pending = [{ ...makeAssessment(4), verdict: 'unknown' }, { ...makeAssessment(5), verdict: 'unknown' }];
    publish(data, channel, result, 'window-a', now);
    const next = { ...makeEdition(), entries: [], pending: [{ ...makeAssessment(6), verdict: 'unknown' as const }] };
    publish(data, channel, { edition: next, cursors: [], rejected: [5] }, 'window-a', now);
    expect(data.editions[0].pending.map(a => a.repo.id)).toEqual([4, 6]);
  });
});
