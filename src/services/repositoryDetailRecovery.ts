import type { AIConfig, Repository } from '../types';
import type { DetailCheckpointContext } from './repositoryDetailCheckpoint';
import type { RepositoryAnalysisAssetWriteVersion } from './repositoryAnalysisAssets';
import { assertRepositoryAnalysisAssetWrite } from './repositoryAnalysisAssets';
import { listAgyRecovery, readAgyRecovery, acknowledgeAgyRecovery } from './agyClient';
import type { AgyRecoveryRecord } from '../types/agy';
import { z } from 'zod';

const contextSchema = z.object({ kind: z.literal('repository-details'), repositoryId: z.number().int().positive(),
  evidence: z.object({ fullName: z.string(), pushedAt: z.string().nullable(), language: z.string(), model: z.string(),
    readme: z.object({ content: z.string(), retrievedAt: z.string() }) }),
  assetVersion: z.object({ accountId: z.string(), repositoryId: z.number(), generation: z.number(), repositoryGeneration: z.number() }).optional(),
  config: z.object({ id: z.string(), model: z.string(), effort: z.enum(['low', 'medium', 'high', 'max']), timeoutSeconds: z.number() }),
  source: z.object({ channelId: z.string(), revision: z.number() }).optional(),
  baseAnalysis: z.string().optional(),
});
export interface DetailRecoveryInput { assetVersion?: RepositoryAnalysisAssetWriteVersion; requestId?: string;
  source?: { channelId: string; revision: number }; onConfig?: (config: AIConfig) => void; onResult?: (record: AgyRecoveryRecord) => void; }
export function originalDetailConfig(fallback: AIConfig, context: z.infer<typeof contextSchema>): AIConfig {
  return { id: context.config.id, name: fallback.name, isActive: false, provider: 'agy-cli', model: context.config.model, agyMode: 'model',
    agyEffort: context.config.effort, agyTimeoutSeconds: context.config.timeoutSeconds, deviceBound: true,
    agyRequestProfile: { model: context.config.model, effort: context.config.effort, timeoutSeconds: context.config.timeoutSeconds } };
}
const analysisSnapshot = (repo: Repository) => JSON.stringify([repo.ai_details ?? null, repo.ai_summary ?? null, repo.ai_tags ?? null, repo.ai_platforms ?? null, repo.analyzed_at ?? null]);
export function detailRecoveryContext(repository: Repository, evidence: DetailCheckpointContext, config: AIConfig, assetVersion?: RepositoryAnalysisAssetWriteVersion, source?: DetailRecoveryInput['source']) {
  return { kind: 'repository-details', repositoryId: repository.id, evidence, assetVersion, source, baseAnalysis: analysisSnapshot(repository),
    config: { id: config.id, model: evidence.model, effort: config.provider === 'agy-cli' ? config.agyRequestProfile?.effort ?? config.agyEffort : 'medium',
      timeoutSeconds: config.provider === 'agy-cli' ? config.agyRequestProfile?.timeoutSeconds ?? config.agyTimeoutSeconds ?? 180 : 180 } };
}
export async function recoverRepositoryDetail(owner: number, repository: Repository, language: string, requestId?: string) {
  if (!window.electronAPI?.agy?.recoveryList) return undefined;
  const record = requestId ? { requestId } : (await listAgyRecovery(String(owner)))
    .filter(record => record.step === `details:${repository.id}` && record.recoverable).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  if (!record) return undefined;
  const saved = await readAgyRecovery(String(owner), record.requestId);
  if (!saved.result || !saved.record.recoverable) throw new Error('REPOSITORY_DETAILS_RECOVERY_UNAVAILABLE');
  const context = contextSchema.parse(saved.context);
  if (context.repositoryId !== repository.id || context.evidence.fullName !== repository.full_name
    || context.evidence.pushedAt !== (repository.pushed_at || null) || context.evidence.language !== language) throw new Error('REPOSITORY_DETAILS_RECOVERY_CONFLICT');
  if (context.assetVersion) await assertRepositoryAnalysisAssetWrite(context.assetVersion);
  if (repository.ai_details?.generated_at && repository.ai_details.generated_at > saved.record.createdAt) throw new Error('REPOSITORY_DETAILS_RECOVERY_CONFLICT');
  const commit = saved.commit as { kind?: string; savedAnalysis?: string } | undefined;
  if (context.baseAnalysis && context.baseAnalysis !== analysisSnapshot(repository)
    && commit?.savedAnalysis !== analysisSnapshot(repository)) throw new Error('REPOSITORY_DETAILS_RECOVERY_CONFLICT');
  return { ...saved, result: saved.result, context };
}
export async function stageRepositoryDetailRecovery(owner: number, record: AgyRecoveryRecord | undefined, repository: Repository) {
  if (!record?.resultDigest) return;
  const { agyRecoverySession } = await import('./agyClient');
  const bound = await agyRecoverySession(String(owner)); if (!bound) throw new Error('AGY_SESSION_CHANGED');
  const previous = await readAgyRecovery(String(owner), record.requestId);
  const result = await bound.api.recoveryStage(bound.session, record.requestId, record.resultDigest,
    { ...(previous.commit as object ?? {}), kind: 'repository-details', savedAnalysis: analysisSnapshot(repository) });
  if (!result.ok) throw new Error(`AGY_${result.code}`);
}
export async function confirmRepositoryDetailRecovery(owner: number, record?: AgyRecoveryRecord) {
  if (record?.resultDigest) await acknowledgeAgyRecovery(String(owner), record.requestId, record.resultDigest);
}
