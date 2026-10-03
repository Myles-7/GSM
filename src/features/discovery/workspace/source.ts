import type { AppState, DiscoveryChannelId } from '../../../types';

type SourceState = Pick<AppState, 'discoveryPlatform' | 'trendingTimeRange' | 'discoverySelectedTopic' |
  'discoverySearchQuery' | 'discoveryLanguage' | 'discoverySortBy' | 'discoverySortOrder' |
  'weeklyOnlyCollected' | 'xTweetFollows' | 'xTweetAuthRevision' | 'telegramFollows' | 'discoveryChannels'>;
/** Credentials never participate in durable identities. */
export function discoverySourceSignature(state: SourceState, channel: DiscoveryChannelId, prereleases = false) {
  const fields: unknown[] = [state.discoveryPlatform];
  switch (channel) {
    case 'trending': fields.push(state.trendingTimeRange); break;
    case 'topic': fields.push(state.discoverySelectedTopic); break;
    case 'search': fields.push(state.discoverySearchQuery.trim(), state.discoveryLanguage, state.discoverySortBy, state.discoverySortOrder); break;
    case 'weekly': fields.splice(0, 1, state.weeklyOnlyCollected); break;
    case 'x-tweet': fields.splice(0, 1, [...state.xTweetFollows].map(f => f.handle.toLowerCase()).sort(), state.xTweetAuthRevision); break;
    case 'telegram': fields.splice(0, 1, [...state.telegramFollows].map(f => f.channel.toLowerCase()).sort()); break;
    case 'hot-release': fields.push(prereleases); break;
    default: if (channel.startsWith('external:')) fields.splice(0, 1, state.discoveryChannels.find(c => c.id === channel)?.sourceUrl); break;
  }
  return JSON.stringify(fields);
}
