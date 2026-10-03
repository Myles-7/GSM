import { inheritTaskSignal } from './taskSignals';

/** Abort the transport AND settle even when a provider ignores cancellation. */
export function withDeadline<T>(
  work: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  parent?: AbortSignal,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const controller = new AbortController();
    inheritTaskSignal(parent, controller.signal);
    let settled = false;
    const finish = (error: unknown, value?: T) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      parent?.removeEventListener('abort', abort);
      if (error) reject(error);
      else resolve(value as T);
    };
    const abort = () => {
      const reason = parent?.reason || new DOMException('Cancelled', 'AbortError');
      controller.abort(reason);
      finish(reason);
    };
    const timer = setTimeout(() => {
      const reason = new DOMException('Request deadline exceeded', 'TimeoutError');
      controller.abort(reason);
      finish(reason);
    }, timeoutMs);
    parent?.addEventListener('abort', abort, { once: true });
    if (parent?.aborted) { abort(); return; }
    Promise.resolve().then(() => {
      controller.signal.throwIfAborted();
      return work(controller.signal);
    }).then(value => finish(null, value), error => finish(error));
  });
}

export function waitForRequest(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      reject(signal?.reason || new DOMException('Cancelled', 'AbortError'));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', abort);
      resolve();
    }, Math.max(0, ms));
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
  });
}
