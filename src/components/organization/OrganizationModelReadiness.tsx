import { CheckCircle2, FolderOpen, Loader2, Power, RotateCcw, Search, ShieldCheck, Square } from 'lucide-react';
import { useSyncExternalStore } from 'react';
import { agySchedulerStatus } from '../../services/agyClient';
import { useAgySettings } from '../../features/settings/hooks/useAgySettings';
import { useT } from '../../i18n/useT';
import { Button } from '../ui/button';

export function OrganizationModelReadiness({ disabled = false, needsRepair = false }: { disabled?: boolean; needsRepair?: boolean }) {
  const c = useAgySettings(); const settingsT = useT('settings'); const t = useT('repositories');
  const pool = useSyncExternalStore(agySchedulerStatus.subscribe, agySchedulerStatus.snapshot);
  const quarantined = !!(pool?.quarantined || pool?.degraded || pool?.suspect);
  const profile = c.draft?.featureOverrides?.organization;
  const probe = c.state?.featureProbes?.organization;
  const featureMatches = probe?.code === 'SUCCESS' && probe.fingerprint === c.state?.executable?.fingerprint
    && probe.model === (profile?.model ?? c.draft?.model) && probe.effort === (profile?.effort ?? c.draft?.effort);
  const canEnable = c.probeMatches && featureMatches && c.draft?.model === c.state?.prefs.model && c.draft?.effort === c.state?.prefs.effort;
  const ready = !quarantined && c.state?.enabled && c.state.executable && c.probeMatches;
  const timeoutSeconds = profile?.timeoutSeconds ?? c.draft?.timeoutSeconds ?? 180;
  const validTimeout = Number.isInteger(timeoutSeconds) && timeoutSeconds >= 20 && timeoutSeconds <= 600;
  const failure = c.notice && c.notice !== 'SAVED' ? c.notice : probe?.code && probe.code !== 'SUCCESS' ? probe.code : null;
  return <section className="border-y bg-muted/30 px-4 py-3" aria-label={t('organizationUx.modelStatus')}>
    <div className="flex flex-wrap items-center gap-2">
      {c.busy ? <Loader2 className="h-4 w-4 animate-spin" /> : ready ? <CheckCircle2 className="h-4 w-4 text-primary" /> : <ShieldCheck className="h-4 w-4 text-muted-foreground" />}
      <span className="text-sm font-medium">{t(quarantined ? 'organizationRecovery.quarantined' : ready ? 'organizationUx.modelReady' : 'organizationUx.modelNotReady')}</span><span className="min-w-0 break-all text-xs text-muted-foreground">{profile?.model || c.state?.prefs.model || 'AGY CLI'}</span>
      {(!ready || needsRepair) && c.available && <div className="ml-auto flex flex-wrap gap-2">
        <Button size="sm" variant="outline" disabled={c.busy || disabled} onClick={c.detect}><Search className="mr-1.5 h-3.5 w-3.5" />{t('organizationUx.detect')}</Button>
        <Button size="icon" variant="ghost" className="h-8 w-8" title={settingsT('agy.choose')} aria-label={settingsT('agy.choose')} disabled={c.busy || disabled} onClick={c.choose}><FolderOpen className="h-4 w-4" /></Button>
        {quarantined && <Button size="sm" variant="outline" disabled={c.busy || disabled} onClick={c.recover}><RotateCcw className="mr-1.5 h-3.5 w-3.5" />{t('organizationRecovery.recover')}</Button>}
        <Button size="sm" variant="outline" disabled={quarantined || c.busy || disabled || !c.state?.executable || !validTimeout} onClick={c.testOrganizationBeforeEnable}><ShieldCheck className="mr-1.5 h-3.5 w-3.5" />{t('organizationUx.test')}</Button>
        {!ready && !quarantined && <Button size="sm" disabled={c.busy || disabled || !canEnable || !validTimeout} onClick={c.enableAndActivate}><Power className="mr-1.5 h-3.5 w-3.5" />{t('organizationUx.enable')}</Button>}
        {c.busy && <Button size="icon" variant="ghost" className="h-8 w-8" title={settingsT('agy.cancel')} aria-label={settingsT('agy.cancel')} onClick={c.cancel}><Square className="h-3.5 w-3.5" /></Button>}
      </div>}
    </div>
    {quarantined && <p role="alert" className="mt-2 text-xs text-destructive">{t('organizationRecovery.hint')}</p>}
    {!ready && <p className="mt-2 text-xs leading-5 text-muted-foreground">{t(c.available ? 'organizationUx.readinessHint' : 'organizationUx.desktopRequired')}</p>}
    {(!ready || needsRepair) && c.draft && <details className="mt-2 text-xs"><summary className="cursor-pointer text-muted-foreground">{settingsT('agy.advanced')}</summary><div className="mt-3 grid gap-3 sm:grid-cols-3"><label className="space-y-1">{settingsT('agy.model')}<input className="block h-8 w-full rounded-md border border-input bg-background px-2 text-xs" value={profile?.model ?? c.draft.model} disabled={disabled || c.busy} placeholder={settingsT('agy.cliDefault')} onChange={e => c.update({ featureOverrides: { ...c.draft!.featureOverrides, organization: { ...profile, model: e.target.value } } })} /></label><label className="space-y-1">{settingsT('agy.effort')}<select className="block h-8 w-full rounded-md border border-input bg-background px-2 text-xs" value={profile?.effort ?? c.draft.effort} disabled={disabled || c.busy} onChange={e => c.update({ featureOverrides: { ...c.draft!.featureOverrides, organization: { ...profile, effort: e.target.value as 'low' | 'medium' | 'high' | 'max' } } })}>{['low', 'medium', 'high', 'max'].map(value => <option key={value} value={value}>{value}</option>)}</select></label><label className="space-y-1">{settingsT('agy.timeout')}<input type="number" min={20} max={600} step={1} className="block h-8 w-full rounded-md border border-input bg-background px-2 text-xs" value={Number.isFinite(timeoutSeconds) ? timeoutSeconds : ''} disabled={disabled || c.busy} onChange={e => c.update({ featureOverrides: { ...c.draft!.featureOverrides, organization: { ...profile, timeoutSeconds: e.target.valueAsNumber } } })} /></label></div><Button size="sm" variant="outline" className="mt-2" disabled={disabled || c.busy || !validTimeout} onClick={c.save}>{settingsT('agy.save')}</Button></details>}
    {failure && <p role="status" className="mt-2 text-xs text-destructive">{failure === 'RECOVERY_REQUIRED' ? t('organizationRecovery.pending') : settingsT(`agy.errors.${failure}`, { defaultValue: settingsT('agy.error') })} ({failure})</p>}
  </section>;
}
