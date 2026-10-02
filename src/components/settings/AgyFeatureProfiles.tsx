import { RotateCcw, ShieldCheck, Save } from 'lucide-react';
import { AGY_FEATURES, type AgyDevicePrefs, type AgyDeviceState, type AgyFeature, type AgyModel, type AgyProfile } from '../../types/agy';
import { useAppStore } from '../../store/useAppStore';
import { Button } from '../ui/button';

const names: Record<AgyFeature, [string, string]> = {
  'repository-summary': ['仓库摘要', 'Repository summaries'], 'repository-details': ['仓库详情', 'Repository details'],
  organization: ['分类整理', 'Organization'], 'gist-summary': ['Gist 摘要', 'Gist summaries'],
  'release-summary': ['Release 摘要', 'Release summaries'], 'query-expansion': ['查询扩展', 'Query expansion'],
  'repository-rerank': ['仓库重排', 'Repository reranking'], 'gist-rerank': ['Gist 重排', 'Gist reranking'],
  'repository-chat': ['单仓库问答', 'Repository chat'], workbench: ['工作台研究', 'Workbench research'],
  discovery: ['发现订阅', 'Discovery subscriptions'], plugin: ['插件 AI', 'Plugin AI'], other: ['其他文本调用', 'Other text requests'],
};
const selectClass = 'h-10 w-full min-w-0 rounded-md border border-input bg-background px-2 text-sm';
export function AgyFeatureProfiles({ draft, state, models, update, test, dirty, save, valid, errorText }: {
  draft: AgyDevicePrefs; state: AgyDeviceState | null; models: AgyModel[];
  update: (patch: Partial<AgyDevicePrefs>) => void; test: (feature: AgyFeature) => void; dirty: boolean; save: () => void; valid: boolean; errorText: (code: string) => string;
}) {
  const zh = (useAppStore(store => store.language) ?? 'zh').startsWith('zh');
  const inherit = zh ? '继承全局' : 'Inherit global';
  const cliDefault = zh ? 'CLI 默认模型' : 'CLI default model';
  const patch = (feature: AgyFeature, key: keyof AgyProfile, value: string) => {
    const profile = { ...draft.featureOverrides?.[feature] };
    if (value === '__inherit') delete profile[key];
    else Object.assign(profile, { [key]: key === 'timeoutSeconds' || key === 'concurrency' ? Number(value) : value });
    update({ featureOverrides: { ...draft.featureOverrides, [feature]: profile } });
  };
  return <div className="min-w-0 space-y-2">
    <h5 className="text-sm font-semibold">{zh ? '功能独立配置' : 'Feature profiles'}</h5>
    {AGY_FEATURES.map(feature => {
      const profile = draft.featureOverrides?.[feature] ?? {};
      const effective = { ...draft, ...profile };
      const name = names[feature][zh ? 0 : 1];
      const status = state?.pool?.features[feature];
      const probe = state?.featureProbes?.[feature];
      return <details key={feature} className="min-w-0 border-b border-border py-2">
        <summary className="cursor-pointer break-words text-sm"><span className="font-medium">{name}</span>
          <span className="ml-2 text-xs text-muted-foreground">{effective.model || cliDefault} · {effective.effort} · {effective.timeoutSeconds}s · {Math.min(draft.concurrency ?? 5, effective.concurrency ?? 5)}</span>
        </summary>
        <div className="mt-3 grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="min-w-0 text-sm">{zh ? '模型' : 'Model'}
            <select aria-label={`${name} ${zh ? '模型' : 'Model'}`} className={selectClass} value={profile.model ?? '__inherit'} onChange={e => patch(feature, 'model', e.target.value)}>
              <option value="__inherit">{inherit}</option><option value="">{cliDefault}</option>
              {profile.model && !models.some(model => model.id === profile.model) && <option value={profile.model}>{profile.model}</option>}
              {models.map(model => <option key={model.id} value={model.id}>{model.label}</option>)}
            </select>
          </label>
          <label className="text-sm">effort<select aria-label={`${name} effort`} className={selectClass} value={profile.effort ?? '__inherit'} onChange={e => patch(feature, 'effort', e.target.value)}>
            <option value="__inherit">{inherit}</option>{['low', 'medium', 'high', 'max'].map(value => <option key={value}>{value}</option>)}
          </select></label>
          <label className="text-sm">{zh ? '并发上限' : 'Concurrency limit'}<select aria-label={`${name} ${zh ? '并发上限' : 'Concurrency limit'}`} className={selectClass} value={profile.concurrency ?? '__inherit'} onChange={e => patch(feature, 'concurrency', e.target.value)}>
            <option value="__inherit">{inherit}</option>{[1, 2, 3, 4, 5].map(value => <option key={value}>{value}</option>)}
          </select></label>
          <label className="text-sm">{zh ? '请求超时（秒）' : 'Request timeout (seconds)'}
            <input type="number" min={20} max={600} step={1} className={selectClass} placeholder={`${inherit}: ${draft.timeoutSeconds}`} value={profile.timeoutSeconds ?? ''}
              onChange={e => patch(feature, 'timeoutSeconds', e.target.value === '' ? '__inherit' : e.target.value)} />
          </label>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Button size="icon" variant="outline" title={zh ? '保存所有更改' : 'Save all changes'} aria-label={`${name} ${zh ? '保存所有更改' : 'Save all changes'}`} disabled={!dirty || !valid} onClick={save}><Save size={16} /></Button>
          <Button size="icon" variant="outline" title={inherit} aria-label={`${name} ${inherit}`} onClick={() => {
            const next = { ...draft.featureOverrides }; delete next[feature]; update({ featureOverrides: next });
          }}><RotateCcw size={16} /></Button>
          <Button size="sm" variant="outline" disabled={dirty || !state?.executable} onClick={() => test(feature)}><ShieldCheck size={16} className="mr-2" />{zh ? '测试已保存配置' : 'Test saved profile'}</Button>
          {probe && <span className="break-words text-xs" role="status">{probe.fingerprint === state?.executable?.fingerprint && probe.model === effective.model && probe.effort === effective.effort ? probe.code === 'SUCCESS' ? zh ? '测试成功' : 'Test passed' : errorText(probe.code) : zh ? '配置已变更，未测试' : 'Changed, not tested'}</span>}
          {status && <span className="text-xs" role="status">{zh ? '运行 / 等待' : 'Running / queued'}: {status.running} / {status.queued}</span>}
        </div>
      </details>;
    })}
  </div>;
}
