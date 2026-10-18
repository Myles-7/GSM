import type { Repository } from '../types';
import { readingProjectFingerprint, completeReadingProjectIfUnchanged } from '../lib/html-reading/workspace';
import { candidateTransaction, candidateFingerprint, clearCandidateIfUnchanged, type ReadingStarBatch, type ReadingStarBatchRow } from '../lib/html-reading/candidates';

export interface ReadingStarDependencies {
  api: {
    getRepository(owner: string, repo: string, signal?: AbortSignal): Promise<Repository>;
    isRepositoryStarred(owner: string, repo: string, signal?: AbortSignal): Promise<boolean>;
    starRepository(owner: string, repo: string, signal?: AbortSignal): Promise<void>;
  };
  isCurrent(): boolean;
  addRepository(repo: Repository): Promise<void>;
  sync(): Promise<void>;
  changed?(): void;
  now?(): number;
  wait?(ms: number, signal: AbortSignal): Promise<void>;
}
export type ReadingStarRequest = { ids: string[]; selectionMode?: 'candidates'; expectedFingerprints?: Record<string, string> } | { ids: string[]; selectionMode: 'projects'; expectedFingerprints: Record<string, string> } | { batchId: string };
const running = new Map<string, AbortController>();
const finished = (row: ReadingStarBatchRow) => ['starred', 'already-starred', 'skipped'].includes(row.status);
export const isReadingStarBatchRunning = (account: string) => running.has(account);
export const stopReadingStarBatch = (account: string) => running.get(account)?.abort();
const message = (error: unknown) => (error instanceof Error ? error.message : 'GitHub 请求失败')
  .replace(/(?:github_pat_|gh[pousr]_)[A-Za-z0-9_]+|Bearer\s+[^\s,;]+/gi, '[凭据已隐藏]').slice(0, 1000);
function failure(error: unknown) {
  const value = error as { status?: number; retryAfterMs?: number; name?: string };
  const text = message(error);
  const status = value?.status ?? Number(/GitHub API error: (\d+)/.exec(text)?.[1]);
  const pause = [401, 403, 429].includes(status) || value?.retryAfterMs != null
    || value?.name === 'GitHubTokenPermissionError' || /unauthorized|credentials|sign.in|token.*expired/i.test(text);
  return { pause, retryAfterMs: value?.retryAfterMs, uncertain: !status || status >= 500 };
}
function wait(ms: number, signal: AbortSignal) {
  if (signal.aborted) return Promise.reject(new DOMException('Stopped', 'AbortError'));
  return new Promise<void>((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(new DOMException('Stopped', 'AbortError')); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, ms);
    signal.addEventListener('abort', abort, { once: true });
  });
}

/** No call site may invoke this without an explicit review/confirmation first. */
export async function executeReadingStarBatch(account: string, request: ReadingStarRequest, deps: ReadingStarDependencies) {
  if (running.has(account)) throw new Error('本账户已有 Star 批次正在执行。');
  const controller = new AbortController();
  running.set(account, controller);
  try {
    // Chromium Web Locks also prevent another renderer/window from executing
    // the same account concurrently. The in-process guard covers fallback hosts.
    if (typeof navigator !== 'undefined' && navigator.locks?.request) {
      return await navigator.locks.request(`gsm-reading-stars:${account}`, { ifAvailable: true }, async lock => {
        if (!lock) throw new Error('其他窗口正在处理本账户的 Star 批次。');
        return execute(account, request, deps, controller);
      });
    }
    return await execute(account, request, deps, controller);
  } finally { running.delete(account); deps.changed?.(); }
}

