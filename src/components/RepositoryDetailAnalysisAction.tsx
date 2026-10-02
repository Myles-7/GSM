import { useEffect, useId, useState } from 'react';
import { isAIConfigAvailable } from '../utils/aiConfig';
import { Sparkles, Pause, Play, Square, RotateCcw } from 'lucide-react';
import type { Repository } from '../types';
import { useAppStore } from '../store/useAppStore';
import { useT } from '../i18n/useT';
import { useRepositoryDetailAnalysisJob } from '../features/repositories/hooks/useRepositoryDetailAnalysisJob';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './ui/dialog';

type DetailJob = ReturnType<typeof useRepositoryDetailAnalysisJob>;

export function RepositoryDetailAnalysisAction({ repositories, job: externalJob, compact = false, request, hideTrigger = false }: { repositories: Repository[]; job?: DetailJob; compact?: boolean; request?: { repositories: Repository[]; accountId?: number }; hideTrigger?: boolean }) {
  const t = useT('repositories');
  const configs = useAppStore((state) => state.aiConfigs);
  const activeConfigId = useAppStore((state) => state.activeAIConfig);
  const [selectedConfigId, setSelectedConfigId] = useState<string | null>(null);
  const config = configs.find((item) => item.id === (selectedConfigId ?? activeConfigId));
  const modelSelectId = useId();
  const accountId = useAppStore((state) => state.user?.id);
  const [pending, setPending] = useState<{ repositories: Repository[]; accountId: number | undefined } | null>(null);
  useEffect(() => { setPending(null); setSelectedConfigId(null); }, [accountId]);
  useEffect(() => { if (request && request.accountId === accountId) setPending({ repositories: [...request.repositories], accountId }); }, [request, accountId]);
  const localJob = useRepositoryDetailAnalysisJob(!externalJob);
  const job = externalJob || localJob;
  const configured = isAIConfigAvailable(config);
  return <div className="flex flex-wrap items-center gap-2">
    {!hideTrigger && <Button variant="outline" size={compact ? 'icon' : 'sm'} title={t('details.analyze')} aria-label={t('details.analyze')} disabled={!repositories.length || job.running} onClick={() => setPending({ repositories: [...repositories], accountId })}>
      <Sparkles className={compact ? 'h-4 w-4' : 'mr-2 h-4 w-4'} />{!compact && t('details.analyze')}
    </Button>}
    {job.progress.total > 0 && <span role="status" className="text-xs">{job.progress.current}/{job.progress.total}</span>}
    {job.running && job.stage && <span className="max-w-48 truncate text-xs text-muted-foreground" title={job.currentRepository}>{t(`details.stage${job.stage}`)}</span>}
    {job.running && <>
      <Button variant="ghost" size="icon" title={t(job.paused ? 'details.resume' : 'details.pause')} aria-label={t(job.paused ? 'details.resume' : 'details.pause')} onClick={job.paused ? job.resume : job.pause}>
        {job.paused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
      </Button>
      <Button variant="ghost" size="icon" title={t('details.stop')} aria-label={t('details.stop')} onClick={job.stop}><Square className="h-4 w-4" /></Button>
    </>}
    {job.syncFailed && <p role="alert" className="text-sm text-destructive">{t('details.syncFailed')}</p>}
    {!!job.errors?.length && <ul role="alert" className="max-h-32 w-full overflow-auto text-xs text-destructive">
      {job.errors.map((error, index) => <li key={`${error.repository}-${index}`} className="break-words">{error.repository}: {error.message}</li>)}
    </ul>}
    {!job.running && job.failures.length > 0 && <Button variant="outline" size="sm" onClick={() => setPending({ repositories: job.failures, accountId })}>
      <RotateCcw className="mr-2 h-4 w-4" />{t('details.retry', { count: job.failures.length })}
    </Button>}
    <Dialog open={pending !== null && pending.accountId === accountId} onOpenChange={(open) => !open && setPending(null)}>
      <DialogContent aria-describedby="detail-analysis-preview">
        <DialogTitle>{t('details.analyze')}</DialogTitle>
        <label htmlFor={modelSelectId} className="text-sm font-medium">{t('details.model')}</label>
        <select id={modelSelectId} className="h-9 min-w-0 rounded-md border border-input bg-background px-2 text-sm" value={config?.id ?? ''} onChange={(event) => setSelectedConfigId(event.target.value)}>
          <option value="" disabled>{t('details.configure')}</option>
          {configs.map((item) => <option key={item.id} value={item.id}>{item.name || item.model} ({item.model})</option>)}
        </select>
        <DialogDescription id="detail-analysis-preview">{t('details.confirm', { count: pending?.repositories.length || 0, model: config?.model || t('details.unknown') })}</DialogDescription>
        <ul className="max-h-40 overflow-auto text-sm">{pending?.repositories.map((repo) => <li key={repo.id} className="break-all">{repo.full_name}</li>)}</ul>
        {!configured && <p role="alert">{t('details.configure')}</p>}
        <Button disabled={!configured || job.running || accountId === undefined} onClick={() => { const request = pending; setPending(null); if (request && request.accountId === accountId && config) void job.run(request.repositories, request.accountId, config.id); }}>{t('details.start')}</Button>
      </DialogContent>
    </Dialog>
  </div>;
}
