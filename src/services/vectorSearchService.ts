/**
 * 向量语义搜索服务
 *
 * 1. EmbeddingClient — 调用用户配置的 Embedding API 生成向量
 * 2. VectorSearchService — 与 Cloudflare Worker 通信（存/查/删向量）
 */

import type { EmbeddingConfig, VectorSearchConfig, Repository, VectorIndexMode } from '../types';
import { withDeadline } from '../utils/requestDeadline';
import { NO_LICENSE_SENTINEL, normalizeLicense } from '../utils/licenseFilter';
import {
  EMBEDDING_FORMAT_VERSION, VECTOR_PROTOCOL_VERSION, hashVectorContent,
  requireCompatibleVectorIndex, vectorScope,
  VectorIndexCompatibilityError,
  type VectorIndexGeneration, type VectorIndexScope,
} from './vectorIndexIdentity';
export { EMBEDDING_FORMAT_VERSION } from './vectorIndexIdentity';
import type { RepositoryIdentityMapping } from '../utils/repositoryIdentity';
import { validateParticipantMappings } from './repositoryIdentityParticipants';
import {
  equalRepositoryIdentityVectors, migratedRepositoryIdentityVector, validateVectorRepositoryIdentityBackup,
  vectorRepositoryIdentityIds, assertRestorableRepositoryIdentitySnapshot,
  type RemoteRepositoryIdentityVector, type VectorRepositoryIdentityBackup,
} from './vectorRepositoryIdentityStorage';
export type { VectorRepositoryIdentityBackup, RemoteRepositoryIdentityVector } from './vectorRepositoryIdentityStorage';

// ============================================================
// EmbeddingClient
// ============================================================

export class EmbeddingClient {
  constructor(private config: EmbeddingConfig) {}

  /**
   * 批量生成 embedding 向量
   * @param purpose 'document' 用于索引, 'query' 用于搜索查询
   */
  async embed(texts: string[], purpose: 'document' | 'query' = 'document', signal?: AbortSignal): Promise<number[][]> {
    return withDeadline(requestSignal => this.embedWithinDeadline(texts, purpose, requestSignal), purpose === 'query' ? 30_000 : 120_000, signal);
  }

  private async embedWithinDeadline(texts: string[], purpose: 'document' | 'query', signal: AbortSignal): Promise<number[][]> {
    switch (this.config.apiType) {
      case 'openai':
      case 'openai-compatible':
      case 'siliconflow':
        return this.embedOpenAICompatible(texts, signal);
      case 'ollama':
        return this.embedOllama(texts, signal);
      case 'gemini':
        return this.embedGemini(texts, purpose, signal);
      case 'cohere':
        return this.embedCohere(texts, purpose, signal);
      default:
        throw new Error(`Unsupported embedding API type: ${this.config.apiType}`);
    }
  }

  /**
   * 测试连接：发送单条文本，验证返回向量维度
   */
  async testConnection(signal?: AbortSignal): Promise<{ success: boolean; dimensions: number; error?: string }> {
    try {
      const vectors = await withDeadline(requestSignal => this.embed(['hello'], 'query', requestSignal), 10_000, signal);
      if (!vectors || vectors.length === 0 || !Array.isArray(vectors[0])) {
        return { success: false, dimensions: 0, error: 'Invalid response format' };
      }
      return { success: true, dimensions: vectors[0].length };
    } catch (error) {
      return {
        success: false,
        dimensions: 0,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // ----------------------------------------------------------
  // OpenAI / OpenAI-compatible
  // POST /v1/embeddings  or  custom URL
  // ----------------------------------------------------------
  private async embedOpenAICompatible(texts: string[], signal?: AbortSignal): Promise<number[][]> {
    const url =
      this.config.apiType === 'openai' || this.config.apiType === 'siliconflow'
        ? `${this.config.baseUrl.replace(/\/+$/, '')}/v1/embeddings`
        : this.config.baseUrl;

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.config.apiKey) {
      headers['Authorization'] = `Bearer ${this.config.apiKey}`;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ model: this.config.model, input: texts }),
      signal,
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(`Embedding API error ${response.status}: ${errText}`);
    }

    const data = await response.json();
    // OpenAI 格式: { data: [{ embedding: [...], index: 0 }] }
    return data.data
      .sort((a: { index: number }, b: { index: number }) => a.index - b.index)
      .map((d: { embedding: number[] }) => d.embedding);
  }

