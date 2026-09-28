
import { useT } from '../../../i18n/useT';
import type { AppLanguage } from '../../../i18n/languages';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Repository } from '../../../types';
import { useAppStore } from '../../../store/useAppStore';
import { resolveRepositoryChatHeadSha } from '../../../services/repositoryChatService';
import type { RepositoryChatMessage, RepositoryChatSession } from '../../../types/repositoryChat';
import { repositoryChatStorage } from '../../../services/repositoryChatStorage';
import { workbenchRuntime } from '../../../services/aiWorkbenchService';

const createId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `repository-chat-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
};

/** 会话默认标题集合：历史会话可能以任意语言创建，判断是否默认标题用集合比较 */
export const DEFAULT_CHAT_TITLES = new Set([
  '新对话', 'New conversation', '新しい会話', 'Nueva conversación', 'Nova conversa',
  'Новый диалог', '新對話', 'Nouvelle conversation', 'Neue Unterhaltung', '새 대화',
]);
const DEFAULT_TITLE_BY_LANGUAGE: Record<AppLanguage, string> = {
  zh: '新对话', en: 'New conversation', ja: '新しい会話', es: 'Nueva conversación', 'pt-BR': 'Nova conversa',
  ru: 'Новый диалог', 'zh-TW': '新對話', fr: 'Nouvelle conversation', de: 'Neue Unterhaltung', ko: '새 대화',
};
const defaultTitle = (language: AppLanguage) => DEFAULT_TITLE_BY_LANGUAGE[language] ?? 'New conversation';

/** 通知全局问答历史入口（SearchBar 徽标、历史抽屉）刷新。 */
const notifyGlobalHistoryChanged = () => {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('gsm:global-chat-history-changed'));
  }
};

export interface UseRepositoryChatSessionsOptions {
  repository: Repository | null;
  language: AppLanguage;
  resolveSourceRefSha?: (repository: Repository, signal?: AbortSignal) => Promise<string>;
}

export const useRepositoryChatSessions = ({
  repository,
  language,
  resolveSourceRefSha,
}: UseRepositoryChatSessionsOptions) => {
  const t = useT('chat');
  const githubToken = useAppStore((state) => state.githubToken);
  const user = useAppStore((state) => state.user);
  const ownerId = user ? String(user.id) : '';
  const retainSessionDays = useAppStore((state) => state.repositoryChatSettings.retainSessionDays);
  const [sessions, setSessions] = useState<RepositoryChatSession[]>([]);
  const [activeSession, setActiveSession] = useState<RepositoryChatSession | null>(null);
  const [messages, setMessages] = useState<RepositoryChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const operationIdRef = useRef(0);

  const loadSessionMessages = useCallback(async (session: RepositoryChatSession | null, operationId: number) => {
    if (!session) {
      if (operationId === operationIdRef.current) setMessages([]);
      return;
    }
    const nextMessages = await repositoryChatStorage.listMessages(session.id);
    if (operationId === operationIdRef.current) setMessages(nextMessages);
  }, []);

  const refresh = useCallback(async () => {
    const operationId = ++operationIdRef.current;
    if (!repository) {
      setSessions([]);
      setActiveSession(null);
      setMessages([]);
      return;
    }

    setIsLoading(true);
    setError(null);
    try {
      const nextSessions = (await repositoryChatStorage.listSessionsByRepository(repository.id))
        .filter((session) => Boolean(ownerId) && session.ownerId === ownerId && !session.archived);
      if (operationId !== operationIdRef.current) return;
      setSessions(nextSessions);
      const mostRecent = nextSessions[0] ?? null;
      setActiveSession(mostRecent);
      await loadSessionMessages(mostRecent, operationId);
    } catch (unknownError) {
      if (operationId === operationIdRef.current) setError(unknownError instanceof Error ? unknownError.message : 'Unable to load repository chat sessions');
    } finally {
      if (operationId === operationIdRef.current) setIsLoading(false);
    }
  }, [loadSessionMessages, repository, ownerId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!ownerId) return;
    const task = workbenchRuntime.getSnapshot();
    void repositoryChatStorage.cleanupWorkbench(ownerId, retainSessionDays, task.running ? task.sessionId ?? undefined : undefined)
      .catch(() => undefined);
  }, [ownerId, retainSessionDays]);

  useEffect(() => {
    let active = true;
    const reload = async () => {
      if (!repository || !ownerId) return;
      const next = (await repositoryChatStorage.listSessionsByRepository(repository.id))
        .filter((item) => item.ownerId === ownerId && !item.archived);
      const current = next.find((item) => item.id === activeSession?.id);
      const nextMessages = current ? await repositoryChatStorage.listMessages(current.id) : [];
      if (!active) return;
      setSessions(next);
      if (current) { setActiveSession(current); setMessages(nextMessages); }
    };
    const handler = () => { void reload().catch(() => undefined); };
    window.addEventListener('gsm:global-chat-history-changed', handler);
    return () => { active = false; window.removeEventListener('gsm:global-chat-history-changed', handler); };
  }, [repository, ownerId, activeSession?.id]);

  const createSession = useCallback(async () => {
    const operationId = ++operationIdRef.current;
    if (!repository || !ownerId) return null;
    setIsLoading(true);
    setError(null);
    try {
      const resolveSha = resolveSourceRefSha ?? ((targetRepository: Repository) => {
        if (!githubToken) throw new Error(t('useRepositoryChatSessions.configure-a-github-token-before-starting-a-conve'));
        return resolveRepositoryChatHeadSha(targetRepository, githubToken);
      });
      const sourceRefSha = await resolveSha(repository);
      if (operationId !== operationIdRef.current) return null;
      const now = new Date().toISOString();
      const session: RepositoryChatSession = {
        id: createId(),
        ownerId,
        kind: 'repository',
        repoId: repository.id,
        repoFullName: repository.full_name,
        sourceRefSha,
        title: defaultTitle(language),
        createdAt: now,
        updatedAt: now,
      };
      await repositoryChatStorage.saveSession(session);
      if (operationId !== operationIdRef.current) return null;
      setSessions((previous) => [session, ...previous]);
      setActiveSession(session);
      setMessages([]);
      notifyGlobalHistoryChanged();
      return session;
    } catch (unknownError) {
      if (operationId === operationIdRef.current) setError(unknownError instanceof Error ? unknownError.message : 'Unable to create a repository chat session');
      return null;
    } finally {
      if (operationId === operationIdRef.current) setIsLoading(false);
    }
  }, [githubToken, language, repository, resolveSourceRefSha, t, ownerId]);

  const selectSession = useCallback(async (sessionId: string) => {
    const operationId = ++operationIdRef.current;
    const session = sessions.find((item) => item.id === sessionId) ?? null;
    setActiveSession(session);
    await loadSessionMessages(session, operationId);
  }, [loadSessionMessages, sessions]);

  const deleteSession = useCallback(async (sessionId: string) => {
    const operationId = ++operationIdRef.current;
    setIsLoading(true);
    setError(null);
    try {
      if (!sessions.some((item) => item.id === sessionId && item.ownerId === ownerId)) return;
      await repositoryChatStorage.softDeleteSession(sessionId);
      notifyGlobalHistoryChanged();
      if (operationId !== operationIdRef.current) return;
      const nextSessions = sessions.filter((session) => session.id !== sessionId);
      setSessions(nextSessions);
      const nextActive = activeSession?.id === sessionId ? (nextSessions[0] ?? null) : activeSession;
      setActiveSession(nextActive);
      await loadSessionMessages(nextActive, operationId);
    } catch (unknownError) {
      if (operationId === operationIdRef.current) setError(unknownError instanceof Error ? unknownError.message : 'Unable to delete the repository chat session');
    } finally {
      if (operationId === operationIdRef.current) setIsLoading(false);
    }
  }, [activeSession, loadSessionMessages, sessions, ownerId]);

  const updateSession = useCallback(async (session: RepositoryChatSession) => {
    await repositoryChatStorage.saveSession(session);
    setSessions((previous) => previous
      .map((item) => item.id === session.id ? session : item)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)));
    setActiveSession((previous) => previous?.id === session.id ? session : previous);
  }, []);

  return {
    sessions,
    activeSession,
    messages,
    isLoading,
    error,
    refresh,
    createSession,
    selectSession,
    deleteSession,
    updateSession,
    setMessages,
  };
};
