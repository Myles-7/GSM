import { useEffect, useState, useSyncExternalStore } from 'react';
import type { Repository } from '../types';
import { readDetailResponseCheckpoint, subscribeDetailCheckpoints } from '../services/repositoryDetailCheckpoint';
import { Button } from './ui/button';
import { aiTaskJournal, type AITaskRecord } from '../services/aiTaskJournal';
import { agyRecoverySession, readAgyRecovery, discardAgyRecovery } from '../services/agyClient';

export function RepositoryDetailRecovery({ repository, accountId, language, running, repair, retrySave }: {
  repository: Repository; accountId: number; language: string; running: boolean;
  repair: (repository: Repository, accountId: number, response: string) => Promise<void>;
  retrySave?: (repositories: Repository[], task: AITaskRecord) => Promise<void>;
}) {
  const tasks = useSyncExternalStore(aiTaskJournal.subscribe, aiTaskJournal.snapshot);
  const task = tasks.find(task => task.owner === String(accountId) && ['details', 'discovery-analysis'].includes(task.kind)
    && task.items.some(item => item.id === String(repository.id) && item.recovery));
  const recovery = task?.items.find(item => item.id === String(repository.id))?.recovery;
  const [saving, setSaving] = useState(false);
  const [checkpoint, setCheckpoint] = useState<Awaited<ReturnType<typeof readDetailResponseCheckpoint>>>();
  const [editing, setEditing] = useState(false), [response, setResponse] = useState(''), [error, setError] = useState(false);
  const zh = language.startsWith('zh');
  useEffect(() => {
    let live = true;
    setCheckpoint(undefined); setEditing(false); setResponse(''); setError(false);
    const load = () => { void readDetailResponseCheckpoint(accountId, repository.id).then(value => {
      if (live) setCheckpoint(value?.context?.fullName === repository.full_name && value.context.language === language
        && value.context.pushedAt === (repository.pushed_at || null) ? value : undefined);
    }).catch(() => {}); };
    load(); const off = subscribeDetailCheckpoints(load);
    return () => { live = false; off(); };
  }, [accountId, repository.id, repository.full_name, repository.pushed_at, language]);
  const save = async (editedText?: string) => {
    if (!task || !recovery) return;
    setError(false); setSaving(true);
    try {
      if (editedText !== undefined) {
        const bound = await agyRecoverySession(String(accountId)); if (!bound || !recovery.digest) throw new Error('AGY_SESSION_CHANGED');
        const previous = await readAgyRecovery(String(accountId), recovery.requestId);
        const staged = await bound.api.recoveryStage(bound.session, recovery.requestId, recovery.digest,
          { ...(previous.commit as object ?? {}), editedText });
        if (!staged.ok) throw new Error(staged.code);
      }
      const selected = { ...task, items: task.items.filter(item => item.id === String(repository.id)) };
      if (task.kind === 'discovery-analysis') await (await import('../features/discovery/custom/analysis')).retryAnalysisSave(selected);
      else if (retrySave) await retrySave([repository], selected);
      else throw new Error('AGY_SAVE_RECOVERY_UNSUPPORTED');
      if (aiTaskJournal.snapshot().some(task => task.items.some(item => item.recovery?.requestId === recovery.requestId))) setError(true);
    } catch { setError(true); } finally { setSaving(false); }
  };
  if (recovery) return <div className="space-y-2 text-sm">
    <p>{zh ? '模型结果已在本机加密保留。可仅重试保存，不再调用模型。' : 'The model result is retained encrypted on this device. Retry saving without a new model call.'}</p>
    <Button size="sm" variant="outline" disabled={running || saving} onClick={() => void save()}>{zh ? '仅重试保存' : 'Retry saving only'}</Button>
    <Button size="sm" variant="outline" disabled={running || saving} onClick={() => {
      void readAgyRecovery(String(accountId), recovery.requestId).then(saved => { setResponse((saved.commit as { editedText?: string })?.editedText ?? saved.result?.text ?? ''); setEditing(true); }).catch(() => setError(true));
    }}>{zh ? '本地修复响应' : 'Repair response locally'}</Button>
    <Button size="sm" variant="ghost" disabled={running || saving} onClick={() => {
      if (window.confirm(zh ? '丢弃此结果后无法恢复，是否继续？' : 'Discard this retained result permanently?')) void discardAgyRecovery(String(accountId), recovery.requestId).catch(() => setError(true));
    }}>{zh ? '丢弃结果' : 'Discard result'}</Button>
    {editing && <><textarea className="min-h-40 w-full rounded border bg-background p-2 font-mono text-xs" value={response} maxLength={192000}
      aria-label={zh ? '本地响应 JSON' : 'Local response JSON'} disabled={running || saving} onChange={event => setResponse(event.target.value)} />
      <Button size="sm" disabled={running || saving || !response.trim()} onClick={() => void save(response)}>{zh ? '校验并保存' : 'Validate and save'}</Button></>}
    {error && <p role="alert">{zh ? '尚未保存。请查看任务中的校验、身份或存储错误，原结果仍保留。' : 'Not saved. Check the task for validation, identity or storage errors. The retained result is preserved.'}</p>}
  </div>;
  if (!checkpoint) return null;
  return <div className="space-y-2 text-sm">
    <p>{zh ? '已在本机保留未通过校验的响应（24 小时）。可编辑 JSON 后重新校验和保存，不调用模型。' : 'An invalid response is retained locally for 24 hours. Edit its JSON, then validate and save without another model call.'}</p>
    {!editing ? <Button variant="outline" size="sm" disabled={running} onClick={() => { setResponse(checkpoint.response); setEditing(true); }}>
      {zh ? '本地修复响应' : 'Repair response locally'}</Button> : <>
      <textarea className="max-h-80 min-h-40 w-full rounded border bg-background p-2 font-mono text-xs" value={response} maxLength={96000}
        aria-label={zh ? '本地响应 JSON' : 'Local response JSON'} onChange={event => setResponse(event.target.value)} disabled={running} />
      <Button size="sm" disabled={running || !response.trim()} onClick={() => {
        setError(false);
        void repair(repository, accountId, response).then(async () => {
          if (await readDetailResponseCheckpoint(accountId, repository.id)) setError(true);
        }).catch(() => setError(true));
      }}>{zh ? '校验并保存' : 'Validate and save'}</Button>
      <Button variant="ghost" size="sm" disabled={running} onClick={() => setEditing(false)}>{zh ? '关闭编辑' : 'Close editor'}</Button>
      {error && <p role="alert">{zh ? '尚未保存，请根据分析任务中的校验错误修改响应。' : 'Not saved. Correct the validation error shown in the analysis task.'}</p>}
    </>}
  </div>;
}
