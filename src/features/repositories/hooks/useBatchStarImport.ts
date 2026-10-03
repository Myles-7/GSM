import { useCallback, useEffect, useRef, useState } from 'react';
import { useAppStore } from '../../../store/useAppStore';
import { forceSyncToBackend } from '../../../services/autoSync';
import { aiTaskJournal } from '../../../services/aiTaskJournal';
import { GitHubTokenPermissionError, type GitHubRepoDetailRead } from '../../../services/githubApi';
import { makeT } from '../../../i18n/useT';
import { createGitHubApiService } from '../../../services/githubApiFactory';
import type { Repository } from '../../../types';
import type { ImportedRepositoryCandidate } from '../../../types/repositoryImport';
import { extractRepositoryCandidates } from '../../../utils/repositoryImport';

const MAX_CANDIDATES = 50;
const RESOLVE_BATCH_SIZE = 5;

export interface BatchStarRow {
  candidate: ImportedRepositoryCandidate;
  detail?: GitHubRepoDetailRead;
  status: 'ready' | 'already-starred' | 'unavailable' | 'failed' | 'starred';
  selected: boolean;
  error?: string;
}

/** Resolves pasted repository links, then applies only the user's selected stars. */
export function useBatchStarImport() {
  const githubToken = useAppStore(state => state.githubToken);
  const accountId = useAppStore(state => state.user?.id);
  const language = useAppStore(state => state.language);
  const addRepository = useAppStore(state => state.addRepository);
  const [rows, setRows] = useState<BatchStarRow[]>([]);
  const [duplicateCount, setDuplicateCount] = useState(0);
  const [inputError, setInputError] = useState('');
  const [isResolving, setIsResolving] = useState(false);
  const [isStarring, setIsStarring] = useState(false);
  const [syncError, setSyncError] = useState('');
  const [invalidIds, setInvalidIds] = useState<Array<{ fullName: string; id: number }>>([]);
  const busyRef = useRef(false);
  const requestRef = useRef<AbortController | null>(null);
  const cancel = useCallback(() => {
    requestRef.current?.abort();
    requestRef.current = null;
    busyRef.current = false;
    setRows([]);
    setInvalidIds([]);
    setInputError('');
    setSyncError('');
    setDuplicateCount(0);
    setIsResolving(false);
    setIsStarring(false);
  }, []);
  const generationRef = useRef(0);
  const generation = generationRef.current;
  useEffect(() => {
    const unsubscribe = useAppStore.subscribe((next, previous) => {
      if (next.user?.id !== previous.user?.id || next.githubToken !== previous.githubToken) {
        generationRef.current += 1;
        cancel();
      }
    });
    return () => { unsubscribe(); requestRef.current?.abort(); };
  }, [cancel]);

  const isCurrentAccount = () => generationRef.current === generation
    && useAppStore.getState().user?.id === accountId
    && useAppStore.getState().githubToken === githubToken;
  const isCurrent = (controller: AbortController) => !controller.signal.aborted
    && requestRef.current === controller
    && isCurrentAccount();
  const errorMessage = (error: unknown) => {
    const t = makeT(language, 'repositories');
    if (error instanceof GitHubTokenPermissionError) return t('batchStar.token-permission-error', {
      defaultValue: 'This token cannot manage Stars. Enable Starring read/write and Metadata read, or public_repo (repo for private repositories).',
    });
    const failure = error as { status?: number; retryAfterMs?: number };
    if (failure?.status === 429 || failure?.retryAfterMs != null) return t('batchStar.rate-limit-error', {
      defaultValue: 'GitHub has rate limited this request. Wait before trying again; changing token permissions will not fix it.',
    });
    if (error instanceof TypeError) return t('batchStar.network-error', {
      defaultValue: 'Could not reach GitHub. Check your connection and try again.',
    });
    return error instanceof Error ? error.message : String(error);
  };
  const hasValidId = (id: number) => Number.isSafeInteger(id) && id > 0;

  /** Parses pasted text into candidate repositories and resolves their live
   *  details and star status without touching the GitHub account. */
  const preview = useCallback(async (text: string) => {
    if (busyRef.current || !isCurrentAccount()) return;
    setInputError('');
    setSyncError('');
    setRows([]);
    setInvalidIds([]);
    if (!githubToken) {
      setInputError('sign-in');
      return;
    }

    const extracted = extractRepositoryCandidates(text);
    if (extracted.inputErrors.length > 0) {
      setInputError(extracted.inputErrors[0].code);
      return;
    }
    const candidates = extracted.candidates.filter(candidate => candidate.status !== 'duplicate');
    setDuplicateCount(extracted.stats.duplicates);
    if (candidates.length === 0) {
      setInputError('no-repositories');
      return;
    }
    if (candidates.length > MAX_CANDIDATES) {
      setInputError('too-many-repositories');
      return;
    }

    busyRef.current = true;
    const controller = new AbortController();
    requestRef.current = controller;
    setIsResolving(true);
    try {
      const api = createGitHubApiService(githubToken);
      const resolved: BatchStarRow[] = [];
      const canonicalNames = new Set<string>();
      let canonicalDuplicates = 0;
      for (let start = 0; start < candidates.length; start += RESOLVE_BATCH_SIZE) {
        if (!isCurrent(controller)) return;
        const batch = candidates.slice(start, start + RESOLVE_BATCH_SIZE);
        const batchRows = await Promise.all(batch.map(async (candidate): Promise<BatchStarRow> => {
          if (candidate.status === 'invalid') {
            return { candidate, status: 'unavailable', selected: false };
          }
          const [owner, repo] = candidate.repositoryFullName.split('/');
          try {
            const detail = await api.getRepositoryDetails(owner, repo, controller.signal);
            if (!isCurrent(controller)) return { candidate, status: 'unavailable', selected: false };
            if (!hasValidId(detail.id)) {
              setInvalidIds(current => [...current, { fullName: detail.full_name, id: detail.id }]);
              return { candidate, detail, status: 'unavailable', selected: false,
                error: makeT(language, 'repositories')('batchStar.invalid-repository-id', {
                  defaultValue: 'GitHub did not return a valid repository ID. This repository was not starred.',
                }) };
            }
            const alreadyStarred = await api.isRepositoryStarred(detail.owner.login, detail.name, controller.signal);
            const renamed = detail.full_name.toLowerCase() !== candidate.repositoryFullName.toLowerCase();
            return {
              candidate,
              detail,
              status: alreadyStarred ? 'already-starred' : 'ready',
              selected: !alreadyStarred && candidate.confidence === 'high' && !renamed,
            };
          } catch (error) {
            return {
              candidate,
              status: 'unavailable',
              selected: false,
              error: errorMessage(error),
            };
          }
        }));
        if (!isCurrent(controller)) return;
        for (const row of batchRows) {
          const canonicalName = row.detail?.full_name.toLowerCase();
          if (canonicalName && canonicalNames.has(canonicalName)) {
            canonicalDuplicates += 1;
            continue;
          }
          if (canonicalName) canonicalNames.add(canonicalName);
          resolved.push(row);
        }
        setDuplicateCount(extracted.stats.duplicates + canonicalDuplicates);
        setRows([...resolved]);
      }
    } finally {
      if (requestRef.current === controller) {
        busyRef.current = false;
        setIsResolving(false);
      }
    }
  // The request guard captures the same account, token and language as this action.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId, githubToken, language, generation]);

  /** Flips the selection of a starable row; other statuses cannot be toggled. */
  const toggleRow = useCallback((index: number) => {
    if (busyRef.current) return;
    setRows(current => current.map((row, rowIndex) =>
      rowIndex === index && row.status === 'ready'
        ? { ...row, selected: !row.selected }
        : row
    ));
  }, []);

  /** Selects every starable row, leaving starred and unavailable rows untouched. */
  const selectAll = useCallback(() => {
    if (busyRef.current) return;
    setRows(current => current.map(row =>
      row.status === 'ready' ? { ...row, selected: true } : row
    ));
  }, []);

  /** Inverts the selection of every starable row. */
  const invertSelection = useCallback(() => {
    if (busyRef.current) return;
    setRows(current => current.map(row =>
      row.status === 'ready' ? { ...row, selected: !row.selected } : row
    ));
  }, []);

  /** Drops the preview results together with every transient error. */
  const clearPreview = useCallback(() => {
    if (busyRef.current) return;
    setRows([]);
    setInputError('');
    setSyncError('');
    setDuplicateCount(0);
    setInvalidIds([]);
  }, []);

  /** Stars the selected repositories one by one, records each result
   *  independently, then syncs the store to the backend when at least one
   *  star succeeded. */
  const starSelected = useCallback(async () => {
    if (busyRef.current || !githubToken || !isCurrentAccount()) return;
    const selected = rows.map((row, index) => ({ row, index }))
      .filter(({ row }) => row.status === 'ready' && row.selected && row.detail);
    if (selected.length === 0) return;

    busyRef.current = true;
    const controller = new AbortController();
    requestRef.current = controller;
    setIsStarring(true);
    setSyncError('');
    const api = createGitHubApiService(githubToken);
    let starredCount = 0;
    const task = aiTaskJournal.begin(String(accountId ?? ''), 'import', selected.map(({ row }) => ({ id: row.detail!.full_name, label: row.detail!.full_name })), undefined, undefined,
      { title: 'GitHub Stars', target: { view: 'repositories' } });
    task.bind({ stop: () => controller.abort() });
    try {
      for (const { row, index } of selected) {
        if (!isCurrent(controller)) return;
        const detail = row.detail!;
        task.item(detail.full_name, 'running');
        try {
          if (!hasValidId(detail.id)) {
            setInvalidIds(current => [...current, { fullName: detail.full_name, id: detail.id }]);
            throw new Error(makeT(language, 'repositories')('batchStar.invalid-repository-id', {
              defaultValue: 'GitHub did not return a valid repository ID. This repository was not starred.',
            }));
          }
          await api.starRepository(detail.owner.login, detail.name, controller.signal);
          if (!isCurrent(controller)) return;
          addRepository({ ...detail, starred_at: new Date().toISOString() } as Repository);
          starredCount += 1;
          task.item(detail.full_name, 'complete');
          setRows(current => current.map((item, itemIndex) =>
            itemIndex === index ? { ...item, status: 'starred', selected: false } : item
          ));
        } catch (error) {
          if (isCurrent(controller)) task.item(detail.full_name, 'failed', error);
          if (!isCurrent(controller)) return;
          setRows(current => current.map((item, itemIndex) => itemIndex === index
            ? { ...item, status: 'failed', selected: false, error: errorMessage(error) }
            : item
          ));
        }
      }
      if (starredCount > 0 && isCurrent(controller)) {
        try {
          await forceSyncToBackend({ reportFailures: true });
        } catch (error) {
          if (isCurrent(controller)) setSyncError(errorMessage(error));
        }
      }
    } finally {
      task.finish(controller.signal.aborted ? 'canceled' : undefined);
      if (requestRef.current === controller) {
        busyRef.current = false;
        setIsStarring(false);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId, addRepository, githubToken, language, rows, generation]);

  return {
    rows, duplicateCount, inputError, isResolving, isStarring, syncError, invalidIds, cancel,
    preview, toggleRow, selectAll, invertSelection, clearPreview, starSelected,
  };
}
