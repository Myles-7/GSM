
import type { PersistStorage, StorageValue } from 'zustand/middleware';
import {
  getStorageEntriesStrict,
  removeLegacySnapshot,
  replaceStorageWithGeneration,
  setStorageEntriesGuarded,
} from '../../services/indexedDbStorage';
import { logger } from '../../services/logger';
import {
  PERSISTENCE_SHARD_FORMAT, PERSISTENCE_SHARD_NAMES, buildShardViews, findDirtyShards,
  generationKeyFor, metaKeyFor, shardKeyFor, resolveShardForField,
  type PersistenceShardName, type ShardMeta, type ShardPayload,
} from './shards';

const scheduleIdleTask = (callback: () => void): number => {
  if (typeof window === 'undefined') {
    return setTimeout(callback, 0) as unknown as number;
  }

  if ('requestIdleCallback' in window) {
    return window.requestIdleCallback(callback, { timeout: idleCallbackTimeoutMs });
  }

  return globalThis.setTimeout(callback, 0) as unknown as number;
};

const cancelIdleTask = (id: number): void => {
  if (typeof window !== 'undefined' && 'cancelIdleCallback' in window) {
    window.cancelIdleCallback(id);
    return;
  }

  clearTimeout(id);
};

let persistTimeoutId: ReturnType<typeof setTimeout> | null = null;
let persistIdleTaskId: number | null = null;
let latestPersistName: string | null = null;
let latestPersistValue: StorageValue<unknown> | null = null;
let persistWriteVersion = 0;
let persistFlushListenersRegistered = false;

// 分片持久化的会话内簿记：
// - lastWrittenShards 记录每个分片上次成功写入的字段引用，作为判脏基准；
// - committedShards 记录本会话已成功提交过的分片，用于判定 legacy 旧快照可以退役；
// - legacySnapshotHydrated 表示本次会话从旧版单键快照（或部分分片+旧快照兜底）水合，
//   下一次写入将强制提交全部分片，以便一次性完成迁移并退役旧键；
// - hydratedIncomplete 表示最近一次水合存在读取失败（IDB 故障/超时）。此时水合
//   结果不完整，绝不能写盘——否则会把磁盘上仍然完好的真实分片用默认值覆盖。
// 多标签页/多窗口：判脏基准仍是各标签页自己的水合快照，但持久化 generation
// 是跨标签共享的 lineage fence。clear 会在同一 IDB 事务里删除旧快照并推进 generation；
// stale tab 的后续部分写入必须在同一事务中 compare generation，发现不一致即拒绝，
// 因此不能再制造「meta 全量声明 + clear 后仅复活少数分片」的撕裂快照。
type ShardViews = Record<PersistenceShardName, Record<string, unknown>>;
let lastWrittenShards: ShardViews | null = null;
const committedShards = new Set<PersistenceShardName>();
let legacySnapshotHydrated = false;
let hydratedIncomplete = false;
let hydratedGeneration: string | null = null;
let staleGeneration = false;

// 空闲期大分片写入节流：
// - SHARD_SIZE_WARN_BYTES：大分片判定阈值（与「Large state shard serialized」日志共用），
//   按该分片上次成功写入的序列化体积判定；
// - LARGE_SHARD_IDLE_WRITE_MIN_INTERVAL_MS：同一大分片两次 idle 写入之间的最小间隔。
// 大分片的全量 stringify/写入开销显著（实测 140MB 分片单次 stringify 130-540ms），
// 空闲期被反复触发会造成持续主线程开销，故对含大分片的 idle 写入设置最小间隔。
// 节流只推迟不丢弃：冷却期内的 idle 写入请求把最新待写值保留在
// latestPersistValue/persistWriteVersion，冷却到期后合并为一次最终写入；
// flush（pagehide/visibilitychange）等非 idle 来源绕过节流立即写入。
const SHARD_SIZE_WARN_BYTES = 5 * 1024 * 1024;
// 时序参数为 let：默认值即生产行为；测试经 __setPersistTimingsForTest 注入
// 更小的值，用真实计时器确定性地验证节流时序（fake timers 与 fake-indexeddb
// 的 macrotask 交错在慢环境 CI 上不稳定）。
let largeShardIdleWriteMinIntervalMs = 60_000;
let persistDebounceMs = 1000;
let idleCallbackTimeoutMs = 3000;
const lastWrittenShardBytes = new Map<PersistenceShardName, number>();
const lastShardWriteAt = new Map<PersistenceShardName, number>();
let deferredLargeShardWriteTimerId: ReturnType<typeof setTimeout> | null = null;

