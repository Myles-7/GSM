import { create } from 'zustand';
import { emptyData, type CandidateAssessment, type CustomChannelId, type CustomDiscoveryData, type TaskProgress } from './model';
import { loadData, transact } from './storage';
import { issueLabel, taskIssue } from './taskStatus';
import { useAppStore } from '../../../store/useAppStore';
import { aiTaskJournal } from '../../../services/aiTaskJournal';

interface CustomStore {
  account: string | null;
  data: CustomDiscoveryData;
  selected: CustomChannelId | null;
  progress: Record<string, TaskProgress | null>;
  busy: boolean;
  error: string | null;
  candidates: Record<string, { revision: number; date: string; items: CandidateAssessment[] }>;
}
export const useCustomDiscovery = create<CustomStore>(() => ({
  account: null, data: emptyData(), selected: null, progress: {}, busy: false, error: null, candidates: {},
}));
export const selectCustomChannel = (selected: CustomChannelId | null) => useCustomDiscovery.setState({ selected });
let stopRun: (() => void) | null = null;
export const stopCustomRun = () => stopRun?.();
export async function reloadCustomData(): Promise<void> {
  const account = useCustomDiscovery.getState().account;
  if (!account) return;
  const data = await loadData(account);
  if (useCustomDiscovery.getState().account === account) {
    const selected = useCustomDiscovery.getState().selected;
    useCustomDiscovery.setState({ data, selected: data?.channels?.some(c => c.id === selected && c.enabled) ? selected : null });
  }
}
export async function updateCustomData(change: (data: CustomDiscoveryData) => void): Promise<void> {
  const account = useCustomDiscovery.getState().account;
  if (!account) throw new Error('Please sign in');
  await transact(account, change);
  await reloadCustomData();
}
export async function deleteCustomEdition(
  channelId: CustomChannelId,
  selector: { date: string; revision?: number; generatedAt?: string } | string
): Promise<void> {
  await updateCustomData(data => {
    data.editions = data.editions.filter(e => {
      if (e.channelId !== channelId) return true;
      if (typeof selector === 'string') {
        const fullKey = `${e.date}:${e.revision}:${e.generatedAt || ''}`;
        const shortKey = `${e.date}:${e.revision}`;
        const match = selector === fullKey
          || selector === shortKey
          || (Boolean(e.generatedAt) && selector === e.generatedAt);
        return !match;
      }
      const match = e.date === selector.date
        && (selector.revision === undefined || e.revision === selector.revision)
        && (selector.generatedAt === undefined || (e.generatedAt || '') === selector.generatedAt);
      return !match;
    });
  });
}
export async function clearCustomEditions(
  channelId: CustomChannelId,
  options: { keepLatest?: number } = { keepLatest: 1 }
): Promise<void> {
  await updateCustomData(data => {
    const channelEditions = data.editions
      .filter(e => e.channelId === channelId)
      .sort((a, b) =>
        b.date.localeCompare(a.date)
        || (b.generatedAt || '').localeCompare(a.generatedAt || '')
        || b.revision - a.revision
      );
    const keepCount = Math.max(0, options.keepLatest ?? 1);
    const toKeep = new Set(channelEditions.slice(0, keepCount));
    data.editions = data.editions.filter(e => e.channelId !== channelId || toKeep.has(e));
  });
}
export async function startCustomRun(ids: string[]): Promise<void> {
  if (useCustomDiscovery.getState().busy) return;
  const account = useCustomDiscovery.getState().account;
  useCustomDiscovery.setState({ busy: true, error: null });
  const channels = useCustomDiscovery.getState().data.channels.filter(channel => ids.includes(channel.id));
  const journal = account ? aiTaskJournal.begin(account, 'discovery', channels.map(channel => ({ id: channel.id, label: channel.name }))) : null;
  const startedAt = Date.now();
  let stopped = false;
  const completed = new Set<string>();
  const recordEdition = (id: string) => {
    const channel = channels.find(item => item.id === id);
    if (!channel || stopped) return;
    const edition = useCustomDiscovery.getState().data.editions
      .filter(item => item.channelId === id && item.revision === channel.revision)
      .sort((a, b) => b.generatedAt.localeCompare(a.generatedAt))[0];
    if (edition && Date.parse(edition.generatedAt) >= startedAt) {
      journal?.item(id, edition.complete ? 'complete' : 'failed');
      completed.add(id);
    }
  };
  journal?.bind({ stop: () => { stopped = true; stopRun?.(); } });
  try {
    const { runChannels } = await import('./runner');
    if (useCustomDiscovery.getState().account !== account) return;
    const { cancelCustomRun } = await import('./runner');
    stopRun = cancelCustomRun;
    if (stopped) return;
    await runChannels(ids, (id, message) => {
      if (useCustomDiscovery.getState().account === account) {
        useCustomDiscovery.setState(s => ({ progress: { ...s.progress, [id]: message } }));
        if (message) journal?.item(id, 'running');
        else recordEdition(id);
      }
    }, reloadCustomData);
    if (useCustomDiscovery.getState().account === account) {
      channels.forEach(channel => recordEdition(channel.id));
    }
  } catch (error) {
    if (useCustomDiscovery.getState().account === account) {
      reportCustomError(error);
      if (!stopped && taskIssue(error).kind !== 'cancelled')
        channels.filter(channel => !completed.has(channel.id)).forEach(channel => journal?.item(channel.id, 'failed'));
    }
  } finally {
    journal?.finish();
    stopRun = null;
    if (useCustomDiscovery.getState().account === account) useCustomDiscovery.setState({ busy: false, progress: {} });
  }
}
export const reportCustomError = (error: unknown) =>
  useCustomDiscovery.setState({ error: issueLabel(taskIssue(error), useAppStore.getState().language.startsWith('zh')) });
