import type { HomeTask } from '../home/types';
import type { HomeSync } from '../home/sync';
import { taskObservability } from './taskObservability';
import type { TaskObservedResult } from '../types/taskObservation';
const liveReaders = new Map<string, AbortController>();
const terminal = (status: string) => ['completed', 'failed', 'cancelled', 'interrupted', 'paused'].includes(status);
const taskId = (sync: HomeSync, id: string) => `server:${sync.identity.workspaceId}:${id}`;
interface RemoteEvent {
    seq: number;
    type: string;
    data: Record<string, unknown>;
    createdAt?: string;
}
interface Session {
    remote: HomeTask;
    sync: HomeSync;
    id: string;
    cursor: number;
    seen: Set<number>;
    running: boolean;
    stopped: boolean;
    controller?: AbortController;
    unregister?: () => void;
    attempted?: string;
    usage: Map<string, Record<string, number>>;
    responses: Map<string, TaskObservedResult>;
}
/** The result is a validated server artifact; provider_result is only a raw response. */
export function captureRemoteTaskResult(owner: string, id: string, remote: HomeTask): void {
    if (remote.result)
        taskObservability.result(owner, id, { id: 'server:validated-result', label: 'Server result / 服务端结果', data: remote.result, commitStatus: remote.commitStatus === 'saved' || (!remote.commitStatus && remote.status === 'completed') ? 'saved' : remote.commitStatus === 'failed' ? 'failed' : 'pending' });
}
export function createRemoteTaskObserver(getSync: () => HomeSync | null, owner: string, project: (sync: HomeSync, remote: HomeTask) => unknown) {
    const sessions = new Map<string, Session>();
    let stopped = false;
    const current = (session: Session) => !stopped && !session.stopped && getSync() === session.sync && String(session.sync.identity.githubUserId) === owner;
    const query = (session: Session) => new URLSearchParams({ workspaceId: session.sync.identity.workspaceId, githubUserId: owner });
    const unavailable = (session: Session, message: string, seq?: number) => taskObservability.event(owner, session.id, { source: 'server', type: 'unavailable', message, remoteSeq: seq, id: seq === undefined ? `server:unavailable:${session.cursor}:${message}` : undefined });
    const projectSnapshot = (session: Session, remote: HomeTask) => { if (!current(session))
        return; session.remote = remote; project(session.sync, remote); captureRemoteTaskResult(owner, session.id, remote); };
    const ensureRequest = (session: Session, data: Record<string, unknown>, startedAt?: string) => {
        const requestId = typeof data.providerRequestId === 'string' ? data.providerRequestId : `legacy:${session.remote.requestId}`;
        const batch = data.batch && typeof data.batch === 'object' ? data.batch as {
            repository?: unknown;
        } : undefined;
        const itemId = typeof batch?.repository === 'string' ? batch.repository : undefined;
        taskObservability.begin({ owner, taskId: session.id, requestId, itemId, label: itemId ?? session.remote.kind, source: 'server', mode: 'stream', model: typeof data.model === 'string' ? data.model : undefined, ...(startedAt ? { startedAt } : {}) });
        return { requestId, itemId };
    };
    const apply = (session: Session, event: RemoteEvent) => {
        if (!current(session) || !Number.isSafeInteger(event.seq)) return;
        if(event.seq<=session.cursor){
            if(!session.seen.has(event.seq))unavailable(session,'Out-of-order history; earlier content was not applied / 历史乱序，较早片段未追加',event.seq);
            return;
        }
        session.seen.add(event.seq);if(session.seen.size>5000)session.seen.delete(session.seen.values().next().value!);
        session.cursor = event.seq;
        const data = event.data ?? {}, type = event.type;
        if (type === 'resync') {
            unavailable(session, data.reason === 'DIAGNOSTIC_GAP' ? 'Diagnostic history has a gap / 诊断历史存在缺口' : 'Historical stream unavailable / 历史流已不可用', event.seq);
            if (data.task && typeof data.task === 'object')
                projectSnapshot(session, data.task as HomeTask);
            if (terminal(session.remote.status))
                for (const request of taskObservability.snapshot(owner, session.id).requests)
                    if (!request.endedAt)
                        taskObservability.complete(owner, session.id, request.requestId, { outcome: session.remote.status === 'cancelled' ? 'canceled' : 'unknown' });
            return;
        }
        const hasRequest = ['provider_request', 'provider_result', 'provider_usage', 'content', 'reasoning'].includes(type);
        const request = hasRequest ? ensureRequest(session, data, event.createdAt) : undefined;
        taskObservability.event(owner, session.id, { source: 'server', type, remoteSeq: event.seq, requestId: request?.requestId, itemId: request?.itemId, time: event.createdAt, phase: typeof data.phase === 'string' ? data.phase : undefined, message: type === 'provider_request' ? 'Request sent / 请求已发送' : type === 'diagnostic_truncated' ? 'Diagnostic preview truncated / 诊断预览已截断' : typeof data.error === 'string' ? data.error : undefined });
        if (type === 'content' || type === 'reasoning') {
            if (typeof data.text === 'string')
                taskObservability.append(owner, session.id, request!.requestId, type === 'content' ? 'answer' : 'reasoning', data.text);
        }
        else if (type === 'provider_usage' && data.usage && typeof data.usage === 'object') {
            session.usage.set(request!.requestId, Object.fromEntries(Object.entries(data.usage).filter((entry): entry is [
                string,
                number
            ] => typeof entry[1] === 'number' && Number.isFinite(entry[1]))));
        }
        else if (type === 'provider_result') {
            taskObservability.complete(owner, session.id, request!.requestId, { outcome: data.outcome === 'succeeded' ? 'succeeded' : 'unknown', answer: typeof data.content === 'string' ? data.content : undefined, truncated: data.truncated === true, usage: session.usage.get(request!.requestId), error: typeof data.error === 'string' ? data.error : undefined });
            if (typeof data.content === 'string') {
                const result: TaskObservedResult = { id: `server:response:${request!.requestId}`, requestId: request!.requestId, itemId: request!.itemId, label: request!.itemId ?? 'Model response / 模型返回', data: data.content, commitStatus: 'not_started' };
                session.responses.set(request!.itemId ?? request!.requestId, result);
            }
        }
        else if (type === 'progress' && typeof data.repository === 'string' && typeof data.repositoryWrite === 'string') {
            const result = session.responses.get(data.repository);
            if (result) {
                let parsed: unknown = result.data;
                try {
                    parsed = JSON.parse(String(parsed));
                }
                catch { /* Keep readable validated text. */ }
                const saved = { ...result, data: parsed, commitStatus: data.repositoryWrite === 'conflict' ? 'conflict' as const : 'saved' as const };
                session.responses.set(data.repository, saved);
                taskObservability.result(owner, session.id, saved);
            }
        }
        else if (type === 'result') {
            session.remote = { ...session.remote, result: data, commitStatus: 'saved' };
            captureRemoteTaskResult(owner, session.id, session.remote);
        }
        else if (type === 'diagnostic_truncated')
            unavailable(session, 'Diagnostic preview truncated; some events were not retained / 诊断预览截断，部分事件未保存');
        if (type === 'state' && typeof data.status === 'string') {
            session.remote = { ...session.remote, status: data.status, pauseRequested: typeof data.pauseRequested === 'boolean' ? data.pauseRequested : session.remote.pauseRequested, phase: typeof data.phase === 'string' ? data.phase : session.remote.phase, lastSeq: Math.max(session.remote.lastSeq ?? 0, event.seq), updatedAt: event.createdAt ?? session.remote.updatedAt };
            if (typeof data.commitStatus === 'string')
                session.remote.commitStatus = data.commitStatus as HomeTask['commitStatus'];
            projectSnapshot(session, session.remote);
            if (terminal(data.status))
                for (const request of taskObservability.snapshot(owner, session.id).requests)
                    if (!request.endedAt)
                        taskObservability.complete(owner, session.id, request.requestId, { outcome: data.status === 'cancelled' ? 'canceled' : 'unknown' });
        }
    };
    const sleep = (ms: number, signal: AbortSignal) => new Promise<void>(resolve => { if (signal.aborted) {
        resolve();
        return;
    } const done = () => { clearTimeout(timer); signal.removeEventListener('abort', done); resolve(); }; const timer = setTimeout(done, ms); signal.addEventListener('abort', done, { once: true }); });
    const start = async (session: Session) => {
        if (!current(session) || session.running || typeof session.sync.api.response !== 'function')
            return;
        const version = `${session.remote.status}:${session.remote.lastSeq ?? 0}:${session.remote.updatedAt}`;
        if (terminal(session.remote.status) && session.attempted === version)
            return;
        const identity = JSON.stringify([owner, session.id]);
        if (liveReaders.has(identity))
            return;
        const controller = new AbortController();
        session.controller = controller;
        session.running = true;
        liveReaders.set(identity, controller);
        try {
            await taskObservability.load(owner, session.id);
            if (!current(session))
                return;
            const view = taskObservability.snapshot(owner, session.id);
            session.cursor = Math.max(session.cursor, ...view.events.map(e => e.remoteSeq ?? 0));
            for(const event of view.events)if(event.remoteSeq!==undefined)session.seen.add(event.remoteSeq);
            for (const request of view.requests)
                if (request.usage)
                    session.usage.set(request.requestId, request.usage);
            for (const result of view.results)
                if (result.itemId)
                    session.responses.set(result.itemId, result);
            // A reload may happen after receiving a model answer but before
            // the server confirms its save. Rebuild only the pending preview;
            // a later progress event must still confirm validation/storage.
            for (const request of view.requests) {
                if (request.outcome !== 'succeeded' || !request.itemId || session.responses.has(request.itemId)) continue;
                session.responses.set(request.itemId, {
                    id: `server:response:${request.requestId}`, requestId: request.requestId, itemId: request.itemId,
                    label: request.label, data: request.truncated ? { preview: request.answer, truncated: true } : request.answer, commitStatus: 'not_started',
                });
            }
            for (let attempt = 0; attempt < 3 && current(session) && !controller.signal.aborted; attempt++) {
                if (attempt) {
                    await sleep(500 * 2 ** (attempt - 1), controller.signal);
                    if (!current(session) || controller.signal.aborted)
                        return;
                    const remote = await session.sync.api.request<HomeTask>(`/tasks/${encodeURIComponent(session.remote.id)}?${query(session)}`, undefined, controller.signal);
                    if (!current(session))
                        return;
                    projectSnapshot(session, remote);
                    if (terminal(remote.status) && session.cursor >= (remote.lastSeq ?? Infinity))
                        break;
                }
                try {
                    const params = query(session);
                    params.set('after', String(session.cursor));
                    const response = await session.sync.api.response(`/tasks/${encodeURIComponent(session.remote.id)}/events?${params}`, undefined, controller.signal);
                    if (!current(session) || controller.signal.aborted)
                        return;
                    if (!response.body)
                        throw new Error('TASK_EVENT_STREAM_UNAVAILABLE');
                    const reader = response.body.getReader(), decoder = new TextDecoder();
                    let pending = '';
                    const abort = () => { void reader.cancel().catch(() => { }); };
                    controller.signal.addEventListener('abort', abort, { once: true });
                    try {
                        let finished = false;
                        while (!finished && current(session) && !controller.signal.aborted) {
                            const chunk = await reader.read();
                            if (!current(session) || controller.signal.aborted)
                                return;
                            if (chunk.done)
                                break;
                            pending += decoder.decode(chunk.value, { stream: true });
                            let match: RegExpExecArray | null;
                            while ((match = /\r?\n\r?\n/.exec(pending))) {
                                const frame = pending.slice(0, match.index);
                                pending = pending.slice(match.index + match[0].length);
                                if (frame.length > 4 * 1024 * 1024)
                                    throw new Error('TASK_EVENT_FRAME_TOO_LARGE');
                                const text = frame.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
                                if (!text)
                                    continue;
                                apply(session, JSON.parse(text) as RemoteEvent);
                                if (terminal(session.remote.status) && session.cursor >= (session.remote.lastSeq ?? Infinity)) {
                                    finished = true;
                                    break;
                                }
                            }
                            if (pending.length > 4 * 1024 * 1024)
                                throw new Error('TASK_EVENT_FRAME_TOO_LARGE');
                        }
                    }
                    finally {
                        controller.signal.removeEventListener('abort', abort);
                        await reader.cancel().catch(() => { });
                        reader.releaseLock();
                    }
                    if (terminal(session.remote.status))
                        break;
                }
                catch (error) {
                    if (!current(session) || controller.signal.aborted)
                        return;
                    if (attempt === 2)
                        unavailable(session, error instanceof Error ? error.message : 'Task stream unavailable / 任务流不可用');
                }
            }
            session.attempted = `${session.remote.status}:${session.remote.lastSeq ?? 0}:${session.remote.updatedAt}`;
            await taskObservability.flush(owner, session.id);
        }
        catch (error) {
            if (current(session) && !controller.signal.aborted)
                unavailable(session, error instanceof Error ? error.message : 'Task stream unavailable / 任务流不可用');
        }
        finally {
            controller.abort();
            session.running = false;
            if (liveReaders.get(identity) === controller)
                liveReaders.delete(identity);
        }
    };
    return {
        observe(remote: HomeTask) {
            const sync = getSync();
            if (stopped || !sync || String(sync.identity.githubUserId) !== owner || typeof sync.api.response !== 'function')
                return;
            const id = taskId(sync, remote.id);
            let session = sessions.get(id);
            if (session && session.sync !== sync) {
                session.stopped = true;
                session.controller?.abort();
                session.unregister?.();
                sessions.delete(id);
                session = undefined;
            }
            if (!session) {
                session = { remote, sync, id, cursor: 0, seen: new Set(), running: false, stopped: false, usage: new Map(), responses: new Map() };
                sessions.set(id, session);
                const row = session;
                session.unregister = taskObservability.registerRemote(owner, id, () => { void start(row); }, async (pinned) => { if (!current(row))
                    throw new Error('SESSION_CHANGED'); const updated = await row.sync.api.request<HomeTask>(`/tasks/${encodeURIComponent(row.remote.id)}/retain`, { ...row.sync.identity, pinned }); if (!current(row))
                    throw new Error('SESSION_CHANGED'); projectSnapshot(row, updated); });
            }
            session.remote = remote;
            captureRemoteTaskResult(owner, id, remote);
            if (!terminal(remote.status))
                void start(session);
        },
        stop() { stopped = true; for (const session of sessions.values()) {
            session.stopped = true;
            session.unregister?.();
            session.controller?.abort();
        } sessions.clear(); },
    };
}
