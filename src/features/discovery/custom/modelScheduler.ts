import { waitForRequest } from '../../../utils/requestDeadline';

interface RequestJob {
  priority: number;
  rpm: number;
  signal: AbortSignal;
  work: () => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
  abort: () => void;
}
// Screening and enrichment share one slot; queued screening always wins.
const queue: RequestJob[] = [];
let running = false;
let nextRequestAt = 0;

async function drain() {
  if (running) return;
  running = true;
  try {
    while (queue.length) {
      queue.sort((a, b) => b.priority - a.priority);
      const next = queue[0];
      try { await waitForRequest(Math.max(0, nextRequestAt - Date.now()), next.signal); }
      catch { continue; }
      // A screening request may have arrived while rate-limited.
      queue.sort((a, b) => b.priority - a.priority);
      const job = queue.shift()!;
      job.signal.removeEventListener('abort', job.abort);
      try {
        job.signal.throwIfAborted();
        nextRequestAt = Date.now() + (job.rpm > 0 ? 60000 / job.rpm : 0);
        job.resolve(await job.work());
      } catch (error) { job.reject(error); }
    }
  } finally { running = false; }
}
export function scheduleModel<T>(work: () => Promise<T>, signal: AbortSignal, rpm = 0, priority = 0, agy = false): Promise<T> {
  if (agy) {
    // AGY has a process-wide scheduler; do not serialize it a second time.
    signal.throwIfAborted();
    return work();
  }
  return new Promise<T>((resolve, reject) => {
    const job: RequestJob = {
      work, signal, rpm, priority, resolve: value => resolve(value as T), reject,
      abort: () => {
        const index = queue.indexOf(job);
        if (index >= 0) queue.splice(index, 1);
        reject(signal.reason || new DOMException('Cancelled', 'AbortError'));
      },
    };
    if (signal.aborted) { job.abort(); return; }
    signal.addEventListener('abort', job.abort, { once: true });
    queue.push(job);
    void drain();
  });
}
