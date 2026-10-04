import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeChannel } from '../custom/fixtures.test-support';
import { localDay, visibleEditionItems, type ChannelDailyEdition } from '../custom/model';
import type { Repository } from '../../../types';
import { CustomChannelEditionPicker } from './CustomChannelEditionPicker';
import { formatNaturalDate, formatTimeLabel, groupEditionsByDate } from '../custom/editionPresentation';

const mocks = vi.hoisted(() => ({
  deleteEdition: vi.fn(),
  clearEditions: vi.fn(),
}));

vi.mock('../custom/store', () => ({
  deleteCustomEdition: mocks.deleteEdition,
  clearCustomEditions: mocks.clearEditions,
  reportCustomError: vi.fn(),
}));

vi.mock('../../../store/useAppStore', () => ({
  useAppStore: (selector: (state: { language: string }) => unknown) => selector({ language: 'zh-CN' }),
}));

function makeEdition(channelId: ChannelDailyEdition['channelId'], date: string, revision = 1, generatedAt = `${date}T15:40:00.000Z`, entriesCount = 2, pendingCount = 1): ChannelDailyEdition {
  return {
    channelId,
    date,
    revision,
    instruction: 'test',
    entries: Array.from({ length: entriesCount }, (_, i) => ({
      repo: { id: i + 1, name: `repo-${i}`, full_name: `owner/repo-${i}`, stargazers_count: 100 } as Repository,
      verdict: 'match',
      reason: 'ok',
      evidence: [],
      method: 'rules',
      relevance: 2,
      preference: 1,
    })),
    pending: Array.from({ length: pendingCount }, (_, i) => ({
      repo: { id: i + 100, name: `pending-${i}`, full_name: `owner/pending-${i}`, stargazers_count: 50 } as Repository,
      verdict: 'unknown',
      reason: 'needs check',
      evidence: [],
      method: 'rules',
      relevance: 1,
      preference: 0,
    })),
    errors: [],
    complete: true,
    searched: 10,
    filtered: 5,
    generatedAt,
  };
}

