import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useAppStore } from '../../../store/useAppStore';
import { useShallow } from 'zustand/react/shallow';
import { useT } from '../../../i18n/useT';
import { repositoryChatStorage as storage } from '../../../services/repositoryChatStorage';
import {
  answerWorkbench, prepareWorkbenchRequirements, searchWorkbench,
  starWorkbenchRepository, workbenchRuntime,
} from '../../../services/aiWorkbenchService';
import {
  executeWorkbenchProposal, proposeWorkbenchOperations, restoreWorkbenchProposal,
} from '../../../services/aiWorkbenchOperations';
import type { Repository } from '../../../types';
import type { RepositoryChatMessage, RepositoryChatSession, ToolEvidence } from '../../../types/repositoryChat';
import type {
  WorkbenchProject, WorkbenchProposal, WorkbenchRequirements, WorkbenchSessionData,
} from '../../../types/aiWorkbench';
import { AIService } from '../../../services/aiService';

const HISTORY_EVENT = 'gsm:global-chat-history-changed';
const ACTIVE_KEY = 'gsm:ai-workbench-session';
const now = () => new Date().toISOString();
const defaults = (): WorkbenchSessionData => ({
  scope: 'github', depth: 'standard', selectedRepositories: [], searchBatches: [],
});

export function useAIWorkbench() {
  const t = useT('chat');
  const { user, repositories, aiConfigs, activeAIConfig, settings, setSettings } = useAppStore(useShallow((s) => ({
    user: s.user, repositories: s.repositories, aiConfigs: s.aiConfigs, activeAIConfig: s.activeAIConfig,
    settings: s.repositoryChatSettings, setSettings: s.setRepositoryChatSettings,
  })));
  const ownerId = user ? String(user.id) : '';
  const task = useSyncExternalStore(workbenchRuntime.subscribe, workbenchRuntime.getSnapshot);
  const [sessions, setSessions] = useState<RepositoryChatSession[]>([]);
  const [projects, setProjects] = useState<WorkbenchProject[]>([]);
  const [mode, setMode] = useState<'active' | 'archived' | 'trash' | 'legacy'>('active');
  const [activeId, setActiveId] = useState<string | null>(() => sessionStorage.getItem(ACTIVE_KEY));
  const [active, setActive] = useState<RepositoryChatSession | null>(null);
  const [messages, setMessages] = useState<RepositoryChatMessage[]>([]);
  const [evidence, setEvidence] = useState<ToolEvidence[]>([]);
  const [proposals, setProposals] = useState<WorkbenchProposal[]>([]);
  const [error, setError] = useState('');
  const revision = useRef(0);
  const mounted = useRef(true);
  const activeRef = useRef(activeId);
  activeRef.current = activeId;

  const refresh = useCallback(async () => {
    const request = ++revision.current;
    if (!ownerId) return;
    const [nextSessions, nextProjects, nextActive] = await Promise.all([
      storage.listWorkbenchSessions(ownerId, mode), storage.listProjects(ownerId),
      activeId ? storage.getSession(activeId) : Promise.resolve(null),
    ]);
    const owned = nextActive?.ownerId === ownerId ? nextActive : null;
    const [nextMessages, nextProposals] = owned
      ? await Promise.all([storage.listMessages(owned.id), storage.listProposals(ownerId, owned.id)])
      : [[], []];
    const nextEvidence = await storage.listEvidence(nextMessages.flatMap((m) => m.evidenceIds));
    if (!mounted.current || request !== revision.current) return;
    setSessions(nextSessions.sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || b.updatedAt.localeCompare(a.updatedAt))); setProjects(nextProjects); setActive(owned);
    setMessages(nextMessages); setProposals(nextProposals); setEvidence(nextEvidence);
  }, [ownerId, mode, activeId]);

  useEffect(() => {
    mounted.current = true;
    let timer: ReturnType<typeof setTimeout>;
    const update = () => {
      clearTimeout(timer);
      timer = setTimeout(() => { void refresh().catch((e: unknown) => setError(String(e))); }, 40);
    };
    void refresh().catch((e: unknown) => setError(String(e)));
    window.addEventListener(HISTORY_EVENT, update);
    return () => {
      mounted.current = false; clearTimeout(timer);
      window.removeEventListener(HISTORY_EVENT, update);
    };
  }, [refresh]);

  useEffect(() => {
    if (!ownerId) return;
    void storage.cleanupWorkbench(ownerId, settings.retainSessionDays, task.running ? task.sessionId ?? undefined : undefined)
      .then(refresh).catch((e: unknown) => setError(String(e)));
  // Cleanup runs on account/retention change, never on each streaming message.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownerId, settings.retainSessionDays]);

  const select = useCallback((id: string | null) => {
    setActiveId(id); setError('');
    if (id) sessionStorage.setItem(ACTIVE_KEY, id);
    else sessionStorage.removeItem(ACTIVE_KEY);
  }, []);

  const guard = useCallback(async (action: () => Promise<unknown>) => {
    try { setError(''); await action(); if (mounted.current) await refresh(); }
    catch (e) { if (mounted.current) setError(e instanceof Error ? e.message : String(e)); }
  }, [refresh]);

  const requireOwned = async (id: string) => {
    const record = await storage.getSession(id);
    if (!record || record.ownerId !== ownerId || String(useAppStore.getState().user?.id ?? '') !== ownerId) {
      throw new Error(t('workbench.accountChanged'));
    }
    return record;
  };

  const patchSession = async (id: string, patch: Partial<RepositoryChatSession>) => {
    const record = await requireOwned(id);
    if (task.running && task.sessionId === id && (patch.deletedAt || patch.archived)) {
      throw new Error(t('workbench.stopFirst'));
    }
    await storage.saveSession({ ...record, ...patch, id: record.id, ownerId, updatedAt: now() });
  };

  const patchData = async (id: string, patch: Partial<WorkbenchSessionData>) => {
    const record = await requireOwned(id);
    const initial = record.repoId ? {
      ...defaults(), scope: 'selected' as const, selectedRepositories: repositories.filter((r) => r.id === record.repoId),
    } : defaults();
    await patchSession(id, { workbench: { ...initial, ...record.workbench, ...patch } });
  };

  const createSession = async (projectId?: string) => {
    if (!ownerId) throw new Error(t('workbench.accountChanged'));
    const record: RepositoryChatSession = {
      id: crypto.randomUUID(), ownerId, kind: 'workbench', projectId,
      repoId: 0, repoFullName: '', sourceRefSha: '', title: t('workbench.newChat'),
      createdAt: now(), updatedAt: now(), workbench: defaults(),
    };
    await storage.saveSession(record);
    setMode('active'); select(record.id);
    return record;
  };

  const saveProject = async (project: WorkbenchProject) => {
    if (project.ownerId !== ownerId || String(useAppStore.getState().user?.id ?? '') !== ownerId) throw new Error(t('workbench.accountChanged'));
    await storage.saveProject({ ...project, updatedAt: now() });
  };

  const createProject = async (name: string) => {
    const project: WorkbenchProject = {
      id: crypto.randomUUID(), ownerId, name: name.trim(), instructions: '', conclusions: '',
      repositories: [], createdAt: now(), updatedAt: now(),
    };
    if (!project.name) return;
    await saveProject(project);
    await createSession(project.id);
  };

  const project = projects.find((p) => p.id === active?.projectId);
  const data = active?.workbench ?? (active ? {
    ...defaults(), scope: 'selected' as const,
    selectedRepositories: repositories.filter((r) => r.id === active?.repoId),
  } : defaults());

  const withTask = async (record: RepositoryChatSession, action: (signal: AbortSignal, stage: (s: string) => void) => Promise<void>) => {
    await workbenchRuntime.run(record.id, ownerId, async (signal, stage) => {
      await requireOwned(record.id);
      await action(signal, stage);
    });
  };

  const send = async (question: string, manage = false) => {
    if (!question.trim()) return;
    if (task.running) throw new Error(t('workbench.busy'));
    const record = active ?? await createSession();
    if (record.deletedAt || record.archived) throw new Error(t('workbench.restoreFirst'));
    const context = record.workbench ?? data;
    await withTask(record, async (signal, stage) => {
      const history = await storage.listMessages(record.id);
      const userMessage: RepositoryChatMessage = {
        id: crypto.randomUUID(), sessionId: record.id, role: 'user', content: question.trim(),
        status: 'complete', evidenceIds: [], createdAt: now(),
      };
      const reply: RepositoryChatMessage = {
        ...userMessage, id: crypto.randomUUID(), role: 'assistant', content: '',
        status: 'streaming', createdAt: new Date(Date.parse(userMessage.createdAt) + 1).toISOString(),
      };
      await storage.saveMessage(userMessage);
      await storage.saveMessage(reply);
      await patchSession(record.id, { title: history.length ? record.title : question.trim().slice(0, 72) });
      try {
        if (manage) {
          stage('planning');
          const proposal = await proposeWorkbenchOperations({ question, sessionId: record.id, signal });
          signal.throwIfAborted();
          await storage.saveProposal(proposal);
          reply.content = t('workbench.reviewProposal');
        } else if (context.scope === 'github') {
          stage('requirements');
          const requirements = await prepareWorkbenchRequirements({ question, previous: context.requirements, project, signal });
          signal.throwIfAborted();
          await patchData(record.id, { requirements });
          reply.content = requirements.questions.length ? requirements.questions.join('\n\n') : t('workbench.confirmRequirements');
        } else {
          stage('verification');
          let sources = context.scope === 'project' ? project?.repositories ?? []
            : context.scope === 'library' ? repositories : context.selectedRepositories;
          if (context.scope === 'project' || context.scope === 'library') {
            const state = useAppStore.getState();
            const config = state.aiConfigs.find((c) => c.id === (state.repositoryChatSettings.chatConfigId ?? state.activeAIConfig));
            if (config && sources.length) {
              const matches = await new AIService(config, state.language).searchRepositoriesWithSelection(sources, question, { signal });
              signal.throwIfAborted();
              const ids = new Set(matches.map((r) => r.id));
              sources = sources.filter((r) => ids.has(r.id));
            }
          }
          const result = await answerWorkbench({
            question, repositories: sources, project, session: record,
            messages: [...history, userMessage], depth: context.depth, signal,
            onChunk: (content) => {
              if (signal.aborted) return;
              reply.content = content;
              if (mounted.current && activeRef.current === record.id) setMessages([...history, userMessage, { ...reply }]);
            },
          });
          signal.throwIfAborted();
          await Promise.all(result.evidences.map((item) => storage.saveEvidence(item)));
          reply.content = result.content;
          reply.evidenceIds = result.evidences.map((item) => item.id);
        }
        reply.status = 'complete';
      } catch (e) {
        reply.status = signal.aborted ? 'aborted' : 'error';
        reply.content = signal.aborted ? reply.content || t('workbench.interrupted') : e instanceof Error ? e.message : String(e);
        throw e;
      } finally {
        await storage.saveMessage(reply);
      }
    });
  };

  const search = async (requirements: WorkbenchRequirements, page = 1) => {
    if (!active) return;
    const record = active;
    await withTask(record, async (signal, stage) => {
      stage('retrieval');
      const confirmed = { ...requirements };
      if (!confirmed.queries.length) {
        const prepared = await prepareWorkbenchRequirements({
          question: JSON.stringify({ purpose: confirmed.purpose, required: confirmed.required, preferred: confirmed.preferred, excluded: confirmed.excluded }),
          previous: confirmed, project, signal,
        });
        signal.throwIfAborted();
        confirmed.queries = prepared.queries;
      }
      await patchData(record.id, { requirements: confirmed });
      await searchWorkbench({
        requirements: confirmed, depth: data.depth, page, signal,
        onUpdate: async (batch) => {
          signal.throwIfAborted();
          const latest = await requireOwned(record.id);
          const current = latest.workbench ?? defaults();
          await patchData(record.id, {
            searchBatches: [...current.searchBatches.filter((b) => b.id !== batch.id), batch],
          });
        },
      });
    });
  };

  const addRepository = async (repository: Repository, toProject = false) => {
    if (!active) return;
    if (toProject) {
      if (!project) throw new Error(t('workbench.chooseProject'));
      await saveProject({ ...project, repositories: [...project.repositories.filter((r) => r.id !== repository.id), repository] });
    } else {
      await patchData(active.id, {
        selectedRepositories: [...data.selectedRepositories.filter((r) => r.id !== repository.id), repository],
      });
    }
  };

  const execute = async (proposal: WorkbenchProposal, restore = false) => {
    if (!active) return;
    await withTask(active, async (signal, stage) => {
      stage(restore ? 'restore' : 'execution');
      const update = async (next: WorkbenchProposal) => {
        await storage.saveProposal(next);
        if (mounted.current && activeRef.current === next.sessionId) {
          setProposals((previous) => [...previous.filter((p) => p.id !== next.id), next]);
        }
      };
      if (restore) await restoreWorkbenchProposal(proposal, signal, update);
      else await executeWorkbenchProposal(proposal, signal, update);
    });
  };

  return {
    ownerId, sessions, projects, mode, setMode, active, activeId, select, messages, evidence,
    proposals, project, data, error, task, guard, refresh, repositories, aiConfigs,
    modelId: settings.chatConfigId ?? activeAIConfig ?? '', settings, setSettings,
    createSession, createProject, saveProject, patchSession, patchData, send, search, addRepository,
    execute, stop: workbenchRuntime.stop,
    star: starWorkbenchRepository,
    claim: async (id: string) => { await storage.claimSession(id, ownerId); setMode('active'); select(id); },
    restoreSession: async (id: string) => { await requireOwned(id); await storage.restoreSession(id); },
    deleteProject: async (p: WorkbenchProject) => {
      if (task.running) throw new Error(t('workbench.stopFirst'));
      for (const s of [...await storage.listWorkbenchSessions(ownerId), ...await storage.listWorkbenchSessions(ownerId, 'archived'), ...await storage.listWorkbenchSessions(ownerId, 'trash')]) {
        if (s.projectId === p.id) await patchSession(s.id, { projectId: undefined });
      }
      await saveProject({ ...p, deletedAt: now() });
    },
    exportBackup: () => storage.exportWorkbench(ownerId),
    importBackup: (value: unknown) => storage.importWorkbench(ownerId, value),
  };
}
