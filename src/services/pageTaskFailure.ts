import { aiTaskJournal, taskError, type AITaskKind, type TaskMetadata } from './aiTaskJournal';

/** Retain failures outside the business page, without creating duplicate notices on remount. */
export function retainPageTaskFailure(owner: string, kind: AITaskKind, error: string, metadata: TaskMetadata) {
  if (!owner || !error) return;
  const message = taskError(error);
  if (aiTaskJournal.snapshot().some(record => record.owner === owner && record.kind === kind && record.error === message
    && record.target?.view === metadata.target?.view && record.target?.id === metadata.target?.id)) return;
  const record = aiTaskJournal.begin(owner, kind, [], undefined, undefined, metadata);
  record.error(message);
  record.finish('failed');
}
