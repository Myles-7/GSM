import { returnSchema, emptyReadingState, type ReadingReturn, type ReadingPosition } from './model';
import { inspectReadingReturn, inspectReadingPositions, loadReadingData, readingTransaction, type ReadingData, type ImportRow, type ImportPositionRow } from './storage';

export interface ReadingReturnFile { name: string; input: ReadingReturn }
export interface BatchSource { fileName: string; snapshotId: string; op: ReadingReturn['operations'][number]; status: ImportRow['status'] }
export interface BatchImportRow { key: string; name: string; repoId: number; field: ReadingReturn['operations'][number]['field']; current: ImportRow['current']; status: 'ready' | 'duplicate' | 'conflict'; sources: BatchSource[] }
type ActivePosition = NonNullable<Extract<ReadingReturn, { version: 2 }>['activeView']>;
export interface BatchPositionSource { fileName: string; snapshotId: string; sequence: number; row: ImportPositionRow; value: ReadingPosition | ActivePosition }
export interface BatchPositionRow { key: string; kind: ImportPositionRow['kind']; viewId: string; name: string; viewName: string; current: string | null; status: 'ready' | 'duplicate' | 'stale' | 'conflict'; sources: BatchPositionSource[] }
export interface ReadingBatchPreview { files: ReadingReturnFile[]; rows: BatchImportRow[]; positions: BatchPositionRow[] }
export type ReadingBatchChoices = Record<string, 'desktop' | string>;
const positionValue = (value: ReadingPosition | ActivePosition) => JSON.stringify({ viewId: value.viewId, ...('repoId' in value ? { repoId: value.repoId } : {}) });
const rank = (a: { sequence: number; revision: number }, b: { sequence: number; revision: number }) => a.sequence - b.sequence || a.revision - b.revision;

