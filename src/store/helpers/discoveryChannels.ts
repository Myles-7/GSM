import type { DiscoveryChannel, DiscoveryChannelId } from '../../types';
import { normalizeExternalDiscoveryChannels } from '../../services/externalFeedConfig';
import { defaultDiscoveryChannels } from '../schema';

/** Built-ins are preferences; external entries are account-owned configuration. */
export function normalizeDiscoveryChannels(input: unknown): DiscoveryChannel[] {
  const rows = Array.isArray(input) ? input : [];
  const builtins = defaultDiscoveryChannels.map(defaultChannel => {
    const previous = rows.find(value => value && typeof value === 'object' && value.id === defaultChannel.id);
    return { ...defaultChannel, enabled: previous?.enabled !== false };
  });
  const channels: DiscoveryChannel[] = [...builtins, ...normalizeExternalDiscoveryChannels(rows)];
  if (!channels.some(channel => channel.enabled)) channels[0] = { ...channels[0], enabled: true };
  const order = rows.map(value => value && typeof value === 'object' ? value.id : undefined);
  return channels.sort((a, b) => {
    const left = order.indexOf(a.id), right = order.indexOf(b.id);
    return (left < 0 ? order.length : left) - (right < 0 ? order.length : right);
  });
}

export function externalChannelSelection(channels: DiscoveryChannel[], selected: DiscoveryChannelId): DiscoveryChannelId {
  return channels.some(channel => channel.id === selected && channel.enabled)
    ? selected
    : channels.find(channel => channel.enabled)?.id ?? 'trending';
}
