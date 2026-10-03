import { AGY_FEATURES, type AgyDevicePrefs, type AgyFeature } from '../../types/agy';
import { useT } from '../../i18n/useT';
import { Button } from '../ui/button';

const AGY_BATCH_FEATURES: AgyFeature[] = ['repository-summary', 'repository-details', 'gist-summary', 'release-summary', 'discovery'];

/** Keep batch limits visible; preserve old model/effort overrides until explicitly reset. */
export function AgyFeatureProfiles({ draft, update }: {
  draft: AgyDevicePrefs; update: (patch: Partial<AgyDevicePrefs>) => void;
}) {
  const t = useT('settings');
  const legacy = AGY_FEATURES.filter(feature => {
    const profile = draft.featureOverrides?.[feature];
    return profile && Object.keys(profile).some(key => !AGY_BATCH_FEATURES.includes(feature) || key !== 'concurrency');
  });
  const patch = (feature: AgyFeature, value: string) => {
    const profile = { ...draft.featureOverrides?.[feature] };
    if (value === 'inherit') delete profile.concurrency;
    else profile.concurrency = Number(value);
    const next = { ...draft.featureOverrides };
    if (Object.keys(profile).length) next[feature] = profile;
    else delete next[feature];
    update({ featureOverrides: next });
  };
  return <section className="space-y-3" aria-labelledby="agy-batch-heading">
    <div>
      <h5 id="agy-batch-heading" className="text-sm font-semibold">{t('settingsUx.batch')}</h5>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{t('settingsUx.batchHelp')}</p>
    </div>
    <div className="divide-y divide-border rounded-lg border border-border">
      {AGY_BATCH_FEATURES.map(feature => <div key={feature} className="flex items-center justify-between gap-4 px-3 py-2.5">
        <label htmlFor={`agy-batch-${feature}`} className="text-sm">{t(`settingsUx.features.${feature}`)}</label>
        <select id={`agy-batch-${feature}`} aria-label={`${t(`settingsUx.features.${feature}`)} ${t('settingsUx.concurrency')}`}
          className="h-9 w-40 shrink-0 rounded-md border border-input bg-background px-2 text-sm"
          value={draft.featureOverrides?.[feature]?.concurrency ?? 'inherit'} onChange={event => patch(feature, event.target.value)}>
          <option value="inherit">{t('settingsUx.inherit')} · {draft.concurrency ?? 5}</option>
          {[1, 2, 3, 4, 5].map(value => <option key={value} value={value}>{value}</option>)}
        </select>
      </div>)}
    </div>
    {legacy.length > 0 && <details className="rounded-lg border border-border p-3">
      <summary className="cursor-pointer text-sm font-medium">{t('settingsUx.legacyOverrides', { count: legacy.length })}</summary>
      <p className="my-3 text-xs text-muted-foreground">{t('settingsUx.legacyHelp')}</p>
      {legacy.map(feature => <div key={feature} className="flex flex-wrap items-center justify-between gap-2 border-t border-border py-2 text-sm">
        <div className="min-w-0"><span>{t(`settingsUx.features.${feature}`)}</span><code className="mt-1 block break-all text-xs text-muted-foreground">{JSON.stringify(draft.featureOverrides?.[feature])}</code></div>
        <Button size="sm" variant="outline" onClick={() => {
          const next = { ...draft.featureOverrides };
          const concurrency = AGY_BATCH_FEATURES.includes(feature) ? next[feature]?.concurrency : undefined;
          if (concurrency !== undefined) next[feature] = { concurrency };
          else delete next[feature];
          update({ featureOverrides: next });
        }}>{t('settingsUx.resetDefaults')}</Button>
      </div>)}
    </details>}
  </section>;
}
