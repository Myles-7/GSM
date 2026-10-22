import { FolderOpen, RefreshCw, Save, Search, ShieldAlert, Square, Terminal } from 'lucide-react';
import { useSyncExternalStore } from 'react';
import { useAgySettings } from '../../features/settings/hooks/useAgySettings';
import { useT } from '../../i18n/useT';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Checkbox } from '../ui/checkbox';
import type { AgyDevicePrefs } from '../../types/agy';
import { useAppStore } from '../../store/useAppStore';
import { AgyFeatureProfiles } from './AgyFeatureProfiles';
import { agySchedulerStatus } from '../../services/agyClient';

const selectClass = 'h-10 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm';

export function AgyConfigPanel() {
  const agy = useAgySettings();
  return <AgyConfigPanelView agy={agy} />;
}

export function AgyConfigPanelView({ agy }: { agy: ReturnType<typeof useAgySettings> }) {
  const chatT = useT('chat');
  const t = useT('settings');
  const zh = (useAppStore(store => store.language) ?? 'zh').startsWith('zh');
  const { state, draft, busy } = agy;
  const livePool = useSyncExternalStore(agySchedulerStatus.subscribe, agySchedulerStatus.snapshot);
  const pool = livePool ?? state?.pool;
  const supported = state?.supported === true;
  const detected = !!state?.executable;
  const valid = draft && Number.isInteger(draft.timeoutSeconds) && draft.timeoutSeconds >= 20 && draft.timeoutSeconds <= 600 &&
    Number.isInteger(draft.maxQueued) && draft.maxQueued >= 0 && draft.maxQueued <= 50 &&
    Number.isInteger(draft.concurrency ?? 5) && (draft.concurrency ?? 5) >= 1 && (draft.concurrency ?? 5) <= 5 &&
    Object.values(draft.featureOverrides ?? {}).every(profile => !profile ||
      (profile.timeoutSeconds === undefined || Number.isInteger(profile.timeoutSeconds) && profile.timeoutSeconds >= 20 && profile.timeoutSeconds <= 600) &&
      (profile.concurrency === undefined || Number.isInteger(profile.concurrency) && profile.concurrency >= 1 && profile.concurrency <= 5));
  const dirty = draft && JSON.stringify(draft) !== JSON.stringify(state?.prefs);
  const concurrencyValid = !!draft && Number.isInteger(draft.concurrency ?? 5) && (draft.concurrency ?? 5)>=1 && (draft.concurrency ?? 5)<=5 && Object.values(draft.featureOverrides??{}).every(profile=>profile?.concurrency===undefined || Number.isInteger(profile.concurrency)&&profile.concurrency>=1&&profile.concurrency<=5);
  const probe = state?.lastProbe;
  const errorKey = (code: string) => ['AUTH_REQUIRED', 'CANCELED', 'BUSY', 'EXECUTABLE_CHANGED', 'TIMEOUT', 'INIT_TIMEOUT', 'NOT_FOUND', 'RATE_LIMIT', 'QUOTA_EXHAUSTED', 'QUEUE_TIMEOUT', 'PERMISSION_DENIED', 'SERVICE_UNAVAILABLE'].includes(code)
    ? `agy.errors.${code}` : 'agy.error';
  const errorText = (code: string) => code === 'MODEL_EFFORT_CONFLICT'
    ? zh ? '所选模型与 effort 冲突，请调整对应功能的配置后重新测试。' : 'The selected model conflicts with effort. Adjust this feature profile and test again.'
    : code === 'QUOTA_EXHAUSTED'
    ? zh ? 'AGY 额度不足，请在终端检查账户额度后手动重试。不会自动购买或切换模型。' : 'AGY quota exhausted. Check your account in the terminal, then retry manually. No automatic purchases or model changes.'
    : t(errorKey(code));

  return <section className="min-w-0 space-y-4 rounded-xl border border-border p-4 sm:p-5" aria-labelledby="agy-heading">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h4 id="agy-heading" className="flex items-center gap-2 font-semibold text-foreground"><Terminal size={20} /> AGY CLI</h4>
      <span className="text-xs text-muted-foreground">{t('agy.deviceOnly')}</span>
    </div>
    {!agy.available || (state && !supported) ? <p className="text-sm text-muted-foreground">{t('agy.desktopOnly')}</p> : <>
      {(busy || (pool ? pool.running + pool.queued > 0 : state?.busy)) && <p role="status" className="text-sm text-muted-foreground">{t('agy.working')} ({pool?.queued ?? state?.queued ?? 0})</p>}
      {pool && <p role="status" className="text-sm text-muted-foreground">{zh ? '运行 / 等待 / 有效并发' : 'Running / queued / effective concurrency'}: {pool.running} / {pool.queued} / {pool.effective}
        {pool.cooldownUntil > Date.now() && ` · ${zh ? '限流冷却至' : 'Cooling down until'} ${new Date(pool.cooldownUntil).toLocaleTimeString()}`}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 break-all text-sm text-muted-foreground">{detected ? state.executable!.path || state.executable!.name : t('agy.notDetected')}</span>
        <Button variant="outline" size="sm" disabled={busy || !supported} onClick={agy.detect}><Search size={16} className="mr-2" />{t('agy.detect')}</Button>
        <Button variant="outline" size="sm" disabled={busy || !supported} onClick={agy.choose}><FolderOpen size={16} className="mr-2" />{t('agy.chooseExecutable')}</Button>
        <Button variant="outline" size="sm" disabled={busy || !detected || !valid} onClick={agy.saveAndProbe}><ShieldAlert size={16} className="mr-2" />{t('agy.saveAndTest')}</Button>
        {busy && <Button variant="outline" size="sm" onClick={agy.cancel}><Square size={14} className="mr-2" />{t('agy.cancel')}</Button>}
      </div>
      {probe && <p className="break-words text-sm text-muted-foreground" role="status">
        {t('agy.lastProbe')} {new Date(probe.at).toLocaleString()} · {probe.code === 'SUCCESS'
          ? agy.probeMatches ? t('agy.success') : t('settingsUx.untested') : <>{errorText(probe.code)} ({probe.code})</>}
      </p>}
      {state?.requiresTest && <p role="status" className="text-sm text-amber-700 dark:text-amber-400">{zh ? '当前模型或 effort 尚未通过连接测试。请点击“保存并测试”后再发起新调用；原配置的在途任务可继续完成。' : 'Test the current model and effort before starting new calls. Requests already using a tested profile can finish.'}</p>}
      {(pool?.degraded || pool?.suspect || pool?.quarantined) ? <div className="space-y-2">
        <p role="status" className="text-sm text-amber-700 dark:text-amber-400">{zh ? '进程或目录清理尚未确认完成，相关容量继续隔离。确认进程退出后可重试恢复。' : 'Process or directory cleanup is unresolved. Its capacity remains isolated until exit is confirmed.'}</p>
        <Button variant="outline" disabled={busy} onClick={agy.recover}>{zh ? '重试清理与恢复' : 'Retry cleanup and recovery'}</Button>
      </div> : null}
      {agy.recoveryIssues.length > 0 && <div className="space-y-3 rounded-lg border border-amber-300 bg-amber-50/50 p-3 dark:border-amber-800 dark:bg-amber-950/20">
        <p role="alert" className="text-sm font-medium text-amber-800 dark:text-amber-300">
          {zh ? 'AGY 恢复记录损坏，新的模型调用会保持阻断，直到显式处理。' : 'AGY recovery records are corrupt. New provider calls remain blocked until they are explicitly repaired.'}
        </p>
        {agy.recoveryIssues.map(issue => <div key={issue.requestId} className="space-y-2 border-t border-amber-200 pt-2 first:border-t-0 first:pt-0 dark:border-amber-900">
          <p className="break-all text-xs text-muted-foreground">{issue.requestId} · {issue.dispatch ?? 'unknown'} · {issue.providerOutcome ?? 'unknown'}</p>
          <p className="text-sm text-amber-800 dark:text-amber-300">{issue.certainty === 'definitely-unsent'
            ? zh ? '记录虽损坏，但 durable 状态仍能证明请求从未发送；可以安全丢弃阻断记录。' : 'The durable state still proves this request was never sent, so the blocking record can be safely discarded.'
            : zh ? '无法证明请求未发送；它可能已经调用并计费。默认不会自动清除或重试。' : 'The request cannot be proven unsent and may already have been billed. It will not be cleared or retried automatically.'}</p>
          <Button variant="outline" size="sm" disabled={busy || !!agy.recoveryBusy} onClick={() => agy.repairRecovery(issue)}>
            {agy.recoveryBusy === issue.requestId
              ? zh ? '处理中…' : 'Repairing…'
              : issue.certainty === 'definitely-unsent'
                ? zh ? '安全丢弃未发送记录' : 'Safely discard unsent record'
                : zh ? '放弃未知结果并解除阻断' : 'Abandon unknown outcome and unblock'}
          </Button>
        </div>)}
      </div>}
      {draft && <fieldset disabled={busy || !supported} className="min-w-0 space-y-4">
        <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="min-w-0 space-y-1">
            <label htmlFor="agy-model" className="text-sm font-medium">{t('agy.model')}</label>
            <div className="flex min-w-0 gap-2">
              <select id="agy-model" className={selectClass} value={draft.model} onChange={event => agy.update({ model: event.target.value })}>
                <option value="">{t('agy.cliDefault')}</option>
                {draft.model && !agy.models.some(model => model.id === draft.model) && <option value={draft.model}>{draft.model}</option>}
                {agy.models.map(model => <option key={model.id} value={model.id}>{model.label}</option>)}
              </select>
              <Button variant="outline" size="icon" className="shrink-0" disabled={!detected} title={t('agy.refreshModels')} aria-label={t('agy.refreshModels')} onClick={agy.refreshModels}><RefreshCw size={16} /></Button>
            </div>
          </div>
          <div className="min-w-0 space-y-1">
            <label className="text-sm font-medium" htmlFor="agy-concurrency">{t('settingsUx.globalConcurrency')}</label>
            <div className="flex items-center gap-2"><select id="agy-concurrency" className={selectClass} value={draft.concurrency ?? 5} onChange={event => agy.update({ concurrency: Number(event.target.value) })}>
              {[1, 2, 3, 4, 5].map(value => <option key={value}>{value}</option>)}
            </select><Button variant="outline" className="shrink-0" disabled={!concurrencyValid || !agy.concurrencyDirty} onClick={agy.saveConcurrency}>{zh?'保存并发':'Save limits'}</Button></div>
            <p className="text-xs leading-relaxed text-muted-foreground">{zh?`已保存上限 ${state?.prefs.concurrency??5} · 当前有效 ${pool?.effective??state?.prefs.concurrency??5}。限流与恢复状态可能降低有效并发。仅保存并发不调用或测试模型，正在执行的请求不会强行中断。`:`Saved limit ${state?.prefs.concurrency??5} · Effective ${pool?.effective??state?.prefs.concurrency??5}. Rate limits and recovery may lower the effective limit. Saving limits does not call or test the model, or interrupt running requests.`}</p>
          </div>
          <details className="min-w-0 sm:col-span-2">
            <summary className="cursor-pointer text-sm font-medium">{t('agy.advanced')}</summary>
            <div className="mt-3 grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="min-w-0 space-y-1">
            <label htmlFor="agy-effort" className="text-sm font-medium">{t('agy.effort')}</label>
            <select id="agy-effort" className={selectClass} value={draft.effort} onChange={event => agy.update({ effort: event.target.value as AgyDevicePrefs['effort'] })}>
              {(['low', 'medium', 'high', 'max'] as const).map(effort => <option key={effort} value={effort}>{effort}</option>)}
            </select>
          </div>
          <div className="min-w-0 space-y-1">
            <label htmlFor="agy-mode" className="text-sm font-medium">{t('agy.mode')}</label>
            <select id="agy-mode" className={selectClass} value={draft.mode} onChange={event => agy.update({ mode: event.target.value as AgyDevicePrefs['mode'] })}>
              <option value="model">{t('agy.modelMode')}</option><option value="research">{t('agy.researchMode')}</option>
            </select>
          </div>
          <div className="min-w-0 space-y-1">
            <label htmlFor="agy-timeout" className="text-sm font-medium">{t('agy.timeout')}</label>
            <Input id="agy-timeout" type="number" min={20} max={600} step={1} value={Number.isFinite(draft.timeoutSeconds) ? draft.timeoutSeconds : ''} onChange={event => agy.update({ timeoutSeconds: event.target.valueAsNumber })} />
          </div>
          <div className="min-w-0 space-y-1">
            <label htmlFor="agy-queue" className="text-sm font-medium">{t('agy.queue')}</label>
            <Input id="agy-queue" type="number" min={0} max={50} step={1} value={Number.isFinite(draft.maxQueued) ? draft.maxQueued : ''} onChange={event => agy.update({ maxQueued: event.target.valueAsNumber })} />
          </div>
            </div>
          </details>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={draft.enabled} disabled={!draft.enabled && (!agy.probeMatches || draft.model !== state?.prefs.model || draft.effort !== state?.prefs.effort)}
            onCheckedChange={value => agy.update({ enabled: value === true })} />
          {t('agy.enable')}
        </label>
        <AgyFeatureProfiles draft={draft} update={agy.update} testFeature={agy.testFeature} />
        <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
        <Button variant="outline" onClick={agy.save} disabled={!valid || !dirty}><Save size={16} className="mr-2" />{t('agy.save')}</Button>
        {!state?.enabled && <Button variant="outline" className="ml-2" onClick={agy.enableAndActivate}
          disabled={!valid || draft.model !== state?.prefs.model || draft.effort !== state?.prefs.effort || !agy.probeMatches}>{t('agy.enableAndActivate')}</Button>}
        <Button variant="outline" className="ml-2" onClick={agy.activate} disabled={!state?.enabled || !!dirty || agy.active}>
          {t(agy.active && state?.enabled ? 'agy.active' : 'agy.activate')}
        </Button>
        {dirty && <span role="status" className="text-xs text-muted-foreground">{t('settingsUx.unsaved')}</span>}
        </div>
      </fieldset>}
      {(busy || agy.notice) && <p role="status" className="text-sm text-muted-foreground">{busy ? t('agy.working') : agy.notice === 'SAVED' ? t('agy.saved')
        : agy.notice === 'CONCURRENCY_SAVED' ? zh ? '并发设置已保存；其余未保存的修改仍保留在表单中。' : 'Concurrency limits saved. Other unsaved edits remain in the form.'
        : agy.notice === 'RECOVERY_REPAIRED' ? zh ? '恢复记录已处理；AGY 新调用已解除对应阻断。' : 'Recovery record repaired; the corresponding AGY call block is cleared.'
        : `${errorText(agy.notice!)} (${agy.notice})`}</p>}
      <p className="text-xs leading-relaxed text-muted-foreground">{t('agy.privacy')}</p>
      {state?.enabled && <Button variant="outline" onClick={() => useAppStore.getState().setCurrentView('ai')}>
        <FolderOpen size={16} className="mr-2" />{chatT('localResearch.open')}
      </Button>}
    </>}
  </section>;
}
