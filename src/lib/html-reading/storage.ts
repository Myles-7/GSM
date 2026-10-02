import { emptyReadingState, defaultSettings, settingsSchema, type ReadingSettings, type ReadingState, type ReadingSnapshot, type ReadingReturn } from './model';

export interface ReadingData { settings: ReadingSettings; states: Record<string, ReadingState>; names: Record<string, string>; applied: Record<string, string>; snapshots: Record<string, { base: Record<string, ReadingState>; allowed: ReadingSettings['operations'] }>; }
const empty = (): ReadingData => ({ settings: structuredClone(defaultSettings), states: {}, names: {}, applied: {}, snapshots: {} });
export async function readingTransaction<T>(account: string, mutate: (data: ReadingData) => T): Promise<T> {
  if (!/^\d+$/.test(account)) throw new Error('请先登录 GitHub 账户。');
  const db = await new Promise<IDBDatabase>((resolve, reject) => { const req = indexedDB.open('gsm-html-reading', 1); req.onupgradeneeded = () => req.result.createObjectStore('accounts'); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
  try { return await new Promise<T>((resolve, reject) => {
    const tx = db.transaction('accounts', 'readwrite'); let result: T; let error: unknown;
    const timeout = setTimeout(() => tx.abort(), 15000);
    tx.oncomplete = () => { clearTimeout(timeout); resolve(result); };
    tx.onabort = tx.onerror = () => { clearTimeout(timeout); reject(error ?? tx.error ?? new Error('阅读资料保存失败')); };
    const req = tx.objectStore('accounts').get(account);
    req.onsuccess = () => { try { const data = req.result as ReadingData | undefined ?? empty(); data.settings = settingsSchema.parse(data.settings); result = mutate(data); tx.objectStore('accounts').put(data, account); } catch (e) { error = e; tx.abort(); } };
  }); } finally { db.close(); }
}
export const loadReadingData = (account: string) => readingTransaction(account, data => structuredClone(data));
export const saveReadingSettings = async (account: string, settings: ReadingSettings) => { await readingTransaction(account, data => { data.settings = settingsSchema.parse(settings); }); window.dispatchEvent(new Event('gsm:html-reading-settings')); };
export function rememberSnapshot(account: string, snapshot: ReadingSnapshot) {
  return readingTransaction(account, data => {
    if (snapshot.accountId !== account) throw new Error('账户已变更，请重新生成。');
    const base: Record<string, ReadingState> = {};
    for (const section of snapshot.sections) for (const item of section.items) { base[item.id] = { ...item.state }; data.names[item.id] = item.name; }
    data.snapshots[snapshot.id] = { base, allowed: snapshot.settings.operations };
  });
}
export interface ImportRow { op: ReadingReturn['operations'][number]; name: string; status: 'ready' | 'duplicate' | 'conflict'; current: ReadingState[keyof ReadingState] }
export function inspectReadingReturn(data: ReadingData, account: string, input: ReadingReturn): ImportRow[] {
  if (input.accountId !== account) throw new Error('这份回传文件属于其他 GitHub 账户。');
  const snapshot = data.snapshots[input.snapshotId]; if (!snapshot) throw new Error('找不到原始导出快照，请在生成文件的电脑账户中导入。');
  const ids = new Set<string>(), targets = new Set<string>();
  return input.operations.map(op => {
    const base = snapshot.base[op.repoId];
    if (!base || !snapshot.allowed[op.field] || base[op.field] !== op.base) throw new Error('回传操作不匹配原始文件。');
    const valid = op.field === 'interest' ? ['neutral', 'interested', 'ignored'].includes(String(op.value)) && typeof op.value === 'string' : op.field === 'note' ? typeof op.value === 'string' : typeof op.value === 'boolean';
    const target = `${op.repoId}:${op.field}`;
    if (!valid || ids.has(op.id) || targets.has(target)) throw new Error('回传内容有非法或重复字段。'); ids.add(op.id); targets.add(target);
    const signature = JSON.stringify(op);
    if (data.applied[op.id] && data.applied[op.id] !== signature) throw new Error('操作 ID 已被不同内容使用。');
    const current = (data.states[op.repoId] ?? emptyReadingState())[op.field];
    return { op, name: data.names[op.repoId] ?? String(op.repoId), current, status: data.applied[op.id] ? 'duplicate' : current === op.base || current === op.value ? 'ready' : 'conflict' };
  });
}
export const applyReadingReturn = (account: string, input: ReadingReturn, choices: Record<string, 'phone' | 'desktop'>, expected?: ImportRow[]) => readingTransaction(account, data => {
  const rows = inspectReadingReturn(data, account, input); let applied = 0, duplicate = 0, kept = 0;
  if(expected&&rows.some(row=>row.status!=='duplicate'&&row.current!==expected.find(prior=>prior.op.id===row.op.id)?.current))throw new Error('电脑记录在预览后发生变化，请重新预览。');
  for (const row of rows) {
    if (row.status === 'duplicate') { duplicate++; continue; }
    if (row.status === 'conflict' && !choices[row.op.id]) throw new Error('请处理所有冲突后再导入。');
    if (choices[row.op.id] === 'desktop') kept++;
    else { const state = data.states[row.op.repoId] ?? emptyReadingState(); Object.assign(state, { [row.op.field]: row.op.value }); data.states[row.op.repoId] = state; applied++; }
    data.applied[row.op.id] = JSON.stringify(row.op);
  }
  return { applied, duplicate, kept };
});
