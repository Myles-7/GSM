import { Bot, Check, Settings2, Terminal, TestTube, Trash2, RefreshCw } from 'lucide-react';
import type { AIConfig } from '../../types';
import { useT } from '../../i18n/useT';
import { AGY_CONFIG_ID, isHttpAIConfig, isAIConfigAvailable } from '../../utils/aiConfig';
import type { useAgySettings } from '../../features/settings/hooks/useAgySettings';
import { aiConnectionFingerprint, type AIConfigActions } from '../../features/settings/hooks/useAIConfigActions';
import { Button } from '../ui/button';
import { RadioGroup, RadioGroupItem } from '../ui/radio-group';

export function AIServiceSelector({ configs, active, select, agy, actions, configureAgy, edit, remove }: {
  configs: AIConfig[]; active: string | null; select: (id: string) => void;
  agy: ReturnType<typeof useAgySettings>; actions: AIConfigActions; configureAgy: () => void;
  edit: (config: AIConfig) => void; remove: (config: AIConfig) => void;
}) {
  const t = useT('settings');
  const state = agy.state;
  const agyReady = !!(agy.available && state?.enabled && state.executable);
  const agyStatus = !agy.available || state?.supported === false ? 'desktopOnly'
    : !state ? agy.notice ? 'failed' : 'checking' : !state.executable ? 'notDetected'
    : state.enabled ? agy.probeMatches ? 'ready' : 'untested' : agy.probeMatches ? 'disabled'
    : state.lastProbe ? 'failed' : 'untested';
  const candidates = [{ id: AGY_CONFIG_ID, name: 'AGY CLI', ready: agyReady, status: t(`settingsUx.${agyStatus}`), model: state?.prefs.model || t('agy.cliDefault'), agy: true },
    ...configs.filter(isHttpAIConfig).map(config => {
      const result = actions.results[config.id];
      const fresh = result && result.fingerprint === aiConnectionFingerprint(config);
      const ready = isAIConfigAvailable(config);
      return { id: config.id, name: config.name, ready, model: config.model, agy: false, config,
        status: !ready ? t('settingsUx.incomplete') : fresh ? t(`settingsUx.${result.success ? 'tested' : 'failed'}`) : t('settingsUx.untested') };
    })];
  return <section className="space-y-3" aria-labelledby="active-ai-config-heading">
    <div>
      <h4 id="active-ai-config-heading" className="text-sm font-semibold">{t('settingsUx.currentAI')}</h4>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{t('settingsUx.selectionHelp')}</p>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{t('settingsUx.connectionScope')}</p>
    </div>
    <RadioGroup aria-labelledby="active-ai-config-heading" value={active || ''} onValueChange={select} className="gap-3">
      {candidates.map(candidate => {
        const config = 'config' in candidate ? candidate.config : undefined;
        const result = config && actions.results[config.id];
        const fresh = result && result.fingerprint === aiConnectionFingerprint(config);
        return <div key={candidate.id} className={`min-w-0 rounded-xl border p-4 transition-colors ${active === candidate.id ? 'border-primary/50 bg-primary/5' : 'border-border'}`}>
          <div className="flex flex-col items-stretch justify-between gap-3 sm:flex-row sm:items-center">
            <div className="flex min-w-0 flex-1 items-start gap-3">
              <RadioGroupItem id={`active-ai-${candidate.id}`} value={candidate.id} aria-label={candidate.name} disabled={!candidate.ready} className="mt-1" />
              <div className="min-w-0">
                <label htmlFor={`active-ai-${candidate.id}`} className="flex cursor-pointer flex-wrap items-center gap-2 text-sm font-semibold">
                  {candidate.agy ? <Terminal size={16} /> : <Bot size={16} />}{candidate.name}
                  {active === candidate.id && <span className="inline-flex items-center gap-1 rounded bg-primary/10 px-2 py-0.5 text-xs text-primary"><Check size={12} />{t('settingsUx.selected')}</span>}
                </label>
                <p className="mt-1 break-all text-xs text-muted-foreground">{candidate.model}{config && ` · ${(config.apiType || 'openai').toUpperCase()}`}</p>
                <p className={`mt-2 text-xs ${candidate.agy && agyReady && agy.probeMatches || fresh && result.success ? 'text-success' : 'text-muted-foreground'}`} role="status">{candidate.status}
                  {candidate.agy && state?.lastProbe && ` · ${new Date(state.lastProbe.at).toLocaleString()}`}
                  {fresh && ` · ${new Date(result.at).toLocaleTimeString()}`}
                </p>
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap justify-end gap-2">
              {config && <Button variant="outline" size="sm" disabled={actions.testingForm || (!!actions.testingId && actions.testingId !== config.id) || !candidate.ready} onClick={() => actions.testingId === config.id ? actions.cancelTest() : void actions.testConfig(config)} aria-label={`${t(actions.testingId === config.id ? 'settingsUx.cancelTest' : 'settingsUx.test')} ${candidate.name}`}>
                {actions.testingId === config.id ? <RefreshCw size={14} className="animate-spin" /> : <TestTube size={14} />}{t(actions.testingId === config.id ? 'settingsUx.cancelTest' : 'settingsUx.test')}
              </Button>}
              <Button variant="outline" size="sm" onClick={() => candidate.agy ? configureAgy() : config && edit(config)} aria-label={candidate.agy ? t('settingsUx.configureAgy') : `${t('settingsUx.configure')} ${candidate.name}`}><Settings2 size={14} />{t('settingsUx.configure')}</Button>
              {config && <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`${t('settingsUx.delete')} ${candidate.name}`} onClick={() => remove(config)}><Trash2 size={14} /></Button>}
            </div>
          </div>
          {fresh && !result.success && <p role="alert" className="mt-3 break-words text-xs text-destructive">{result.message}</p>}
        </div>;
      })}
    </RadioGroup>
    {active && !candidates.some(candidate => candidate.id === active && candidate.ready) && <p role="status" className="rounded-lg bg-muted p-3 text-sm">{t('settingsUx.unavailableSelection')}</p>}
  </section>;
}
