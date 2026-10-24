import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';
import type { Repository } from '../../../types';
import type { WorkbenchCandidate } from '../../../types/aiWorkbench';
import { WorkbenchResults } from './WorkbenchResults';

vi.mock('../../../i18n/useT', () => ({
  useT: () => (key: string, params?: Record<string, unknown>) => `${key}${params ? `:${Object.values(params).join(',')}` : ''}`,
}));

const candidate = (id: number, name: string, category: string, kind: 'tool' | 'library'): WorkbenchCandidate => ({
  repository: {
    id, name, full_name: `owner/${name}`, owner: { login: 'owner', avatar_url: '' },
    stargazers_count: id * 10, language: 'TypeScript', description: name,
    html_url: `https://github.com/owner/${name}`, forks_count: 0, forks: 0,
    created_at: '', updated_at: '', pushed_at: '', topics: [],
  },
  summary: name, reasons: [], limitations: [], sources: [], status: 'candidate',
  overview: { summary: name, category, categoryDescription: '', kind, status: 'ready', basis: 'metadata' },
});
const candidates = [candidate(1, 'alpha', 'Tools', 'tool'), candidate(2, 'beta', 'Libraries', 'library')];
type Props = ComponentProps<typeof WorkbenchResults>;
const props = () => {
  const workbench = {
    active: { id: 's1' }, activeId: 's1', repositories: [candidates[0].repository],
    data: { selectedRepositories: [] as Repository[], searchBatches: [] },
    task: { running: false, stage: 'idle' }, project: null,
    guard: vi.fn((fn: () => unknown) => fn()), addRepositories: vi.fn(), addRepository: vi.fn(),
    patchData: vi.fn(),
  };
  return {
    workbench: workbench as unknown as Props['workbench'], candidates, tab: 'results' as const,
    batchId: 'b1', onTabChange: vi.fn(), onBatchChange: vi.fn(), resolveLanguage: () => 'TypeScript',
    onResearch: vi.fn(), onAsk: vi.fn(),
  };
};

