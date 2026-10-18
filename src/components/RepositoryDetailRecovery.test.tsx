import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { Repository } from '../types';
import { RepositoryDetailRecovery } from './RepositoryDetailRecovery';

const mocks = vi.hoisted(() => ({ read: vi.fn(), listeners: new Set<() => void>() }));
vi.mock('../services/repositoryDetailCheckpoint', () => ({ readDetailResponseCheckpoint: mocks.read,
  subscribeDetailCheckpoints: (listener: () => void) => { mocks.listeners.add(listener); return () => mocks.listeners.delete(listener); } }));
const repository = { id: 1, full_name: 'owner/repo', pushed_at: '2026-10-01' } as Repository;
const checkpoint = { response: '{invalid', context: { fullName: 'owner/repo', language: 'en', pushedAt: '2026-10-01' } };
beforeEach(() => { mocks.read.mockReset().mockResolvedValue(checkpoint); mocks.listeners.clear(); });

it('offers local JSON correction and invokes only the local repair action', async () => {
  const repair = vi.fn(async () => { mocks.read.mockResolvedValue(undefined); mocks.listeners.forEach(listener => listener()); });
  render(<RepositoryDetailRecovery repository={repository} accountId={7} language="en" running={false} repair={repair} />);
  fireEvent.click(await screen.findByText('Repair response locally'));
  expect(screen.getByRole('textbox')).toHaveValue('{invalid');
  fireEvent.change(screen.getByRole('textbox'), { target: { value: '{"problem":null}' } });
  await act(async () => { fireEvent.click(screen.getByText('Validate and save')); });
  expect(repair).toHaveBeenCalledWith(repository, 7, '{"problem":null}');
  await waitFor(() => expect(screen.queryByRole('textbox')).not.toBeInTheDocument());
});
it('does not offer stale repository evidence as a local repair', async () => {
  mocks.read.mockResolvedValue({ ...checkpoint, context: { ...checkpoint.context, fullName: 'old/repo' } });
  render(<RepositoryDetailRecovery repository={repository} accountId={7} language="en" running={false} repair={vi.fn()} />);
  await waitFor(() => expect(mocks.read).toHaveBeenCalledWith(7, 1));
  expect(screen.queryByText('Repair response locally')).not.toBeInTheDocument();
});