  // ----------------------------------------------------------
  // Ollama 本地模型
  // POST /api/embed
  // ----------------------------------------------------------
  private async embedOllama(texts: string[], signal?: AbortSignal): Promise<number[][]> {
    const url = `${this.config.baseUrl.replace(/\/+$/, '')}/api/embed`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.config.model, input: texts }),
      signal,
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(`Ollama API error ${response.status}: ${errText}`);
    }

    const data = await response.json();
    // Ollama 格式: { embeddings: [[...], [...]] }
    return data.embeddings;
  }

  // ----------------------------------------------------------
  // Google Gemini
  // POST /v1beta/models/{model}:batchEmbedContents
  // ----------------------------------------------------------
  private async embedGemini(texts: string[], purpose: 'document' | 'query' = 'document', signal?: AbortSignal): Promise<number[][]> {
    const baseUrl = this.config.baseUrl.replace(/\/+$/, '');
    const url = `${baseUrl}/v1beta/models/${this.config.model}:batchEmbedContents?key=${this.config.apiKey}`;
    const taskType = purpose === 'query' ? 'RETRIEVAL_QUERY' : 'RETRIEVAL_DOCUMENT';

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requests: texts.map((text) => ({
          model: `models/${this.config.model}`,
          content: { parts: [{ text }] },
          taskType,
        })),
      }),
      signal,
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(`Gemini API error ${response.status}: ${errText}`);
    }

    const data = await response.json();
    return data.embeddings.map((e: { values: number[] }) => e.values);
  }

  // ----------------------------------------------------------
  // Cohere
  // POST /v1/embed
  // ----------------------------------------------------------
  private async embedCohere(texts: string[], purpose: 'document' | 'query' = 'document', signal?: AbortSignal): Promise<number[][]> {
    const url = `${this.config.baseUrl.replace(/\/+$/, '')}/v1/embed`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({
        model: this.config.model,
        texts,
        input_type: purpose === 'query' ? 'search_query' : 'search_document',
      }),
      signal,
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(`Cohere API error ${response.status}: ${errText}`);
    }

    const data = await response.json();
    return data.embeddings;
  }
}

// ============================================================
// VectorSearchService — 与 Cloudflare Worker 通信
// ============================================================

// Vectorize V2 限制：returnMetadata 返回 metadata 时 topK 上限为 50。
// Worker /query 同样以 50 为 clamp 上限，此处保持一致，避免请求被静默截断。
export const VECTORIZE_QUERY_TOPK_LIMIT = 50;

export interface VectorizeVector {
  id: string;
  values: number[];
  metadata: {
    content_hash?: string;
    identity_hash?: string;
    full_name: string;
    description: string;
    language: string;
    stars: number;
    tags: string[];
    // 可选：此 PR 之前（embedding v2）索引的向量不含 license 键，重索引前以 undefined 出现。
    // indexAllRepos 写入时会填入字符串；消费方请按可选处理。
    license?: string;
  };
}

export interface VectorQueryResult {
  id: string;
  score: number;
  metadata: {
    identity_hash?: string;
    full_name: string;
    description: string;
    language: string;
    stars: number;
    tags: string[];
    // 同上：旧向量查询返回时缺该键，按可选处理。
    license?: string;
  };
}

export interface VectorizeStatus {
  vectorCount: number;
  dimensions: number;
  indexName?: string;
  protocolVersion?: number;
  identityStorage?: boolean;
  identityRestoreCheck?: boolean;
}

type VectorSearchServiceConfig = Pick<VectorSearchConfig, 'workerUrl' | 'authToken'> & Partial<VectorSearchConfig>;

export class VectorSearchService {
  private workerUrl: string;
  private authToken: string;
  private scope?: VectorIndexScope;
  private lastMutationId?: string;
  private queryReady?: Promise<void>;

  constructor(private config: VectorSearchServiceConfig, private embedding?: EmbeddingConfig, generation?: VectorIndexGeneration) {
    this.workerUrl = config.workerUrl.replace(/\/+$/, '');
    this.authToken = config.authToken;
    this.scope = generation ? vectorScope(generation) : undefined;
  }

  async checkCapabilities(dimensions: number, signal?: AbortSignal): Promise<void> {
    const status = await this.getStatus(signal);
    if (status.protocolVersion !== VECTOR_PROTOCOL_VERSION) {
      throw new VectorIndexCompatibilityError('Update the Vectorize Worker before rebuilding or querying the index (identity protocol v2 required).');
    }
    if (status.dimensions !== dimensions) {
      throw new VectorIndexCompatibilityError('Embedding dimensions do not match the Worker index. Use a compatible index target; the old generation is retained.');
    }
  }

  async prepareQuery(signal?: AbortSignal): Promise<void> {
    if (!this.queryReady) {
      this.queryReady = (async () => {
        if (!this.embedding) throw new Error('Embedding identity required. Rebuild the vector index.');
        const active = await requireCompatibleVectorIndex(this.embedding, this.config as VectorSearchConfig);
        await this.checkCapabilities(active.identity.dimensions, signal);
        this.scope = vectorScope(active);
      })();
    }
    return this.queryReady;
  }

  private requireScope(): VectorIndexScope {
    if (!this.scope) throw new Error('Vector generation required. Rebuild the vector index.');
    return this.scope;
  }

  private requireRepositoryIdentityScope(): VectorIndexScope {
    const scope = this.requireScope();
    const active = this.config.activeIndex;
    const target = new URL(this.workerUrl);
    if (target.username || target.password || target.search || target.hash
      || !active || active.namespace !== scope.namespace || active.identityHash !== scope.identityHash
      || active.identity.dimensions !== scope.dimensions
      || active.identity.target !== target.href.replace(/\/+$/, '')) {
      throw new Error('Current active vector generation required for repository identity storage');
    }
    return scope;
  }

  private async checkRepositoryIdentityStorage(): Promise<void> {
    const scope = this.requireRepositoryIdentityScope();
    const status = await this.getStatus();
    if (status.identityStorage !== true || status.identityRestoreCheck !== true || status.protocolVersion !== VECTOR_PROTOCOL_VERSION) {
      throw new Error('Update the Worker: repository identity storage and restore preflight capabilities required; migration blocked');
    }
    if (status.dimensions !== scope.dimensions) throw new Error('Vector identity storage dimensions conflict');
  }

