import { useT } from '../../../i18n/useT';
import { Loader2 } from 'lucide-react';
import { Button } from '../../../components/ui/button';
import type { ExplorationTask } from './types';

interface Props {
  ownerId: string; task: ExplorationTask | null | undefined; busy: boolean;
  error: string; setupIssue?: string; message: string; preview: boolean;
  readyCount: number; model: string; elapsed: number; concurrency: number;
  activity: string; canRun: boolean; checking?: boolean; recoveryStorageFull: boolean;
  pendingCount?: number;
  onRetry: () => void; onCancel: () => void; onTasks: () => void;
  onResults?: () => void;
  onConfigure: () => void; onRefresh: () => void;
}

/** Business pages only show progress and actions; diagnostics belong to task records. */
export function ExplorationTaskStatus(props: Props) {
  const t = useT('repositories');
  const { task, busy, error, setupIssue, message } = props;
  if (!task && !busy && !error && !setupIssue && !message) return null;
  const remaining = task ? Math.max(0, task.total - task.completed) : 0;
  const needsSetup = !!setupIssue || /AGY_(DISABLED|NOT_FOUND|DESKTOP_REQUIRED|TEST_REQUIRED)/.test(error);
  const retryLabel = task?.phase === 'topics' && !remaining ? t('exploration.retry-topic-organization') : remaining ? t('exploration.continue-remaining', { count: remaining }) : t('exploration.retry-unfinished-task');
  return <section className={`explore-task-status ${busy ? 'is-running' : ''}`} aria-label={t('exploration.map-task-status')}>
    {error && !needsSetup && <p className="explore-validation-notice">{t('exploration.saved-results-preserved')}</p>}
    <div className="explore-task-status-row">
      <div className="explore-task-status-summary" role="status">
        {busy && <Loader2 size={14} className="animate-spin" />}
        <strong>{busy ? t('exploration.processing') : t('exploration.task')}</strong>{task && <span>{task.completed} / {task.total} {' '}{t('exploration.saved')}</span>}
      </div>
      <div className="explore-task-status-actions">
        {!!task?.completed && props.onResults && <Button size="sm" variant="ghost" onClick={props.onResults}>{t('exploration.view-results')}</Button>}
        {needsSetup && <><Button size="sm" variant="ghost" onClick={props.onConfigure}>{t('exploration.open-ai-settings')}</Button><Button size="sm" variant="ghost" disabled={props.checking} onClick={props.onRefresh}>{props.checking ? t('exploration.checking') : t('exploration.check-status-again')}</Button></>}
        {busy ? <Button size="sm" variant="ghost" onClick={props.onCancel}>{t('exploration.cancel-task')}</Button> : task && !needsSetup && <Button size="sm" variant="outline" disabled={!props.canRun} onClick={props.onRetry}>{retryLabel}</Button>}
        <Button size="sm" variant="ghost" onClick={props.onTasks}>{props.recoveryStorageFull ? t('exploration.open-ai-task-center') : t('exploration.task-history')}</Button>
      </div>
    </div>
  </section>;
}
