import type { AppState } from '../types';
import type { HomeDatabase } from './database';
import type { Collection, HomeRecord } from './types';
import { loadData, transact } from '../features/discovery/custom/storage';
import { planSchema, overrideSchema, type CustomDiscoveryData, type CustomDiscoveryChannel, type ChannelDailyEdition } from '../features/discovery/custom/model';
import { normalizeTrendingSnapshot } from '../utils/trendingSnapshots';
import { normalizeDiscoveryChannels, externalChannelSelection } from '../store/helpers/discoveryChannels';
import { isExternalDiscoveryChannelId } from '../services/externalFeedConfig';

export type DiscoverySeed = { collection: Collection; id: string; data: Record<string, unknown> };
const json = (value: unknown): Record<string, unknown> => JSON.parse(JSON.stringify(value));
export const editionId = (edition: Pick<ChannelDailyEdition, 'channelId' | 'date' | 'revision'>) => `${edition.channelId}:${edition.date}:${edition.revision}`;
export function desktopDiscoveryStoreRecords(state: AppState): DiscoverySeed[] {
  return [
    ...(Array.isArray(state.discoveryChannels) ? [{ collection: 'discovery_config' as const, id: 'default', data: { schemaVersion: 2, channels: state.discoveryChannels.map(({ id, name, nameEn, icon, description, enabled, sourceUrl, sourceKind }) => ({ id, name, nameEn, icon, description, enabled, sourceUrl, sourceKind })) } }] : []),
    ...(state.xTweetFollows ?? []).map(follow => ({ collection: 'discovery_subscriptions' as const, id: `source:x:${follow.handle.toLowerCase()}`, data: { kind: 'x', handle: follow.handle, addedAt: follow.addedAt, enabled: true } })),
    ...(state.telegramFollows ?? []).map(follow => ({ collection: 'discovery_subscriptions' as const, id: `source:telegram:${follow.channel.toLowerCase()}`, data: { kind: 'telegram', handle: follow.channel, addedAt: follow.addedAt, enabled: true } })),
    ...(state.trendingSnapshots ?? []).map(snapshot => ({ collection: 'discovery_history' as const, id: `trending:${snapshot.period}:${snapshot.platform}:${snapshot.capturedAt.slice(0, 10)}`, data: { ...json(snapshot), type: 'trending' } })),
  ].map(row => ({ ...row, data: json(row.data) }));
}

/** Preserve opaque fields only on retained IDs, never union removed channels back in. */
export function mergeDesktopDiscoveryConfig(
  next: Record<string, unknown>, canonical?: HomeRecord, previous?: Record<string, unknown>,
): Record<string, unknown> {
  const current = canonical?.deleted ? {} : canonical?.data ?? {};
  const channels = (value: unknown): Array<Record<string, unknown> & { id: string }> =>
    Array.isArray(value) ? value.filter((item): item is Record<string, unknown> & { id: string } =>
      !!item && typeof item === 'object' && !Array.isArray(item) && typeof item.id === 'string') : [];
  const retained = new Map(channels(current.channels).map(channel => [channel.id, channel]));
  const previousIds = new Set(channels(previous?.channels).map(channel => channel.id));
  const authoritative = canonical?.deleted || current.schemaVersion === 2;
  const knownFields = ['id', 'name', 'nameEn', 'icon', 'description', 'enabled', 'sourceUrl', 'sourceKind'];
  return {
    ...current, ...next,
    channels: channels(next.channels)
      .filter(channel => !authoritative || !isExternalDiscoveryChannelId(channel.id)
        || retained.has(channel.id) || !previousIds.has(channel.id))
      .map(channel => {
        const merged = { ...retained.get(channel.id), ...channel };
        // Omitted known optional fields are intentional edits (e.g. RSS -> JSON).
        for (const field of knownFields) if (!Object.prototype.hasOwnProperty.call(channel, field)) delete merged[field];
        return merged;
      }),
  };
}
export function customDiscoveryRecords(data: CustomDiscoveryData): DiscoverySeed[] {
  return [
    ...data.channels.map(channel => ({ collection: 'discovery_subscriptions' as const, id: channel.id, data: json(channel) })),
    ...data.editions.map(edition => ({ collection: 'discovery_editions' as const, id: editionId(edition), data: json(edition) })),
    ...data.channels.flatMap(channel => channel.read.map(repoId => ({ collection: 'discovery_reads' as const, id: `${channel.id}:${repoId}`, data: { channelId: channel.id, repoId, isRead: true } }))),
  ];
}
export async function exportCustomDiscovery(account: string): Promise<DiscoverySeed[]> { return customDiscoveryRecords(await loadData(account)); }