/**
 * 仅供测试注入更小的时序参数（写入防抖 / 空闲回调上限 / 大分片 idle 写入最小
 * 间隔）。不改变任何语义，只缩短等待；用例结束后应恢复默认值。
 */
export function __setPersistTimingsForTest(timings: {
  debounceMs?: number;
  idleTimeoutMs?: number;
  largeShardIdleMinIntervalMs?: number;
}): void {
  if (timings.debounceMs !== undefined) persistDebounceMs = timings.debounceMs;
  if (timings.idleTimeoutMs !== undefined) idleCallbackTimeoutMs = timings.idleTimeoutMs;
  if (timings.largeShardIdleMinIntervalMs !== undefined) largeShardIdleWriteMinIntervalMs = timings.largeShardIdleMinIntervalMs;
}

const emptyShardViews = (): ShardViews => {
  const views = {} as ShardViews;
  for (const shard of PERSISTENCE_SHARD_NAMES) {
    views[shard] = {};
  }
  return views;
};

const cancelPendingPersistTasks = (): void => {
  if (persistTimeoutId) {
    clearTimeout(persistTimeoutId);
    persistTimeoutId = null;
  }

  if (persistIdleTaskId !== null) {
    cancelIdleTask(persistIdleTaskId);
    persistIdleTaskId = null;
  }

  if (deferredLargeShardWriteTimerId !== null) {
    clearTimeout(deferredLargeShardWriteTimerId);
    deferredLargeShardWriteTimerId = null;
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const validVersion = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const validGeneration = (value: unknown): value is string => typeof value === 'string' && /^[\w-]{8,100}$/.test(value);
const isGenerationConflict = (error: unknown): boolean => !!error && typeof error === 'object'
  && (error as { code?: unknown }).code === 'PERSISTENCE_GENERATION_CONFLICT';
const newGeneration = (): string => globalThis.crypto?.randomUUID?.()
  ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;

type PersistenceLockManager = {
  request<T>(name: string, options: { mode: 'exclusive' }, callback: () => Promise<T>): Promise<T>;
};

/**
 * Web Locks serialize cooperating browser tabs, including the localStorage
 * fallback path. The IndexedDB generation compare remains the correctness
 * fence when Web Locks are unavailable or a stale tab wakes after a clear.
 */
const withPersistenceMutationLock = async <T>(name: string, work: () => Promise<T>): Promise<T> => {
  const locks = typeof navigator !== 'undefined'
    ? (navigator as Navigator & { locks?: PersistenceLockManager }).locks
    : undefined;
  return locks?.request
    ? locks.request(`gsm:persistence:${name}`, { mode: 'exclusive' }, work)
    : work();
};

export class PersistenceSnapshotError extends Error {
  constructor(message: string) { super(message); this.name = 'PersistenceSnapshotError'; }
}

/** A pure, strict, single-transaction read. No hydration state or cleanup writes. */
async function readSnapshot(name: string): Promise<{ snapshot: StorageValue<unknown> | null; rewrite: boolean; generation: string | null }> {
  const generationKey = generationKeyFor(name);
  const keys = [name, metaKeyFor(name), generationKey, ...PERSISTENCE_SHARD_NAMES.map(shard => shardKeyFor(name, shard))];
  const [legacyRaw, metaRaw, generationRaw, ...rawShards] = await getStorageEntriesStrict(name, keys, { optionalKeys: [name, generationKey] });
  if (generationRaw !== null && !validGeneration(generationRaw)) throw new PersistenceSnapshotError('Invalid persistence generation');
  const generation = generationRaw;
  const exists = rawShards.some(raw => raw !== null);
  if (!exists && metaRaw === null) {
    if (legacyRaw === null) return { snapshot: null, rewrite: false, generation };
    let legacy: unknown;
    try { legacy = JSON.parse(legacyRaw); } catch { throw new PersistenceSnapshotError('Invalid legacy persisted snapshot'); }
    if (!isRecord(legacy) || !isRecord(legacy.state) || !validVersion(legacy.version)) throw new PersistenceSnapshotError('Invalid legacy persisted snapshot');
    return { snapshot: { state: legacy.state, version: legacy.version }, rewrite: true, generation };
  }
  const parts: Record<string, unknown> = {};
  let version: number | undefined;
  for (const [index, shard] of PERSISTENCE_SHARD_NAMES.entries()) {
    let payload: unknown;
    try { payload = rawShards[index] === null ? null : JSON.parse(rawShards[index]!); } catch { /* Rejected below. */ }
    if (!isRecord(payload) || payload.format !== PERSISTENCE_SHARD_FORMAT || !validVersion(payload.version) || !isRecord(payload.state)) {
      throw new PersistenceSnapshotError('Missing or invalid persistence shard: ' + shard);
    }
    if (version !== undefined && version !== payload.version) throw new PersistenceSnapshotError('Persistence shard versions disagree');
    version = payload.version;
    for (const [field, value] of Object.entries(payload.state)) {
      if (resolveShardForField(field) !== shard || Object.prototype.hasOwnProperty.call(parts, field)) throw new PersistenceSnapshotError('Persistence shard field ownership mismatch');
      parts[field] = value;
    }
  }
  let meta: unknown;
  try { meta = metaRaw === null ? null : JSON.parse(metaRaw); } catch { /* Complete shards can recover a damaged directory. */ }
  // Salvage requires ALL known shards and one semantic version. Partial salvage
  // never becomes writable, even when an old monolithic backup still exists.
  const metaShards = isRecord(meta) && Array.isArray(meta.shards) ? meta.shards : [];
  const validMeta = isRecord(meta) && meta.format === PERSISTENCE_SHARD_FORMAT && meta.version === version
    && metaShards.length === PERSISTENCE_SHARD_NAMES.length
    && new Set(metaShards).size === PERSISTENCE_SHARD_NAMES.length
    && PERSISTENCE_SHARD_NAMES.every(shard => metaShards.includes(shard));
  if (isRecord(meta) && (meta.format !== PERSISTENCE_SHARD_FORMAT || meta.version !== version)) throw new PersistenceSnapshotError('Unsupported or inconsistent persistence directory');
  return { snapshot: { state: parts, version: version! }, rewrite: !validMeta || generation === null, generation };
}

/** Hydration owns bookkeeping; failed reads freeze writes until a valid hydration. */
export const readPersistedSnapshot = async (name: string): Promise<StorageValue<unknown> | null> => {
  try {
    const { snapshot, rewrite, generation } = await readSnapshot(name);
    lastWrittenShards = snapshot ? buildShardViews(snapshot.state as Record<string, unknown>) : null;
    legacySnapshotHydrated = rewrite;
    committedShards.clear();
    hydratedIncomplete = false;
    hydratedGeneration = generation;
    staleGeneration = false;
    return snapshot;
  } catch (error) {
    hydratedIncomplete = true;
    logger.errorFromError('store.persist', 'Snapshot unreadable; hydration and writes refused', error);
    throw error;
  }
};

const writeShardedSnapshot = async (
  name: string,
  value: StorageValue<unknown>,
  writeVersion: number,
  source: 'idle' | 'flush',
  shardFilter?: ReadonlyArray<PersistenceShardName>,
): Promise<void> => {
  if (latestPersistValue === null || latestPersistName !== name || persistWriteVersion !== writeVersion) {
    return;
  }

  if (hydratedIncomplete) {
    // 最近一次水合存在读取失败：水合结果不完整，写盘会用默认值覆盖磁盘上
    // 仍然完好的真实分片。拒绝写入直到下一次完整读取成功。
    logger.errorFromError(
      'store.persist',
      'Skipping persist write: last hydration was incomplete; refusing to overwrite',
      new Error('hydrated incomplete'),
      { source },
    );
    throw new PersistenceSnapshotError('Hydration incomplete; refusing persistence write');
  }
  if (staleGeneration) {
    throw new PersistenceSnapshotError('Persistence generation changed; rehydrate before writing from this tab');
  }

  // 载荷中的 version 必须是 persist 版本号（水合时驱动 migrate），
  // writeVersion 仅用于丢弃过期的写入调度。
  const persistVersion = typeof value.version === 'number' ? value.version : 0;
  const state = (value.state ?? {}) as Record<string, unknown>;
  const views = buildShardViews(state);
  // 从旧版快照水合的会话：首次写入强制提交全部分片，完成迁移后即可退役旧键。
  let dirty = legacySnapshotHydrated
    ? [...PERSISTENCE_SHARD_NAMES]
    : findDirtyShards(views, lastWrittenShards);
  if (shardFilter) {
    const allowed = new Set(shardFilter);
    dirty = dirty.filter((shard) => allowed.has(shard));
  }
  if (source === 'idle') {
    // 写入真正执行时按最新提交时间复查冷却：派发与执行之间可能有在途写入
    // 提交（大分片冷却因此尚未结束）。被跳过的分片交还冷却到期后的派发
    // （届时读取模块级最新值），数据不会丢。
    let stillCoolingMs = 0;
    dirty = dirty.filter((shard) => {
      const remaining = cooldownRemainingMsFor(shard);
      if (remaining > stillCoolingMs) stillCoolingMs = remaining;
      return remaining === 0;
    });
    if (stillCoolingMs > 0) armDeferredLargeShardWrite(stillCoolingMs);
  }
  if (dirty.length === 0) return;

  const entries: Array<readonly [string, string]> = [];
  const serializedBytes = new Map<PersistenceShardName, number>();
  // serialized.length 是 UTF-16 码元数；含 CJK/emoji 等多字节字符时 UTF-8 字节数
  // 更大（至多 3 倍），而 UTF-8 字节数恒 ≥ 码元数。故码元数已达阈值可直接判定；
  // 低于阈值才用 TextEncoder 精确计字节数（此时上界为 3×阈值，开销有界）——
  // 避免为 140MB 级分片整串转码一份字节副本。
  const byteLengthOf = (serialized: string): number => {
    if (serialized.length >= SHARD_SIZE_WARN_BYTES) return serialized.length;
    return new TextEncoder().encode(serialized).length;
  };
  try {
    for (const shard of dirty) {
      const stringifyStartedAt = performance.now();
      const payload: ShardPayload = {
        format: PERSISTENCE_SHARD_FORMAT,
        version: persistVersion,
        state: views[shard],
      };
      const serialized = JSON.stringify(payload);
      const byteLength = byteLengthOf(serialized);
      serializedBytes.set(shard, byteLength);
      const stringifyMs = Math.round(performance.now() - stringifyStartedAt);
      if (stringifyMs > 50) {
        logger.warn('store.persist', 'Large state stringify completed', {
          source,
          shard,
          stringifyMs,
          bytes: byteLength,
        });
      } else if (byteLength > SHARD_SIZE_WARN_BYTES) {
        logger.warn('store.persist', 'Large state shard serialized', {
          source,
          shard,
          bytes: byteLength,
        });
      }
      entries.push([shardKeyFor(name, shard), serialized]);
    }
    const meta: ShardMeta = {
      format: PERSISTENCE_SHARD_FORMAT,
      version: persistVersion,
      shards: [...PERSISTENCE_SHARD_NAMES],
      savedAt: new Date().toISOString(),
    };
    entries.push([metaKeyFor(name), JSON.stringify(meta)]);
  } catch (e) {
    logger.errorFromError('store.persist', 'Failed to stringify state for persistence', e);
    throw e;
  }

  const writeStartedAt = performance.now();
  const expectedGeneration = hydratedGeneration;
  const generation = hydratedGeneration ?? newGeneration();
  entries.push([generationKeyFor(name), generation]);
  try {
    await setStorageEntriesGuarded(name, generationKeyFor(name), expectedGeneration, entries);
  } catch (error) {
    if (isGenerationConflict(error)) {
      staleGeneration = true;
      logger.errorFromError('store.persist', 'Stale tab persistence write refused after generation changed', error, {
        source,
        shards: dirty,
      });
      throw new PersistenceSnapshotError('Persistence generation changed in another tab; refusing stale write');
    }
    // 提交失败（原子回滚）：旧快照原样保留，无数据丢失，等待下次变更重试。
    logger.errorFromError('store.persist', 'Sharded persist write failed; previous snapshot kept', error, {
      source,
      shards: dirty,
    });
    throw error;
  }
  hydratedGeneration = generation;
  const writeMs = Math.round(performance.now() - writeStartedAt);
  if (writeMs > 50) {
    logger.warn('store.persist', 'Large state IndexedDB write completed', {
      source,
      shards: dirty,
      writeMs,
    });
  }

  // 即使本写入期间已有更新的调度（版本过期），磁盘上落盘的也是本批内容，
  // 判脏缓存必须如实反映磁盘状态；更新的写入排在本批之后，会以该基准重新判脏。
  const writeCompletedAt = Date.now();
  const nextCache: ShardViews = { ...(lastWrittenShards ?? emptyShardViews()) };
  for (const shard of dirty) {
    nextCache[shard] = views[shard];
    committedShards.add(shard);
    // 记录该分片的序列化体积与提交时刻，作为空闲写入节流（dispatchIdleShardedWrite）的
    // 判定基准；写入失败/被跳过的路径不会走到这里，冷却不会因失败写入而启动。
    const bytes = serializedBytes.get(shard);
    if (bytes !== undefined) lastWrittenShardBytes.set(shard, bytes);
    lastShardWriteAt.set(shard, writeCompletedAt);
  }
  lastWrittenShards = nextCache;

  // 全部分片至少成功提交一次后，旧版单键快照才可安全退役（保证可回退读取）。
  if (legacySnapshotHydrated && PERSISTENCE_SHARD_NAMES.every((shard) => committedShards.has(shard))) {
    legacySnapshotHydrated = false;
    logger.info('store.persist', 'Legacy single-key snapshot retired after sharded migration');
    await removeLegacySnapshot(name);
  }
};

let writeChain: Promise<void> = Promise.resolve();

/**
 * 串行化分片写入：判脏必须基于上一次已完成写入的缓存（lastWrittenShards）。
 * idle 写入与 flush 写入可能重叠，若并发执行，后写入者会以过期基准判脏而
 * 跳过写盘，把已撤销的状态留在磁盘上且缓存不自知。
 */
const enqueueShardedWrite = (
  name: string,
  value: StorageValue<unknown>,
  writeVersion: number,
  source: 'idle' | 'flush',
  shardFilter?: ReadonlyArray<PersistenceShardName>,
): Promise<void> => {
  const operation = writeChain.then(() => withPersistenceMutationLock(name,
    () => writeShardedSnapshot(name, value, writeVersion, source, shardFilter)));
  // Background scheduling gets a handled tail; explicit flush receives the
  // original rejection so recovery cannot report an uncommitted write as safe.
  writeChain = operation.catch((error: unknown) => {
    logger.errorFromError('store.persist', 'Persist write chain failed', error, { source });
  });
  return operation;
};

/**
 * 分片的大分片冷却剩余时间；非大分片或从未写入过返回 0（不冷却）。
 */
const cooldownRemainingMsFor = (shard: PersistenceShardName): number => {
  if ((lastWrittenShardBytes.get(shard) ?? 0) <= SHARD_SIZE_WARN_BYTES) return 0;
  const lastWriteAt = lastShardWriteAt.get(shard);
  if (lastWriteAt === undefined) return 0;
  return Math.max(0, largeShardIdleWriteMinIntervalMs - (Date.now() - lastWriteAt));
};

/** 冷却到期后重新派发（读取模块级最新值，合并为一次最终写入）。 */
const armDeferredLargeShardWrite = (remainingMs: number): void => {
  if (remainingMs <= 0) return;
  if (deferredLargeShardWriteTimerId !== null) {
    clearTimeout(deferredLargeShardWriteTimerId);
  }
  deferredLargeShardWriteTimerId = setTimeout(() => {
    deferredLargeShardWriteTimerId = null;
    dispatchIdleShardedWrite();
  }, remainingMs);
};

/**
 * idle 写入的统一派发口（含大分片节流）：
 *
 * - 先基于最新待写值计算脏分片。这只用于节流决策，权威判脏仍在
 *   writeShardedSnapshot 写入时进行；此处误判最多造成多等/少等一个冷却期，
 *   不影响落盘内容的正确性。
 * - 脏分片为空时也不能直接丢弃：写入链中可能仍有未提交的在途写入，
 *   lastWrittenShards 仍是旧基准——此时若最新值恰好等于旧基准（把状态改回
 *   旧值），按空脏早退会让该"恢复旧值"的更新被在途提交的新值覆盖丢失。
 *   照常入队，由写入链在提交时以最新基准重新判脏（确实无变化时自然跳过）。
 * - 冷却只推迟冷却中的大分片本身：脏分片按冷却分区，未冷却的（含 core 等
 *   小分片）立即入队写入，冷却中的大分片由定时器在冷却到期后重新派发。
 *   若整批推迟，小分片的变更也会被拖住最长一个冷却期，期间异常退出会丢数据。
 * - 冷却到期后重新走本函数，按最新状态重新判脏再写入——磁盘上落盘的
 *   一定是最新 scheduledVersion。
 */
const dispatchIdleShardedWrite = (): void => {
  if (latestPersistName === null || latestPersistValue === null) return;

  const views = buildShardViews((latestPersistValue.state ?? {}) as Record<string, unknown>);
  const dirty = legacySnapshotHydrated
    ? [...PERSISTENCE_SHARD_NAMES]
    : findDirtyShards(views, lastWrittenShards);
  if (dirty.length === 0) {
    void enqueueShardedWrite(latestPersistName, latestPersistValue, persistWriteVersion, 'idle').catch(() => undefined);
    return;
  }

  // 冷却只推迟冷却中的大分片本身：脏分片按冷却分区，未冷却的（含 core 等
  // 小分片）立即入队写入，冷却中的大分片由定时器在冷却到期后重新派发。
  // 若整批推迟，小分片的变更也会被拖住最长一个冷却期，期间异常退出会丢数据。
  let maxCoolingRemainingMs = 0;
  const eligible = dirty.filter((shard) => {
    const remaining = cooldownRemainingMsFor(shard);
    if (remaining > maxCoolingRemainingMs) maxCoolingRemainingMs = remaining;
    return remaining === 0;
  });
  if (eligible.length > 0) {
    void enqueueShardedWrite(latestPersistName, latestPersistValue, persistWriteVersion, 'idle', eligible).catch(() => undefined);
  }
  if (maxCoolingRemainingMs > 0) {
    armDeferredLargeShardWrite(maxCoolingRemainingMs);
  }
};

const flushPendingPersistSnapshot = (): Promise<void> => {
  if (latestPersistName === null || latestPersistValue === null) return Promise.resolve();

  cancelPendingPersistTasks();
  const name = latestPersistName;
  const value = latestPersistValue;
  const scheduledVersion = persistWriteVersion;
  return enqueueShardedWrite(name, value, scheduledVersion, 'flush');
};

const registerPersistFlushListeners = (): void => {
  if (persistFlushListenersRegistered || typeof window === 'undefined') return;
  persistFlushListenersRegistered = true;

  const flushOnExit = () => { void flushPendingPersistSnapshot().catch(() => undefined); };
  window.addEventListener('pagehide', flushOnExit);
  window.addEventListener('beforeunload', flushOnExit);

  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        flushOnExit();
      }
    });
  }
};

