import type { aiTaskJournal } from '../services/aiTaskJournal';

type TaskHandle = ReturnType<typeof aiTaskJournal.begin>;
const signalTasks = new WeakMap<AbortSignal, TaskHandle>();
const signalItems = new WeakMap<AbortSignal, string>();
export const bindTaskSignal = (signal: AbortSignal, task: TaskHandle) => signalTasks.set(signal, task);
export const taskForSignal = (signal?: AbortSignal) => signal ? signalTasks.get(signal) : undefined;
export const taskItemForSignal = (signal?: AbortSignal) => signal ? signalItems.get(signal) : undefined;
export const bindTaskItemSignal = (signal: AbortSignal, task: TaskHandle, itemId: string) => { bindTaskSignal(signal, task); signalItems.set(signal, itemId); };
export function inheritTaskSignal(parent: AbortSignal | undefined, child: AbortSignal) {
  const task = taskForSignal(parent);
  if (task) bindTaskSignal(child, task);
  const item = taskItemForSignal(parent);
  if (item) signalItems.set(child, item);
}
