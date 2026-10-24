import { z } from 'zod';
import type { ExplorationAccount } from './types';

const id = z.string().min(1).max(180);
const topic = z.object({ id, label: z.string().trim().min(1).max(100), evidenceIds: z.array(id).max(48).optional() }).strict();
const evidence = z.object({ id, kind: z.enum(['metadata', 'analysis', 'readme', 'document']), label: z.string().max(200), text: z.string().min(1).max(3000),
  url: z.string().url().refine(value => /^https?:\/\//i.test(value)).optional(), retrievedAt: z.string().max(60), verified: z.boolean() }).strict();
export const profileSchema = z.object({ repositoryId: z.number().int().positive().safe(), fingerprint: id, summary: z.string().max(1000), status: z.enum(['ready', 'insufficient']),
  topics: z.array(topic).max(8), entities: z.array(z.object({ id, label: z.string().min(1).max(120), aliases: z.array(z.string().max(120)).max(12), description: z.string().max(600) }).strict()).max(30),
  relations: z.array(z.object({ id, repositoryId: z.number().int().positive().safe(), targetType: z.enum(['topic', 'entity', 'repository']), targetId: id,
    kind: z.enum(['direct', 'interoperable', 'similar', 'discovery']), branch: z.string().min(1).max(100), reason: z.string().min(1).max(1000), evidenceIds: z.array(id).min(1).max(12), verified: z.boolean() }).strict()).max(60),
  evidence: z.array(evidence).max(100),
}).strict();
const profiles = z.record(z.string(), profileSchema).refine(rows => Object.keys(rows).length <= 1000 && Object.entries(rows).every(([key, value]) => key === String(value.repositoryId)));
const index = z.object({ version: z.literal(1), id, createdAt: z.string().max(60), model: z.string().max(300), generation: id.optional(), profiles }).strict();
const override = z.discriminatedUnion('type', [
  z.object({ id, createdAt: z.string(), type: z.literal('remove-relation'), relationId: id }).strict(),
  z.object({ id, createdAt: z.string(), type: z.literal('rename-topic'), topicId: id, label: z.string().trim().min(1).max(100) }).strict(),
  z.object({ id, createdAt: z.string(), type: z.literal('set-topics'), repositoryId: z.number().int().positive().safe(), topics: z.array(topic).max(8) }).strict(),
]);
const focus = z.discriminatedUnion('type', [
  z.object({ type: z.literal('all') }),
  z.object({ type: z.literal('group'), id, label:z.string().max(100) }),
  z.object({ type:z.literal('relation'),targetId:id,kind:z.enum(['direct','interoperable','similar','discovery']),label:z.string().max(100) }),
  z.object({ type: z.literal('topic'), id, label: z.string().max(100) }),
  z.object({ type: z.literal('entity'), id, label: z.string().max(200) }),
  z.object({ type: z.literal('search'), id, label: z.string().max(200) }),
  z.object({ type: z.literal('repository'), id: z.number().int().positive(), label: z.string().max(200) }),
  z.object({ type: z.literal('branch'), targetId: id, label: z.string().max(200), kind: z.enum(['direct','interoperable','similar','discovery']), branch: z.string().max(100) }),
]);
const snapshotRepository = z.object({ id: z.number().int().positive(), name: z.string().max(300), full_name: z.string().max(600), description: z.string().nullable(),
  html_url: z.string().url().refine(value => /^https?:\/\//i.test(value)), owner: z.object({ login: z.string(), avatar_url: z.string() }),
  stargazers_count: z.number(), forks_count: z.number(), forks: z.number(), language: z.string().nullable(), topics: z.array(z.string()),
  created_at: z.string(), updated_at: z.string(), pushed_at: z.string(), ai_summary: z.string().optional(), custom_description: z.string().optional() });
const saved = z.object({ id, name: z.string().trim().min(1).max(100), query: z.string().max(200), createdAt: z.string(), updatedAt: z.string(), model: z.string().max(300),
  layoutPositions: z.record(z.string(), z.object({x:z.number().finite(),y:z.number().finite()})).refine(value => Object.keys(value).length <= 1100).optional(),
  path: z.array(focus).min(1).max(100), scope: focus.optional(), kindFilter: z.enum(['all','direct','interoperable','similar','discovery']), camera: z.object({ zoom: z.number().positive().max(4), x: z.number().finite(), y: z.number().finite() }).optional(),
  profiles, repositories: z.array(snapshotRepository).max(1000), checked: z.record(z.string(), id), resultIds: z.array(z.number().int().positive()).max(1000), overrides: z.array(override).max(10000) }).strict();
const task = z.object({ id, type: z.enum(['build', 'query']), status: z.enum(['running', 'paused', 'interrupted', 'failed']), startedAt: z.string(), model: z.string().max(300), generation: id.optional(), query: z.string().max(200).optional(), scope: z.string().max(1000).optional(), force: z.boolean().optional(), fingerprint: id,
  completed: z.number().int().nonnegative(), total: z.number().int().min(0).max(1000), error: z.string().max(1000).optional(), draft: profiles, phase: z.enum(['profiles', 'topics']).optional(), savedId: id.optional(), journalId: id.optional(), checked: z.record(z.string(), id).optional(),
  batches: z.array(z.array(z.number().int().positive()).min(1).max(5)).max(1000).optional(),
  repairs: z.record(id, z.object({ requestId: id, parentRequestId: id.optional(), repositoryIds: z.array(z.number().int().positive()).min(1).max(5) }).strict()).optional(),
  failures: z.array(z.object({ repositoryIds: z.array(z.number().int().positive()), message: z.string().max(1000), unknown: z.boolean() })).optional() }).strict();
export const accountSchema = z.object({ version: z.literal(1), ownerId: id, revision: z.number().int().nonnegative(), index: index.nullable(), overrides: z.array(override).max(10000),
  workspaces: z.array(z.object({ version: z.literal(1), id, name: z.string().trim().min(1).max(100), createdAt: z.string(), updatedAt: z.string(), query: z.string().max(200), path: z.array(focus).min(1).max(100), kindFilter: saved.shape.kindFilter, camera: saved.shape.camera, layoutVersion:z.number().int().positive().optional(), scopeFingerprint: id.optional() }).strict()).max(100).optional(),
  saved: z.array(saved).max(100).optional(),
  queries: z.array(z.object({ id, query: z.string().min(1).max(200), scope: z.string().max(1000).optional(), fingerprint: id, createdAt: z.string(), model: z.string().max(300), generation: id.optional(), profiles }).strict()).max(20),
  task: task.nullable(), pendingTasks: z.array(task).max(20).optional(),
}).strict();
export const emptyExplorationAccount = (ownerId: string): ExplorationAccount => ({ version: 1, ownerId, revision: 0, index: null, overrides: [], queries: [], task: null });

export function validateExplorationAccount(input: unknown, ownerId: string): ExplorationAccount {
  const parsed = accountSchema.parse(input);
  if (parsed.ownerId !== ownerId) throw new Error('图谱属于其他账号，不能写入当前账号。');
  if (new Set(parsed.workspaces?.map(row => row.id)).size !== (parsed.workspaces?.length ?? 0)) throw new Error('探索工作区包含重复标识。');
  if (new Set(parsed.saved?.map(row => row.id)).size !== (parsed.saved?.length ?? 0)) throw new Error('已保存探索包含重复标识。');
  for (const row of parsed.saved ?? []) if (new Set(row.repositories.map(repo => repo.id)).size !== row.repositories.length || row.resultIds.some(key => !row.repositories.some(repo => repo.id === key))) throw new Error('探索快照的项目引用无效。');
  const collections = [parsed.index?.profiles, ...parsed.queries.map(row => row.profiles), parsed.task?.draft, ...(parsed.pendingTasks??[]).map(row=>row.draft), ...(parsed.saved ?? []).map(row => row.profiles)];
  for (const rows of collections) for (const profile of Object.values(rows ?? {})) {
    const ids = new Set(profile.evidence.map(item => item.id));
    if (ids.size !== profile.evidence.length || new Set(profile.entities.map(item => item.id)).size !== profile.entities.length || new Set(profile.topics.map(item => item.id)).size !== profile.topics.length || new Set(profile.relations.map(item => item.id)).size !== profile.relations.length) throw new Error('图谱包含重复标识。');
    if (profile.evidence.some(item => item.verified && !['readme', 'document'].includes(item.kind))) throw new Error('AI分析或元数据不能作为已核实的资料原文。');
    if (profile.topics.some(item => item.evidenceIds?.some(key => !ids.has(key)))) throw new Error('主题缺少对应的分类依据。');
    for (const relation of profile.relations) {
      if (relation.repositoryId !== profile.repositoryId || relation.evidenceIds.some(key => !ids.has(key))) throw new Error('关系缺少对应项目或证据。');
      if (relation.targetType === 'entity' && !profile.entities.some(entity => entity.id === relation.targetId) || relation.targetType === 'topic' && !profile.topics.some(item => item.id === relation.targetId)) throw new Error('关系目标不存在。');
      if (relation.verified && relation.evidenceIds.some(key => !profile.evidence.find(item => item.id === key)?.verified)) throw new Error('未核实依据不能标记为明确关系。');
      if (['direct', 'interoperable'].includes(relation.kind) && !relation.verified) throw new Error('直接关系必须经过资料核实。');
    }
  }
  return parsed;
}

async function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('gsm-project-exploration', 2);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains('accounts')) request.result.createObjectStore('accounts', { keyPath: 'ownerId' });
      if (!request.result.objectStoreNames.contains('documents')) request.result.createObjectStore('documents', { keyPath: 'id' });
    };
    request.onsuccess = () => { request.result.onversionchange = () => request.result.close(); resolve(request.result); };
    request.onerror = () => reject(request.error ?? new Error('无法打开本机图谱存储。'));
    request.onblocked = () => reject(new Error('请关闭其他正在更新图谱存储的页面后重试。'));
  });
}
export async function loadExploration(ownerId: string): Promise<ExplorationAccount> {
  const db = await openDatabase();
  try { return await new Promise((resolve, reject) => {
    const tx = db.transaction('accounts'); const request = tx.objectStore('accounts').get(ownerId);
    request.onsuccess = () => { try { resolve(request.result ? validateExplorationAccount(request.result, ownerId) : emptyExplorationAccount(ownerId)); } catch (error) { reject(error); } };
    request.onerror = () => reject(request.error);
  }); } finally { db.close(); }
}
/** All local publications and corrections use the same account-scoped transaction. */
export async function updateExploration(ownerId: string, update: (current: ExplorationAccount) => ExplorationAccount, guard: () => void = () => {}, expectedRevision?: number): Promise<ExplorationAccount> {
  guard(); const db = await openDatabase();
  try { return await new Promise((resolve, reject) => {
    const tx = db.transaction('accounts', 'readwrite'); const store = tx.objectStore('accounts'); const request = store.get(ownerId);
    let result: ExplorationAccount; let failure: unknown;
    request.onsuccess = () => {
      try {
        guard(); const current = request.result ? validateExplorationAccount(request.result, ownerId) : emptyExplorationAccount(ownerId);
        if (expectedRevision !== undefined && expectedRevision !== current.revision) throw new Error('图谱已被其他页面修改，请重新载入。');
        result = validateExplorationAccount({ ...update(structuredClone(current)), ownerId, revision: current.revision + 1 }, ownerId);
        store.put(result);
      } catch (error) { failure = error; tx.abort(); }
    };
    tx.oncomplete = () => resolve(result);
    tx.onerror = tx.onabort = () => reject(failure ?? tx.error ?? new Error('本机图谱保存失败；当前图谱未替换。'));
  }); } finally { db.close(); }
}
export function serializeExploration(account: ExplorationAccount): string {
  const content = JSON.stringify({ format: 'gsm-project-exploration', version: 1, data: { ...account, task: null, pendingTasks: undefined } }, null, 2);
  if (new TextEncoder().encode(content).byteLength > 25 * 1024 * 1024) throw new Error('探索备份超过25MB，请先移除不再需要的探索快照再导出。');
  return content;
}
export function parseExplorationBackup(content: string, ownerId: string): ExplorationAccount {
  if (content.length > 25 * 1024 * 1024) throw new Error('图谱文件超过25MB。');
  const envelope = JSON.parse(content);
  if (envelope.format !== 'gsm-project-exploration' || envelope.version !== 1) throw new Error('不支持的图谱备份格式。');
  return { ...validateExplorationAccount(envelope.data, ownerId), task: null, pendingTasks: undefined };
}

export async function readExplorationDocuments(ownerId: string, repositoryId: number, fingerprint: string): Promise<import('./types').ExplorationEvidence[] | null> {
  const db = await openDatabase();
  try { return await new Promise((resolve, reject) => {
    const request = db.transaction('documents').objectStore('documents').get(JSON.stringify([ownerId, repositoryId]));
    request.onsuccess = () => resolve(request.result?.fingerprint === fingerprint ? request.result.sources : null);
    request.onerror = () => reject(request.error);
  }); } finally { db.close(); }
}
export async function cacheExplorationDocuments(ownerId: string, repositoryId: number, fingerprint: string, sources: import('./types').ExplorationEvidence[], guard: () => void): Promise<void> {
  guard(); const db = await openDatabase();
  try { await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('documents', 'readwrite'); guard();
    tx.objectStore('documents').put({ id: JSON.stringify([ownerId, repositoryId]), fingerprint, sources });
    tx.oncomplete = () => resolve(); tx.onerror = tx.onabort = () => reject(tx.error);
  }); } finally { db.close(); }
}
