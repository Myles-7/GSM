import { HomeApi, HomeApiError } from './api';
import { HomeDatabase } from './database';
import type { Capabilities, HomeRecord, SyncView } from './types';
import { aiTaskJournal } from '../services/aiTaskJournal';

interface Page { records: HomeRecord[]; cursor: number; hasMore: boolean; snapshotId?: string; nextOffset?: number }
export class HomeSync {
  readonly db: HomeDatabase;
  private running: Promise<void> | null = null;
  private maintenance = false;
  private timer?: ReturnType<typeof setInterval>;
  private debounce?: ReturnType<typeof setTimeout>;
  private detach?: () => void;
  private stopped = false;
  private failures = 0;
  private nextAutomaticSync = 0;
  private listeners = new Set<() => void>();
  view: SyncView = { status: 'offline', pending: 0, conflicts: 0 };
  constructor(readonly api: HomeApi, readonly capabilities: Capabilities) {
    if (!capabilities.workspace) throw new Error('请先在电脑初始化家庭同步');
    this.db = new HomeDatabase(`${api.url}|${capabilities.workspace.id}`);
  }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(patch: Partial<SyncView>) { this.view = { ...this.view, ...patch }; this.listeners.forEach(listener => listener()); }
  get identity() { return { workspaceId: this.capabilities.workspace!.id, githubUserId: this.capabilities.workspace!.githubUserId }; }
  private get query() { return new URLSearchParams({ workspaceId: this.identity.workspaceId, githubUserId: String(this.identity.githubUserId) }).toString(); }
  changed() {
    if (this.stopped) return;
    this.publish({ status: 'pending' }); clearTimeout(this.debounce);
    this.debounce = setTimeout(() => { if (Date.now() >= this.nextAutomaticSync && document.visibilityState !== 'hidden') void this.sync(); }, 2000);
  }
  start() {
    this.stop();
    this.stopped = false;
    const poll = () => { if (document.visibilityState !== 'hidden' && Date.now() >= this.nextAutomaticSync) void this.sync(); };
    const wake = () => { if (document.visibilityState !== 'hidden') { this.nextAutomaticSync = 0; void this.sync(); } };
    window.addEventListener('online', wake); document.addEventListener('visibilitychange', wake);
    this.timer = setInterval(poll, 15_000); wake();
    this.detach = () => { window.removeEventListener('online', wake); document.removeEventListener('visibilitychange', wake); };
    return () => this.stop();
  }
  stop(): void {
    this.stopped = true;
    clearInterval(this.timer); clearTimeout(this.debounce);
    this.detach?.(); this.detach = undefined;
  }
  /** Wait for the exact dispatched batch to finish its receipts; never release the identity gate. */
  async drain(): Promise<void> {
    await this.running;
  }
  sync(): Promise<void> {
    if (this.running) return this.running;
    if (this.maintenance || this.stopped) return Promise.resolve();
    const execute = () => this.perform();
    this.running = (async () => {
      if (typeof navigator !== 'undefined' && navigator.locks) await navigator.locks.request(`gsm-home-sync:${this.db.namespace}`, execute);
      else await execute();
    })().finally(() => { this.running = null; });
    return this.running;
  }
  /** Restore must not race a pull response which re-marks an imported cache initialized. */
  async withLocalMaintenance<T>(work:()=>Promise<T>):Promise<T> {
    if(this.maintenance)throw new Error('本机资料正在维护，请稍后重试');
    this.maintenance=true;
    try {
      if(this.running)await this.running;
      if(typeof navigator!=='undefined'&&navigator.locks)return await navigator.locks.request(`gsm-home-sync:${this.db.namespace}`,work);
      return await work();
    } finally {this.maintenance=false;}
  }
  private async snapshot(forIdentityMaintenance = false): Promise<boolean> {
    let snapshotId = ''; let offset = 0; let more = true; let cursor = 0;
    await this.db.clearSnapshotStage();
    try {
    while (more) {
      if (this.stopped && !forIdentityMaintenance) return false;
      const page = await this.api.request<Page>(`/sync/v2/snapshot?${this.query}&limit=200&offset=${offset}${snapshotId ? `&snapshotId=${encodeURIComponent(snapshotId)}` : ''}`);
      if (this.stopped && !forIdentityMaintenance) return false;
      if(snapshotId&&snapshotId!==page.snapshotId||snapshotId&&cursor!==page.cursor)throw Error('HOME_SNAPSHOT_BOUNDARY_CHANGED');
      await this.db.stageSnapshotPage(offset,page.records);
      cursor = page.cursor; snapshotId = page.snapshotId!; offset = page.nextOffset!; more = page.hasMore;
    }
    // Only publish the complete fixed-boundary snapshot; interrupted downloads leave the old cache intact.
    await this.db.commitSnapshotStage(cursor);
    return true;
    } finally { await this.db.clearSnapshotStage(); }
  }
  async reloadSnapshotForIdentityMaintenance(): Promise<void> {
    if (await this.db.metadata('inFlight') || (await this.db.pending()).length) throw new Error('IDENTITY_UNCONFIRMED_OPERATIONS');
    await this.snapshot(true);
  }
  private async perform() {
    if (this.stopped || (typeof navigator !== 'undefined' && navigator.onLine === false)) { this.publish({ status: 'offline' }); return; }
    this.publish({ status: 'syncing', error: undefined });
    let task: ReturnType<typeof aiTaskJournal.begin> | null = null;
    const ensureTask = () => task ??= aiTaskJournal.begin(String(this.identity.githubUserId), 'sync', [{ id: 'sync', label: 'Home sync' }], undefined, undefined,
      { trigger: 'automatic', target: { view: 'settings', tab: 'backend' }, phase: 'reconciling' });
    let changed = false, failed = false;
    try {
      const initialized = await this.db.metadata('initialized');
      if (this.stopped) return;
      if (!initialized && !await this.snapshot()) return;
      if (!initialized) changed = true;
      let more = true;
      while (more && !this.stopped) {
        const cursor = await this.db.metadata<number>('cursor') ?? 0;
        if (this.stopped) return;
        let page: Page;
        try { page = await this.api.request<Page>(`/sync/v2/changes?${this.query}&cursor=${cursor}&limit=200`); }
        catch (error) {
          if (error instanceof HomeApiError && ['CURSOR_EXPIRED', 'CURSOR_TOO_OLD'].includes(error.code)) { if (!await this.snapshot()) return; continue; }
          throw error;
        }
        if (this.stopped) return;
        const applied = await this.db.applyRemote(page.records, page.cursor); changed ||= applied > 0; more = page.hasMore;
      }
      // Bound one turn while draining edits made during a request. Immutable in-flight batches
      // survive reload/network loss independently of the editable latest local version.
      let repaired = false;
      for (let batchIndex = 0; batchIndex < 100 && !this.stopped; batchIndex++) {
        const batch = await this.db.nextBatch();
        const { clientId, operations } = batch;
        if (this.stopped) return;
        if (!operations.length) break;
        changed = true;
        let response: { results: Array<{ opId: string; status: string; record?: HomeRecord; conflict?: { current: HomeRecord | null; reason?: string } }> };
        try { response = await this.api.request('/sync/v2/operations', { ...this.identity, clientId, operations }); }
        catch (error) {
          if (!this.stopped && !repaired && error instanceof HomeApiError && await this.db.repairRejectedRepositoryBatch(batch, error)) {
            repaired = true; continue;
          }
          throw error;
        }
        if (response.results.length !== operations.length || operations.some(op => !response.results.some(item => item.opId === op.opId))) throw new Error('服务器返回不完整的操作确认；稍后将安全重试');
        for (const item of response.results) {
          const sent = operations.find(op => op.opId === item.opId);
          if (!sent) continue;
          if (item.status === 'applied' && item.record) await this.db.acknowledge(sent, item.record);
          else await this.db.reject(sent, item.conflict?.current ?? null, item.conflict?.reason ?? item.status);
        }
        await this.db.finishBatch(operations);
      }
      if (this.stopped) return;
      const remaining = await this.db.pending(); const conflicts = remaining.filter(item => item.conflict !== undefined || item.rejected).length;
      const lastSync = new Date().toISOString(); await this.db.setMetadata('lastSync', lastSync);
      this.failures = 0; this.nextAutomaticSync = 0;
      await this.db.setMetadata('dataFailureTask', null);
      this.publish({ status: conflicts ? 'conflict' : remaining.length ? 'pending' : 'synced', pending: remaining.length, conflicts, lastSync });
      if (conflicts || remaining.length || changed) {
        const currentTask = ensureTask();
        currentTask.item('sync', conflicts ? 'failed' : 'complete', conflicts ? `${conflicts} sync conflicts require review` : undefined);
      }
    } catch (error) {
      failed = true;
      const deterministic = error instanceof HomeApiError && error.status === 400 && error.code === 'PRIVATE_DATA_NOT_SYNCABLE';
      if (deterministic) await aiTaskJournal.load(String(this.identity.githubUserId));
      const previousId = deterministic ? await this.db.metadata<string>('dataFailureTask') : undefined;
      const previous = aiTaskJournal.snapshot().find(record => record.id === previousId && record.owner === String(this.identity.githubUserId)
        && record.kind === 'sync' && record.state === 'failed' && !record.archived);
      if (previous) aiTaskJournal.patch(previous.id, { usage: { ...previous.usage, occurrences: (previous.usage?.occurrences ?? 1) + 1 }, endedAt: new Date().toISOString() });
      else {
        const currentTask = ensureTask();
        currentTask.metadata({ failureCode: deterministic ? error.code : 'HOME_SYNC_FAILED' });
        currentTask.item('sync', 'failed', error);
        if (deterministic) await this.db.setMetadata('dataFailureTask', currentTask.id);
      }
      const unauthorized = error instanceof HomeApiError && [401, 403].includes(error.status);
      this.failures += 1;
      this.nextAutomaticSync = unauthorized ? Infinity : Date.now() + Math.min(300_000, 15_000 * 2 ** Math.min(this.failures - 1, 5));
      this.publish({ status: unauthorized ? 'auth-required' : error instanceof TypeError ? 'offline' : 'error', error: error instanceof Error ? error.message : '同步失败' });
    } finally {
      if (task) task.finish(this.stopped ? 'interrupted' : undefined);
      if (!this.stopped) aiTaskJournal.noteActivity(String(this.identity.githubUserId), { changed, failed: failed || this.view.status === 'conflict', noChange: !changed && !failed && this.view.status === 'synced', lastError: this.view.error });
    }
  }
}
