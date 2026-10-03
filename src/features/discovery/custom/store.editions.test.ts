import { beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyData, type ChannelDailyEdition, type CustomDiscoveryData } from './model';
import { makeChannel } from './fixtures.test-support';
import { clearCustomEditions, deleteCustomEdition, useCustomDiscovery } from './store';

vi.mock('./storage', () => ({
  loadData: async () => useCustomDiscovery.getState().data,
  transact: async (_acc: string, change: (d: CustomDiscoveryData) => void) => {
    const data = useCustomDiscovery.getState().data;
    change(data);
    useCustomDiscovery.setState({ data: { ...data } });
  },
}));

function makeEdition(channelId: ChannelDailyEdition['channelId'], date: string, revision = 1, generatedAt = `${date}T10:00:00.000Z`): ChannelDailyEdition {
  return {
    channelId,
    date,
    revision,
    instruction: 'test',
    entries: [],
    pending: [],
    errors: [],
    complete: true,
    searched: 10,
    filtered: 5,
    generatedAt,
  };
}

describe('custom discovery store edition management', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const data = emptyData();
    const channel = makeChannel();
    data.channels = [channel];
    data.editions = [
      makeEdition(channel.id, '2026-09-29', 3, '2026-09-29T15:40:00.000Z'),
      makeEdition(channel.id, '2026-09-29', 2, '2026-09-29T10:20:00.000Z'),
      makeEdition(channel.id, '2026-09-28', 2, '2026-09-28T16:00:00.000Z'),
      makeEdition(channel.id, '2026-09-28', 1, '2026-09-28T09:00:00.000Z'),
      makeEdition(channel.id, '2026-09-27', 1, '2026-09-27T10:00:00.000Z'),
    ];
    useCustomDiscovery.setState({ account: 'test-user', data, busy: false, progress: {}, error: null });
  });

  it('deletes a specific edition by key string', async () => {
    const channelId = useCustomDiscovery.getState().data.channels[0].id;
    const targetKey = '2026-09-29:2:2026-09-29T10:20:00.000Z';

    await deleteCustomEdition(channelId, targetKey);

    const editions = useCustomDiscovery.getState().data.editions;
    expect(editions).toHaveLength(4);
    expect(editions.some(e => e.generatedAt === '2026-09-29T10:20:00.000Z')).toBe(false);
  });

  it('deletes a specific edition by criteria object', async () => {
    const channelId = useCustomDiscovery.getState().data.channels[0].id;

    await deleteCustomEdition(channelId, { date: '2026-09-27', revision: 1 });

    const editions = useCustomDiscovery.getState().data.editions;
    expect(editions).toHaveLength(4);
    expect(editions.some(e => e.date === '2026-09-27')).toBe(false);
  });

  it('clears older editions and keeps only the latest 1 edition by default', async () => {
    const channelId = useCustomDiscovery.getState().data.channels[0].id;

    await clearCustomEditions(channelId, { keepLatest: 1 });

    const editions = useCustomDiscovery.getState().data.editions;
    expect(editions).toHaveLength(1);
    expect(editions[0].date).toBe('2026-09-29');
    expect(editions[0].revision).toBe(3);
  });

  it('clears older editions and keeps specified count', async () => {
    const channelId = useCustomDiscovery.getState().data.channels[0].id;

    await clearCustomEditions(channelId, { keepLatest: 2 });

    const editions = useCustomDiscovery.getState().data.editions;
    expect(editions).toHaveLength(2);
    expect(editions[0].date).toBe('2026-09-29');
    expect(editions[1].date).toBe('2026-09-29');
  });

  it('deletes an edition when generatedAt is undefined or empty string', async () => {
    const channelId = useCustomDiscovery.getState().data.channels[0].id;
    const legacyEdition = makeEdition(channelId, '2026-09-26', 1);
    delete (legacyEdition as Partial<ChannelDailyEdition>).generatedAt;
    useCustomDiscovery.getState().data.editions.push(legacyEdition);

    // Using the key format produced by getEditionKey
    const key = '2026-09-26:1:';
    await deleteCustomEdition(channelId, key);

    const editions = useCustomDiscovery.getState().data.editions;
    expect(editions.some(e => e.date === '2026-09-26')).toBe(false);
  });

  it('prioritizes generatedAt timestamp over revision number when clearing old editions', async () => {
    const channelId = useCustomDiscovery.getState().data.channels[0].id;
    // Replace editions with a scenario where an earlier revision ran later in the day
    useCustomDiscovery.getState().data.editions = [
      makeEdition(channelId, '2026-09-29', 2, '2026-09-29T10:00:00.000Z'),
      makeEdition(channelId, '2026-09-29', 1, '2026-09-29T15:00:00.000Z'),
    ];

    await clearCustomEditions(channelId, { keepLatest: 1 });

    const editions = useCustomDiscovery.getState().data.editions;
    expect(editions).toHaveLength(1);
    // Should keep the 15:00 run even though its revision number is lower
    expect(editions[0].generatedAt).toBe('2026-09-29T15:00:00.000Z');
  });
});
