import type { aiTaskJournal } from '../services/aiTaskJournal';

type TaskHandle = ReturnType<typeof aiTaskJournal.begin>;
const signalTasks = new WeakMap<AbortSignal, TaskHandle>();
export const bindTaskSignal = (signal: AbortSignal, task: TaskHandle) => signalTasks.set(signal, task);
export const taskForSignal = (signal?: AbortSignal) => signal ? signalTasks.get(signal) : undefined;
export function inheritTaskSignal(parent: AbortSignal | undefined, child: AbortSignal) {
  const task = taskForSignal(parent);
  if (task) bindTaskSignal(child, task);
}
