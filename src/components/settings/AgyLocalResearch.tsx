import { useEffect, useRef, useState } from 'react';
import { FolderOpen, Play, Square, X } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { useT } from '../../i18n/useT';
import type { AgyLocalProject } from '../../types/agy';
import type { RepositoryChatTurnResult } from '../../services/repositoryChatService';
import { researchLocalProject } from '../../services/localResearch';
import { refreshAgyDeviceState } from '../../services/agyClient';
import { AGY_CONFIG_ID, isAgyConfig } from '../../utils/aiConfig';
import MarkdownRenderer from '../MarkdownRenderer';
import { Button } from '../ui/button';

export function AgyLocalResearch() {
  const t = useT('settings');
  const [project, setProject] = useState<AgyLocalProject | null>(null);
  const [question, setQuestion] = useState('');
  const [result, setResult] = useState<RepositoryChatTurnResult | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const current = useRef<AbortController | null>(null);
  const grant = useRef<string | null>(null);
  const alive = useRef(true);
  const config = useAppStore(state => state.aiConfigs.find(item => item.id === AGY_CONFIG_ID));
  const api = window.electronAPI?.agy;
  useEffect(() => {
    alive.current = true;
    const off = useAppStore.subscribe((next, previous) => {
      if (next.user?.id !== previous.user?.id || next.githubToken !== previous.githubToken) {
        current.current?.abort();
        if (grant.current) void api?.revokeProject(grant.current);
        grant.current = null;
        setProject(null); setResult(null); setQuestion('');
      }
    });
    return () => {
      alive.current = false; current.current?.abort(); off();
      if (grant.current) void api?.revokeProject(grant.current);
    };
  }, [api]);
  const choose = async () => {
    if (!api || busy) return;
    setBusy(true); setError('');
    try {
      await refreshAgyDeviceState();
      const response = await api.chooseProject(crypto.randomUUID());
      if (!response.ok) throw new Error(response.code);
      if (!alive.current) { await api.revokeProject(response.value.id); return; }
      if (grant.current) await api.revokeProject(grant.current);
      grant.current = response.value.id;
      setProject(response.value); setResult(null);
    } catch (err) { if (alive.current) setError(err instanceof Error ? err.message : String(err)); }
    finally { if (alive.current) setBusy(false); }
  };
  const run = async () => {
    if (!project || !config || !isAgyConfig(config) || busy || !question.trim()) return;
    const controller = new AbortController();
    current.current = controller;
    setBusy(true); setResult(null); setError('');
    try {
      const answer = await researchLocalProject(project, question, config, useAppStore.getState().language, controller.signal);
      if (alive.current && !controller.signal.aborted) setResult(answer);
    } catch (err) {
      if (alive.current && !controller.signal.aborted) setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (alive.current) setBusy(false);
      if (current.current === controller) current.current = null;
    }
  };
  return <div className="min-w-0 space-y-3 border-t border-border pt-4">
    <h5 className="font-medium">{t('agy.localTitle')}</h5>
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="outline" size="sm" disabled={busy} onClick={choose}><FolderOpen size={16} className="mr-2" />{t('agy.localChoose')}</Button>
      {project && <><span className="break-all text-sm">{project.name} ({project.entries.length})</span>
        <Button variant="ghost" size="icon" title={t('agy.localRevoke')} disabled={busy} onClick={() => {
          void api?.revokeProject(project.id); grant.current = null; setProject(null); setResult(null);
        }}><X size={16} /></Button></>}
    </div>
    {project && <>
      <p className="text-xs text-muted-foreground">{t('agy.localDisclosure')}{project.truncated ? ` ${t('agy.localTruncated')}` : ''}</p>
      <details><summary className="cursor-pointer text-sm">{t('agy.localScope')}</summary>
        <pre className="max-h-48 overflow-auto whitespace-pre text-xs">{project.entries.map(item => item.path).join('\n')}</pre></details>
      <label htmlFor="agy-local-question" className="block text-sm">{t('agy.localQuestion')}</label>
      <textarea id="agy-local-question" className="min-h-24 w-full rounded-md border border-input bg-background p-3 text-sm"
        value={question} onChange={event => setQuestion(event.target.value)} disabled={busy} maxLength={12_000} />
      <Button variant="outline" onClick={run} disabled={busy || !question.trim() || !config?.isActive}>
        <Play size={16} className="mr-2" />{t('agy.localRun')}</Button>
      {busy && <Button variant="ghost" onClick={() => current.current?.abort()}><Square size={16} className="mr-2" />{t('agy.cancel')}</Button>}
    </>}
    {error && <p role="alert" className="break-words text-sm text-destructive">{error}</p>}
    {result && <div className="min-w-0 space-y-3">
      <MarkdownRenderer content={result.content} enableHtml={false} />
      <details><summary className="cursor-pointer text-sm">{t('agy.localEvidence')} ({result.evidences.length})</summary>
        {result.evidences.map(item => <div key={item.id} className="my-3 min-w-0 border-t pt-2 text-xs">
          <p className="break-all">{item.path}:{item.lineStart}-{item.lineEnd} · {item.retrievedAt}</p>
          <p className="break-all">{item.contentHash}</p>
          <pre className="max-h-48 overflow-auto whitespace-pre-wrap">{item.excerpt}</pre>
        </div>)}
      </details>
    </div>}
  </div>;
}