export function inspectReadingReturnBatch(data: ReadingData, account: string, files: ReadingReturnFile[]): ReadingBatchPreview {
  if (!files.length || files.length > 20) throw new Error('每批请选择 1 至 20 份回传文件。');
  if (new Blob([JSON.stringify(files)]).size > 20 * 1024 * 1024) throw new Error('回传文件总计超过 20 MB，请分批导入。');
  const groups = new Map<string, BatchImportRow>(), positions = new Map<string, BatchPositionRow>();
  const ids = new Map<string, string>();
  const checkId = (id: string, signature: string) => { if (ids.has(id) && ids.get(id) !== signature) throw new Error('操作 ID 已被不同内容使用。'); ids.set(id, signature); };
  for (const file of files) {
    if (new Blob([JSON.stringify(file.input)]).size > 4_000_000) throw new Error(`回传文件 ${file.name} 超过 4 MB，请分批导出。`);
    const input = returnSchema.parse(file.input);
    for (const row of inspectReadingReturn(data, account, input)) {
      checkId(row.op.id, JSON.stringify(row.op));
      const key = `${row.op.repoId}:${row.op.field}`;
      let group = groups.get(key);
      if (!group) { group = { key, name: row.name, repoId: row.op.repoId, field: row.op.field, current: row.current, status: 'ready', sources: [] }; groups.set(key, group); }
      group.sources.push({ fileName: file.name, snapshotId: input.snapshotId, op: row.op, status: row.status });
    }
    if (input.version === 2) for (const row of inspectReadingPositions(data, account, input)) {
      const value = row.kind === 'active' ? input.activeView! : input.positions.find(value => value.id === row.id)!;
      checkId(row.id, JSON.stringify({ snapshotId: input.snapshotId, kind: row.kind, value }));
      const key = row.kind === 'active' ? 'active' : `position:${row.viewId}`;
      let group = positions.get(key);
      if (!group) { group = { key, kind: row.kind, viewId: row.viewId, name: row.name, viewName: row.viewName, current: row.current, status: 'ready', sources: [] }; positions.set(key, group); }
      group.sources.push({ fileName: file.name, snapshotId: input.snapshotId, sequence: data.snapshots[input.snapshotId].sequence!, row, value });
    }
  }
  for (const group of groups.values()) {
    const pending = group.sources.filter(source => source.status !== 'duplicate');
    group.status = !pending.length ? 'duplicate' : pending.some(source => source.status === 'conflict') || new Set(pending.map(source => JSON.stringify(source.op.value))).size > 1 ? 'conflict' : 'ready';
  }
  for (const group of positions.values()) {
    const pending = group.sources.filter(source => source.row.status !== 'duplicate');
    if (!pending.length) { group.status = 'duplicate'; continue; }
    pending.sort((a,b) => rank({ sequence: b.sequence, revision: b.value.revision }, { sequence: a.sequence, revision: a.value.revision }));
    const best = pending[0];
    const tied = pending.filter(source => source.sequence === best.sequence && source.value.revision === best.value.revision);
    const current = group.current ? JSON.parse(group.current) as ReadingPosition & { sequence: number } : null;
    const desktopRank = current ? rank({ sequence: best.sequence, revision: best.value.revision }, current) : 1;
    const conflicting = new Set(tied.map(source => positionValue(source.value))).size > 1 || desktopRank === 0 && current && positionValue(current) !== positionValue(best.value);
    group.status = desktopRank < 0 ? 'stale' : conflicting ? 'conflict' : desktopRank > 0 ? 'ready' : 'stale';
  }
  return { files: structuredClone(files), rows: [...groups.values()], positions: [...positions.values()] };
}
export async function previewReadingReturnBatch(account: string, files: ReadingReturnFile[]): Promise<ReadingBatchPreview> {
  return inspectReadingReturnBatch(await loadReadingData(account, { snapshotIds: files.map(file => file.input.snapshotId) }), account, files);
}
export const applyReadingReturnBatch = (account: string, expected: ReadingBatchPreview, choices: ReadingBatchChoices = {}) => readingTransaction(account, data => {
  const preview = inspectReadingReturnBatch(data, account, expected.files);
  if (preview.rows.some(row => row.current !== expected.rows.find(prior => prior.key === row.key)?.current) || preview.positions.some(row => row.current !== expected.positions.find(prior => prior.key === row.key)?.current)) throw new Error('电脑记录或继续阅读位置在预览后发生变化，请重新预览。');
  const results = { applied: 0, duplicate: 0, kept: 0, positionApplied: 0, positionStale: 0, positionDuplicate: 0 };
  for (const row of preview.rows) {
    const choice = choices[row.key];
    if (row.status === 'conflict' && !choice) throw new Error('请处理所有冲突后再导入。');
    if (choice && choice !== 'desktop' && !row.sources.some(source => source.op.id === choice)) throw new Error('所选修改不属于这个字段。');
    const selected = choice === 'desktop' ? undefined : choice ? row.sources.find(source => source.op.id === choice) : row.sources.find(source => source.status !== 'duplicate');
    let updated = false;
    const seen = new Set<string>();
    for (const source of row.sources) {
      if (seen.has(source.op.id) || source.status === 'duplicate') { results.duplicate++; continue; } seen.add(source.op.id);
      if (selected && source.op.value === selected.op.value) {
        if (!updated) { const state = data.states[row.repoId] ?? emptyReadingState(); Object.assign(state, { [row.field]: selected.op.value }); data.states[row.repoId] = state; results.applied++; updated = true; }
        else results.duplicate++;
      } else results.kept++;
      data.applied[source.op.id] = JSON.stringify(source.op);
    }
  }
  for (const row of preview.positions) {
    const choice = choices[row.key];
    if (row.status === 'conflict' && !choice) throw new Error('阅读位置同序号、同修订但内容不同，请明确选择。');
    if (choice && choice !== 'desktop' && !row.sources.some(source => source.value.id === choice)) throw new Error('所选阅读位置无效。');
    const candidates = row.sources.filter(source => source.row.status !== 'duplicate').sort((a,b) => rank({ sequence: b.sequence, revision: b.value.revision }, { sequence: a.sequence, revision: a.value.revision }));
    const requested = choice && choice !== 'desktop' ? row.sources.find(source => source.value.id === choice) : undefined;
    if (requested && row.status !== 'stale' && row.status !== 'duplicate' && candidates[0] && rank({ sequence: requested.sequence, revision: requested.value.revision }, { sequence: candidates[0].sequence, revision: candidates[0].value.revision }) < 0) throw new Error('请选择快照序号和修订最新的阅读位置；旧位置不能覆盖较新的回传。');
    let selected = choice === 'desktop' || row.status === 'stale' || row.status === 'duplicate' ? undefined : choice ? row.sources.find(source => source.value.id === choice) : candidates[0];
    const current = row.current ? JSON.parse(row.current) as ReadingPosition & { sequence: number } : null;
    if (selected && current && rank({ sequence: selected.sequence, revision: selected.value.revision }, current) < 0) selected = undefined;
    const seen = new Set<string>();
    for (const source of row.sources) {
      if (seen.has(source.value.id) || source.row.status === 'duplicate') { results.positionDuplicate++; continue; } seen.add(source.value.id);
      if (selected?.value.id === source.value.id) {
        const saved = { ...source.value, snapshotId: source.snapshotId, sequence: source.sequence };
        if (row.kind === 'active') data.activeView = saved;
        else Object.defineProperty(data.positions!, source.value.viewId, { value: saved, configurable: true, writable: true, enumerable: true });
        results.positionApplied++;
      } else results.positionStale++;
      data.positionReceipts![source.value.id] = JSON.stringify({ snapshotId: source.snapshotId, kind: row.kind, value: source.value });
    }
  }
  return results;
}, { snapshotIds: expected.files.map(file => file.input.snapshotId) });
