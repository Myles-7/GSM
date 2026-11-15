import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useRepositoryChatSessions } from './useRepositoryChatSessions';
import type { Repository } from '../../../types';
import type { RepositoryChatMessage, RepositoryChatSession } from '../../../types/repositoryChat';
import { repositoryChatStorage } from '../../../services/repositoryChatStorage';

vi.mock('../../../store/useAppStore', () => ({
  useAppStore: (selector: (state: { user: { id: number }; githubToken: string; repositoryChatSettings: { retainSessionDays: number } }) => unknown) =>
    selector({ user: { id: 7 }, githubToken: 'test-token', repositoryChatSettings: { retainSessionDays: 90 } }),
}));

const repository = { id: 1, full_name: 'owner/repo-one' } as unknown as Repository;

describe('useRepositoryChatSessions global history notification', () => {
  beforeEach(() => {
    window.localStorage.clear();
    Object.defineProperty(window, 'indexedDB', { configurable: true, value: undefined });
  });

  it('创建会话后派发全局历史刷新事件', async () => {
    const dispatchSpy = vi.fn();
    window.addEventListener('gsm:global-chat-history-changed', dispatchSpy);
    try {
      const { result } = renderHook(() =>
        useRepositoryChatSessions({
          repository,
          language: 'zh',
          resolveSourceRefSha: async () => 'abc123def456',
        }),
      );

      let sessionId: string | null = null;
      await act(async () => {
        const session = await result.current.createSession();
        sessionId = session?.id ?? null;
      });

      expect(sessionId).toBeTruthy();
      expect(dispatchSpy).toHaveBeenCalled();
    } finally {
      window.removeEventListener('gsm:global-chat-history-changed', dispatchSpy);
    }
  });

  it('删除会话后派发全局历史刷新事件', async () => {
    const dispatchSpy = vi.fn();
    window.addEventListener('gsm:global-chat-history-changed', dispatchSpy);
    try {
      const { result } = renderHook(() =>
        useRepositoryChatSessions({
          repository,
          language: 'zh',
          resolveSourceRefSha: async () => 'abc123def456',
        }),
      );

      let sessionId = '';
      await act(async () => {
        sessionId = (await result.current.createSession())?.id ?? '';
      });
      dispatchSpy.mockClear();

      await act(async () => {
        await result.current.deleteSession(sessionId);
      });
      expect(dispatchSpy).toHaveBeenCalled();
    } finally {
      window.removeEventListener('gsm:global-chat-history-changed', dispatchSpy);
    }
  });

  it('ignores a history reload for the former selection and clears a deleted active session', async () => {
    const time = new Date().toISOString();
    const first: RepositoryChatSession = {
      id: 'first', repoId: 1, repoFullName: repository.full_name, sourceRefSha: 'a'.repeat(40),
      title: 'First', ownerId: '7', kind: 'repository', createdAt: time, updatedAt: time,
    };
    const second = { ...first, id: 'second', title: 'Second' };
    await repositoryChatStorage.saveSession(first);
    await repositoryChatStorage.saveSession(second);
    const { result } = renderHook(() => useRepositoryChatSessions({
      repository, language: 'en', initialSessionId: first.id,
    }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.activeSession?.id).toBe(first.id);

    let finishOldLoad!: (messages: RepositoryChatMessage[]) => void;
    const messages = vi.spyOn(repositoryChatStorage, 'listMessages').mockImplementationOnce(
      () => new Promise(resolve => { finishOldLoad = resolve; }),
    );
    try {
      act(() => { window.dispatchEvent(new CustomEvent('gsm:global-chat-history-changed')); });
      await waitFor(() => expect(messages).toHaveBeenCalledWith(first.id));
      await act(async () => { await result.current.selectSession(second.id); });
      await act(async () => { finishOldLoad([]); });
      expect(result.current.activeSession?.id).toBe(second.id);

      await act(async () => {
        await repositoryChatStorage.softDeleteSession(second.id);
        window.dispatchEvent(new CustomEvent('gsm:global-chat-history-changed'));
      });
      await waitFor(() => expect(result.current.activeSession).toBeNull());
    } finally {
      messages.mockRestore();
    }
  });
});
