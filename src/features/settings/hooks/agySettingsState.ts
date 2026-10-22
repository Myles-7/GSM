import { AGY_FEATURES, type AgyDevicePrefs } from '../../../types/agy';

/** Merge device refreshes field by field, preserving only unsaved local edits. */
export function mergeAgyDraft(previous: AgyDevicePrefs | null, draft: AgyDevicePrefs | null, incoming: AgyDevicePrefs): AgyDevicePrefs {
  if (!previous || !draft) return incoming;
  const merge = (before: unknown, local: unknown, remote: unknown): unknown => {
    if (JSON.stringify(before) === JSON.stringify(local)) return remote;
    const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
    if (!object(local)) return local;
    const base = object(before) ? before : {}, next = object(remote) ? remote : {};
    return Object.fromEntries([...new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(next)])].flatMap(key => {
      const value = merge(base[key], local[key], next[key]); return value === undefined ? [] : [[key, value]];
    }));
  };
  return merge(previous, draft, incoming) as AgyDevicePrefs;
}
export function agyConcurrencyDirty(base: AgyDevicePrefs | null, draft: AgyDevicePrefs | null): boolean {
  return !!base && !!draft && ((base.concurrency ?? 5) !== (draft.concurrency ?? 5) || AGY_FEATURES.some(feature => base.featureOverrides?.[feature]?.concurrency !== draft.featureOverrides?.[feature]?.concurrency));
}
/** Save only changed limits against the latest device settings, not stale model edits. */
export function concurrencyPreferences(base: AgyDevicePrefs, draft: AgyDevicePrefs, latest: AgyDevicePrefs): AgyDevicePrefs {
  const next = structuredClone(latest);
  if ((base.concurrency ?? 5) !== (draft.concurrency ?? 5)) next.concurrency = draft.concurrency ?? 5;
  for (const feature of AGY_FEATURES) {
    if (base.featureOverrides?.[feature]?.concurrency === draft.featureOverrides?.[feature]?.concurrency) continue;
    const profile = { ...next.featureOverrides?.[feature] };
    const value = draft.featureOverrides?.[feature]?.concurrency;
    if (value === undefined) delete profile.concurrency; else profile.concurrency = value;
    next.featureOverrides = { ...next.featureOverrides };
    if (Object.keys(profile).length) next.featureOverrides[feature] = profile; else delete next.featureOverrides[feature];
  }
  return next;
}
