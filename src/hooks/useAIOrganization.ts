import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useAppStore } from '../store/useAppStore';
import type { Repository } from '../types';
import type { OrganizationAnalysisDepth, OrganizationEntry, OrganizationMode } from '../types/aiOrganization';
import type { WorkbenchProposal } from '../types/aiWorkbench';
import { repositoryChatStorage as storage, type ChatHistoryChange } from '../services/repositoryChatStorage';
import { workbenchRuntime } from '../services/aiWorkbenchService';
import { runOrganizationGeneration } from '../services/aiOrganizationWorkflow';
import { applyOrganizationProposal, editOrganizationProposal, organizationCategorySnapshot, reconcileOrganizationProposal, restoreOrganizationProposal, retryOrganizationSync } from '../services/aiOrganizationExecution';
import { organizationScopeRepositories, type OrganizationScope } from '../utils/organizationScope';
import { useT } from '../i18n/useT';
import { acceptOriginalStructureGroup, applyCategoryStructure, editCategoryStructure, migrateStructureSelection, proposeCategoryStructure, restoreCategoryStructure, runStructureGeneration, type StructureSuggestion } from '../services/aiCategoryStructure';
import type { ClassificationSchemeId } from '../types/classification';
import { classificationMembership, projectClassificationRepository } from '../store/helpers/classificationSchemes';
import { assertOrganizationModelReady } from '../services/aiOrganizationReadiness';
import { refreshAgyDeviceState } from '../services/agyClient';
import { runOrganizationRefinement } from '../services/aiOrganizationRefinement';
import { agyFeatureConcurrency } from '../services/agyProfiles';
import { readRepositoryDetails } from '../utils/repositoryDetailsSchema';
import { continueLegacyCategoryProposal, createManualOrganizationProposal, editCategoryTree, previewCategoryApplication, type CategoryTreeEdit } from '../services/aiOrganizationTree';
import { runMergeSubcategoryRedesign } from '../services/aiOrganizationTreeRedesign';
import { confirmOrganizationNewCalls, retryOrganizationTaskSave } from '../services/aiOrganizationResultRecovery';
import { aiTaskJournal } from '../services/aiTaskJournal';

function waitForWorkbenchStop(): Promise<void> {
  if (!workbenchRuntime.getSnapshot().running) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { unsubscribe(); reject(new Error('AI task is still stopping; retry after it has stopped')); }, 20000);
    const unsubscribe = workbenchRuntime.subscribe(() => {
      if (!workbenchRuntime.getSnapshot().running) { clearTimeout(timer); unsubscribe(); resolve(); }
    });
    if (!workbenchRuntime.getSnapshot().running) { clearTimeout(timer); unsubscribe(); resolve(); }
  });
}