describe('WorkbenchResults selection and filters', () => {
  it('puts secondary controls in an accessible filter popover and exposes removable applied filters', async () => {
    const user = userEvent.setup();
    render(<WorkbenchResults {...props()} />);
    expect(screen.queryByRole('combobox', { name: 'overview.allTypes' })).not.toBeInTheDocument();
    const trigger = screen.getByRole('button', { name: 'overview.filtersCount:0' });
    await user.click(trigger);
    expect(screen.getByRole('dialog', { name: 'overview.filters' })).toBeVisible();
    await user.click(screen.getByRole('combobox', { name: 'overview.allTypes' }));
    await user.click(screen.getByRole('option', { name: 'overview.library' }));
    await user.keyboard('{Escape}');
    expect(trigger).toHaveFocus();
    expect(screen.queryByRole('dialog', { name: 'overview.filters' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'overview.filtersCount:1' })).toBeVisible();
    expect(screen.queryByRole('link', { name: 'alpha' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'beta' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'overview.removeFilter:overview.library' }));
    expect(screen.getAllByTestId('overview-card')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'overview.filtersCount:0' })).toBeVisible();
  });

  it('preserves checked hidden items and sends precisely those items to every batch action', () => {
    const p = props();
    render(<WorkbenchResults {...p} />);
    expect(screen.getByRole('button', { name: 'overview.askCheckedCount:0' })).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: 'overview.select:owner/alpha' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'overview.search' }), { target: { value: 'beta' } });
    expect(screen.getByText('overview.hiddenChecked:1', { exact: false })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'overview.askCheckedCount:1' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'overview.askCheckedCount:1' }));
    fireEvent.click(screen.getByRole('button', { name: 'overview.addResearchContextCount:1' }));
    fireEvent.click(screen.getByRole('button', { name: 'overview.researchCheckedCount:1' }));
    expect(p.onAsk).toHaveBeenCalledWith([candidates[0]]);
    expect(p.workbench.addRepositories).toHaveBeenCalledWith([candidates[0].repository]);
    expect(p.onResearch).toHaveBeenCalledWith([candidates[0].repository]);
    fireEvent.click(screen.getByRole('button', { name: 'overview.clearFilters' }));
    expect(screen.getByRole('checkbox', { name: 'overview.select:owner/alpha' })).toBeChecked();
  });

  it('retains checked items through type, star and sort changes and clears every applied control', async () => {
    const user = userEvent.setup();
    render(<WorkbenchResults {...props()} />);
    await user.click(screen.getByRole('checkbox', { name: 'overview.select:owner/alpha' }));
    await user.click(screen.getByRole('button', { name: 'overview.filtersCount:0' }));
    for (const [label, option] of [
      ['overview.allTypes', 'overview.library'],
      ['overview.starStatus', 'workbench.unstarred'],
      ['overview.sort', 'overview.stars'],
    ]) {
      await user.click(screen.getByRole('combobox', { name: label }));
      await user.click(screen.getByRole('option', { name: option }));
    }
    await user.keyboard('{Escape}');
    expect(screen.getByRole('button', { name: 'overview.filtersCount:3' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'overview.askCheckedCount:1' })).toBeEnabled();
    expect(screen.getByText('overview.hiddenChecked:1', { exact: false })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'overview.clearFilters' }));
    expect(screen.getByRole('button', { name: 'overview.filtersCount:0' })).toBeVisible();
    expect(screen.getByRole('checkbox', { name: 'overview.select:owner/alpha' })).toBeChecked();
    expect(screen.getAllByTestId('overview-card').map(card => within(card).getByRole('link').textContent)).toEqual(['alpha', 'beta']);
  });

  it('selects and deselects visible items without discarding selection in another category', () => {
    render(<WorkbenchResults {...props()} />);
    fireEvent.click(screen.getByRole('checkbox', { name: 'overview.select:owner/alpha' }));
    fireEvent.click(screen.getByRole('button', { name: 'Libraries 1' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'overview.selectVisible' }));
    expect(screen.getByRole('button', { name: 'overview.askCheckedCount:2' })).toBeEnabled();
    fireEvent.click(screen.getByRole('checkbox', { name: 'overview.selectVisible' }));
    expect(screen.getByRole('button', { name: 'overview.askCheckedCount:1' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'overview.clearFilters' }));
    expect(screen.getByRole('checkbox', { name: 'overview.select:owner/alpha' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'overview.select:owner/beta' })).not.toBeChecked();
  });

  it.each(['batch', 'session', 'tab'] as const)('resets temporary checks when the %s changes', change => {
    const p = props();
    const { rerender } = render(<WorkbenchResults {...p} />);
    fireEvent.click(screen.getByRole('checkbox', { name: 'overview.select:owner/alpha' }));
    const next = change === 'batch' ? { ...p, batchId: 'b2' }
      : change === 'tab' ? { ...p, tab: 'selected' as const }
        : { ...p, workbench: { ...p.workbench, activeId: 's2' } };
    rerender(<WorkbenchResults {...next} />);
    expect(screen.getByRole('button', { name: 'overview.askCheckedCount:0' })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: 'overview.select:owner/alpha' })).not.toBeChecked();
  });

  it('distinguishes saved context from temporary checks and keeps the row context action working', () => {
    const p = props();
    p.workbench.data.selectedRepositories = [candidates[0].repository];
    render(<WorkbenchResults {...p} />);
    expect(screen.getByText('overview.savedContextCount:1')).toBeInTheDocument();
    expect(screen.getByText('overview.checkedCount:0')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'overview.askCheckedCount:0' })).toBeDisabled();
    const cards = screen.getAllByTestId('overview-card');
    fireEvent.click(within(cards[0]).getByRole('button', { name: 'workbench.removeContext' }));
    expect(p.workbench.patchData).toHaveBeenCalledWith('s1', { selectedRepositories: [] });
    fireEvent.click(within(cards[1]).getByRole('button', { name: 'overview.addResearchContext' }));
    expect(p.workbench.addRepository).toHaveBeenCalledWith(candidates[1].repository);
  });
});
