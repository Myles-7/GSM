import type { TaskContentChannel, TaskObservationEvent, TaskObservations, TaskObservedResult, TaskRequestObservation } from '../types/taskObservation';
const DB = 'gsm-task-observations-v1', PREVIEW = 1024 * 1024, EVENTS = 5000, BUDGET = 256 * 1024 * 1024, AGE = 30 * 86400000;
const listeners = new Set<() => void>(), entries = new Map<string, Entry>(), writes = new Map<string, Promise<void>>();
const remoteLoaders = new Map<string, () => void>(), remotePins = new Map<string, (pinned: boolean) => Promise<void>>(), demanded = new Set<string>();
interface Meta {
    owner: string;
    taskId: string;
    state?: string;
    endedAt?: string;
    pinned: boolean;
    protected: boolean;
    bytes: number;
    truncated: boolean;
}
interface Entry {
    owner: string;
    taskId: string;
    requests: Map<string, TaskRequestObservation>;
    events: Map<string, TaskObservationEvent>;
    results: Map<string, TaskObservedResult>;
    meta: Meta;
    metaPatch?: Partial<Meta>;
    loaded: boolean;
    loading?: Promise<void>;
    view?: TaskObservations;
    notify?: ReturnType<typeof setTimeout>;
    timer?: ReturnType<typeof setTimeout>;
    dirty: Record<'requests' | 'events' | 'results', Set<string>>;
    storageError?: string;
}
const key = (owner: string, taskId: string) => JSON.stringify([owner, taskId]);
const bytes = (value: string) => new TextEncoder().encode(value).length;
export function taskPreview(value: string, limit: number): string {
    if (bytes(value) <= limit)
        return value;
    let low = 0, high = Math.min(value.length, Math.max(0, limit));
    while (low < high) {
        const mid = Math.ceil((low + high) / 2);
        if (bytes(value.slice(0, mid)) <= limit)
            low = mid;
        else
            high = mid - 1;
    }
    if (low > 0 && /[\uD800-\uDBFF]/.test(value[low - 1]))
        low--;
    return value.slice(0, low);
}
function redact(value: string) { return value.replace(/Bearer\s+[^\s"\\]+/gi, 'Bearer [redacted]').replace(/((?:api[_-]?key|token|secret|password)["']?\s*[=:]\s*["']?)[^\s,"'}]+/gi, '$1[redacted]'); }
function cleanData(value: unknown): unknown { try {
    return JSON.parse(redact(JSON.stringify(value) ?? 'null'));
}
catch {
    return '[unavailable]';
} }
function entry(owner: string, taskId: string) { const id = key(owner, taskId); let row = entries.get(id); if (!row) {
    row = { owner, taskId, requests: new Map(), events: new Map(), results: new Map(), loaded: false, meta: { owner, taskId, pinned: false, protected: true, bytes: 0, truncated: false }, dirty: { requests: new Set(), events: new Set(), results: new Set() } };
    entries.set(id, row);
} return row; }
function emit(row: Entry, immediate = false) {
    const publish = () => { clearTimeout(row.notify); row.notify = undefined; row.view = undefined; listeners.forEach(listener => listener()); };
    if (immediate)
        publish();
    else
        row.notify ??= setTimeout(publish, 150);
}
function schedule(row: Entry, immediate = false) {
    if (immediate) {
        clearTimeout(row.timer);
        row.timer = undefined;
        void persist(row);
    }
    else
        row.timer ??= setTimeout(() => { row.timer = undefined; void persist(row); }, 1000);
}
async function open() {
    if (typeof indexedDB === 'undefined')
        throw new Error('TASK_CONTENT_STORAGE_FAILED');
    return new Promise<IDBDatabase>((resolve, reject) => {
        let settled = false;
        const timeout = setTimeout(() => { settled = true; reject(new Error('TASK_CONTENT_STORAGE_TIMEOUT')); }, 2000);
        const req = indexedDB.open(DB, 1);
        req.onupgradeneeded = () => { for (const name of ['requests', 'events', 'results', 'meta']) {
            const store = req.result.createObjectStore(name, { keyPath: name === 'meta' ? ['owner', 'taskId'] : ['owner', 'taskId', 'id'] });
            store.createIndex('task', ['owner', 'taskId']);
            store.createIndex('owner', 'owner');
        } };
        req.onsuccess = () => { clearTimeout(timeout); if (settled)
            req.result.close();
        else
            resolve(req.result); };
        req.onerror = () => { clearTimeout(timeout); reject(req.error); };
    });
}
function read<T>(db: IDBDatabase, name: string, index: string, value: IDBValidKey): Promise<T[]> { return new Promise((resolve, reject) => { const tx = db.transaction(name, 'readonly'), req = tx.objectStore(name).index(index).getAll(value); tx.oncomplete = () => resolve(req.result); tx.onerror = tx.onabort = () => reject(tx.error); }); }
async function deleteStored(db: IDBDatabase, owner: string, taskId: string) { return new Promise<void>((resolve, reject) => { const tx = db.transaction(['requests', 'events', 'results', 'meta'], 'readwrite'); for (const name of ['requests', 'events', 'results', 'meta']) {
    const store = tx.objectStore(name);
    const request = store.index('task').openCursor(IDBKeyRange.only([owner, taskId]));
    request.onsuccess = () => { const cursor = request.result; if (cursor) {
        cursor.delete();
        cursor.continue();
    } };
} tx.oncomplete = () => resolve(); tx.onerror = tx.onabort = () => reject(tx.error); }); }
async function hydrate(row: Entry): Promise<void> {
    if (row.loaded)
        return;
    if (row.loading)
        return row.loading;
    row.loading = (async () => {
        let db: IDBDatabase | undefined;
        try {
            db = await open();
            const [requests, events, results, metas] = await Promise.all([read<TaskRequestObservation & {
                    id: string;
                }>(db, 'requests', 'task', [row.owner, row.taskId]), read<TaskObservationEvent>(db, 'events', 'task', [row.owner, row.taskId]), read<TaskObservedResult>(db, 'results', 'task', [row.owner, row.taskId]), read<Meta>(db, 'meta', 'task', [row.owner, row.taskId])]);
            for (const value of requests)
                if (!row.requests.has(value.requestId))
                    row.requests.set(value.requestId, value);
            for (const value of events)
                if (!row.events.has(value.id))
                    row.events.set(value.id, value);
            for (const value of results)
                if (!row.results.has(value.id))
                    row.results.set(value.id, value);
            if (metas[0])
                row.meta = { ...metas[0], ...row.metaPatch, truncated: metas[0].truncated || row.meta.truncated };
            row.loaded = true;
        }
        catch {
            row.storageError = 'TASK_CONTENT_STORAGE_FAILED';
        }
        finally {
            db?.close();
            row.loading = undefined;
            emit(row, true);
        }
    })();
    return row.loading;
}
function forget(owner: string, taskId: string) { const row = entries.get(key(owner, taskId)); if (!row)
    return; clearTimeout(row.timer); clearTimeout(row.notify); entries.delete(key(owner, taskId)); }
function evictable(meta: Meta) { const cached = entries.get(key(meta.owner, meta.taskId)); return !meta.protected && !meta.pinned && (!cached || !cached.meta.protected && !cached.meta.pinned); }
async function persist(row: Entry) {
    const previous = writes.get(row.owner) ?? Promise.resolve();
    const work = previous.catch(() => { }).then(async () => {
        let db: IDBDatabase | undefined;
        try {
            await hydrate(row);
            if (!row.loaded)
                throw new Error('TASK_CONTENT_STORAGE_FAILED');
            db = await open();
            const metas = await read<Meta>(db, 'meta', 'owner', row.owner);
            const expired = new Set(metas.filter(meta => meta.taskId !== row.taskId && evictable(meta) && meta.endedAt && Date.parse(meta.endedAt) < Date.now() - AGE).map(meta => meta.taskId));
            for (const taskId of expired) {
                await deleteStored(db, row.owner, taskId);
                forget(row.owner, taskId);
            }
            const size = bytes(JSON.stringify([...row.requests.values()])) + bytes(JSON.stringify([...row.events.values()])) + bytes(JSON.stringify([...row.results.values()]));
            let used = metas.filter(meta => meta.taskId !== row.taskId && !expired.has(meta.taskId)).reduce((sum, meta) => sum + meta.bytes, 0);
            if (used + size > BUDGET) {
                for (const meta of metas.filter(meta => meta.taskId !== row.taskId && !expired.has(meta.taskId) && evictable(meta)).sort((a, b) => (a.endedAt ?? '').localeCompare(b.endedAt ?? ''))) {
                    await deleteStored(db, row.owner, meta.taskId);
                    forget(row.owner, meta.taskId);
                    used -= meta.bytes;
                    if (used + size <= BUDGET)
                        break;
                }
            }
            if (used + size > BUDGET)
                throw new Error('TASK_CONTENT_CACHE_FULL');
            const dirty = { requests: [...row.dirty.requests], events: [...row.dirty.events], results: [...row.dirty.results] };
            const captured: Record<'requests' | 'events' | 'results', Map<string, unknown>> = { requests: new Map(), events: new Map(), results: new Map() };
            for (const field of ['requests', 'events', 'results'] as const)
                for (const id of dirty[field])
                    captured[field].set(id, row[field].get(id));
            const requests = dirty.requests.map(id => ({ id, ...row.requests.get(id)! })), events = dirty.events.map(id => ({ owner: row.owner, taskId: row.taskId, ...row.events.get(id)! })), results = dirty.results.map(id => ({ owner: row.owner, taskId: row.taskId, ...row.results.get(id)! }));
            const meta = { ...row.meta, bytes: size };
            await new Promise<void>((resolve, reject) => { const tx = db!.transaction(['requests', 'events', 'results', 'meta'], 'readwrite'); for (const value of requests)
                tx.objectStore('requests').put(value); for (const value of events)
                tx.objectStore('events').put(value); for (const value of results)
                tx.objectStore('results').put(value); tx.objectStore('meta').put(meta); tx.oncomplete = () => resolve(); tx.onerror = tx.onabort = () => reject(tx.error); });
            // Only clear records that have not changed while the transaction was pending.
            for (const field of ['requests', 'events', 'results'] as const)
                for (const id of dirty[field]) {
                    if (row[field].get(id) === captured[field].get(id))
                        row.dirty[field].delete(id);
                }
            // A pin/state change may have queued another write while this
            // transaction was pending. Preserve it for that next transaction.
            row.meta = { ...meta, ...row.metaPatch, truncated: meta.truncated || row.meta.truncated };
            row.storageError = undefined;
        }
        catch (error) {
            row.storageError = error instanceof Error ? error.message : 'TASK_CONTENT_STORAGE_FAILED';
        }
        finally {
            db?.close();
            emit(row, true);
        }
    });
    writes.set(row.owner, work);
    await work;
}
export const taskObservability = {
    registerRemote(owner: string, taskId: string, start: () => void, pin?: (pinned: boolean) => Promise<void>) { const id = key(owner, taskId); remoteLoaders.set(id, start); if (pin)
        remotePins.set(id, pin); if (demanded.has(id) && entry(owner, taskId).loaded)
        start(); return () => { if (remoteLoaders.get(id) === start) {
        remoteLoaders.delete(id);
        remotePins.delete(id);
    } }; },
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    snapshot(owner: string, taskId: string): TaskObservations { const row = entry(owner, taskId); return row.view ??= { requests: [...row.requests.values()], events: [...row.events.values()], results: [...row.results.values()], loaded: row.loaded, truncated: row.meta.truncated, pinned: row.meta.pinned, storageError: row.storageError }; },
    async load(owner: string, taskId: string) { const id = key(owner, taskId); demanded.add(id); const row = entry(owner, taskId); await hydrate(row); if (row.loaded)
        remoteLoaders.get(id)?.(); },
    begin(input: Pick<TaskRequestObservation, 'owner' | 'taskId' | 'requestId' | 'label' | 'source' | 'mode'> & Partial<Pick<TaskRequestObservation, 'itemId' | 'model' | 'effort' | 'attempt' | 'startedAt'>>) { const row = entry(input.owner, input.taskId); if (row.requests.has(input.requestId))
        return; const at = input.startedAt ?? new Date().toISOString(); row.requests.set(input.requestId, { ...input, label: redact(input.label), attempt: input.attempt ?? 1, phase: 'queue_wait', startedAt: at, phaseStartedAt: at, lastActivityAt: at, answer: '', reasoning: '', receivedChars: 0, truncated: false }); row.dirty.requests.add(input.requestId); this.event(input.owner, input.taskId, { requestId: input.requestId, itemId: input.itemId, source: input.source, type: 'request', phase: 'queue_wait' }); },
    event(owner: string, taskId: string, input: Omit<TaskObservationEvent, 'id' | 'time'> & Partial<Pick<TaskObservationEvent, 'id' | 'time'>>) { const row = entry(owner, taskId); const id = input.id ?? (input.remoteSeq !== undefined ? `server:${input.remoteSeq}` : crypto.randomUUID()); if (row.events.has(id))
        return; if (row.events.size >= EVENTS) {
        row.meta.truncated = true;
        emit(row);
        schedule(row);
        return;
    } row.events.set(id, { ...input, id, time: input.time ?? new Date().toISOString(), message: input.message ? taskPreview(redact(input.message), 2000) : undefined }); row.dirty.events.add(id); emit(row); schedule(row); },
    phase(owner: string, taskId: string, requestId: string, phase: string, message?: string, source?: TaskRequestObservation['source']) { const row = entry(owner, taskId), request = row.requests.get(requestId); if (!request || request.endedAt)
        return; const at = new Date().toISOString(); row.requests.set(requestId, { ...request, phase, phaseStartedAt: request.phase === phase ? request.phaseStartedAt : at, lastActivityAt: at }); row.dirty.requests.add(requestId); this.event(owner, taskId, { requestId, itemId: request.itemId, source: source ?? request.source, type: 'phase', phase, message }); schedule(row, true); },
    append(owner: string, taskId: string, requestId: string, channel: TaskContentChannel, text: string) { const row = entry(owner, taskId), request = row.requests.get(requestId); if (!request || request.endedAt || !text)
        return; const at = new Date().toISOString(); const other = channel === 'answer' ? 'reasoning' : 'answer', clean = redact(request[channel] + text), bounded = taskPreview(clean, Math.max(0, PREVIEW - bytes(request[other]))); row.requests.set(requestId, { ...request, [channel]: bounded, receivedChars: request.receivedChars + text.length, firstOutputAt: request.firstOutputAt ?? at, lastOutputAt: at, lastActivityAt: at, truncated: request.truncated || bounded.length < clean.length }); row.dirty.requests.add(requestId); emit(row); schedule(row); },
    complete(owner: string, taskId: string, requestId: string, input: Pick<TaskRequestObservation, 'outcome'> & Partial<Pick<TaskRequestObservation, 'error' | 'usage'>> & {
        answer?: string;
        truncated?: boolean;
    }) { const row = entry(owner, taskId), request = row.requests.get(requestId); if (!request || request.endedAt)
        return; let answer = request.answer, truncated = request.truncated || input.truncated === true; if (input.answer !== undefined) {
        const clean = redact(input.answer);
        answer = taskPreview(clean, Math.max(0, PREVIEW - bytes(request.reasoning)));
        truncated ||= answer.length < clean.length;
    } const at = new Date().toISOString(); row.requests.set(requestId, { ...request, ...input, error: input.error ? redact(input.error) : undefined, answer, truncated, receivedChars: Math.max(request.receivedChars, input.answer?.length ?? 0), endedAt: at, lastActivityAt: at, usage: input.usage ? { ...input.usage } : request.usage }); row.dirty.requests.add(requestId); this.event(owner, taskId, { requestId, itemId: request.itemId, source: request.source, type: 'end', message: input.outcome }); schedule(row, true); emit(row, true); },
    result(owner: string, taskId: string, input: TaskObservedResult) { const row = entry(owner, taskId); const data = cleanData(input.data); const text = JSON.stringify(data); row.results.set(input.id, { ...input, label: redact(input.label), data: bytes(text) > PREVIEW ? { preview: taskPreview(text, PREVIEW), truncated: true } : data }); row.dirty.results.add(input.id); emit(row); schedule(row, true); },
    markTask(owner: string, taskId: string, input: {
        state: string;
        endedAt?: string;
        protected?: boolean;
        pinned?: boolean;
    }) { const row = entry(owner, taskId); const patch = { ...Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)), protected: input.protected ?? !input.endedAt }; const next = { ...row.meta, ...patch }; if (JSON.stringify(next) === JSON.stringify(row.meta))
        return; row.metaPatch = { ...row.metaPatch, ...patch }; row.meta = next; schedule(row, true); },
    async pin(owner: string, taskId: string, pinned: boolean) { const row = entry(owner, taskId); const remotePin = remotePins.get(key(owner, taskId)); try {
        if (remotePin)
            await remotePin(pinned);
    }
    catch {
        row.storageError = 'REMOTE_TASK_RETENTION_FAILED';
        emit(row, true);
        return false;
    } row.metaPatch = { ...row.metaPatch, pinned }; row.meta.pinned = pinned; emit(row, true); schedule(row, true); return true; },
    async flush(owner?: string, taskId?: string) { for (const row of entries.values())
        if ((!owner || row.owner === owner) && (!taskId || row.taskId === taskId)) {
            clearTimeout(row.timer);
            row.timer = undefined;
            await persist(row);
            emit(row, true);
        } if (owner)
        await writes.get(owner); },
};
if (typeof window !== 'undefined')
    window.addEventListener('pagehide', () => { void taskObservability.flush(); });