export function useAIOrganization(input: { filteredRepositories: Repository[]; selectedRepositoryIds: number[]; categoryId: string; sessionId?: string }) {
  const t = useT('repositories');
  const { user, repositories, aiConfigs, activeAIConfig } = useAppStore(useShallow(s => ({ user: s.user, repositories: s.repositories, aiConfigs: s.aiConfigs, activeAIConfig: s.activeAIConfig })));
  const ownerId = String(user?.id ?? '');
  const activeScheme = useAppStore(s => s.activeClassificationScheme ?? 'purpose');
  const treeState = useAppStore(useShallow(s => ({ customCategories: s.customCategories, defaultCategoryOverrides: s.defaultCategoryOverrides,
    hiddenDefaultCategoryIds: s.hiddenDefaultCategoryIds, categoryOrder: s.categoryOrder, subcategories: s.subcategories, subcategoryOrder: s.subcategoryOrder,
    repositoryOrder: s.repositoryOrder, categoryListIdMap: s.categoryListIdMap, classificationSchemes: s.classificationSchemes })));
  const task = useSyncExternalStore(workbenchRuntime.subscribe, workbenchRuntime.getSnapshot);
  const journalTasks = useSyncExternalStore(aiTaskJournal.subscribe, aiTaskJournal.snapshot);
  const [scope, setScope] = useState<OrganizationScope>('all');
  const [mode, setMode] = useState<OrganizationMode>('reorganize');
  const [analysisDepth, setAnalysisDepth] = useState<OrganizationAnalysisDepth>('quick');
  const [concurrency, setConcurrency] = useState<number | undefined>();
  const [reviewScheme, setReviewScheme] = useState<ClassificationSchemeId>('purpose');
  const [purpose, setPurpose] = useState<'repositories' | 'structure'>('repositories');
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
  const continuingCompleted = useRef(false);
  const refreshId = useRef(0);
  const loadedSession = useRef('');
  const contextRef = useRef({ ownerId, sessionId });
  useEffect(() => {
    const openAgentDraft = () => {
      const raw = sessionStorage.getItem('gsm:pending-agent-organization');
      if (!raw) return;
      try {
        const target = JSON.parse(raw) as { taskId: string; sessionId: string; ownerId: string };
        if (target.ownerId !== ownerId) return;
        setSessionId(target.sessionId); selectVersion(target.taskId);
      } catch { /* Ignore an invalid navigation target. */ }
    };
    openAgentDraft(); window.addEventListener('gsm:agent-organization-open', openAgentDraft);
    return () => window.removeEventListener('gsm:agent-organization-open', openAgentDraft);
  }, [ownerId]);
  contextRef.current = { ownerId, sessionId };
  useEffect(() => { setSessionId(input.sessionId ?? sessionStorage.getItem(`gsm:organization-session:${ownerId}`) ?? ''); selectVersion(''); setVersions([]); }, [input.sessionId, ownerId]);
  useEffect(() => { if (!configId && activeAIConfig) setConfigId(activeAIConfig); }, [activeAIConfig, configId]);
  const refresh = useCallback(async (proposalId?: string) => {
    const request = ++refreshId.current;
    if (!sessionId || !ownerId) { setVersions([]); return; }
    const incremental = !!proposalId && loadedSession.current === `${ownerId}:${sessionId}`;
    const changed = incremental ? await storage.getProposal(proposalId!) : null;
    const next = incremental ? changed?.ownerId === ownerId && changed.sessionId === sessionId && changed.organization ? [changed] : []
      : (await storage.listProposals(ownerId, sessionId)).filter(p => p.organization).sort((a, b) => b.organization!.revision - a.organization!.revision);
    const current = () => mounted.current && contextRef.current.ownerId === ownerId
      && contextRef.current.sessionId === sessionId && request === refreshId.current;
    if (!current()) return;
    const running = workbenchRuntime.getSnapshot();
    if (next[0] && !(running.running && running.sessionId === sessionId)) await reconcileOrganizationProposal(next[0]);
    if (current()) {
      loadedSession.current = `${ownerId}:${sessionId}`;
      setVersions(previous => {
        if (!incremental) return next;
        if (!changed || !next.length) return previous;
        return [...previous.filter(row => row.id !== changed.id), changed].sort((a, b) => b.organization!.revision - a.organization!.revision);
      });
    }
  }, [sessionId, ownerId]);
  useEffect(() => {
    mounted.current = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let target: string | undefined; let full = false;
    const update = (event?: Event) => {
      const detail = (event as CustomEvent<ChatHistoryChange> | undefined)?.detail;
      if (detail?.proposalId && (detail.ownerId !== ownerId || detail.sessionId !== sessionId)) return;
      if (!detail?.proposalId) full = true;
      else if (target && target !== detail.proposalId) full = true;
      else target = detail.proposalId;
      if (timer) return;
      timer = setTimeout(() => {
        const id = full ? undefined : target; timer = undefined; target = undefined; full = false;
        void refresh(id).catch(e => { if (mounted.current) setError(String(e)); });
      }, 150);
    };
    void refresh().catch(e => { if (mounted.current) setError(String(e)); });
    window.addEventListener('gsm:global-chat-history-changed', update);
    return () => { mounted.current = false; clearTimeout(timer); window.removeEventListener('gsm:global-chat-history-changed', update); };
  }, [refresh, ownerId, sessionId]);
  const proposal = versions.find(p => p.id === versionId) ?? versions[0] ?? null;
  const treePreview = useMemo(() => proposal?.organization?.dual && ['ready', 'interrupted', 'applied'].includes(proposal.organization.status)
    ? previewCategoryApplication(proposal, { ...useAppStore.getState(), ...treeState, repositories, user }) : null, [proposal, repositories, user, treeState]);
  useEffect(() => { if (proposal?.organization?.configId) setConfigId(proposal.organization.configId); }, [proposal?.id, proposal?.organization?.configId]);
  const readonly = Boolean(proposal && (proposal.id !== versions[0]?.id || proposal.organization?.status === 'imported'));
  const scopeInput = { repositories: input.filteredRepositories.map(repo => projectClassificationRepository(repo, activeScheme)), allRepositories: repositories.map(repo => projectClassificationRepository(repo, activeScheme)), selectedIds: input.selectedRepositoryIds, categoryId: input.categoryId, mode };
  const scopeIds = new Set(organizationScopeRepositories({ ...scopeInput, scope }).map(repo => repo.id));
  const scoped = repositories.filter(repo => scopeIds.has(repo.id));
  const scopeOptions = (['default', 'selected', 'filtered', 'current', 'pending', 'all'] as OrganizationScope[]).map(value => ({ value, label: t(`aiOrganization.scope.${value}`), count: organizationScopeRepositories({ ...scopeInput, scope: value }).length }));
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
  const ensureSession = async () => {
    let id = sessionId;
    if (!id) {
      if (!ownerId) throw new Error(t('aiOrganization.accountRequired'));
      id = crypto.randomUUID();
      const date = new Date().toISOString();
      await storage.saveSession({ id, ownerId, kind: 'workbench', title: t('aiOrganization.title'), repoId: 0, repoFullName: '', sourceRefSha: '', createdAt: date, updatedAt: date,
        workbench: { taskMode: 'organize', inputIntent: 'research', scope: 'library', depth: 'standard', selectedRepositories: [], searchBatches: [] } });
      setSessionId(id);
      sessionStorage.setItem(`gsm:organization-session:${ownerId}`, id);
    }
    return id;
  };
  const generate = (retryOnly = false, enrichRepositoryIds?: number[], batchIndex?: number, requestedDepth?: OrganizationAnalysisDepth, deferPending = false) => guard(async () => {
    let currentProposal = proposal;
    const deferUnderstandingIds = deferPending ? proposal?.organization?.dual?.understanding.filter(row => row.status === 'pending').map(row => row.repositoryId) : undefined;
    if (readonly) throw new Error(t('aiOrganization.busy'));
    if (deferPending) {
      if (!currentProposal?.organization?.dual || !deferUnderstandingIds?.length) return;
      const running = workbenchRuntime.getSnapshot();
      if (running.running && (running.ownerId !== ownerId || running.sessionId !== currentProposal.sessionId)) throw new Error(t('aiOrganization.busy'));
      if (running.running) { workbenchRuntime.stop(); await waitForWorkbenchStop(); }
      if (contextRef.current.ownerId !== ownerId || contextRef.current.sessionId !== sessionId || String(useAppStore.getState().user?.id ?? '') !== ownerId) throw new Error('Account or conversation changed');
      const latest = await storage.getProposal(currentProposal.id);
      if (!latest?.organization || latest.ownerId !== ownerId || latest.organization.revision !== currentProposal.organization.revision) throw new Error('Draft changed; review the latest version');
      currentProposal = latest;
    }
    if (workbenchRuntime.getSnapshot().running) throw new Error(t('aiOrganization.busy'));
    if (retryOnly && currentProposal && !await confirmOrganizationNewCalls(ownerId, currentProposal.id,
      batchIndex === undefined ? enrichRepositoryIds : currentProposal.organization?.batches[batchIndex]?.repositoryIds)) return;
    if (aiConfigs.find(config => config.id === configId)?.provider === 'agy-cli') await refreshAgyDeviceState();
    assertOrganizationModelReady(useAppStore.getState().aiConfigs.find(config => config.id === configId));
    const id = await ensureSession();
    selectVersion('');
    const selected = currentProposal ? repositories.filter(r => currentProposal.organization!.scope.repositoryIds.includes(r.id)) : scoped;
    const request = { sessionId: id, repositories: selected, scopeName: currentProposal?.organization?.scope.name ?? scope,
      configId, instruction: instruction.trim() || currentProposal?.organization?.instruction || t(purpose === 'repositories' ? 'dualOrganization.defaultInstruction' : 'aiOrganization.defaultInstruction'),
      previous: currentProposal ?? undefined, retryOnly, enrichRepositoryIds, deferUnderstandingIds, replaceManual, maxNewSubcategories, batchIndex, mode, rangeSource: scope,
      dual: !currentProposal || !!currentProposal.organization?.dual,
      analysisDepth: requestedDepth ?? currentProposal?.organization?.analysisDepth ?? (currentProposal ? 'deep' : analysisDepth),
      concurrency, preserveStructure: Boolean(enrichRepositoryIds?.length), };
    if ((currentProposal?.organization?.purpose ?? purpose) === 'structure') await runStructureGeneration({ ...request, schemeId: currentProposal ? currentProposal.organization?.singleSchemeId ?? 'purpose' : activeScheme });
    else await runOrganizationGeneration(request);
    if (mounted.current && contextRef.current.sessionId === id && String(useAppStore.getState().user?.id ?? '') === ownerId) {
      setInstruction('');
      const records = (await storage.listProposals(ownerId, id)).filter(p => p.organization).sort((a, b) => b.organization!.revision - a.organization!.revision);
      if (contextRef.current.sessionId === id && contextRef.current.ownerId === ownerId) setVersions(records);
    }
  });
  const newDraft = () => { sessionStorage.removeItem(`gsm:organization-session:${ownerId}`); setSessionId(''); setVersions([]); selectVersion(''); setInstruction(''); setError(''); setAnalysisDepth('quick'); setConcurrency(undefined); };
  const structureAction = (kind: 'apply' | 'restore', operationId: string) => guard(async () => {
    if (!proposal || readonly || task.running) return;
    await workbenchRuntime.run(proposal.sessionId, ownerId, async (signal, stage) => {
      stage(kind === 'apply' ? 'execution' : 'restore');
      if (kind === 'apply') await applyCategoryStructure(proposal.id, proposal.updatedAt, operationId, signal);
      else await restoreCategoryStructure(proposal.id, proposal.updatedAt, operationId, signal);
    });
  });
  const execute = (operation: 'apply' | 'restore' | 'sync', targetRepositoryIds?: number[]) => guard(async () => {
    if (!proposal || readonly) return;
    if (task.running) throw new Error(t('aiOrganization.busy'));
    {
      await workbenchRuntime.run(proposal.sessionId, ownerId, async (signal, stage) => {
        signal.throwIfAborted(); stage(operation === 'restore' ? 'restore' : 'execution');
        if (operation === 'apply') await applyOrganizationProposal(proposal.id, proposal.updatedAt, signal, targetRepositoryIds);
        else if (operation === 'restore') await restoreOrganizationProposal(proposal.id, proposal.updatedAt, signal);
        else await retryOrganizationSync(proposal.id);
      });
    }
  });
  return {
    continueCompleted: async () => {
      if (continuingCompleted.current) return;
      continuingCompleted.current = true;
      try { await generate(true, undefined, undefined, undefined, true); }
      finally { continuingCompleted.current = false; }
    },
    redesignMerge: (schemeId: ClassificationSchemeId, operationId: string) => guard(async () => {
      if (!proposal || readonly || task.running) return;
      if (aiConfigs.find(config => config.id === configId)?.provider === 'agy-cli') await refreshAgyDeviceState();
      await runMergeSubcategoryRedesign({ id: proposal.id, expected: proposal.updatedAt, schemeId, operationId, configId });
      selectVersion('');
    }),
    treeCategories: proposal?.organization?.dual?.schemes[reviewScheme].categories ?? organizationCategorySnapshot(reviewScheme),
    continueLegacy: () => guard(async () => {
      if (!proposal || readonly || task.running) return;
      const next = await continueLegacyCategoryProposal(proposal.id, proposal.updatedAt, configId);
      selectVersion(''); setPurpose('repositories'); setReviewScheme(proposal.organization?.singleSchemeId ?? 'purpose');
      setVersions(values => [next, ...values]);
    }),
    treePreview,
    editTree: async (schemeId: ClassificationSchemeId, edit: CategoryTreeEdit) => {
      let completed = false;
      await guard(async () => {
      if (readonly || task.running) return;
      const id = await ensureSession();
      const base = proposal?.organization?.dual && ['ready', 'interrupted'].includes(proposal.organization.status)
        ? proposal : await createManualOrganizationProposal(id, configId, proposal ?? undefined);
      const next = await editCategoryTree(base.id, base.updatedAt, schemeId, edit);
      if (mounted.current && String(useAppStore.getState().user?.id ?? '') === ownerId) {
        setPurpose('repositories'); setReviewScheme(schemeId); selectVersion(''); setVersions(values => [next, ...values.filter(value => value.id !== next.id)]);
        completed = true;
      }
      });
      return completed;
    },
    analysisDepth: proposal?.organization?.analysisDepth ?? (proposal ? 'deep' : analysisDepth), setAnalysisDepth,
    concurrency, setConcurrency,
    concurrencyLimit: aiConfigs.find(config => config.id === configId) ? agyFeatureConcurrency(aiConfigs.find(config => config.id === configId)!, 'organization') : 1,
    evidenceSummary: { detailed: scoped.filter(repo => readRepositoryDetails(repo.ai_details)).length,
      stale: scoped.filter(repo => { const detail = readRepositoryDetails(repo.ai_details); return detail && (!repo.pushed_at || detail.repository_pushed_at !== repo.pushed_at); }).length,
      pending: scoped.filter(repo => !readRepositoryDetails(repo.ai_details)).length },
    structureSchemeId: proposal ? proposal.organization?.singleSchemeId ?? 'purpose' : activeScheme,
    reviewScheme, setReviewScheme,
    setSchemeSelected: (schemeId: ClassificationSchemeId, schemeSelected: boolean) => guard(async () => {
      if (proposal && !readonly && !task.running) await editOrganizationProposal(proposal.id, proposal.updatedAt, { schemeId, schemeSelected });
    }),
    setRetireCategories: (retireCategoryIds: string[]) => guard(async () => {
      if (proposal && !readonly && !task.running) await editOrganizationProposal(proposal.id, proposal.updatedAt, { schemeId: reviewScheme, retireCategoryIds });
    }),
    setCleanupReplaced: (cleanupReplaced: boolean) => guard(async () => {
      if (proposal && !readonly && !task.running) await editOrganizationProposal(proposal.id, proposal.updatedAt, { schemeId: reviewScheme, cleanupReplaced });
    }),
    scope, setScope, scopeOptions, repositories, configId, setConfigId, aiConfigs, instruction, setInstruction,
    purpose: proposal?.organization?.purpose ?? purpose,
    setPurpose: (value: 'repositories' | 'structure') => { if (task.running || saving) return; if (proposal) newDraft(); setPurpose(value); },
    mode: proposal?.organization?.mode ?? mode, setMode,
    rangeSummary: { total: scoped.length, assigned: scoped.filter(r => r.category_id != null).length, locked: scoped.filter(r => ['purpose', 'technology'].some(id => classificationMembership(r, id as ClassificationSchemeId).locked)).length, fullLibrary: scope === 'all' },
    maxNewSubcategories, setMaxNewSubcategories, replaceManual, setReplaceManual, proposal, versions, selectVersion,
    saving, busy: task.running || saving, task, error, readonly, count: scoped.length, scopedRepositories: scoped,
    recoverableResults: journalTasks.some(row => row.owner === ownerId && row.kind === 'organization' && row.items.some(item => item.recovery)
      && (row.target?.id === sessionId || row.items.some(item => item.label.includes(proposal?.id ?? 'no-proposal')))),
    retrySave: () => guard(async () => {
      if (task.running || readonly || !proposal) return;
      const records = await (await import('../services/agyClient')).listAgyRecovery(ownerId);
      const taskIds = new Set(records.filter(record => record.recoverable && record.step?.startsWith(`organization:${proposal.id}:`)).map(record => record.taskId));
      for (const row of aiTaskJournal.snapshot().filter(row => row.owner === ownerId && row.kind === 'organization' && (taskIds.has(row.id) || row.target?.id === sessionId) && row.items.some(item => item.recovery))) await retryOrganizationTaskSave(row);
    }),
    generate: () => generate(), retry: () => generate(true), enrich: (ids: number[]) => generate(true, ids, undefined, 'deep'),
    deepenAll: () => generate(false, undefined, undefined, 'deep'),
    refine: () => guard(async () => {
      if (!proposal || readonly || task.running || !instruction.trim()) return;
      if (aiConfigs.find(config => config.id === configId)?.provider === 'agy-cli') await refreshAgyDeviceState();
      await runOrganizationRefinement({ proposal, schemeId: reviewScheme, instruction: instruction.trim(), configId });
      if (contextRef.current.ownerId === ownerId && contextRef.current.sessionId === sessionId) { setInstruction(''); selectVersion(''); }
    }),
    retryBatch: (batchIndex: number) => generate(true, undefined, batchIndex),
    editEntry: (repositoryId: number, patch: Partial<Pick<OrganizationEntry, 'categoryId' | 'subcategoryId' | 'selected' | 'overrideLocked'>>) => guard(async () => {
      if (proposal && !readonly && !task.running) await editOrganizationProposal(proposal.id, proposal.updatedAt, { schemeId: reviewScheme, repositoryId, patch });
    }),
    selectEntries: (repositoryIds: number[], selected: boolean) => guard(async () => {
      if (proposal && !readonly && !task.running) await editOrganizationProposal(proposal.id, proposal.updatedAt, { schemeId: reviewScheme, selection: { repositoryIds, selected } });
    }),
    renameCategory: (categoryId: string, name: string) => guard(async () => {
      if (proposal && !readonly && !task.running) await editOrganizationProposal(proposal.id, proposal.updatedAt, { schemeId: reviewScheme, categoryId, name });
    }),
    bulkEdit: (repositoryIds: number[], categoryId: string | null, subcategoryId: string | null, action?: 'keep' | 'subdivide' | 'reconsider') => guard(async () => {
      if (proposal && !readonly && !task.running) await editOrganizationProposal(proposal.id, proposal.updatedAt, { schemeId: reviewScheme, bulk: { repositoryIds, categoryId, subcategoryId, action } });
    }),
    addStructure: (suggestion: StructureSuggestion) => guard(async () => {
      if (task.running || readonly) return;
      const id = await ensureSession();
      const next = await proposeCategoryStructure({ sessionId: id, suggestions: [suggestion], configId: configId || 'manual', instruction,
        schemeId: proposal ? proposal.organization?.singleSchemeId ?? 'purpose' : activeScheme,
        previous: proposal ?? undefined, preservePrevious: true, maxNewSubcategories });
      if (mounted.current && String(useAppStore.getState().user?.id ?? '') === ownerId
        && (contextRef.current.sessionId === id || contextRef.current.sessionId === sessionId)) { selectVersion(''); setVersions(previous => [next, ...previous]); }
    }),
    editStructure: (operationId: string, patch: Parameters<typeof editCategoryStructure>[3]) => guard(async () => {
      if (proposal && !readonly && !task.running) await editCategoryStructure(proposal.id, proposal.updatedAt, operationId, patch);
    }),
    applyStructure: (id: string) => structureAction('apply', id), restoreStructure: (id: string) => structureAction('restore', id),
    migrateSelected: () => guard(async () => {
      if (!proposal || readonly || task.running) return;
      await workbenchRuntime.run(proposal.sessionId, ownerId, async (signal, stage) => {
        stage('execution'); await migrateStructureSelection(proposal.id, proposal.updatedAt, signal);
      });
    }),
    acceptOriginalGroup: (repositoryId: number) => guard(async () => {
      if (proposal && !readonly && !task.running) await acceptOriginalStructureGroup(proposal.id, proposal.updatedAt, repositoryId);
    }),
    apply: (targetRepositoryIds?: number[]) => execute('apply', targetRepositoryIds),
    restore: () => execute('restore'), retrySync: () => execute('sync'), stop: workbenchRuntime.stop,
    newDraft,
    continueInWorkbench: () => {
      if (!sessionId) return;
      sessionStorage.setItem('gsm:ai-workbench-session', sessionId);
      window.dispatchEvent(new CustomEvent('gsm:select-workbench-session', { detail: sessionId }));
      useAppStore.getState().setCurrentView('ai');
    },
  };
}