/**
 * 清空持久化快照，返回覆盖整条串行链的 Promise：排队中的写入先完成、随后
 * 原子删除用户快照并仅留下新的 `${name}#generation` lineage fence，最后重置
 * 判脏簿记（含删除失败路径）。
 * 删除与写盘共用同一条串行链——若清盘即重置，in-flight 写入完成后会重新填充
 * 缓存，删除后的首个写入只补写脏分片，而 meta 仍列出全部分片，重启即缺失。
 *
 * 失败语义：共享写链永不 reject（后续写入不被删除失败连坐），但返回给调用方
 * 的 Promise 在删除失败时如实 reject——「清空所有数据」流据此跳过状态重置与
 * reload，而不是把残留快照当作已删除导致数据在重启后复活。
 *
 * 注意：zustand v4 的 persist.clearStorage() 不回传 removeItem 的 Promise，
 * 需要等待删除真正落盘的调用方应直接调用并 await 本函数。
 */
const removePersistedSnapshot = (name: string): Promise<void> => {
  latestPersistName = null;
  latestPersistValue = null;
  persistWriteVersion++;
  cancelPendingPersistTasks();
  const previousGeneration = hydratedGeneration;
  const generation = newGeneration();
  const removal = writeChain
    .catch(() => undefined)
    .then(() => withPersistenceMutationLock(name,
      () => replaceStorageWithGeneration(name, generationKeyFor(name), generation, previousGeneration)));
  const reset = removal.then(() => {
      lastWrittenShards = null;
      committedShards.clear();
      legacySnapshotHydrated = false;
      hydratedIncomplete = false;
      hydratedGeneration = generation;
      staleGeneration = false;
      // 节流簿记一并重置：清盘后的首次写入不得被上一个会话的大分片冷却推迟
      lastWrittenShardBytes.clear();
      lastShardWriteAt.clear();
    });
  writeChain = reset.catch((error: unknown) => {
    logger.errorFromError('store.persist', 'Failed to remove persisted state snapshot', error);
  });
  return reset;
};