  /** Save this credential-free snapshot in the durable coordinator journal before mutation. */
  async backupRepositoryIdentities(mappings: ReadonlyArray<RepositoryIdentityMapping>): Promise<VectorRepositoryIdentityBackup> {
    validateParticipantMappings(mappings);
    if (mappings.length > 500) throw new Error('VECTOR_IDENTITY_MAPPING_LIMIT_500');
    const scope = this.requireRepositoryIdentityScope();
    const backup: VectorRepositoryIdentityBackup = {
      version: 1, workerUrl: this.workerUrl, scope: { ...scope },
      mappings: mappings.map(mapping => ({ ...mapping })), records: [],
    };
    if (!mappings.length) return backup;
    await this.checkRepositoryIdentityStorage();
    const response = await this.request<Pick<VectorRepositoryIdentityBackup, 'records'>>('/identity-snapshot', {
      method: 'POST', body: JSON.stringify({ scope, ids: vectorRepositoryIdentityIds(mappings) }),
    });
    backup.records = response.records;
    validateVectorRepositoryIdentityBackup(backup, this.workerUrl, scope, mappings);
    return backup;
  }

  private async waitForRepositoryIdentitySnapshot(backup: VectorRepositoryIdentityBackup, restore: boolean): Promise<void> {
    const expected = new Map(backup.records.map(record => [record.id, record.vector]));
    if (!restore) {
      for (const mapping of backup.mappings) {
        const source = expected.get(String(mapping.oldId));
        if (!source) continue;
        expected.set(String(mapping.oldId), null);
        expected.set(String(mapping.newId), migratedRepositoryIdentityVector(backup.scope, mapping, source));
      }
    }
    for (let attempt = 0; attempt < 30; attempt++) {
      this.requireRepositoryIdentityScope();
      const response = await this.request<{ records: VectorRepositoryIdentityBackup['records'] }>('/identity-snapshot', {
        method: 'POST', body: JSON.stringify({ scope: backup.scope, ids: vectorRepositoryIdentityIds(backup.mappings) }),
      });
      if (Array.isArray(response.records) && response.records.length === expected.size
        && new Set(response.records.map(record => record.id)).size === expected.size
        && response.records.every(record => expected.has(record.id)
          && equalRepositoryIdentityVectors(record.vector, expected.get(record.id)!))) return;
      await new Promise<void>(resolve => setTimeout(resolve, 1000));
    }
    throw new Error('Vector identity storage deletion is not confirmed; retain the durable backup and resume migration');
  }

  private async mutateRepositoryIdentities(
    mappings: ReadonlyArray<RepositoryIdentityMapping>, backup: VectorRepositoryIdentityBackup, restore: boolean,
  ): Promise<{ changed: number }> {
    const scope = this.requireRepositoryIdentityScope();
    validateVectorRepositoryIdentityBackup(backup, this.workerUrl, scope, mappings);
    if (!mappings.length) return { changed: 0 };
    await this.checkRepositoryIdentityStorage();
    const path = restore ? '/identity-restore' : '/identity-rekey';
    const copied = await this.request<{
      changed: number; complete?: boolean; mutationId?: string; entries: Array<{ id: string; contentHash: string }>;
    }>(path, { method: 'POST', body: JSON.stringify({ scope, mappings, backup, phase: 'copy' }) });
    if (copied.complete && copied.changed === 0) {
      await this.waitForRepositoryIdentitySnapshot(backup, restore);
      return { changed: 0 };
    }
    if (!Number.isSafeInteger(copied.changed) || copied.changed < 1 || !copied.mutationId || !copied.entries?.length) {
      throw new Error('Worker did not acknowledge the vector identity copy; durable backup retained');
    }
    const expected = new Map<string, RemoteRepositoryIdentityVector>();
    for (const mapping of mappings) {
      const source = backup.records.find(record => record.id === String(mapping.oldId))?.vector;
      if (source) {
        const vector = restore ? source : migratedRepositoryIdentityVector(scope, mapping, source);
        expected.set(vector.id.slice(scope.namespace.length + 1), vector);
      }
    }
    if (new Set(copied.entries.map(entry => entry.id)).size !== copied.entries.length
      || copied.entries.some(entry => expected.get(entry.id)?.metadata.content_hash !== entry.contentHash)) {
      throw new Error('Worker returned conflicting vector identity verification entries');
    }
    this.lastMutationId = copied.mutationId;
    await this.verifyGeneration(copied.entries);
    this.requireRepositoryIdentityScope();
    await this.request(path, {
      method: 'POST', body: JSON.stringify({ scope, mappings, backup, phase: 'delete', mutationId: copied.mutationId }),
    });
    await this.waitForRepositoryIdentitySnapshot(backup, restore);
    return { changed: copied.changed };
  }

  async rekeyRepositoryIdentities(
    mappings: ReadonlyArray<RepositoryIdentityMapping>, backup: VectorRepositoryIdentityBackup,
  ): Promise<{ changed: number }> {
    return this.mutateRepositoryIdentities(mappings, backup, false);
  }

  async restoreRepositoryIdentities(backup: VectorRepositoryIdentityBackup): Promise<void> {
    await this.checkRestoreRepositoryIdentities(backup);
    await this.mutateRepositoryIdentities(backup.mappings, backup, true);
  }

