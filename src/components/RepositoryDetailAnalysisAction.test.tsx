import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { Repository } from '../types';
import { RepositoryDetailAnalysisAction } from './RepositoryDetailAnalysisAction';
const mocks = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock('../i18n/useT', () => ({ useT: () => (key: string, options?: { count: number; model: string }) => options ? `${key} ${options.count} ${options.model}` : key }));
vi.mock('../store/useAppStore', () => ({
  useAppStore: (select: (state: unknown) => unknown) => select({ user: { id: 1 }, activeAIConfig: 'one', aiConfigs: [{ id: 'one', model: 'mock-model', apiKey: 'mock-key', baseUrl: 'https://example.com' }, { id: 'two', model: 'other-model', apiKey: 'mock-key', baseUrl: 'https://example.com' }] }),
}));
vi.mock('../features/repositories/hooks/useRepositoryDetailAnalysisJob', () => ({
  useRepositoryDetailAnalysisJob: () => ({ run: mocks.run, running: false, paused: false, progress: { current: 0, total: 0 }, failures: [] }),
}));
beforeEach(() => vi.clearAllMocks());
it('previews model and exact repository range and requires explicit confirmation', () => {
  const repositories = [{ id: 1, full_name: 'owner/one' }, { id: 2, full_name: 'owner/two' }] as Repository[];
  render(<RepositoryDetailAnalysisAction repositories={repositories} />);
  expect(mocks.run).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'details.analyze' }));
  expect(screen.getByText('details.confirm 2 mock-model')).toBeInTheDocument();
  expect(screen.getByText('owner/one')).toBeInTheDocument();
  expect(screen.getByText('owner/two')).toBeInTheDocument();
  expect(mocks.run).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'details.start' }));
  expect(mocks.run).toHaveBeenCalledWith(repositories, 1, 'one');
});
it('offers the same confirmation from an accessible compact icon', () => {
  render(<RepositoryDetailAnalysisAction compact repositories={[{ id: 1, full_name: 'owner/one' } as Repository]} />);
  const trigger = screen.getByRole('button', { name: 'details.analyze' });
  expect(trigger).toHaveAttribute('title', 'details.analyze');
  expect(trigger.textContent).toBe('');
  fireEvent.click(trigger);
  expect(screen.getByRole('dialog')).toBeInTheDocument();
  expect(mocks.run).not.toHaveBeenCalled();
});
it('previews and submits the chosen model without changing the global active configuration', () => {
  const repositories = [{ id: 1, full_name: 'owner/one' }] as Repository[];
  render(<RepositoryDetailAnalysisAction repositories={repositories} />);
  fireEvent.click(screen.getByRole('button', { name: 'details.analyze' }));
  fireEvent.change(screen.getByRole('combobox', { name: 'details.model' }), { target: { value: 'two' } });
  expect(screen.getByText('details.confirm 1 other-model')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'details.start' }));
  expect(mocks.run).toHaveBeenCalledWith(repositories, 1, 'two');
});
