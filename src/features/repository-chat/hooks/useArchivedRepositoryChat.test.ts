import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RepositoryChatSession } from '../../../types/repositoryChat';
import { useArchivedRepositoryChat } from './useArchivedRepositoryChat';

const fixtures = vi.hoisted(() => ({
  input: { user: { id: 42 }, githubToken: 'fixture' },
  getRepository: vi.fn(),
  getRepositoryHeadSha: vi.fn(),
}));
vi.mock('../../../store/useAppStore', () => ({
  useAppStore: (selector: (state: typeof fixtures.input) => unknown) => selector(fixtures.input),
}));
vi.mock('../../../services/githubApiFactory', () => ({
  createGitHubApiService: () => ({
    getRepository: fixtures.getRepository,
    getRepositoryHeadSha: fixtures.getRepositoryHeadSha,
  }),
}));

const pinned = 'a'.repeat(40);
const saved: RepositoryChatSession = {
  id: 'existing', ownerId: '42', kind: 'repository', repoId: 131,
  repoFullName: 'owner/unstarred', title: 'Original chat', sourceRefSha: pinned,
  createdAt: '2026-10-24T00:00:00.000Z', updatedAt: '2026-10-24T00:00:00.000Z',
};

describe('unstarred repository history access', () => {
  beforeEach(() => {
    fixtures.getRepository.mockReset().mockResolvedValue({ id: saved.repoId, full_name: saved.repoFullName });
    fixtures.getRepositoryHeadSha.mockReset().mockResolvedValue(pinned);
  });

  it('enables the original session only for the matching repository and pinned commit', async () => {
    const { result } = renderHook(() => useArchivedRepositoryChat(saved));
    await waitFor(() => expect(result.current.repository).toMatchObject({ id: saved.repoId }));
    expect(fixtures.getRepositoryHeadSha).toHaveBeenCalledWith('owner', 'unstarred', pinned, expect.any(AbortSignal));
  });

  it('keeps reused names and different commits read-only', async () => {
    fixtures.getRepository.mockResolvedValueOnce({ id: 999, full_name: saved.repoFullName });
    fixtures.getRepositoryHeadSha.mockResolvedValue('b'.repeat(40));
    const { result, rerender } = renderHook(({ session }) => useArchivedRepositoryChat(session), { initialProps: { session: saved } });
    await waitFor(() => expect(result.current.checking).toBe(false));
    expect(result.current.repository).toBeNull();
    expect(fixtures.getRepositoryHeadSha).not.toHaveBeenCalled();
    rerender({ session: { ...saved, id: 'next' } });
    await waitFor(() => expect(result.current.checking).toBe(false));
    expect(result.current.repository).toBeNull();
  });

  it('cancels a pending verification when the owner changes', async () => {
    let verify!: (sha: string) => void;
    fixtures.getRepositoryHeadSha.mockImplementation(() => new Promise(resolve => { verify = resolve; }));
    const { result, rerender } = renderHook(({ session }) => useArchivedRepositoryChat(session), { initialProps: { session: saved } });
    await waitFor(() => expect(fixtures.getRepositoryHeadSha).toHaveBeenCalledOnce());
    const signal = fixtures.getRepositoryHeadSha.mock.calls[0][3] as AbortSignal;
    rerender({ session: { ...saved, ownerId: '43' } });
    expect(signal.aborted).toBe(true);
    verify(pinned);
    expect(result.current).toEqual({ repository: null, checking: false });
  });
});