// Create a debounced storage to avoid frequent JSON.stringify calls on large state objects
// which causes V8 JIT assertion failures (EXC_BREAKPOINT) on macOS ARM64.
//
// Since the sharded layout, each flush only stringifies and rewrites the shards whose
// persisted fields actually changed (reference-dirty check) — a trivial UI change now
// costs a few KB instead of re-serializing the whole ~100MB snapshot.
//
// Idle writes that would touch a large shard (last serialized size over
// SHARD_SIZE_WARN_BYTES) are additionally throttled to at most one write per
// LARGE_SHARD_IDLE_WRITE_MIN_INTERVAL_MS; flush sources bypass the throttle
// (see dispatchIdleShardedWrite).
const debouncedPersistStorage: PersistStorage<unknown> = {
  getItem: async (name) => {
    // 每次水合重新评估读取完整性；读取失败会在 readPersistedSnapshot 内置位，
    // 使后续写入被拒绝，直到出现一次完整读取。
    hydratedIncomplete = false;
    return await readPersistedSnapshot(name);
  },
  setItem: (name: string, value: StorageValue<unknown>) => {
    registerPersistFlushListeners();
    latestPersistName = name;
    latestPersistValue = value;
    persistWriteVersion++;

    cancelPendingPersistTasks();
    persistTimeoutId = setTimeout(() => {
      persistTimeoutId = null;
      persistIdleTaskId = scheduleIdleTask(() => {
        persistIdleTaskId = null;
        // 派发口读取模块级最新值与版本号：冷却期内的多次写入在此合并，
        // 由大分片节流决定立即写入或推迟到冷却期末（见 dispatchIdleShardedWrite）。
        dispatchIdleShardedWrite();
      });
    }, persistDebounceMs);
  },
  removeItem: (name) => removePersistedSnapshot(name),
};

export { debouncedPersistStorage, flushPendingPersistSnapshot, removePersistedSnapshot };

/** Await the single full persisted snapshot API used by restore verification. */
export async function readFullPersistedSnapshot(name: string): Promise<StorageValue<unknown> | null> {
  return (await readSnapshot(name)).snapshot;
}

export async function flushAppStorePersistence(): Promise<void> {
  let version: number;
  do {
    version = persistWriteVersion;
    await flushPendingPersistSnapshot();
    await writeChain;
  } while (version !== persistWriteVersion);
}