async function execute(account: string, request: ReadingStarRequest, deps: ReadingStarDependencies, controller: AbortController) {
  const now = deps.now ?? Date.now;
  const stamp = () => new Date(now()).toISOString();
  const assertAccount = () => { if (!deps.isCurrent()) throw new Error('账户或凭据已变化，批次已暂停。'); };
  const assertActive = () => { assertAccount(); if (controller.signal.aborted) throw new DOMException('Stopped', 'AbortError'); };
  assertActive();
  let lastWrite = Number.NEGATIVE_INFINITY;
  const batch = await candidateTransaction(account, data => {
    assertActive();
    for (const previous of Object.values(data.starBatches)) for (const row of previous.rows) {
      const at = row.lastAttemptAt ?? row.starredAt ?? (['sending', 'uncertain', 'local-pending'].includes(row.status) ? row.updatedAt : undefined);
      if (at && Number.isFinite(Date.parse(at))) lastWrite = Math.max(lastWrite, Date.parse(at));
    }
    // Holding the execution lock proves a persisted running batch is no longer
    // executing here. Retain it for explicit recovery while activating only one.
    for (const previous of Object.values(data.starBatches)) {
      if (previous.status === 'running' && (!('batchId' in request) || previous.id !== request.batchId)) {
        previous.status = 'paused'; previous.pauseReason = '上次执行已中断，请确认剩余项目后继续。'; previous.updatedAt = stamp();
      }
    }
    if ('batchId' in request) {
      const saved = data.starBatches[request.batchId];
      if (!saved || saved.accountId !== account) throw new Error('找不到本账户的 Star 批次。');
      if (saved.retryAt && Date.parse(saved.retryAt) > now()) throw new Error('GitHub 限流等待尚未结束，请稍后继续。');
      if (!saved.rows.some(row => !finished(row))) throw new Error('该批次已完成。');
      saved.status = 'running'; saved.pauseReason = undefined; saved.retryAt = undefined; saved.updatedAt = stamp();
      return structuredClone(saved);
    }
    const direct = request.selectionMode === 'projects';
    if (direct && !request.expectedFingerprints) throw new Error('请刷新项目清单后重新确认。');
    const ids = [...new Set(request.ids)];
    if (!ids.length) throw new Error('请先选择候选。');
    const rows = ids.map(id => {
      const repoId = Number(id);
      if (!Number.isSafeInteger(repoId) || repoId <= 0) throw new Error('项目标识无效。');
      if (!(direct ? data.states[repoId] : data.states[repoId]?.candidate) || !data.names[repoId]) throw new Error('候选已变化，请刷新清单后重新确认。');
      if (request.expectedFingerprints && request.expectedFingerprints[id] !== (direct ? readingProjectFingerprint(data, repoId) : candidateFingerprint(data, repoId))) throw new Error('候选已变化，请刷新清单后重新确认。');
      return { repoId, name: data.names[repoId], sourceFingerprint: direct ? readingProjectFingerprint(data, repoId) : candidateFingerprint(data, repoId), projectFingerprint: readingProjectFingerprint(data, repoId), status: 'queued' as const };
    });
    const created: ReadingStarBatch = { id: crypto.randomUUID(), accountId: account, createdAt: stamp(), updatedAt: stamp(), status: 'running', selectionMode: direct ? 'projects' : 'candidates', rows };
    data.starBatches[created.id] = created;
    return structuredClone(created);
  });
  deps.changed?.();
  const update = async (change: (saved: ReadingStarBatch) => void) => {
    await candidateTransaction(account, data => { const saved = data.starBatches[batch.id]; if (!saved) throw new Error('批次记录已丢失。'); change(saved); saved.updatedAt = stamp(); });
    deps.changed?.();
  };
  const mark = (id: number, status: ReadingStarBatchRow['status'], error?: string) => update(saved => {
    const row = saved.rows.find(row => row.repoId === id)!;
    Object.assign(row, { status, error, updatedAt: stamp() });
  });
  let localChanges = false;
  try {
    for (const row of batch.rows) {
      if (finished(row)) continue;
      assertActive();
      let submitted = false, githubAccepted = false;
      const needsReconciliation = row.reconcileRequired || ['sending', 'uncertain', 'local-pending'].includes(row.status);
      try {
        const valid = await candidateTransaction(account, data => {
          assertActive();
          return batch.selectionMode === 'projects' ? readingProjectFingerprint(data, row.repoId) === row.sourceFingerprint : data.states[row.repoId]?.candidate && candidateFingerprint(data, row.repoId) === row.sourceFingerprint;
        });
        // A removed/reimported candidate is outside this batch's confirmation.
        if (!valid && !needsReconciliation) { await mark(row.repoId, 'skipped', '候选已变化，请在新清单中重新确认。'); continue; }
        await update(saved => { const item = saved.rows.find(item => item.repoId === row.repoId)!; item.status = 'checking'; item.reconcileRequired = !!needsReconciliation; item.updatedAt = stamp(); });
        if (!/^[\w.-]+\/[\w.-]+$/.test(row.name)) throw new Error('项目名称无效，请核对来源。');
        const [owner, name] = row.name.split('/');
        const repo = await deps.api.getRepository(owner, name, controller.signal);
        assertActive();
        if (!Number.isSafeInteger(repo.id) || repo.id !== row.repoId || !/^[\w.-]+\/[\w.-]+$/.test(repo.full_name)) throw new Error('项目标识已变化，请先在 GitHub 核对来源。');
        const [canonicalOwner, canonicalName] = repo.full_name.split('/');
        const alreadyStarred = await deps.api.isRepositoryStarred(canonicalOwner, canonicalName, controller.signal);
        assertActive();
        await candidateTransaction(account, data => { assertActive(); data.starObservations![row.repoId] = { starred: alreadyStarred, checkedAt: stamp() }; });
        if (!alreadyStarred) {
          if (!valid) { await mark(row.repoId, 'skipped', '候选已变化，未执行新的 Star。'); continue; }
          const delay = Math.max(0, lastWrite + 1000 - now());
          if (delay) await (deps.wait ?? wait)(delay, controller.signal);
          assertActive();
          // Recheck immediately before external write, after all async reads.
          const unchanged = await candidateTransaction(account, data => { assertActive(); return batch.selectionMode === 'projects' ? readingProjectFingerprint(data, row.repoId) === row.sourceFingerprint : data.states[row.repoId]?.candidate && candidateFingerprint(data, row.repoId) === row.sourceFingerprint; });
          if (!unchanged) { await mark(row.repoId, 'skipped', '候选已变化，未执行 Star。'); continue; }
          await update(saved => { const item = saved.rows.find(item => item.repoId === row.repoId)!; item.status = 'sending'; item.lastAttemptAt = stamp(); item.reconcileRequired = true; item.updatedAt = stamp(); });
          assertActive(); submitted = true; lastWrite = now();
          await deps.api.starRepository(canonicalOwner, canonicalName, controller.signal);
        }
        githubAccepted = true;
        await update(saved => { const item = saved.rows.find(item => item.repoId === row.repoId)!; item.status = 'local-pending'; item.outcome ??= alreadyStarred ? 'already-starred' : 'starred'; item.starredAt ??= stamp(); });
        assertAccount();
        await candidateTransaction(account, data => { assertAccount(); data.starObservations![row.repoId] = { starred: true, checkedAt: stamp() }; });
        // An explicit stop does not discard a known successful response.
        await deps.addRepository(repo); assertAccount(); localChanges = true;
        await candidateTransaction(account, data => {
          assertAccount();
          const completed = completeReadingProjectIfUnchanged(data, row.repoId, row.projectFingerprint ?? (batch.selectionMode === 'projects' ? row.sourceFingerprint : ''));
          // Only old persisted candidate batches lack the whole-project guard.
          // A newer note/import must keep its candidate for another review.
          if (!completed && !row.projectFingerprint && batch.selectionMode !== 'projects') clearCandidateIfUnchanged(data, row.repoId, row.sourceFingerprint);
          const item = data.starBatches[batch.id].rows.find(item => item.repoId === row.repoId)!;
          item.status = row.outcome ?? (alreadyStarred ? 'already-starred' : 'starred'); item.reconcileRequired = false; item.error = undefined; item.updatedAt = stamp();
        });
        deps.changed?.();
      } catch (error) {
        const reason = failure(error);
        await mark(row.repoId, githubAccepted || needsReconciliation && row.outcome ? 'local-pending' : needsReconciliation || submitted && reason.uncertain ? 'uncertain' : 'failed', message(error));
        if (controller.signal.aborted || !deps.isCurrent() || reason.pause || githubAccepted) {
          await update(saved => { saved.status = 'paused'; saved.pauseReason = controller.signal.aborted ? '已停止，未执行项目可稍后继续。' : message(error); if (reason.retryAfterMs != null) saved.retryAt = new Date(now() + Math.max(0, reason.retryAfterMs)).toISOString(); });
          break;
        }
      }
    }
  } catch (error) {
    await update(saved => { saved.status = 'paused'; saved.pauseReason = controller.signal.aborted ? '已停止，未执行项目可稍后继续。' : message(error); });
  } finally {
    if (localChanges && deps.isCurrent()) {
      try { await deps.sync(); await update(saved => { saved.syncError = undefined; }); }
      catch (error) { await update(saved => { saved.syncError = message(error); }); }
    }
    await update(saved => {
      if (saved.status === 'running') saved.status = saved.rows.every(finished) ? 'completed' : 'paused';
    });
  }
  return batch.id;
}
