import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAppStore } from '../../../store/useAppStore';
import { loadReadingCandidatePresentation } from '../../../services/readingCandidatePresentation';
import { useT } from '../../../i18n/useT';
import { analysisFields } from '../../../lib/html-reading/model';
import { candidateTransaction, candidateFingerprint, readCandidateWorkspace, updateStarBatch, type CandidateWorkspace } from '../../../lib/html-reading/candidates';
import { applyRepositoryAnalysisAsset, useRepositoryAnalysisAssets } from '../../../services/repositoryAnalysisAssets';
import { createGitHubApiService } from '../../../services/githubApiFactory';
import { forceSyncToBackend } from '../../../services/autoSync';
import { flushAppStorePersistence } from '../../../store/persistence/storage';
import { checkpointDesktopHomeRepository } from '../../../home/desktop';
import { executeReadingStarBatch, isReadingStarBatchRunning, stopReadingStarBatch } from '../../../services/readingStarBatch';
import type { Repository } from '../../../types';

export function useReadingCandidates(account: string, changed: () => Promise<void>) {
  const t = useT('settings');
  const [workspace, setWorkspace] = useState<CandidateWorkspace | null>(null);
  const [presentation, setPresentation] = useState<Record<string, Repository>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const alive = useRef(true), current = useRef(account), action = useRef(false), refreshSequence = useRef(0);
  current.current = account;
  const repositories = useAppStore(s => s.repositories);
  const discovery = useAppStore(s => s.discoveryRepos);
  const language = useAppStore(s => s.language);
  const user = useAppStore(s => s.user);
  const token = useAppStore(s => s.githubToken);
  const assets = useRepositoryAnalysisAssets(s => s.assets);
  const refresh = useCallback(async () => {
    if (!account) return;
    const sequence = ++refreshSequence.current;
    const result = await readCandidateWorkspace(account);
    if (alive.current && current.current === account && sequence === refreshSequence.current) {
      setWorkspace(result); setBusy(action.current || isReadingStarBatchRunning(account));
    }
  }, [account]);
  useEffect(() => {
    alive.current = true; setWorkspace(null); setPresentation({}); setError('');
    void refresh().catch(cause => { if (alive.current && current.current === account) setError(String(cause)); });
    const timer = window.setInterval(() => { if (isReadingStarBatchRunning(account)) void refresh().catch(() => {}); }, 1000);
    return () => { alive.current = false; window.clearInterval(timer); stopReadingStarBatch(account); };
  }, [account, refresh]);
  useEffect(() => { stopReadingStarBatch(account); }, [account, token]);
  useEffect(() => {
    if (!account) return;
    let valid = true;
    void loadReadingCandidatePresentation(account, repositories ?? [], Object.values(discovery ?? {}).flat(), language).then(projected => {
      if (!valid || current.current !== account) return;
      setPresentation(projected);
    }).catch(cause => { if (valid) setError(cause instanceof Error ? cause.message : '读取项目资料失败'); });
    return () => { valid = false; };
  }, [account, repositories, discovery, language]);
  const items = useMemo(() => Object.entries(workspace?.states ?? {}).filter(([, state]) => state.candidate).map(([id, state]) => {
    const base = presentation[id];
    // Re-project on asset deletion so expanded details never resurrect old AI text.
    const repo = base ? applyRepositoryAnalysisAsset(account, base, language) : undefined;
    const analysis = Object.keys(analysisFields).flatMap(key => {
      const value = repo?.ai_details?.[key as keyof typeof analysisFields];
      const text = typeof value === 'string' ? value : Array.isArray(value) ? value.map(part => typeof part === 'string' ? `• ${part}` : [part.description, part.command].filter(Boolean).join('\n')).join('\n') : '';
      return text.trim() ? [{ title: t(`htmlReadingLabels.detail.${key}`), text }] : [];
    });
    return { id, name: workspace!.names[id] ?? id, summary: repo?.ai_summary?.trim() || repo?.ai_details?.summary?.trim() || repo?.description?.trim() || '', analysis, source: workspace!.candidateSources[id], state, candidateFingerprint: candidateFingerprint(workspace!,Number(id)) };
  }).sort((a, b) => a.name.localeCompare(b.name)),
  // applyRepositoryAnalysisAsset reads its private account cache. The published
  // asset subscription invalidates this projection on replacement or deletion.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [workspace, presentation, account, language, assets, t]);
  const perform = async (work: () => Promise<void>) => {
    if (action.current || isReadingStarBatchRunning(account)) return;
    action.current = true; setBusy(true); setError('');
    try { await work(); }
    catch (cause) { if (alive.current && current.current === account) setError(cause instanceof Error ? cause.message : '候选处理失败'); throw cause; }
    finally {
      action.current = false;
      // The old account's action can settle after the new account has mounted.
      // Release UI busy independently, without publishing old workspace data.
      if (alive.current) setBusy(isReadingStarBatchRunning(current.current));
      if (alive.current && current.current === account) { await refresh().catch(() => {}); await changed().catch(cause => setError(cause instanceof Error ? cause.message : '阅读记录更新失败')); }
    }
  };
  const execute = (request: { ids: string[]; expectedFingerprints?: Record<string,string> } | { batchId: string }) => perform(async () => {
    const initial = useAppStore.getState(), credential = initial.githubToken;
    const isCurrent = () => {
      const latest = useAppStore.getState();
      return latest.isAuthenticated && String(latest.user?.id) === account && latest.githubToken === credential && current.current === account;
    };
    if (!credential || !isCurrent()) throw new Error('请先连接当前 GitHub 账户。');
    const api = createGitHubApiService(credential);
    // A changed token can belong to a different account even when the cached
    // desktop identity is unchanged. Verify the token owner before any batch.
    const githubUser = await api.getCurrentUser();
    if (!isCurrent() || String(githubUser.id) !== account) throw new Error('GitHub 凭据所属账户与当前工作区不一致，请重新登录后确认。');
    await executeReadingStarBatch(account, request, {
      api: { getRepository: (...args) => api.getRepository(...args), isRepositoryStarred: (...args) => api.isRepositoryStarred(...args), starRepository: (owner, name, signal) => api.starRepository(owner, name, signal, { autoRetry: false }) },
      isCurrent,
      addRepository: async repo => {
        if (!isCurrent()) throw new Error('账户已变化');
        const state = useAppStore.getState();
        if (!state.repositories.some(existing => existing.id === repo.id)) {
          const projected = applyRepositoryAnalysisAsset(account, presentation[String(repo.id)] ?? repo, state.language);
          state.addRepository({ ...repo, ...(projected.ai_summary ? { ai_summary: projected.ai_summary } : {}), ...(projected.ai_details ? { ai_details: projected.ai_details } : {}), ...(projected.ai_tags ? { ai_tags: projected.ai_tags } : {}), starred_at: new Date().toISOString() });
        }
        // Even an existing in-memory row may be from an earlier failed write.
        await flushAppStorePersistence();
        if (!isCurrent()) throw new Error('账户已变化');
        await checkpointDesktopHomeRepository(account,repo.id);
      },
      sync: () => forceSyncToBackend({ reportFailures: true }), changed: () => { if (alive.current) void refresh().catch(() => {}); },
    });
  });
  const dismiss = (ids: string[], expectedFingerprints?: Record<string,string>) => perform(async () => {
    await candidateTransaction(account, data => {
      if (current.current !== account || String(useAppStore.getState().user?.id) !== account) throw new Error('账户已变化');
      if (expectedFingerprints && ids.some(id => !data.states[id]?.candidate || expectedFingerprints[id] !== candidateFingerprint(data,Number(id)))) throw new Error('候选已变化，请刷新清单后重新确认。');
      for (const id of new Set(ids)) if (data.states[id]) data.states[id].candidate = false;
    });
  });
  const retrySync = (batchId: string) => perform(async () => {
    if (current.current !== account || String(useAppStore.getState().user?.id) !== account) throw new Error('账户已变化');
    await forceSyncToBackend({ reportFailures: true });
    await updateStarBatch(account, batchId, batch => { batch.syncError = undefined; });
  });
  return { items, batches: Object.values(workspace?.starBatches ?? {}).sort((a, b) => b.createdAt.localeCompare(a.createdAt)), busy, error, accountLabel: user?.login ? `${user.login} (${account})` : account,
    start: (ids: string[], expectedFingerprints?: Record<string,string>) => execute({ ids, expectedFingerprints }), resume: (batchId: string) => execute({ batchId }), stop: () => stopReadingStarBatch(account), dismiss, refresh, retrySync };
}
