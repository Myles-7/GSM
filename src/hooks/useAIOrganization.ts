import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useAppStore } from '../store/useAppStore';
import type { Repository } from '../types';
import type { OrganizationEntry } from '../types/aiOrganization';
import type { WorkbenchProposal } from '../types/aiWorkbench';
import { repositoryChatStorage as storage } from '../services/repositoryChatStorage';
import { workbenchRuntime } from '../services/aiWorkbenchService';
import { runOrganizationGeneration } from '../services/aiOrganizationWorkflow';
import { applyOrganizationProposal, editOrganizationProposal, reconcileOrganizationProposal, restoreOrganizationProposal, retryOrganizationSync } from '../services/aiOrganizationExecution';
import { organizationScopeRepositories, type OrganizationScope } from '../utils/organizationScope';
import { useT } from '../i18n/useT';

export function useAIOrganization(input: { filteredRepositories: Repository[]; selectedRepositoryIds: number[]; categoryId: string; sessionId?: string }) {
  const t = useT('repositories');
  const { user, repositories, aiConfigs, activeAIConfig } = useAppStore(useShallow(s => ({ user: s.user, repositories: s.repositories, aiConfigs: s.aiConfigs, activeAIConfig: s.activeAIConfig })));
  const ownerId = String(user?.id ?? '');
  const task = useSyncExternalStore(workbenchRuntime.subscribe, workbenchRuntime.getSnapshot);
  const [scope, setScope] = useState<OrganizationScope>('default');
  const [configId, setConfigId] = useState(activeAIConfig ?? '');
  const [instruction, setInstruction] = useState('');
  const [maxNewSubcategories, setMaxNewSubcategories] = useState(6);
  const [replaceManual, setReplaceManual] = useState(false);
  const [sessionId, setSessionId] = useState(input.sessionId ?? sessionStorage.getItem(`gsm:organization-session:${ownerId}`) ?? '');
  const [versions, setVersions] = useState<WorkbenchProposal[]>([]);
  const [versionId, selectVersion] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const mounted = useRef(true);
  const refreshId = useRef(0);
  const contextRef = useRef({ ownerId, sessionId });
  contextRef.current = { ownerId, sessionId };
  useEffect(() => { setSessionId(input.sessionId ?? sessionStorage.getItem(`gsm:organization-session:${ownerId}`) ?? ''); selectVersion(''); setVersions([]); }, [input.sessionId, ownerId]);
  useEffect(() => { setScope('default'); }, [input.categoryId]);
  useEffect(() => { if (!configId && activeAIConfig) setConfigId(activeAIConfig); }, [activeAIConfig, configId]);
  const refresh = useCallback(async () => {
    const request = ++refreshId.current;
    if (!sessionId || !ownerId) { setVersions([]); return; }
    const next = (await storage.listProposals(ownerId, sessionId)).filter(p => p.organization).sort((a, b) => b.organization!.revision - a.organization!.revision);
    const current = () => mounted.current && contextRef.current.ownerId === ownerId
      && contextRef.current.sessionId === sessionId && request === refreshId.current;
    if (!current()) return;
    const running = workbenchRuntime.getSnapshot();
    if (next[0] && !(running.running && running.sessionId === sessionId)) await reconcileOrganizationProposal(next[0]);
    if (current()) setVersions(next);
  }, [sessionId, ownerId]);
  useEffect(() => {
    mounted.current = true;
    const update = () => { void refresh().catch(e => { if (mounted.current) setError(String(e)); }); };
    update(); window.addEventListener('gsm:global-chat-history-changed', update);
    return () => { mounted.current = false; window.removeEventListener('gsm:global-chat-history-changed', update); };
  }, [refresh]);
  const proposal = versions.find(p => p.id === versionId) ?? versions[0] ?? null;
  const readonly = Boolean(proposal && (proposal.id !== versions[0]?.id || proposal.organization?.status === 'imported'));
  const scoped = organizationScopeRepositories({ repositories: input.filteredRepositories, selectedIds: input.selectedRepositoryIds, categoryId: input.categoryId, scope });
  const scopeOptions = (['default', 'selected', 'current', 'pending', 'all'] as OrganizationScope[]).map(value => ({ value, label: t(`aiOrganization.scope.${value}`), count: organizationScopeRepositories({ repositories: input.filteredRepositories, selectedIds: input.selectedRepositoryIds, categoryId: input.categoryId, scope: value }).length }));
  const guard = async (action: () => Promise<unknown>) => {
    setError(''); setSaving(true);
    const current = () => mounted.current && contextRef.current.ownerId === ownerId && contextRef.current.sessionId === sessionId;
    try { await action(); if (current() && sessionId) await refresh(); }
    catch (e) {
      if (mounted.current && contextRef.current.ownerId === ownerId && !(e instanceof Error && e.name === 'AbortError')) {
        const secrets = [useAppStore.getState().githubToken, ...useAppStore.getState().aiConfigs.map(config => config.apiKey)].filter((value): value is string => Boolean(value));
        setError(secrets.reduce((message, secret) => message.split(secret).join('[redacted]'), e instanceof Error ? e.message : String(e)).slice(0, 1000));
      }
    }
    finally { if (mounted.current) setSaving(false); }
  };
  const generate = (retryOnly = false, enrichRepositoryIds?: number[], batchIndex?: number) => guard(async () => {
    if (task.running || readonly) throw new Error(t('aiOrganization.busy'));
    let id = sessionId;
    if (!id) {
      if (!ownerId) throw new Error(t('aiOrganization.accountRequired'));
      id = crypto.randomUUID();
      const date = new Date().toISOString();
      await storage.saveSession({ id, ownerId, kind: 'workbench', title: t('aiOrganization.title'), repoId: 0, repoFullName: '', sourceRefSha: '', createdAt: date, updatedAt: date,
        workbench: { scope: 'library', depth: 'standard', selectedRepositories: [], searchBatches: [] } });
      setSessionId(id);
      sessionStorage.setItem(`gsm:organization-session:${ownerId}`, id);
    }
    selectVersion('');
    const selected = proposal ? repositories.filter(r => proposal.organization!.scope.repositoryIds.includes(r.id)) : scoped;
    await runOrganizationGeneration({ sessionId: id, repositories: selected, scopeName: proposal?.organization?.scope.name ?? scope,
      configId, instruction: instruction.trim() || proposal?.organization?.instruction || t('aiOrganization.defaultInstruction'),
      previous: proposal ?? undefined, retryOnly, enrichRepositoryIds, replaceManual, maxNewSubcategories, batchIndex });
    if (mounted.current && contextRef.current.sessionId === id && String(useAppStore.getState().user?.id ?? '') === ownerId) {
      setInstruction('');
      const records = (await storage.listProposals(ownerId, id)).filter(p => p.organization).sort((a, b) => b.organization!.revision - a.organization!.revision);
      if (contextRef.current.sessionId === id && contextRef.current.ownerId === ownerId) setVersions(records);
    }
  });
  const execute = (operation: 'apply' | 'restore' | 'sync', targetRepositoryIds?: number[]) => guard(async () => {
    if (!proposal || readonly) return;
    if (operation === 'apply' && task.running) {
      await applyOrganizationProposal(proposal.id, undefined, undefined, targetRepositoryIds);
    } else {
      await workbenchRuntime.run(proposal.sessionId, ownerId, async (signal, stage) => {
        signal.throwIfAborted(); stage(operation === 'restore' ? 'restore' : 'execution');
        if (operation === 'apply') await applyOrganizationProposal(proposal.id, proposal.updatedAt, signal, targetRepositoryIds);
        else if (operation === 'restore') await restoreOrganizationProposal(proposal.id, proposal.updatedAt, signal);
        else await retryOrganizationSync(proposal.id);
      });
    }
  });
  return {
    scope, setScope, scopeOptions, repositories, configId, setConfigId, aiConfigs, instruction, setInstruction,
    maxNewSubcategories, setMaxNewSubcategories, replaceManual, setReplaceManual, proposal, versions, selectVersion,
    saving, busy: task.running || saving, task, error, readonly, count: scoped.length, scopedRepositories: scoped,
    generate: () => generate(), retry: () => generate(true), enrich: (ids: number[]) => generate(true, ids),
    retryBatch: (batchIndex: number) => generate(true, undefined, batchIndex),
    editEntry: (repositoryId: number, patch: Partial<Pick<OrganizationEntry, 'categoryId' | 'subcategoryId' | 'selected' | 'overrideLocked'>>) => guard(async () => {
      if (proposal && !readonly && !task.running) await editOrganizationProposal(proposal.id, proposal.updatedAt, { repositoryId, patch });
    }),
    selectEntries: (repositoryIds: number[], selected: boolean) => guard(async () => {
      if (proposal && !readonly && !task.running) await editOrganizationProposal(proposal.id, proposal.updatedAt, { selection: { repositoryIds, selected } });
    }),
    renameCategory: (categoryId: string, name: string) => guard(async () => {
      if (proposal && !readonly && !task.running) await editOrganizationProposal(proposal.id, proposal.updatedAt, { categoryId, name });
    }),
    apply: (targetRepositoryIds?: number[]) => execute('apply', targetRepositoryIds),
    restore: () => execute('restore'), retrySync: () => execute('sync'), stop: workbenchRuntime.stop,
    newDraft: () => { sessionStorage.removeItem(`gsm:organization-session:${ownerId}`); setSessionId(''); setVersions([]); selectVersion(''); setInstruction(''); setError(''); },
    continueInWorkbench: () => {
      if (!sessionId) return;
      sessionStorage.setItem('gsm:ai-workbench-session', sessionId);
      window.dispatchEvent(new CustomEvent('gsm:select-workbench-session', { detail: sessionId }));
      useAppStore.getState().setCurrentView('ai');
    },
  };
}
