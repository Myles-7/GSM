import type { EmbeddingConfig, VectorSearchConfig } from '../types';

// Increment when buildEmbeddingText changes its text schema.
export const EMBEDDING_FORMAT_VERSION = 3;
export const VECTOR_PROTOCOL_VERSION = 2;
export const VECTOR_REBUILD_REQUIRED = 'Vector index identity is unknown or incompatible. Rebuild the vector index; the previous generation is retained.';
export class VectorIndexCompatibilityError extends Error {
  constructor(message = VECTOR_REBUILD_REQUIRED) {
    super(message);
    this.name = 'VectorIndexCompatibilityError';
  }
}

export interface VectorIndexIdentity {
  provider: string;
  endpoint: string;
  model: string;
  dimensions: number;
  mode: 'description' | 'readme';
  readmeMaxChars: number;
  format: number;
  target: string;
}

export interface VectorIndexGeneration {
  identity: VectorIndexIdentity;
  identityHash: string;
  namespace: string;
}

export type VectorIndexScope = Pick<VectorIndexGeneration, 'identityHash' | 'namespace'> & { dimensions: number };

type IdentityConfig = Pick<VectorSearchConfig, 'workerUrl' | 'indexMode' | 'readmeMaxChars'>;
type EmbeddingIdentityConfig = Pick<EmbeddingConfig, 'apiType' | 'baseUrl' | 'model' | 'dimensions'>;

const normalizeUrl = (value: string, stripTrailingSlash = true) => {
  const url = new URL(value.trim());
  // Credentials must never become persisted identity metadata.
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('Embedding and Worker URLs must not contain credentials, query parameters or fragments.');
  }
  return stripTrailingSlash ? url.href.replace(/\/+$/, '') : url.href;
};

export function embeddingIdentity(embedding: EmbeddingIdentityConfig, config: IdentityConfig): VectorIndexIdentity {
  if (!Number.isInteger(embedding.dimensions) || embedding.dimensions < 1) {
    throw new Error('Embedding dimensions must be a positive integer.');
  }
  const mode = config.indexMode ?? 'readme';
  const readmeMaxChars = mode === 'readme' ? (config.readmeMaxChars ?? 6000) : 0;
  if (!Number.isInteger(readmeMaxChars) || readmeMaxChars < 0 || (mode === 'readme' && !readmeMaxChars)) {
    throw new Error('README character limit must be a positive integer.');
  }
  return {
    provider: embedding.apiType,
    endpoint: normalizeUrl(embedding.baseUrl, embedding.apiType !== 'openai-compatible'),
    model: embedding.model,
    dimensions: embedding.dimensions,
    mode,
    readmeMaxChars,
    format: EMBEDDING_FORMAT_VERSION,
    target: normalizeUrl(config.workerUrl),
  };
}

export async function hashVectorContent(text: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function normalizeVectorGeneration(value: unknown): VectorIndexGeneration | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const candidate = value as VectorIndexGeneration;
  const identity = candidate.identity;
  if (!identity || typeof identity !== 'object' ||
      !/^[a-f0-9]{64}$/.test(candidate.identityHash ?? '') ||
      !new RegExp(`^g${candidate.identityHash.slice(0, 12)}[a-f0-9]{32}$`).test(candidate.namespace ?? '') ||
      !['description', 'readme'].includes(identity.mode) ||
      !Number.isInteger(identity.dimensions) || identity.dimensions < 1 ||
      !Number.isInteger(identity.format) || identity.format < 1 ||
      !Number.isInteger(identity.readmeMaxChars) || identity.readmeMaxChars < 0 ||
      !['provider', 'endpoint', 'model', 'target'].every((key) => typeof identity[key as keyof VectorIndexIdentity] === 'string')) {
    return undefined;
  }
  return candidate;
}

export function hasCompatibleVectorIndex(embedding: EmbeddingIdentityConfig, config: IdentityConfig & Pick<VectorSearchConfig, 'activeIndex'>): boolean {
  try {
    const active = normalizeVectorGeneration(config.activeIndex);
    return !!active && JSON.stringify(active.identity) === JSON.stringify(embeddingIdentity(embedding, config));
  } catch {
    return false;
  }
}

export async function requireCompatibleVectorIndex(embedding: EmbeddingIdentityConfig, config: IdentityConfig & Pick<VectorSearchConfig, 'activeIndex'>): Promise<VectorIndexGeneration> {
  if (!hasCompatibleVectorIndex(embedding, config)) throw new VectorIndexCompatibilityError();
  const active = config.activeIndex!;
  if (await hashVectorContent(JSON.stringify(embeddingIdentity(embedding, config))) !== active.identityHash) {
    throw new VectorIndexCompatibilityError();
  }
  return active;
}

export async function createVectorGeneration(embedding: EmbeddingIdentityConfig, config: IdentityConfig): Promise<VectorIndexGeneration> {
  const identity = embeddingIdentity(embedding, config);
  const identityHash = await hashVectorContent(JSON.stringify(identity));
  return { identity, identityHash, namespace: `g${identityHash.slice(0, 12)}${crypto.randomUUID().replace(/-/g, '')}` };
}

export function vectorScope(index: VectorIndexGeneration): VectorIndexScope {
  return { identityHash: index.identityHash, namespace: index.namespace, dimensions: index.identity.dimensions };
}