describe('CustomChannelEditionPicker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(cleanup);

  it('formats natural dates correctly', () => {
    const fixedNow = new Date(2026, 8, 29); // 2026-09-29
    expect(formatNaturalDate('2026-09-29', true, fixedNow)).toBe('今天 9月29日');
    expect(formatNaturalDate('2026-09-28', true, fixedNow)).toBe('昨天 9月28日');
    expect(formatNaturalDate('2026-09-27', true, fixedNow)).toBe('前天 9月27日');
    expect(formatNaturalDate('2026-09-20', true, fixedNow)).toBe('9月20日');
    expect(formatNaturalDate('2025-05-10', true, fixedNow)).toBe('2025年5月10日');

    expect(formatNaturalDate('2026-09-29', false, fixedNow)).toContain('Today');
    expect(formatNaturalDate('2026-09-28', false, fixedNow)).toContain('Yesterday');
  });

  it('formats time labels correctly', () => {
    expect(formatTimeLabel('2026-09-29T15:40:00.000Z', true, true)).toContain('最新');
    expect(formatTimeLabel(undefined, true, true)).toBe('最新');
  });

  it('groups editions by date and separates latest and earlier', () => {
    const channel = makeChannel();
    const e1 = makeEdition(channel.id, '2026-09-29', 3, '2026-09-29T15:40:00.000Z');
    const e2 = makeEdition(channel.id, '2026-09-29', 2, '2026-09-29T10:20:00.000Z');
    const e3 = makeEdition(channel.id, '2026-09-28', 1, '2026-09-28T09:00:00.000Z');

    const groups = groupEditionsByDate([e2, e1, e3], true, new Date(2026, 8, 29));
    expect(groups).toHaveLength(2);
    expect(groups[0].date).toBe('2026-09-29');
    expect(groups[0].latest.revision).toBe(3);
    expect(groups[0].earlier).toHaveLength(1);
    expect(groups[0].earlier[0].revision).toBe(2);
  });

  it('renders trigger button and opens popover on click', async () => {
    const channel = makeChannel();
    const editions = [
      makeEdition(channel.id, '2026-09-29', 3, '2026-09-29T15:40:00.000Z', 3, 2),
      makeEdition(channel.id, '2026-09-29', 2, '2026-09-29T10:20:00.000Z', 1, 0),
    ];
    const selectSpy = vi.fn();

    render(
      <CustomChannelEditionPicker
        channel={channel}
        editions={editions}
        selectedEditionKey={`${editions[0].date}:${editions[0].revision}:${editions[0].generatedAt}`}
        onSelectEdition={selectSpy}
      />
    );

    const trigger = screen.getByRole('button', { name: '日期与规则版本' });
    expect(trigger).toHaveTextContent('3 推荐');
    expect(trigger).toHaveTextContent('2 待核实');

    fireEvent.click(trigger);
    expect(await screen.findByText('历史期次管理')).toBeInTheDocument();
  });

  it('counts visible recommendations and pending without changing original records', () => {
    const channel = makeChannel();
    const today = localDay();
    const edition = makeEdition(channel.id, today, 1, `${today}T09:00:00`, 2, 2);
    channel.blocked = [1];
    channel.manualAccepted = { '100': today };
    const original = structuredClone(edition);
    render(<CustomChannelEditionPicker channel={channel} editions={[edition]} onSelectEdition={vi.fn()} />);
    const trigger = screen.getByRole('button', { name: '日期与规则版本' });
    expect(trigger).toHaveTextContent('1 推荐');
    expect(trigger).toHaveTextContent('1 待核实');
    expect(edition).toEqual(original);
    expect(visibleEditionItems({ ...edition, date: '2026-01-01' }, channel).pending).toHaveLength(2);
  });

  it('removes accepted-today pending count from the trigger and popover', async () => {
    const channel = makeChannel();
    const today = localDay();
    channel.manualAccepted = { '100': today };
    const edition = makeEdition(channel.id, today, 1, `${today}T09:00:00`);
    render(<CustomChannelEditionPicker channel={channel} editions={[edition]} onSelectEdition={vi.fn()} />);
    const trigger = screen.getByRole('button', { name: '日期与规则版本' });
    expect(trigger).not.toHaveTextContent('待核实');
    fireEvent.click(trigger);
    await screen.findByText('历史期次管理');
    expect(screen.queryByText(/待核实/)).not.toBeInTheDocument();
    expect(edition.pending).toHaveLength(1);
  });

  it('expands earlier editions of a date and selects an earlier edition', async () => {
    const channel = makeChannel();
    const editions = [
      makeEdition(channel.id, '2026-09-29', 3, '2026-09-29T15:40:00.000Z', 2, 0),
      makeEdition(channel.id, '2026-09-29', 2, '2026-09-29T10:20:00.000Z', 1, 0),
    ];
    const selectSpy = vi.fn();

    render(
      <CustomChannelEditionPicker
        channel={channel}
        editions={editions}
        onSelectEdition={selectSpy}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: '日期与规则版本' }));
    const expandBtn = await screen.findByText(/展开当天更早/);
    fireEvent.click(expandBtn);

    const earlierCard = screen.getByText('1 推荐');
    fireEvent.click(earlierCard);

    expect(selectSpy).toHaveBeenCalledWith(`${editions[1].date}:${editions[1].revision}:${editions[1].generatedAt}`);
  });

  it('triggers single edition deletion dialog and calls deleteCustomEdition', async () => {
    const channel = makeChannel();
    const editions = [
      makeEdition(channel.id, '2026-09-29', 3, '2026-09-29T15:40:00.000Z'),
      makeEdition(channel.id, '2026-09-28', 1, '2026-09-28T09:00:00.000Z'),
    ];

    render(
      <CustomChannelEditionPicker
        channel={channel}
        editions={editions}
        onSelectEdition={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: '日期与规则版本' }));
    const deleteBtns = await screen.findAllByTitle('删除该期次');
    fireEvent.click(deleteBtns[0]);

    expect(screen.getByText('删除历史期次')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '确认删除' }));

    await waitFor(() => expect(mocks.deleteEdition).toHaveBeenCalled());
  });

  it('triggers batch clean dialog and calls clearCustomEditions', async () => {
    const channel = makeChannel();
    const editions = [
      makeEdition(channel.id, '2026-09-29', 3, '2026-09-29T15:40:00.000Z'),
      makeEdition(channel.id, '2026-09-28', 1, '2026-09-28T09:00:00.000Z'),
    ];

    render(
      <CustomChannelEditionPicker
        channel={channel}
        editions={editions}
        onSelectEdition={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: '日期与规则版本' }));
    const cleanBtn = await screen.findByText('一键清理旧期次');
    fireEvent.click(cleanBtn);

    expect(screen.getByText('一键清理历史旧期次')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '确认清理' }));

    await waitFor(() => expect(mocks.clearEditions).toHaveBeenCalledWith(channel.id, { keepLatest: 1 }));
  });

  it('displays time label on trigger when an earlier same-day run is selected', () => {
    const channel = makeChannel();
    const editions = [
      makeEdition(channel.id, '2026-09-29', 3, '2026-09-29T15:40:00.000Z'),
      makeEdition(channel.id, '2026-09-29', 2, '2026-09-29T10:20:00.000Z'),
    ];

    render(
      <CustomChannelEditionPicker
        channel={channel}
        editions={editions}
        selectedEditionKey={`${editions[1].date}:${editions[1].revision}:${editions[1].generatedAt}`}
        onSelectEdition={vi.fn()}
      />
    );

    const trigger = screen.getByRole('button', { name: '日期与规则版本' });
    const expectedTime = formatTimeLabel(editions[1].generatedAt, false, true);
    expect(trigger.textContent).toContain(expectedTime);
  });

  it('updates selection to remaining edition when active edition is deleted', async () => {
    const channel = makeChannel();
    const editions = [
      makeEdition(channel.id, '2026-09-29', 3, '2026-09-29T15:40:00.000Z'),
      makeEdition(channel.id, '2026-09-28', 1, '2026-09-28T09:00:00.000Z'),
    ];
    const selectSpy = vi.fn();
    const activeKey = `${editions[0].date}:${editions[0].revision}:${editions[0].generatedAt}`;

    render(
      <CustomChannelEditionPicker
        channel={channel}
        editions={editions}
        selectedEditionKey={activeKey}
        onSelectEdition={selectSpy}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: '日期与规则版本' }));
    const deleteBtns = await screen.findAllByTitle('删除该期次');
    fireEvent.click(deleteBtns[0]);

    fireEvent.click(screen.getByRole('button', { name: '确认删除' }));

    await waitFor(() => expect(mocks.deleteEdition).toHaveBeenCalled());
    // Should notify parent with the remaining edition's key
    const remainingKey = `${editions[1].date}:${editions[1].revision}:${editions[1].generatedAt}`;
    expect(selectSpy).toHaveBeenCalledWith(remainingKey);
  });
});
