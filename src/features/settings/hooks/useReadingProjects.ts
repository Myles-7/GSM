import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAppStore } from '../../../store/useAppStore';
import { loadReadingCandidatePresentation } from '../../../services/readingCandidatePresentation';
import { useT } from '../../../i18n/useT';
import { analysisFields } from '../../../lib/html-reading/model';
import { candidateTransaction, updateStarBatch, type CandidateWorkspace } from '../../../lib/html-reading/candidates';
import { readingProjectFingerprint, readReadingWorkspace, updateReadingProjects, type ReadingProjectPatch, type ReadingProjectSource, type ReadingProcessedReason } from '../../../lib/html-reading/workspace';
import type { ReadingState } from '../../../lib/html-reading/model';
import type { ReadingStarRequest } from '../../../services/readingStarBatch';
import { applyRepositoryAnalysisAsset, useRepositoryAnalysisAssets } from '../../../services/repositoryAnalysisAssets';
import { createGitHubApiService } from '../../../services/githubApiFactory';
import { forceSyncToBackend } from '../../../services/autoSync';
import { flushAppStorePersistence } from '../../../store/persistence/storage';
import { checkpointDesktopHomeRepository } from '../../../home/desktop';
import { executeReadingStarBatch, isReadingStarBatchRunning, stopReadingStarBatch } from '../../../services/readingStarBatch';
import type { Repository } from '../../../types';

export interface ReadingProjectItem {
  id: string; name: string; summary: string; analysis: Array<{ key?: keyof typeof analysisFields; title: string; text: string }>;
  state: ReadingState; source?: ReadingProjectSource; processed: boolean; processedReason?: ReadingProcessedReason; processedAt?: string;
  starState: 'starred' | 'unstarred' | 'unknown'; starCheckedAt?: string; fingerprint: string;
}
const safeMessage = (cause: unknown) => (cause instanceof Error ? cause.message : '项目处理失败')
  .replace(/(?:github_pat_|gh[pousr]_)[A-Za-z0-9_]+|Bearer\s+[^\s,;]+/gi, '[凭据已隐藏]').slice(0, 1000);
