import type { WorkbenchProposal } from '../types/aiWorkbench';
import type { AgyRecoveryRecord } from '../types/agy';
import type { AITaskRecord } from './aiTaskJournal';
import type { AIConfig } from '../types';
import { AIService } from './aiService';
import { agyProfileIdentity, forAgyFeature } from './agyProfiles';
import { repositoryChatStorage as storage } from './repositoryChatStorage';
import { aiTaskJournal } from './aiTaskJournal';
import { agyRecoverySession, listAgyRecovery, readAgyRecovery, acknowledgeAgyRecovery } from './agyClient';
import { useAppStore } from '../store/useAppStore';
import { organizationHash } from './aiOrganizationPlanning';
import { z } from 'zod';

const pending = new Map<string, Map<string, { record: AgyRecoveryRecord; key: string; validated: boolean }>>();
export async function organizationRecoveryConfig(owner: string, proposalId: string, configId: string): Promise<AIConfig> {
  const record = (await listAgyRecovery(owner)).find(record => record.recoverable && record.step?.startsWith(`organization:${proposalId}:`));
  const profile = record?.profile.match(/^(.+):(.*):(low|medium|high|max):text-v1$/);
  if (!profile) throw new Error('AGY_SAVE_ONLY_MISSING_RESULT');
  return { id: configId, name: 'AGY recovery', provider: 'agy-cli', model: profile[2], agyMode: 'model',
    agyEffort: profile[3] as 'low' | 'medium' | 'high' | 'max', agyTimeoutSeconds: 180, isActive: false, deviceBound: true };
}
export function assertOrganizationRecoverySize(proposal: WorkbenchProposal, maxTokens: number) {
  const maxChars = Math.min(192000, Math.max(4000, maxTokens * 8));
  // Include bounded parsed output and taxonomy projections in the commit envelope.
  if (new TextEncoder().encode(JSON.stringify(proposal)).byteLength + maxChars * 8 + 4096 > 1024 * 1024)
    throw new Error('AGY_RECOVERY_CONTEXT_LIMIT');
}
export function registerOrganizationResult(proposalId: string, key: string, record: AgyRecoveryRecord) {
  const entries = pending.get(proposalId) ?? new Map(); entries.set(record.requestId, { record, key, validated: false }); pending.set(proposalId, entries);
  if (record.taskId) {
    const task = aiTaskJournal.snapshot().find(task => task.id === record.taskId);
    if (task) aiTaskJournal.patch(task.id, { commitStatus: 'pending', items: [...task.items.filter(item => item.id !== record.requestId),
      { id: record.requestId, label: key, state: 'running', providerOutcome: 'succeeded', commitStatus: 'pending', recovery: { requestId: record.requestId, digest: record.resultDigest } }] });
  }
}
export function validateOrganizationResult(proposalId: string, key: string, success: boolean) {
  const row = [...(pending.get(proposalId)?.values() ?? [])].reverse().find(row => row.key === key && !row.validated);
  if (row) row.validated = success;
}
export function validateAllOrganizationResults(proposalId: string, nextId = proposalId) {
  const rows = pending.get(proposalId);
  if (rows && nextId !== proposalId) { pending.set(nextId, rows); pending.delete(proposalId); }
}
export function organizationRecoveryAI(config: AIConfig, language: string, proposal: WorkbenchProposal,
  replay: { kind: 'legacy' | 'refinement' | 'redesign' | 'structure'; [key: string]: unknown }, recoveryOnly = false) {
  const profile = forAgyFeature(config, 'organization', 'interactive');
  const ai = new AIService(profile, language);
  let lastKey = '';
  return { validated() { if (lastKey) validateOrganizationResult(proposal.id, lastKey, true); }, async generateChatText(options: Parameters<AIService['generateChatText']>[0]) {
    if (config.provider !== 'agy-cli') { if (recoveryOnly) throw new Error('AGY_SAVE_ONLY_MISSING_RESULT'); return ai.generateChatText(options); }
    const key = options.recovery?.step ?? `${replay.kind}:${(await organizationHash(options.user)).slice(0, 24)}`;
    lastKey = key;
    const context = { kind: 'organization', proposalId: proposal.id, key, replay,
      guard: await organizationHash([proposal.id, proposal.ownerId, proposal.organization?.revision, proposal.organization?.instruction,
        proposal.organization?.scope, proposal.organization?.entries.filter(entry => entry.manual)]) };
    const identity = agyProfileIdentity(profile, 'organization');
    const device = await window.electronAPI?.agy?.getState?.();
    const cached = await findOrganizationResponse(proposal.ownerId, proposal.id, key, options.system, options.user, context,
      `${device?.executable?.fingerprint}:${identity.model}:${identity.effort}:text-v1`, options.maxTokens ?? 4000);
    if (cached !== undefined) return cached;
    if (recoveryOnly) throw new Error('AGY_SAVE_ONLY_MISSING_RESULT');
    assertOrganizationRecoverySize(proposal, options.maxTokens ?? 4000);
    return ai.generateChatText({ ...options, recovery: { context, step: `organization:${proposal.id}:${key}`,
      onResult: record => registerOrganizationResult(proposal.id, key, record) } });
  } };
}
export async function stageOrganizationResults(proposal: WorkbenchProposal, existing?: WorkbenchProposal) {
  let rows = [...(pending.get(proposal.id)?.values() ?? [])].filter(row => row.validated && row.record.resultDigest);
  if (!rows.length) return [];
  const records = await listAgyRecovery(proposal.ownerId);
  for (const row of rows) {
    const prior = records.find(record => record.requestId === row.record.requestId);
    if (prior?.receipt === 'consumed') {
      await acknowledgeAgyRecovery(proposal.ownerId, row.record.requestId, row.record.resultDigest!);
      pending.get(proposal.id)?.delete(row.record.requestId);
    } else if (prior?.receipt === 'discarded') pending.get(proposal.id)?.delete(row.record.requestId);
  }
  rows = rows.filter(row => pending.get(proposal.id)?.has(row.record.requestId));
  if (!rows.length) return [];
  const manual = (p: WorkbenchProposal) => [p.organization?.revision, p.organization?.instruction, p.organization?.scope,
    p.organization?.entries.filter(entry => entry.manual), p.organization?.dual && Object.values(p.organization.dual.schemes).map(scheme => scheme.entries.filter(entry => entry.manual))];
  if (existing && JSON.stringify(manual(existing)) !== JSON.stringify(manual(proposal))) throw new Error('AGY_RESULT_CONTEXT_CONFLICT');
  const receipts = new Map([...(existing?.organization?.agyReceipts ?? []), ...(proposal.organization?.agyReceipts ?? [])].map(receipt => [receipt.requestId, receipt]));
  rows.forEach(row => receipts.set(row.record.requestId, { requestId: row.record.requestId, digest: row.record.resultDigest! }));
  proposal.organization!.agyReceipts = [...receipts.values()];
  const bound = await agyRecoverySession(proposal.ownerId); if (!bound) throw new Error('AGY_SESSION_CHANGED');
  const baseId = rows[0].record.step?.split(':')[1];
  const base = baseId && baseId !== proposal.id ? await storage.getProposal(baseId) : undefined;
  const commit = { kind: 'organization', expectedUpdatedAt: existing?.updatedAt, baseId: base?.id, baseUpdatedAt: base?.updatedAt, proposal: structuredClone(proposal) };
  for (const row of rows) {
    const result = await bound.api.recoveryStage(bound.session, row.record.requestId, row.record.resultDigest!, commit);
    if (!result.ok) throw new Error(`AGY_${result.code}`);
  }
  return rows.map(row => row.record);
}
export async function acknowledgeOrganizationResults(proposal: WorkbenchProposal, rows: AgyRecoveryRecord[]) {
  for (const record of rows) {
    await acknowledgeAgyRecovery(proposal.ownerId, record.requestId, record.resultDigest!);
    pending.get(proposal.id)?.delete(record.requestId);
  }
  if (!pending.get(proposal.id)?.size) pending.delete(proposal.id);
}
export async function findOrganizationResponse(owner: string, proposalId: string, key: string,
  system: string, user: string, context: unknown, profile: string, maxTokens: number) {
  const records = (await listAgyRecovery(owner)).filter(record => record.step === `organization:${proposalId}:${key}` && record.recoverable);
  if (!records.length) return undefined;
  const maxChars = Math.min(192000, Math.max(4000, maxTokens * 8));
  const fullSystem = `${system}\nApplication output ceiling: ${maxChars} characters. Stay within it without dropping requested requirements. Return a complete result, never truncated JSON.`;
  const inputDigest = await organizationHash([fullSystem, user, profile, context]);
  // Recovery is independent of the currently enabled executable/profile. Check
  // the complete original input against each record's own tested identity.
  const record = records.find(record => record.inputDigest === inputDigest) ?? (await Promise.all(records.map(async record => ({ record,
    matches: record.inputDigest === await organizationHash([fullSystem, user, record.profile, context]) })))).find(row => row.matches)?.record;
  if (!record) throw new Error('AGY_RESULT_CONTEXT_CONFLICT');
  const saved = await readAgyRecovery(owner, record.requestId);
  if (!saved.result) throw new Error('AGY_RECOVERY_NOT_FOUND');
  registerOrganizationResult(proposalId, key, saved.record);
  return saved.result.text;
}
const commitSchema = z.object({ kind: z.literal('organization'), expectedUpdatedAt: z.string().optional(), baseId: z.string().optional(), baseUpdatedAt: z.string().optional(), proposal: z.unknown() });
export async function retryOrganizationTaskSave(task: AITaskRecord) {
  if (String(useAppStore.getState().user?.id ?? '') !== task.owner) throw new Error('Account changed');
  const records = (await listAgyRecovery(task.owner)).filter(record => record.taskId === task.id && record.recoverable);
  for (const record of records) {
    const saved = await readAgyRecovery(task.owner, record.requestId);
    if (!saved.commit) {
      const context = saved.context as { proposalId?: string } | undefined;
      if (!context?.proposalId) throw new Error('AGY_RESULT_REQUIRES_LOCAL_PARSE');
      await retryOrganizationParsing(task.owner, context.proposalId, saved.context);
      continue;
    }
    const commit = commitSchema.parse(saved.commit); const proposal = commit.proposal as WorkbenchProposal;
    const { requireOrganizationProposal, saveOrganizationProposal } = await import('./aiOrganizationExecution');
    const current = await storage.getProposal(proposal.id) ? await requireOrganizationProposal(proposal.id) : undefined;
    if (current && current.ownerId !== task.owner || proposal.ownerId !== task.owner) throw new Error('Account changed');
    if (!current) {
      if (!commit.baseId) throw new Error('AGY_RESULT_CONTEXT_CONFLICT');
      await requireOrganizationProposal(commit.baseId, commit.baseUpdatedAt);
    }
    const consumed = current?.organization?.agyReceipts?.some(receipt => receipt.requestId === record.requestId && receipt.digest === record.resultDigest);
    if (!consumed) {
      if (current?.updatedAt !== commit.expectedUpdatedAt) throw new Error('AGY_RESULT_CONTEXT_CONFLICT');
      await saveOrganizationProposal(proposal, current?.updatedAt);
    }
    await acknowledgeAgyRecovery(task.owner, record.requestId, record.resultDigest!);
  }
}
async function retryOrganizationParsing(owner: string, proposalId: string, context?: unknown) {
  const { requireOrganizationProposal } = await import('./aiOrganizationExecution');
  const proposal = await requireOrganizationProposal(proposalId);
  const state = useAppStore.getState(); if (String(state.user?.id ?? '') !== owner) throw new Error('Account changed');
  const replay = (context as { replay?: { kind?: string; instruction?: string; schemeId?: 'purpose' | 'technology'; operationId?: string } } | undefined)?.replay;
  if (replay?.kind === 'structure') return (await import('./aiCategoryStructure')).runStructureGeneration({ sessionId: proposal.sessionId,
    configId: proposal.organization!.configId, instruction: replay.instruction ?? proposal.organization!.instruction, previous: proposal,
    retryOnly: true, recoveryOnly: true });
  if (replay?.kind === 'refinement') return (await import('./aiOrganizationRefinement')).runOrganizationRefinement({ proposal,
    schemeId: replay.schemeId!, instruction: replay.instruction!, configId: proposal.organization!.configId, recoveryOnly: true });
  if (replay?.kind === 'redesign') return (await import('./aiOrganizationTreeRedesign')).runMergeSubcategoryRedesign({ id: proposal.id,
    expected: proposal.updatedAt, schemeId: replay.schemeId!, operationId: replay.operationId!, configId: proposal.organization!.configId, recoveryOnly: true });
  if (!proposal.organization?.dual) return (await import('./aiOrganizationWorkflow')).runOrganizationGeneration({ sessionId: proposal.sessionId,
    repositories: state.repositories.filter(repo => proposal.organization!.scope.repositoryIds.includes(repo.id)), scopeName: proposal.organization!.scope.name,
    configId: proposal.organization!.configId, instruction: proposal.organization!.instruction, previous: proposal, retryOnly: true, recoveryOnly: true });
  const { runDualOrganizationGeneration } = await import('./aiOrganizationDualWorkflow');
  await runDualOrganizationGeneration({ sessionId: proposal.sessionId, repositories: state.repositories.filter(repo => proposal.organization!.scope.repositoryIds.includes(repo.id)),
    scopeName: proposal.organization!.scope.name, configId: proposal.organization!.configId, instruction: proposal.organization!.instruction,
    previous: proposal, retryOnly: true, recoveryOnly: true });
}
export async function confirmOrganizationNewCalls(owner: string, proposalId: string, batchIds?: number[]) {
  const records = await listAgyRecovery(owner);
  const unknown = records.filter(record => record.step?.startsWith(`organization:${proposalId}:`) && record.providerOutcome === 'unknown');
  for (const record of unknown) {
    const saved = await readAgyRecovery(owner, record.requestId);
    const ids = (saved.context as { repositoryIds?: number[] } | undefined)?.repositoryIds;
    if (batchIds && ids?.length && !ids.some(id => batchIds.includes(id))) continue;
    const task = aiTaskJournal.snapshot().find(task => task.id === record.taskId);
    const { confirmTaskRecovery } = await import('./agyRecoveryPolicy');
    if (!confirmTaskRecovery(task ?? { id: record.taskId ?? record.requestId, owner, kind: 'organization', state: 'interrupted', updatedAt: record.createdAt,
      providerOutcome: 'unknown', items: [{ id: record.requestId, requestId: record.requestId, label: record.step ?? 'AGY', state: 'pending', providerOutcome: 'unknown' }] }, useAppStore.getState().language.startsWith('zh'))) return false;
    return true;
  }
  // Legacy journals have no ledger; use the same conservative policy.
  const proposal = await storage.getProposal(proposalId);
  const legacy = aiTaskJournal.snapshot().filter(task => task.owner === owner && task.kind === 'organization'
    && (task.target?.id === proposalId || task.target?.id === proposal?.sessionId));
  const { confirmTaskRecovery } = await import('./agyRecoveryPolicy');
  return legacy.every(task => confirmTaskRecovery(task, useAppStore.getState().language.startsWith('zh')));
}