  /** Read-only cross-participant preflight; restore also rechecks server-side before mutation. */
  async checkRestoreRepositoryIdentities(backup: VectorRepositoryIdentityBackup): Promise<void> {
    const scope = this.requireRepositoryIdentityScope();
    validateVectorRepositoryIdentityBackup(backup, this.workerUrl, scope, backup.mappings);
    if (!backup.mappings.length) return;
    await this.checkRepositoryIdentityStorage();
    const response = await this.request<{ ready: boolean; records: VectorRepositoryIdentityBackup['records'] }>('/identity-restore-check', {
      method: 'POST', body: JSON.stringify({ scope, mappings: backup.mappings, backup }),
    });
    if (response.ready !== true) throw new Error('VECTOR_IDENTITY_RESTORE_NOT_READY');
    assertRestorableRepositoryIdentitySnapshot(backup, response.records);
  }

  private validateVector(values: number[]): void {
    if (!Array.isArray(values) || values.length !== this.requireScope().dimensions || !values.every(Number.isFinite)) {
      throw new Error('Embedding response has invalid values or incompatible dimensions.');
    }
  }

  private async request<T>(path: string, options: RequestInit = {}, signal?: AbortSignal): Promise<T> {
    return withDeadline(requestSignal => this.requestWithinDeadline<T>(path, options, requestSignal), 30_000, signal);
  }

  private async requestWithinDeadline<T>(path: string, options: RequestInit, signal: AbortSignal): Promise<T> {
    const url = `${this.workerUrl}${path}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.authToken}`,
      ...(options.headers as Record<string, string>),
    };

