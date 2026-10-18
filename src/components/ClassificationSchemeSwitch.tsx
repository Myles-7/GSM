import { useAppStore } from '../store/useAppStore';
import { useT } from '../i18n/useT';
import { Button } from './ui/button';
export function ClassificationSchemeSwitch() {
  const t = useT('repositories');
  const scheme = useAppStore(s => s.activeClassificationScheme ?? 'purpose');
  const setScheme = useAppStore(s => s.setClassificationScheme);
  return <div className="mb-3 flex gap-1 rounded-md bg-muted/50 p-1" role="group" aria-label={t('dualOrganization.scheme')}>
    {(['purpose', 'technology'] as const).map(id => <Button key={id} size="sm" variant={scheme === id ? 'secondary' : 'ghost'} aria-pressed={scheme === id} className="h-8 min-w-0 flex-1 text-xs" onClick={() => setScheme(id)}>{t(`dualOrganization.${id}Short`)}</Button>)}
  </div>;
}
