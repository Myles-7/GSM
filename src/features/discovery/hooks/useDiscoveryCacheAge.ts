import { useEffect, useState } from 'react';
import type { DiscoveryChannelId } from '../../../types';

const HOUR = 60 * 60 * 1000;
export const DISCOVERY_CACHE_MAX_AGE: Partial<Record<DiscoveryChannelId, number>> = {
  trending: HOUR, 'hot-release': HOUR, 'most-popular': 6 * HOUR,
  topic: 6 * HOUR, weekly: 6 * HOUR, search: 24 * HOUR,
  'x-tweet': HOUR / 2, telegram: HOUR / 2,
};

export function isDiscoveryCacheExpired(channel: DiscoveryChannelId, refreshedAt: string | null, now = Date.now()): boolean {
  if (!refreshedAt) return false;
  const age = DISCOVERY_CACHE_MAX_AGE[channel];
  const timestamp = Date.parse(refreshedAt);
  return age !== undefined && Number.isFinite(timestamp) && now - timestamp >= age;
}

/** Time-only status, never a network probe or an automatic refresh trigger. */
export function useDiscoveryCacheAge(channel: DiscoveryChannelId, refreshedAt: string | null): boolean {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    setNow(Date.now());
    const tick = () => setNow(Date.now());
    const timer = setInterval(tick, 60000);
    window.addEventListener('focus', tick);
    return () => { clearInterval(timer); window.removeEventListener('focus', tick); };
  }, [channel, refreshedAt]);
  return isDiscoveryCacheExpired(channel, refreshedAt, now);
}
