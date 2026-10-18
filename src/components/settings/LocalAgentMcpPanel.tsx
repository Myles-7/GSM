import { useState } from 'react';
import { Cable, Check, Copy, Eye, EyeOff, RefreshCw } from 'lucide-react';
import { useT } from '../../i18n/useT';
import { useLocalAgentMcp } from '../../features/settings/hooks/useLocalAgentMcp';
import { Button } from '../ui/button';
import { Switch } from '../ui/switch';
import { Input } from '../ui/input';

export function LocalAgentMcpPanel() {
  const t = useT('app'); const local = useLocalAgentMcp();
  const [shown, setShown] = useState(false); const [copied, setCopied] = useState(''); const [error, setError] = useState('');
  const copy = async (key: string, value: string) => {
    try { await navigator.clipboard.writeText(value); setCopied(key); setError(''); }
    catch { setError(t('mcpSettingsPanel.copy-failed')); }
  };
  return <section className="space-y-4 border-b pb-5">
    <div className="flex items-center gap-3"><Cable className="h-5 w-5 text-muted-foreground" /><h3 className="flex-1 text-base font-semibold">{t('localAgentMcp.title')}</h3><Switch checked={local.config.enabled} onCheckedChange={local.toggle} aria-label={t('localAgentMcp.title')} /></div>
    <div className="flex flex-wrap items-center gap-2 text-xs"><span className={`h-2 w-2 rounded-full ${local.status.running ? 'bg-emerald-500' : 'bg-muted-foreground'}`} /><span>{t(local.status.running ? 'mcpSettingsPanel.running' : 'mcpSettingsPanel.stopped')}</span><code className="min-w-0 flex-1 break-all">{local.url}</code><Button size="icon" variant="ghost" className="h-8 w-8" title={t('mcpSettingsPanel.refresh')} onClick={() => void local.refresh()}><RefreshCw className="h-4 w-4" /></Button><Button size="icon" variant="ghost" className="h-8 w-8" title={t('localAgentMcp.copyUrl')} onClick={() => void copy('url', local.url)}>{copied === 'url' ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}</Button></div>
    {(error || local.status.error) && <p role="alert" className="break-words text-xs text-destructive">{error || local.status.error}</p>}
    <div className="grid gap-3 sm:grid-cols-[120px_1fr]"><label className="space-y-1 text-xs text-muted-foreground">{t('mcpSettingsPanel.port')}<Input type="number" min={1} max={65535} value={local.config.port} onChange={event => { const value = Number(event.target.value); if (Number.isInteger(value) && value >= 1 && value <= 65535) local.setPort(value); }} className="h-9" /></label><label className="space-y-1 text-xs text-muted-foreground">{t('mcpSettingsPanel.access-token')}<div className="flex gap-1"><Input readOnly type={shown ? 'text' : 'password'} value={local.config.token} className="h-9 min-w-0 flex-1 font-mono text-xs" /><Button size="icon" variant="ghost" className="h-9 w-9" title={t(shown ? 'mcpSettingsPanel.hide' : 'mcpSettingsPanel.show')} onClick={() => setShown(!shown)}>{shown ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</Button><Button size="icon" variant="ghost" className="h-9 w-9" disabled={!local.config.token} title={t('mcpSettingsPanel.copy-token')} onClick={() => void copy('token', local.config.token)}><Copy className="h-4 w-4" /></Button></div></label></div>
    <details className="text-xs"><summary className="cursor-pointer font-medium">{t('localAgentMcp.codexConfig')}</summary><div className="mt-3 flex items-start gap-2"><pre className="min-w-0 flex-1 overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs">{shown ? local.codexConfig : local.codexConfig.replace(local.config.token || '<token>', '<token>')}</pre><Button size="icon" variant="outline" className="h-8 w-8 shrink-0" disabled={!local.config.token} title={t('localAgentMcp.copyConfig')} onClick={() => void copy('config', local.codexConfig)}>{copied === 'config' ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}</Button></div></details>
  </section>;
}
