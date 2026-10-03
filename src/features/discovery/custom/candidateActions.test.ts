import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../../services/githubApiFactory', () => ({ createGitHubApiService: vi.fn() }));
vi.mock('../../../services/aiService', () => ({ AIService: vi.fn() }));
import { approveInData, approveCandidate, blockCandidate } from './candidateActions';
import { emptyData, editionKey, localDay } from './model';
import { makeAssessment, makeChannel, makeEdition } from './fixtures.test-support';
import { publish } from './runner';
import { loadData, transact } from './storage';
import { useCustomDiscovery } from './store';

const now = new Date(2026, 9, 2, 10);
const setup = () => {
  const data = emptyData(), channel = makeChannel();
  const history = { ...makeEdition(), entries: [], pending: [{ ...makeAssessment(), verdict: 'unknown' as const }] };
  data.channels.push(channel); data.editions.push(history);
  return { data, channel, history, request: { channelId: channel.id, editionKey: editionKey(history), repoId: 1 } };
};
beforeEach(() => useCustomDiscovery.setState({ account: 'manual-actions-test', data: emptyData() }));
describe('manual discovery decisions', () => {
  it('copies acceptance into today without rewriting the historical verdict or evidence', () => {
    const { data, history, request } = setup();
    const original = structuredClone(history);
    expect(approveInData(data, request, now)).toBe(true);
    expect(history).toEqual(original);
    const today = data.editions.find(e => e.date === localDay(now))!;
    expect(today.entries[0]).toMatchObject({ verdict: 'unknown', acceptance: { sourceEditionKey: request.editionKey } });
    expect(today.entries[0].evidence).toEqual(original.pending[0].evidence);
    expect(approveInData(data, request, now)).toBe(false);
  });
  it('does not consume the automatic quota and deduplicates across revisions', () => {
    const { data, channel, request } = setup();
    channel.limit = 1;
    approveInData(data, request, now);
    channel.revision = 2;
    data.lease = { owner: 'test', expires: now.getTime() + 100000 };
    const result = { edition: { ...makeEdition(), date: localDay(now), revision: 2, entries: [makeAssessment(2), makeAssessment(1)] }, cursors: [] };
    expect(publish(data, channel, result, 'test', now.getTime())).toBe(true);
    expect(data.editions.filter(e => e.date === localDay(now)).flatMap(e => e.entries).map(a => a.repo.id)).toEqual([1, 2]);
    expect(approveInData(data, request, now)).toBe(false);
  });
  it('blocks and restores without deleting any history', async () => {
    const { data, history, request } = setup();
    await transact('manual-actions-test', draft => Object.assign(draft, data));
    await blockCandidate(request);
    expect((await loadData('manual-actions-test')).channels[0].blocked).toEqual([1]);
    expect((await loadData('manual-actions-test')).editions[0]).toEqual(history);
    await blockCandidate({ ...request, blocked: false });
    expect((await loadData('manual-actions-test')).channels[0].blocked).toEqual([]);
    await approveCandidate(request);
    expect((await loadData('manual-actions-test')).editions[0].pending[0].verdict).toBe('unknown');
  });
  it('rolls back a transaction interruption', async () => {
    const { data, request } = setup();
    await transact('manual-actions-test', draft => Object.assign(draft, data));
    await expect(transact('manual-actions-test', draft => { approveInData(draft, request, now); throw new Error('interrupted'); })).rejects.toThrow('interrupted');
    expect(await loadData('manual-actions-test')).toEqual(data);
  });
});