/** Only explicitly recognized records participate; absent fields retain device state. */
export function discoveryStoreProjection(state: AppState, records: HomeRecord[]): Partial<AppState> {
  const patch: Partial<AppState> = {};
  const config = records.find(row => row.collection === 'discovery_config' && row.id === 'default' && !row.deleted)?.data;
  if (Array.isArray(config?.channels) && Array.isArray(state.discoveryChannels)) {
    if (config.schemaVersion === 2) {
      patch.discoveryChannels = normalizeDiscoveryChannels(config.channels);
      patch.selectedDiscoveryChannel = externalChannelSelection(patch.discoveryChannels, state.selectedDiscoveryChannel);
    } else {
    patch.discoveryChannels = state.discoveryChannels.map(channel => { const remote = (config.channels as Array<Record<string, unknown>>).find(item => item.id === channel.id); return remote && typeof remote.enabled === 'boolean' ? { ...channel, enabled: remote.enabled } : channel; });
    const order = (config.channels as Array<Record<string,unknown>>).map(channel=>channel.id);
    patch.discoveryChannels.sort((a,b)=>{const left=order.indexOf(a.id),right=order.indexOf(b.id);return (left<0?order.length:left)-(right<0?order.length:right);});
    if (!patch.discoveryChannels.some(channel => channel.enabled)) patch.discoveryChannels = state.discoveryChannels;
    if (!patch.discoveryChannels.some(channel => channel.id === state.selectedDiscoveryChannel && channel.enabled)) patch.selectedDiscoveryChannel = patch.discoveryChannels.find(channel => channel.enabled)?.id ?? state.selectedDiscoveryChannel;
    }
  }
  for (const kind of ['x', 'telegram'] as const) {
    const source = records.filter(row => row.collection === 'discovery_subscriptions' && row.id.startsWith(`source:${kind}:`));
    if (!source.length) continue;
    const map = new Map((kind === 'x' ? (state.xTweetFollows ?? []).map(f => [f.handle.toLowerCase(), { handle: f.handle, addedAt: f.addedAt }] as const) : (state.telegramFollows ?? []).map(f => [f.channel.toLowerCase(), { handle: f.channel, addedAt: f.addedAt }] as const)));
    for (const row of source) {
      const key = row.id.slice(`source:${kind}:`.length).toLowerCase();
      if (row.deleted || row.data?.enabled === false) map.delete(key);
      else if (typeof row.data?.handle === 'string' && row.data.handle.toLowerCase() === key) map.set(key, { handle: row.data.handle, addedAt: typeof row.data.addedAt === 'string' ? row.data.addedAt : '1970-01-01T00:00:00.000Z' });
    }
    if (kind === 'x') patch.xTweetFollows = [...map.values()]; else patch.telegramFollows = [...map.values()].map(item => ({ channel: item.handle, addedAt: item.addedAt }));
  }
  const history = records.filter(row => row.collection === 'discovery_history' && row.id.startsWith('trending:'));
  if (history.length) {
    const current = new Map((state.trendingSnapshots ?? []).map(snapshot => [`trending:${snapshot.period}:${snapshot.platform}:${snapshot.capturedAt.slice(0, 10)}`, snapshot]));
    for (const row of history) { if (row.deleted) current.delete(row.id); else { const snapshot = normalizeTrendingSnapshot(row.data); if (snapshot) current.set(row.id, snapshot); } }
    patch.trendingSnapshots = [...current.values()];
  }
  return patch;
}
export function projectCustomDiscovery(data: CustomDiscoveryData, records: HomeRecord[]): void {
  const channels = new Map(data.channels.map(channel => [channel.id, channel]));
  const editions = new Map(data.editions.map(edition => [editionId(edition), edition]));
  for (const row of records) {
    if (row.collection === 'discovery_subscriptions' && row.id.startsWith('custom:')) {
      if (!row.deleted && !overrideSchema.safeParse(row.data?.ruleOverrides ?? {}).success) continue;
      const id = row.id as CustomDiscoveryChannel['id'];
      if (row.deleted) channels.delete(id);
      else if (row.data?.id === row.id && typeof row.data.name === 'string' && typeof row.data.instruction === 'string' && planSchema.safeParse(row.data.plan).success && Array.isArray(row.data.read) && Array.isArray(row.data.cursors) && Array.isArray(row.data.blocked) && !!row.data.recommended && typeof row.data.recommended === 'object' && typeof row.data.revision === 'number' && typeof row.data.limit === 'number' && typeof row.data.hour === 'number') channels.set(id, { ...channels.get(id), ...row.data } as unknown as CustomDiscoveryChannel);
    }
    if (row.collection === 'discovery_editions') {
      if (row.deleted) editions.delete(row.id);
      else if (typeof row.data?.channelId === 'string' && row.data.channelId.startsWith('custom:') && Array.isArray(row.data.entries) && Array.isArray(row.data.pending)) editions.set(row.id, row.data as unknown as ChannelDailyEdition);
    }
  }
  for (const row of records.filter(item => item.collection === 'discovery_reads')) {
    // Only canonical custom repository read IDs are accepted. Edition IDs end in
    // a revision too, and must never be interpreted as a repository number.
    const separator = row.id.lastIndexOf(':');
    const channelId = (row.deleted ? row.id.slice(0, separator) : row.data?.channelId) as CustomDiscoveryChannel['id'];
    const repoId = row.deleted ? Number(row.id.slice(separator + 1)) : row.data?.repoId;
    const channel = channels.get(channelId);
    if (!channel || typeof repoId !== 'number' || !Number.isSafeInteger(repoId) || repoId <= 0 || row.id !== `${channelId}:${repoId}` || (!row.deleted && row.data?.kind === 'post')) continue;
    const read = new Set(channel.read ?? []); if (row.deleted || row.data?.isRead === false) read.delete(repoId); else read.add(repoId);
    channels.set(channelId, { ...channel, read: [...read] });
  }
  data.channels = [...channels.values()]; data.editions = [...editions.values()];
}
export async function applyDiscoveryProjection(account: string, records: HomeRecord[]) {
  await transact(account, data => projectCustomDiscovery(data, records), 'home-projection');
}

/** Seed before projection; a remote record or tombstone always outranks legacy desktop data. */
export async function migrateDesktopDiscovery(db: HomeDatabase, legacy: DiscoverySeed[]) {
  if (await db.metadata('discoveryDesktopMigrated')) return;
  const existing = new Set((await db.allRecords()).map(row => `${row.collection}:${row.id}`));
  for (const row of legacy) {
    const key = `${row.collection}:${row.id}`;
    if (!existing.has(key)) { await db.edit(row.collection, row.id, row.data); existing.add(key); }
  }
  await db.setMetadata('discoveryDesktopMigrated', true);
}
