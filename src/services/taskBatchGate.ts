/** Stops new batch claims; already claimed work retains its save boundary. */
export function createTaskBatchGate(onState: (state: 'pausing' | 'paused' | 'running') => void) {
    let paused = false, active = 0;
    const waiters = new Set<() => void>();
    return {
        pause() { paused = true; onState(active ? 'pausing' : 'paused'); },
        resume() { paused = false; onState('running'); for (const wake of waiters)
            wake(); },
        async enter(signal: AbortSignal) {
            while (paused) {
                signal.throwIfAborted();
                await new Promise<void>(resolve => {
                    const wake = () => { signal.removeEventListener('abort', wake); waiters.delete(wake); resolve(); };
                    waiters.add(wake);
                    signal.addEventListener('abort', wake, { once: true });
                    if (!paused || signal.aborted)
                        wake();
                });
            }
            signal.throwIfAborted();
            active++;
            let left = false;
            return () => { if (left)
                return; left = true; active--; if (paused && !active)
                onState('paused'); };
        },
    };
}
