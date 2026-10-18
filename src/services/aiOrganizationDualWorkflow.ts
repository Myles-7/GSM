import type { Repository } from '../types';
import type { OrganizationAnalysisDepth } from '../types/aiOrganization';
import type { WorkbenchProposal } from '../types/aiWorkbench';
import { useAppStore } from '../store/useAppStore';
import { repositoryChatStorage as storage } from './repositoryChatStorage';
import { workbenchRuntime } from './aiWorkbenchService';
import { createDualOrganizationDraft, generateDualOrganizationDraft } from './aiOrganizationDual';
import { requireOrganizationProposal, saveOrganizationProposal } from './aiOrganizationExecution';
import { organizationInstruction } from './aiOrganizationInstructions';

export async function runDualOrganizationGeneration(input: {
  recoveryOnly?: boolean;
  sessionId: string; repositories: Repository[]; scopeName: string; configId: string; instruction: string;
  previous?: WorkbenchProposal; retryOnly?: boolean; enrichRepositoryIds?: number[]; replaceManual?: boolean; maxNewSubcategories?: number; requestLimit?: number;
  deferUnderstandingIds?: number[]; batchIndex?: number;
  analysisDepth?: OrganizationAnalysisDepth; concurrency?: number; preserveStructure?: boolean;
}): Promise<void> {
  const ownerId = String(useAppStore.getState().user?.id ?? '');
  if (!ownerId) throw new Error('Connect a GitHub account first');
  await workbenchRuntime.run(input.sessionId, ownerId, async (signal, stage) => {
    const session = await storage.getSession(input.sessionId);
    if (!session || session.ownerId !== ownerId || session.deletedAt || session.archived) throw new Error('Conversation is read-only');
    if (!input.repositories.length) throw new Error('No repositories in selected scope');
    const previous = input.previous ? await requireOrganizationProposal(input.previous.id, input.previous.updatedAt) : undefined;
    if (previous && previous.sessionId !== input.sessionId) throw new Error('Draft belongs to another conversation');
    signal.throwIfAborted();
    const date = new Date().toISOString();
    const continuing = input.retryOnly && !input.enrichRepositoryIds?.length && previous?.organization?.version === 3 && ['ready', 'interrupted'].includes(previous.organization.status);
    const instruction = organizationInstruction(previous?.organization?.instruction, input.instruction, input.retryOnly);
    const localVerification = Boolean(input.enrichRepositoryIds?.length && previous?.organization?.dual);
    let proposal: WorkbenchProposal = continuing || localVerification ? structuredClone(previous!) : {
      id: crypto.randomUUID(), ownerId, sessionId: input.sessionId, createdAt: date, updatedAt: date, operations: [],
      organization: createDualOrganizationDraft({ ...input, instruction, previous: previous?.organization }),
    };
    if (localVerification) {
      if (input.enrichRepositoryIds!.some(id => !previous!.organization!.scope.repositoryIds.includes(id))) throw new Error('Verification target outside frozen scope');
      proposal.id = crypto.randomUUID(); proposal.createdAt = date; proposal.updatedAt = date;
      proposal.organization!.revision++; proposal.organization!.status = 'generating';
      proposal.organization!.dual!.verificationIds = [...new Set(input.enrichRepositoryIds)];
      // Local evidence refresh keeps both taxonomies and every manual target intact.
      for (const scheme of Object.values(proposal.organization!.dual!.schemes)) for (const entry of scheme.entries) {
        if (input.enrichRepositoryIds!.includes(entry.repositoryId) && !entry.manual && entry.status === 'pending') {
          entry.selected = false; entry.disposition = 'insufficient'; delete entry.error;
        }
      }
    }
    proposal.organization!.instruction = instruction; proposal.organization!.configId = input.configId; proposal.organization!.status = 'generating';
    await storage.saveMessage({ id: crypto.randomUUID(), sessionId: session.id, role: 'user', content: instruction, status: 'complete', evidenceIds: [], createdAt: date });
    await storage.saveSession({ ...session, updatedAt: date, modelConfigId: input.configId });
    await saveOrganizationProposal(proposal);
    stage('organization:understanding');
    const retryRepositoryIds = input.batchIndex === undefined ? undefined : proposal.organization!.batches[input.batchIndex]?.repositoryIds;
    if (input.batchIndex !== undefined && !retryRepositoryIds?.length) throw new Error('Retry batch no longer exists');
    await generateDualOrganizationDraft({ ...input, retryRepositoryIds, preserveStructure: input.preserveStructure ?? (localVerification || input.batchIndex !== undefined), proposal, signal, onUpdate: async next => {
      // An interruption checkpoint may be saved after abort, never an applied write.
      if (next.organization?.status !== 'interrupted') signal.throwIfAborted();
      await saveOrganizationProposal(next, proposal.updatedAt); proposal = next;
      stage(`organization:${next.organization!.dual!.phase}`);
    } });
  }, { kind: 'organization', title: input.scopeName, aiConfig: useAppStore.getState().aiConfigs.find(c => c.id === input.configId) });
}
