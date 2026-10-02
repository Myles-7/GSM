import type { HomeTask } from './types';
import { lookupPendingTaskRequest, readPendingTaskRequest } from './taskSubmission';

type TaskRecoveryContext = Parameters<typeof readPendingTaskRequest>[0];

/** A cached selection needs an authenticated matching receipt before confirmation. */
export async function confirmRecoveredTask(context:TaskRecoveryContext,task:HomeTask):Promise<void> {
  const pending = await readPendingTaskRequest(context);
  if (!pending || pending.requestId !== task.requestId) return;
  await lookupPendingTaskRequest(context);
}
