import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ getRepositoryReadme: vi.fn() }));
vi.mock('../services/githubApiFactory', () => ({ createGitHubApiService: () => mocks }));
vi.unmock('../store/useAppStore');
import { useAppStore } from '../store/useAppStore';
import { usePluginPageReadme } from './usePluginPageReadme';
import type { Repository } from '../types';

const repository = { id: 1, full_name: 'owner/one', name: 'one', owner: { login: 'owner' } } as Repository;
afterEach(() => { cleanup(); vi.clearAllMocks(); });
describe('page README lifecycle', () => {
  it('aborts old repository work and rejects a late README after A-B-A switching', async () => {
    useAppStore.setState({ githubToken: 'fixture', user: { id: 91 } as never });
    const finishes: Array<(content: string) => void> = [];
    mocks.getRepositoryReadme.mockImplementation(() => new Promise((resolve) => { finishes.push(resolve); }));
    const { result, rerender, unmount } = renderHook(({ repo }) => usePluginPageReadme(repo), { initialProps: { repo: repository } });
    const oldSignal = mocks.getRepositoryReadme.mock.calls[0][2] as AbortSignal;
    rerender({ repo: { ...repository, id: 2, full_name: 'owner/two', name: 'two' } });
    expect(oldSignal.aborted).toBe(true);
    await act(async () => { finishes[0]('old README'); finishes[1]('new README'); });
    expect(result.current.readme).toBe('new README');
    await act(async () => { useAppStore.setState({ githubToken: 'other' }); });
    expect(result.current.readme).toBeNull();
    const switchSignal = mocks.getRepositoryReadme.mock.calls[2][2] as AbortSignal;
    await act(async () => { useAppStore.setState({ githubToken: 'fixture' }); });
    expect(switchSignal.aborted).toBe(true);
    await act(async () => { finishes[2]('foreign README'); finishes[3]('current README'); });
    await waitFor(() => expect(result.current.readme).toBe('current README'));
    unmount();
    expect((mocks.getRepositoryReadme.mock.calls[3][2] as AbortSignal).aborted).toBe(true);
  });
  it('falls back to metadata on README failure', async () => {
    mocks.getRepositoryReadme.mockRejectedValue(new Error('No README'));
    const { result } = renderHook(() => usePluginPageReadme(repository));
    await act(async () => {});
    expect(result.current.readme).toBeNull();
  });
  it('rejects late work even when A-B-A account changes are batched into one render', async () => {
    useAppStore.setState({ githubToken: 'fixture', user: { id: 91 } as never });
    const finishes: Array<(content: string) => void> = [];
    mocks.getRepositoryReadme.mockImplementation(() => new Promise((resolve) => { finishes.push(resolve); }));
    const { result } = renderHook(() => usePluginPageReadme(repository));
    const signal = mocks.getRepositoryReadme.mock.calls[0][2] as AbortSignal;
    await act(async () => {
      useAppStore.setState({ githubToken: 'other' });
      useAppStore.setState({ githubToken: 'fixture' });
      finishes[0]('stale README');
    });
    expect(signal.aborted).toBe(true);
    expect(result.current.readme).toBeNull();
    expect(mocks.getRepositoryReadme).toHaveBeenCalledTimes(2);
    await act(async () => { finishes[1]('fresh README'); });
    expect(result.current.readme).toBe('fresh README');
  });
});
