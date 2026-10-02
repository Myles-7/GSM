export type ExternalFeedKind = 'json' | 'rss';
export type ExternalDiscoveryChannelId = `external:${string}`;

/** RSS and Atom share the XML parser and the persisted `rss` kind. */
export interface ExternalDiscoveryChannel {
  id: ExternalDiscoveryChannelId;
  name: string;
  nameEn: string;
  icon: 'search';
  description: string;
  enabled: boolean;
  sourceUrl: string;
  sourceKind?: ExternalFeedKind;
}

export interface ExternalFeedConfiguration {
  sourceUrl?: string;
  sourceKind?: ExternalFeedKind;
}