    const response = await fetch(url, { ...options, headers, signal });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(`Worker error ${response.status}: ${errText}`);
    }

    const data = await response.json();
    if (data.success === false) {
      throw new Error(data.error || 'Unknown worker error');
    }
    return data as T;
  }

  /**
   * 批量 upsert 向量到 Vectorize
   */
  async upsert(vectors: VectorizeVector[], signal?: AbortSignal): Promise<{ upserted: number }> {
    const scope = this.requireScope();
    vectors.forEach((vector) => this.validateVector(vector.values));
    const result = await this.request<{ upserted: number; mutationId: string }>('/upsert', {
      method: 'POST',
      body: JSON.stringify({ vectors, scope }),
    }, signal);
    if (!result.mutationId || result.upserted !== vectors.length) throw new Error('Worker did not acknowledge the complete vector batch.');
    this.lastMutationId = result.mutationId;
    return result;
  }

  async verifyGeneration(entries: Array<{ id: string; contentHash: string }>, signal?: AbortSignal): Promise<void> {
    if (entries.length === 0) return;
    if (!this.lastMutationId) throw new Error('Missing vector mutation acknowledgement.');
    // Conservative visibility barrier: a missed/advanced watermark times out rather
    // than publishing a generation whose query visibility cannot be established.
    for (let attempt = 0; attempt < 30; attempt++) {
      signal?.throwIfAborted();
      let ready = true;
      for (let i = 0; i < entries.length; i += 100) {
        const result = await this.request<{ ready: boolean }>('/verify', {
          method: 'POST',
          body: JSON.stringify({ scope: this.requireScope(), entries: entries.slice(i, i + 100), mutationId: this.lastMutationId }),
        }, signal);
        ready = ready && result.ready;
      }
      if (ready) return;
      await new Promise<void>((resolve, reject) => {
        const abort = () => { clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')); };
        const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, 1000);
        signal?.addEventListener('abort', abort, { once: true });
        if (signal?.aborted) abort();
      });
    }
    throw new Error('Vector writes are not yet confirmed queryable. Previous generation retained; retry rebuilding later.');
  }

  /**
   * 向量相似度查询
   */
  async query(
    vector: number[],
    options: { topK?: number; threshold?: number } = {},
    signal?: AbortSignal,
  ): Promise<VectorQueryResult[]> {
    await this.prepareQuery(signal);
    this.validateVector(vector);
    const { topK = 20, threshold = 0.35 } = options;
    const result = await this.request<{ matches: VectorQueryResult[] }>('/query', {
      method: 'POST',
      body: JSON.stringify({ vector, topK, threshold, scope: this.requireScope() }),
    }, signal);
    if (!Array.isArray(result.matches) || result.matches.some((match) => match.metadata?.identity_hash !== this.scope!.identityHash)) {
      throw new Error('Worker returned an incompatible vector identity.');
    }
    return result.matches;
  }

  /**
   * 删除指定 ID 的向量
   */
  async delete(ids: string[], signal?: AbortSignal): Promise<{ deleted: number }> {
    return this.request<{ deleted: number }>('/delete', {
      method: 'POST',
      body: JSON.stringify({ ids, scope: this.requireScope() }),
    }, signal);
  }

  /**
   * 清理不在 keepIds 列表中的向量（删除已 unstar 的仓库）
   */
  async cleanup(keepIds: string[], signal?: AbortSignal): Promise<{ deleted: number }> {
    // Do not send this to older Workers, which ignore scope and delete globally.
    signal?.throwIfAborted();
    throw new Error(`Automatic cleanup disabled (${keepIds.length} keep IDs ignored). Retained generations require explicit administration.`);
  }

  /**
   * 获取索引状态
   */
  async getStatus(signal?: AbortSignal): Promise<VectorizeStatus> {
    return this.request<VectorizeStatus>('/status', {}, signal);
  }

  /**
   * 测试 Worker 连通性
   */
  async testConnection(signal?: AbortSignal): Promise<{ success: boolean; vectorCount: number; dimensions: number; error?: string }> {
    try {
      const status = await this.getStatus(signal);
      return {
        success: true,
        vectorCount: status.vectorCount,
        dimensions: status.dimensions,
      };
    } catch (error) {
      return {
        success: false,
        vectorCount: 0,
        dimensions: 0,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

// ============================================================
// 工具函数
// ============================================================

/**
 * 拼接仓库文本用于 embedding
 * @param repo 仓库数据
 * @param readmeContent README 内容（可选）
 * @param maxChars README 最大字符数，默认 6000
 */
export function buildEmbeddingText(repo: Repository, readmeContent?: string, maxChars = 6000): string {
  const parts: string[] = [];

  // 结构化字段标签，帮助 embedding 模型理解字段角色和权重
  if (repo.full_name) parts.push(`Repository: ${repo.full_name}`);

  // 去重：description 和 ai_summary 内容重叠时，跳过较短的 description
  const description = repo.description || '';
  const aiSummary = repo.ai_summary || '';
  const customDesc = repo.custom_description || '';

  if (description && !aiSummary.includes(description)) {
    parts.push(`Description: ${description}`);
  }
  if (customDesc) parts.push(`About: ${customDesc}`);
  if (aiSummary) parts.push(`Summary: ${aiSummary}`);

  // 合并 topics 和 tags，去重
  const allTopics = [...new Set([
    ...(repo.topics || []),
    ...(repo.ai_tags || []),
    ...(repo.custom_tags || []),
  ])];
  if (allTopics.length > 0) parts.push(`Topics: ${allTopics.join(', ')}`);

  if (repo.language) parts.push(`Language: ${repo.language}`);
  // 开源许可：先归一化，避免 raw GitHub 对象变成 "[object Object]" 污染 embedding；
  // 哨兵（无/未声明）不写入，与 null/缺失保持同一语义。
  {
    const lic = normalizeLicense(repo.license);
    if (lic !== NO_LICENSE_SENTINEL) parts.push(`License: ${lic}`);
  }

  // README 内容提供最丰富的语义信息
  if (readmeContent) {
    const cleaned = readmeContent
      .replace(/\[!\[.*?\]\(.*?\)\]\(.*?\)/g, '') // 移除链接徽章 [![...](...)](...) — 必须在图片之前
      .replace(/!\[.*?\]\(.*?\)/g, '') // 移除图片/徽章 ![...](...)
      .replace(/<[^>]+>/g, ' ') // 移除 HTML 标签
      .replace(/\n{3,}/g, '\n\n') // 压缩多余空行
      .trim();
    const truncated = cleaned.slice(0, maxChars);
    if (truncated) parts.push(`README:\n${truncated}`);
  }
  return parts.join('\n');
}

/**
 * 判断单个仓库是否需要重新向量索引（增量谓词的权威实现）。
 *
 * 以下任一成立即视为需要重索引：
 *  - 从未索引（`vector_indexed_at` 缺失）；
 *  - embedding 格式版本升级（由调用方据 `formatVersionChanged` 传入）；
 *  - 内容时间（`last_edited` 与 `analyzed_at` 中较新者）晚于上次索引时间；
 *  - license 变化（归一化后比对 `vector_indexed_license` 与 `license`）。
 *
 * 该模块与 `VectorSearchSettings.tsx` 的 `unindexedCount` / `attemptedCount` 谓词
 * 必须保持一致，故统一抽取为可选导出供复用，避免三处副本分别漂移。
 */
export function needsReindex(repo: Pick<Repository, 'last_edited' | 'analyzed_at' | 'license' | 'vector_indexed_at' | 'vector_indexed_license'>
  & Partial<Pick<Repository, 'pushed_at' | 'updated_at'>>, formatVersionChanged: boolean): boolean {
  if (!repo.vector_indexed_at) return true; // 从未索引
  if (formatVersionChanged) return true; // 格式版本升级，需要重新索引
  // 取 last_edited 与 analyzed_at 中较新者作为内容时间，更新后需要重新索引
  const contentTime = [repo.last_edited, repo.analyzed_at, repo.pushed_at, repo.updated_at]
    .filter((t): t is string => !!t)
    .sort()
    .pop() || '';
  if (contentTime > repo.vector_indexed_at) return true;
  // license 变化（归一化后比对）：GitHub 同步可能仅更新 license 而 last_edited 不变，
  // 此时向量元数据与嵌入文本中的 License 字段会过时，故需重新索引。
  return normalizeLicense(repo.vector_indexed_license ?? null) !== normalizeLicense(repo.license ?? null);
}

/**
 * 全量/增量重建向量索引
 * 遍历已分析仓库，分批生成 embedding 并 upsert 到 Worker
 * @param readmeFetcher 可选：获取仓库 README 内容的函数 (owner, repo) => content
 */
export interface IndexProgress {
  phase: 'readme' | 'embedding' | 'uploading';
  done: number;
  total: number;
}

/**
 * 判断 embedding 错误是否属于"输入过长"类（如硅基流动 20015）。
 * 这类错误的特点是：batch 中某一条超 token 限制导致整批失败，
 * 可以通过降级为逐条 embed 来隔离出真正超限的那条。
 * 只匹配明确的长度/token 关键词，避免把通用 400/配置错误误判为可重试。
 */
export function looksLikeLengthError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    /\b20015\b/.test(msg) ||
    /input length/i.test(msg) ||
    /maximum token/i.test(msg) ||
    /token limit/i.test(msg) ||
    /too long/i.test(msg)
  );
}

/**
 * 对文本做截断，保留下限 256 字符。
 */
export function truncateForRetry(text: string, maxChars: number): string {
  return text.slice(0, Math.max(256, Math.min(text.length, maxChars)));
}

/**
 * 批量 embed，带单条失败隔离 + 截断重试。
 * - 正常路径：一次 batch 调用，快。
 * - 若 batch 抛出"长度类"错误：降级为逐条 embed，只让真正超限的那条失败。
 * - 非 length 错误（auth/5xx/网络）：直接 rethrow，交由上层整批失败处理。
 * 返回稀疏数组：成功位置为向量，彻底失败的位置为 null。
 */
export async function embedWithFallback(
  texts: string[],
  embeddingClient: EmbeddingClient,
  signal: AbortSignal | undefined,
  retryMaxChars: number
): Promise<(number[] | null)[]> {
  // 快路径：尝试整批
  try {
    if (signal?.aborted) throw new Error('Aborted');
    const vectors = await embeddingClient.embed(texts, 'document', signal);
    if (Array.isArray(vectors) && vectors.length === texts.length) {
      return vectors;
    }
    throw new Error(`Embedding API returned ${vectors?.length ?? 0} vectors for ${texts.length} texts`);
  } catch (err) {
    if (signal?.aborted || (err instanceof Error && err.message === 'Aborted')) {
      throw new Error('Aborted');
    }
    // 仅对"长度类"错误降级为逐条；其他错误整批失败
    if (!looksLikeLengthError(err)) {
      throw err;
    }
  }

  // 慢路径：逐条 embed，单条超限则截断重试
  const results: (number[] | null)[] = new Array(texts.length).fill(null);
  for (let i = 0; i < texts.length; i++) {
    if (signal?.aborted) throw new Error('Aborted');
    const original = texts[i];
    // 截断重试阶梯：每步严格递减，保留下限 256
    const firstLimit = Math.max(256, Math.min(retryMaxChars, Math.floor(original.length / 2)));
    const secondLimit = Math.max(256, Math.floor(firstLimit / 2));
    const candidates = [
      original,
      truncateForRetry(original, firstLimit),
      truncateForRetry(original, secondLimit),
    ].filter((c, idx, arr) => idx === 0 || c.length < (arr[idx - 1]?.length ?? Infinity));
    let succeeded = false;
    for (const candidate of candidates) {
      if (!candidate) { succeeded = true; break; } // 空文本直接跳过
      try {
        const v = await embeddingClient.embed([candidate], 'document', signal);
        if (Array.isArray(v) && v.length === 1 && Array.isArray(v[0])) {
          results[i] = v[0];
          succeeded = true;
          break;
        }
      } catch (err) {
        if (signal?.aborted || (err instanceof Error && err.message === 'Aborted')) {
          throw new Error('Aborted');
        }
        // 仍是 length 错误 → 尝试更短的候选；非长度错误（5xx/network/auth）立即抛出
        if (!looksLikeLengthError(err)) {
          throw err;
        }
      }
    }
    if (!succeeded) {
      results[i] = null;
    }
  }
  return results;
}

export async function indexAllRepos(
  repos: Repository[],
  embeddingClient: EmbeddingClient,
  vectorService: VectorSearchService,
  options: {
    batchSize?: number;
    onProgress?: (progress: IndexProgress) => void;
    signal?: AbortSignal;
    readmeFetcher?: (owner: string, repo: string, signal?: AbortSignal) => Promise<string>;
    indexMode?: 'description' | 'readme';
    readmeMaxChars?: number;
    incremental?: boolean;
    onRepoIndexed?: (repoId: number) => void;
    /** 当前存储的格式版本号 */
    formatVersion?: number;
    /** 最新格式版本号（EMBEDDING_FORMAT_VERSION） */
    currentFormatVersion?: number;
    generation?: VectorIndexGeneration;
  } = {}
): Promise<{ indexed: number; skipped: number; errors: number; error?: string; indexedRepoIds: number[]; indexedContentHashes: Record<string, string> }> {
  const { batchSize = 32, onProgress, signal, readmeFetcher, indexMode = 'readme', readmeMaxChars = 6000, incremental, onRepoIndexed } = options;

  if (!Number.isInteger(batchSize) || batchSize <= 0) {
    throw new Error('batchSize must be a positive integer');
  }

  // 只索引已分析且未失败的仓库
  let indexable = repos.filter((r) => r.analyzed_at && !r.analysis_failed);
  // 增量模式下跳过已索引且内容未更新的仓库
  if (incremental && !options.generation) {
    // 嵌入文本格式版本变化时，强制重新索引所有向量以避免混合格式
    // 缺失版本号视为 v1（旧格式），仍需触发升级
    const formatVersionChanged = (options.formatVersion ?? 1) < (options.currentFormatVersion ?? EMBEDDING_FORMAT_VERSION);
    indexable = indexable.filter((r) => needsReindex(r, formatVersionChanged));
  }
  let indexed = 0;
  let errors = 0;
  let lastError = '';
  const indexedRepoIds: number[] = [];
  const indexedContentHashes: Record<string, string> = {};
  let skipped = repos.length - indexable.length;

  // 仅在 readme 模式下获取 README 内容
  if (options.generation && indexMode === 'readme' && !readmeFetcher && indexable.length > 0) {
    throw new Error('README indexing requires a README source. Previous generation retained.');
  }
  const shouldFetchReadme = indexMode === 'readme' && readmeFetcher;
  const readmeCache = new Map<string, string>();
  const readmeFailures = new Set<string>();
  if (shouldFetchReadme) {
    const CONCURRENCY = 5;
    let completed = 0;

    for (let i = 0; i < indexable.length; i += CONCURRENCY) {
      if (signal?.aborted) throw new Error('Aborted');

      const batch = indexable.slice(i, i + CONCURRENCY);
      const results = await Promise.allSettled(
        batch.map(async (repo) => {
          const [owner, name] = repo.full_name.split('/');
          const readme = await readmeFetcher(owner, name, signal);
          return { fullName: repo.full_name, readme };
        })
      );

      for (const [j, result] of results.entries()) {
        if (result.status === 'fulfilled' && result.value.readme) {
          readmeCache.set(result.value.fullName, result.value.readme);
        } else if (result.status === 'rejected' && options.generation) {
          readmeFailures.add(batch[j].full_name);
        }
      }

      completed = Math.min(completed + batch.length, indexable.length);
      onProgress?.({ phase: 'readme', done: completed, total: indexable.length });
    }
  }

  if (readmeFailures.size) {
    errors += readmeFailures.size;
    lastError = 'README retrieval failed; the previous generation is retained.';
    indexable = indexable.filter((repo) => !readmeFailures.has(repo.full_name));
  }
  const totalBatches = Math.ceil(indexable.length / batchSize);
  for (let i = 0; i < indexable.length; i += batchSize) {
    if (signal?.aborted) {
      throw new Error('Aborted');
    }

    const candidates = await Promise.all(indexable.slice(i, i + batchSize).map(async (repo) => {
      const text = buildEmbeddingText(repo, readmeCache.get(repo.full_name), readmeMaxChars);
      const hash = options.generation ? await hashVectorContent(JSON.stringify({
        text, stars: repo.stargazers_count || 0, tags: repo.ai_tags || [],
      })) : '';
      return { repo, text, hash };
    }));
    const pending = candidates.filter(({ repo, hash }) => {
      if (!incremental || !options.generation) return true;
      return repo.vector_indexed_identity !== options.generation.identityHash ||
        repo.vector_indexed_generation !== options.generation.namespace ||
        repo.vector_indexed_content_hash !== hash || needsReindex(repo, false);
    });
    skipped += candidates.length - pending.length;
    const batch = pending.map(({ repo }) => repo);
    const texts = pending.map(({ text }) => text);
    if (!batch.length) continue;

    try {
      // 1. 调用 Embedding API 生成向量（带单条失败隔离 + 截断重试）
      //    长度类错误（如硅基流动 20015）会降级为逐条 embed，避免整批失败
      const vectors = await embedWithFallback(texts, embeddingClient, signal, readmeMaxChars);

      // 2. 组装成功项的 Vectorize 格式（跳过 null 的失败项）
      const vectorizeVectors: VectorizeVector[] = [];
      let batchErrors = 0;
      for (let j = 0; j < batch.length; j++) {
        const vec = vectors[j];
        if (vec && Array.isArray(vec) && vec.length > 0 && vec.every(Number.isFinite) &&
            (!options.generation || vec.length === options.generation.identity.dimensions)) {
          vectorizeVectors.push({
            id: String(batch[j].id),
            values: vec,
            metadata: {
              ...(options.generation ? { content_hash: pending[j].hash } : {}),
              full_name: batch[j].full_name,
              description: batch[j].description || '',
              language: batch[j].language || '',
              stars: batch[j].stargazers_count || 0,
              tags: batch[j].ai_tags || [],
              // 历史/导入数据 license 可能是 GitHub 对象或数字；统一经 normalizeLicense
              // 降为 SPDX id / 哨兵，避免把 "[object Object]" 写入向量元数据。
              license: normalizeLicense(batch[j].license),
            },
          });
        } else {
          batchErrors++;
        }
      }

      // 3. upsert 到 Worker（仅当有成功向量时）
      //    Vectorize upsert 是原子的，但用返回的 upserted 数量计数更严谨
      const currentBatch = Math.floor(i / batchSize) + 1;
      if (vectorizeVectors.length > 0) {
        onProgress?.({ phase: 'uploading', done: currentBatch, total: totalBatches });
        const upsertResult = await vectorService.upsert(vectorizeVectors, signal);
        const upsertedCount = typeof upsertResult?.upserted === 'number'
          ? Math.min(upsertResult.upserted, vectorizeVectors.length)
          : vectorizeVectors.length;
        indexed += upsertedCount;
        // 仅标记确认 upserted 的 repo（按顺序）
        for (let j = 0; j < upsertedCount; j++) {
          const repoId = parseInt(vectorizeVectors[j].id, 10);
          indexedRepoIds.push(repoId);
          if (options.generation) indexedContentHashes[String(repoId)] = vectorizeVectors[j].metadata.content_hash!;
          onRepoIndexed?.(repoId);
        }
        // 若 worker 返回的 upserted 少于发送数，差额计入 errors
        const notUpserted = vectorizeVectors.length - upsertedCount;
        if (notUpserted > 0) {
          batchErrors += notUpserted;
        }
      }
      if (batchErrors > 0) {
        errors += batchErrors;
        lastError = `${batchErrors} text(s) failed embedding (likely over token limit)`;
      }
    } catch (err) {
      if (signal?.aborted || (err instanceof Error && err.message === 'Aborted')) {
        throw new Error('Aborted');
      }
      lastError = err instanceof Error ? err.message : String(err);
      console.error(`Batch ${i}-${i + batch.length} failed:`, err);
      errors += batch.length;
    }

    const currentBatch = Math.floor(i / batchSize) + 1;
    onProgress?.({ phase: 'embedding', done: currentBatch, total: totalBatches });
  }

  return { indexed, skipped, errors, error: lastError || undefined, indexedRepoIds, indexedContentHashes };
}

/**
 * 查找与源仓库语义相似的仓库。
 *
 * 流程：
 * 1. 拼接源仓库文本并 embed（purpose='query'）
 * 2. 调用 Worker 的 /query 接口获取相似向量 id 列表
 * 3. 从全量仓库中映射回 Repository，过滤掉源仓库自身
 *
 * @returns 相似仓库数组（按相似度降序，已排除源仓库）
 */
export async function findSimilarRepositories(
  sourceRepo: Repository,
  opts: {
    embeddingClient: EmbeddingClient;
    vectorService: VectorSearchService;
    allRepos: Repository[];
    topK: number;
    threshold: number;
    /** Fetches the source README when the index itself was built in README mode. */
    readmeFetcher?: (owner: string, repo: string, signal?: AbortSignal) => Promise<string>;
    indexMode?: VectorIndexMode;
    readmeMaxChars?: number;
    signal?: AbortSignal;
  }
): Promise<Repository[]> {
  const {
    embeddingClient,
    vectorService,
    allRepos,
    topK,
    threshold,
    readmeFetcher,
    indexMode = 'readme',
    readmeMaxChars = 6000,
    signal,
  } = opts;
  signal?.throwIfAborted();

  // An index created from README-enriched documents must be queried with the same
  // representation. Embedding only the card metadata made the source vector a
  // different semantic object from every indexed repository and caused relevance
  // to collapse for feature-rich repositories.
  let sourceReadme = '';
  if (indexMode === 'readme' && readmeFetcher) {
    const [owner, repo] = sourceRepo.full_name.split('/');
    if (owner && repo) {
      try {
        sourceReadme = await readmeFetcher(owner, repo, signal);
      } catch {
        signal?.throwIfAborted();
        // README enrichment improves quality but must not make a usable vector
        // index unavailable. The metadata representation remains a safe fallback.
        sourceReadme = '';
      }
    }
  }

  // 1. Generate the source query vector from the same text schema and truncation
  // policy used during index construction.
  const text = buildEmbeddingText(sourceRepo, sourceReadme, readmeMaxChars);
  signal?.throwIfAborted();
  const vectors = await embeddingClient.embed([text], 'query', signal);
  signal?.throwIfAborted();
  if (!vectors || vectors.length === 0 || !Array.isArray(vectors[0])) {
    throw new Error('Failed to generate embedding for source repository');
  }
  const queryVector = vectors[0];

  // 2. Over-fetch modestly so the source vector, stale IDs, or duplicate matches
  // cannot consume the user's requested result count. Results are then restored to
  // the worker's explicit cosine score order below.
  const requestedTopK = Math.min(Math.max(topK + 8, topK + 1), VECTORIZE_QUERY_TOPK_LIMIT);
  const matches = await vectorService.query(queryVector, { topK: requestedTopK, threshold }, signal);

  // 3. Map valid local repositories and sort explicitly by the worker's score.
  // Relying on incidental response order makes card results change when a Worker
  // implementation, metadata filter, or stale vector changes its output order.
  const repoById = new Map<number, Repository>();
  for (const repo of allRepos) repoById.set(repo.id, repo);

  const sourceId = String(sourceRepo.id);
  const bestMatchById = new Map<string, { repo: Repository; score: number }>();
  for (const match of matches) {
    if (match.id === sourceId) continue;
    const repositoryId = Number(match.id);
    if (!Number.isInteger(repositoryId)) continue;
    const matchedRepository = repoById.get(repositoryId);
    if (!matchedRepository) continue;
    const score = Number.isFinite(match.score) ? match.score : Number.NEGATIVE_INFINITY;
    const current = bestMatchById.get(match.id);
    if (!current || score > current.score) bestMatchById.set(match.id, { repo: matchedRepository, score });
  }
  return Array.from(bestMatchById.values())
    .sort((left, right) => right.score - left.score || left.repo.full_name.localeCompare(right.repo.full_name))
    .slice(0, Math.max(1, topK))
    .map(({ repo }) => repo);
}