export function useReadingProjects(account: string, changed: () => Promise<void>) {
  const t = useT('settings');
  const [workspace, setWorkspace] = useState<CandidateWorkspace | null>(null);
  const [presentation, setPresentation] = useState<Record<string, Repository>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const statusController = useRef<AbortController | null>(null);
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
    try {
      const result = await readReadingWorkspace(account);
      if (alive.current && current.current === account && sequence === refreshSequence.current) {
        setWorkspace(result); setBusy(action.current || isReadingStarBatchRunning(account));
      }
    } catch (cause) {
      if (alive.current && current.current === account && sequence === refreshSequence.current) setError(safeMessage(cause));
      throw cause;
    }
  }, [account]);
  useEffect(() => {
    alive.current = true; setWorkspace(null); setPresentation({}); setError(''); setMessage('');
    void refresh().catch(cause => { if (alive.current && current.current === account) setError(String(cause)); });
    const timer = window.setInterval(() => { if (isReadingStarBatchRunning(account)) void refresh().catch(() => {}); }, 1000);
    return () => { alive.current = false; window.clearInterval(timer); stopReadingStarBatch(account); statusController.current?.abort(); };
  }, [account, refresh]);
  useEffect(() => { stopReadingStarBatch(account); statusController.current?.abort(); }, [account, token]);
  useEffect(() => {
    if (!account) return;
    let valid = true;
    void loadReadingCandidatePresentation(account, repositories ?? [], Object.values(discovery ?? {}).flat(), language).then(projected => {
      if (!valid || current.current !== account) return;
      setPresentation(projected);
    }).catch(cause => { if (valid) setError(cause instanceof Error ? cause.message : '读取项目资料失败'); });
    return () => { valid = false; };
  }, [account, repositories, discovery, language]);
  const knownStars = useMemo(() => new Set((repositories ?? []).map(repo => String(repo.id))), [repositories]);
  const items = useMemo(() => Object.entries(workspace?.states ?? {}).map(([id, state]) => {
    const base = presentation[id];
    // Re-project on asset deletion so expanded details never resurrect old AI text.
    const repo = base ? applyRepositoryAnalysisAsset(account, base, language) : undefined;
    const analysis = Object.keys(analysisFields).flatMap(key => {
      const value = repo?.ai_details?.[key as keyof typeof analysisFields];
      const text = typeof value === 'string' ? value : Array.isArray(value) ? value.map((part, index) => {
        if (typeof part === 'string') return `- ${part}`;
        const command = part.command?.trim();
        const fence = '`'.repeat(Math.max(3, ...Array.from(command?.matchAll(/`+/g) ?? [], match => match[0].length + 1)));
        return `${index + 1}. ${part.description || ''}${command ? `\n\n${fence}sh\n${command}\n${fence}` : ''}`;
      }).join('\n\n') : '';
      return text.trim() ? [{ key: key as keyof typeof analysisFields, title: t(`htmlReadingLabels.detail.${key}`), text }] : [];
    });
    const observation = workspace!.starObservations?.[id];
    const known = observation?.starred ?? (knownStars.has(id) ? true : null);
    return { id, name: workspace!.names[id] ?? id, summary: repo?.ai_summary?.trim() || repo?.ai_details?.summary?.trim() || repo?.description?.trim() || '', analysis, source: workspace!.projectSources?.[id] ?? workspace!.candidateSources[id], state, processed: workspace!.processing?.[id]?.processed ?? false, processedReason: workspace!.processing?.[id]?.reason, processedAt: workspace!.processing?.[id]?.updatedAt, starState: known === null ? 'unknown' as const : known ? 'starred' as const : 'unstarred' as const, starCheckedAt: observation?.checkedAt, fingerprint: readingProjectFingerprint(workspace!,id) };
  }).sort((a, b) => a.name.localeCompare(b.name)),
  // applyRepositoryAnalysisAsset reads its private account cache. The published
  // asset subscription invalidates this projection on replacement or deletion.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [workspace, presentation, knownStars, account, language, assets, t]);
  const perform = async (work: () => Promise<void>) => {
    if (action.current || isReadingStarBatchRunning(account)) throw new Error('已有项目操作正在进行，请等待完成。');
    action.current = true; setBusy(true); setError(''); setMessage('');
    try { await work(); }
    catch (cause) { if (alive.current && current.current === account) setError(safeMessage(cause)); throw cause; }
    finally {
      action.current = false;
      // The old account's action can settle after the new account has mounted.
      // Release UI busy independently, without publishing old workspace data.
      if (alive.current) setBusy(isReadingStarBatchRunning(current.current));
      if (alive.current && current.current === account) { await refresh().catch(() => {}); await changed().catch(cause => setError(cause instanceof Error ? cause.message : '阅读记录更新失败')); }
    }
  };
  const execute = (request: ReadingStarRequest) => perform(async () => {
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
  const bulk = (ids: string[], patch: ReadingProjectPatch, expected: Record<string, string>) => perform(async () => {
    const credential = useAppStore.getState().githubToken;
    const controller = new AbortController(); statusController.current = controller;
    const validate = () => {
      const latest = useAppStore.getState();
      if (controller.signal.aborted || current.current !== account || String(latest.user?.id) !== account || latest.githubToken !== credential) throw new Error('账户或凭据已变化，请重新确认。');
    };
    try {
      await updateReadingProjects(account, ids, patch, expected, { validate, signal: controller.signal });
      validate();
      if (alive.current && current.current === account) setMessage(`已更新 ${new Set(ids).size} 个项目。`);
    } finally { if (statusController.current === controller) statusController.current = null; }
  });
  const refreshStars = (ids: string[]) => perform(async () => {
    const credential = useAppStore.getState().githubToken;
    const controller = new AbortController(); statusController.current = controller;
    const validate = () => {
      const latest = useAppStore.getState();
      if (controller.signal.aborted || !latest.isAuthenticated || current.current !== account || String(latest.user?.id) !== account || latest.githubToken !== credential) throw new Error('账户或凭据已变化，刷新已停止。');
    };
    if (!credential) throw new Error('请先连接当前 GitHub 账户。');
    validate();
    const api = createGitHubApiService(credential);
    const githubUser = await api.getCurrentUser(); validate();
    if (String(githubUser.id) !== account) throw new Error('GitHub 凭据所属账户与当前工作区不一致，请重新登录后确认。');
    const source = await readReadingWorkspace(account, { validate, signal: controller.signal });
    const failures: string[] = []; let updated = 0, checked = 0;
    const selected = [...new Set(ids)];
    try {
      for (const id of selected) {
        validate();
        try {
          const name = source.names[id]; const repoId = Number(id);
          if (!Number.isSafeInteger(repoId) || repoId <= 0 || !source.states[id] || !/^[\w.-]+\/[\w.-]+$/.test(name ?? '')) throw new Error('项目名称或标识无效。');
          const [owner, repoName] = name.split('/');
          const repo = await api.getRepository(owner, repoName, controller.signal); validate();
          if (repo.id !== repoId || !/^[\w.-]+\/[\w.-]+$/.test(repo.full_name)) throw new Error('项目标识已变化，请核对来源。');
          const [canonicalOwner, canonicalName] = repo.full_name.split('/');
          const starred = await api.isRepositoryStarred(canonicalOwner, canonicalName, controller.signal); validate();
          await candidateTransaction(account, data => {
            validate();
            if (data.names[id] !== name) throw new Error('项目名称已变化，请重新刷新。');
            data.starObservations![id] = { starred, checkedAt: new Date().toISOString() };
          }, { validate, signal: controller.signal });
          updated++;
        } catch (cause) {
          validate();
          const reason = `${source.names[id] ?? id}: ${safeMessage(cause)}`;
          const status = (cause as { status?: number; retryAfterMs?: number; name?: string })?.status;
          if ([401, 403, 429].includes(status ?? 0) || (cause as { retryAfterMs?: number })?.retryAfterMs != null || /token|credentials|unauthorized|permission|rate.limit|GitHub API error: (401|403|429)/i.test(safeMessage(cause))) throw new Error(reason);
          failures.push(reason);
        }
        checked++; setMessage(`已检查 ${checked} / ${selected.length} 个项目，成功核实 ${updated} 个。`);
      }
      setMessage(`已核实 ${updated} 个项目的收藏状态。`);
      if (failures.length) throw new Error(failures.join('\n'));
    } finally { if (statusController.current === controller) statusController.current = null; }
  });
  const retrySync = (batchId: string) => perform(async () => {
    const credential = useAppStore.getState().githubToken;
    const validate = () => { const latest = useAppStore.getState(); if (current.current !== account || String(latest.user?.id) !== account || latest.githubToken !== credential) throw new Error('账户或凭据已变化'); };
    validate();
    await forceSyncToBackend({ reportFailures: true });
    await updateStarBatch(account, batchId, batch => { batch.syncError = undefined; }, { validate });
  });
  return { accountId: account, items: items as ReadingProjectItem[], lastImportId: workspace?.latestImport?.id, lastImportIds: workspace?.latestImport?.ids ?? [], message, batches: Object.values(workspace?.starBatches ?? {}).sort((a, b) => b.createdAt.localeCompare(a.createdAt)), busy, error, accountLabel: user?.login ? `${user.login} (${account})` : account,
    start: (ids: string[], expectedFingerprints: Record<string,string>) => execute({ ids, selectionMode: 'projects', expectedFingerprints }), resume: (batchId: string) => execute({ batchId }), stop: () => { stopReadingStarBatch(account); statusController.current?.abort(); }, bulk, refresh, refreshStars, retrySync };
}
