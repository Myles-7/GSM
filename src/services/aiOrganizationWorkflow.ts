import type { Repository } from '../types';
import type { WorkbenchProposal } from '../types/aiWorkbench';
import { membershipOf } from '../store/helpers/aiOrganizationTransaction';
import { useAppStore } from '../store/useAppStore';
import { repositoryChatStorage as storage } from './repositoryChatStorage';
import { workbenchRuntime } from './aiWorkbenchService';
import { organizationCategorySnapshot, requireOrganizationProposal, saveOrganizationProposal } from './aiOrganizationExecution';
import { generateOrganizationDraft } from './aiOrganizationService';

export async function runOrganizationGeneration(input: {
  sessionId: string; repositories: Repository[]; scopeName: string; configId: string; instruction: string;
  previous?: WorkbenchProposal; retryOnly?: boolean; enrichRepositoryIds?: number[];
  replaceManual?: boolean; maxNewSubcategories?: number; batchIndex?: number;
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
    if (String(useAppStore.getState().user?.id ?? '') !== ownerId) throw new Error('Account changed');
    const date = new Date().toISOString();
    const previousDraft = previous?.organization;
    const continuing = Boolean(input.retryOnly && previousDraft && ['ready', 'interrupted'].includes(previousDraft.status));
    const categories = organizationCategorySnapshot();
    const currentIds = new Set(categories.map(c => c.id));
    const inherited = previousDraft?.categories.filter(c => c.isNew && !currentIds.has(c.id)) ?? [];
    let proposal: WorkbenchProposal = continuing ? structuredClone(previous!) : {
      id: crypto.randomUUID(), ownerId, sessionId: input.sessionId, createdAt: date, updatedAt: date, operations: [],
      organization: {
        version: 1, revision: (previousDraft?.revision ?? 0) + 1,
        scope: { name: input.scopeName, repositoryIds: input.repositories.map(r => r.id) },
        instruction: input.instruction, configId: input.configId, maxNewSubcategories: input.maxNewSubcategories ?? 6,
        structureReady: false, categories: [...categories, ...inherited],
        entries: input.repositories.map(repository => {
          const before = membershipOf(repository);
          const old = previousDraft?.entries.find(e => e.repositoryId === repository.id);
          const preserveManual = old?.manual && !input.replaceManual && !['applied', 'restored', 'imported'].includes(previousDraft?.status ?? '');
          return { repositoryId: repository.id, before, categoryId: preserveManual ? old.categoryId : before.categoryId,
            subcategoryId: preserveManual ? old.subcategoryId : before.subcategoryId,
            reason: preserveManual ? old.reason : '', disposition: preserveManual ? old.disposition : 'insufficient' as const,
            selected: preserveManual ? old.selected : false, overrideLocked: false, manual: Boolean(preserveManual), status: 'pending' as const };
        }),
        batches: Array.from({ length: Math.ceil(input.repositories.length / 20) }, (_, index) => ({ repositoryIds: input.repositories.slice(index * 20, index * 20 + 20).map(r => r.id), status: 'pending' as const })),
        status: 'generating', createdCategoryIds: [],
      },
    };
    if (continuing) {
      proposal.organization!.instruction = input.instruction;
      proposal.organization!.configId = input.configId;
      proposal.organization!.status = 'generating';
      if (input.batchIndex !== undefined) {
        if (proposal.organization!.batches[input.batchIndex]) {
          proposal.organization!.batches[input.batchIndex].status = 'pending';
          delete proposal.organization!.batches[input.batchIndex].error;
        }
      } else if (input.retryOnly) {
        for (const b of proposal.organization!.batches) {
          if (b.status === 'failed') {
            b.status = 'pending';
            delete b.error;
          }
        }
      }
    }
    const messageId = crypto.randomUUID();
    await storage.saveMessage({ id: messageId, sessionId: session.id, role: 'user', content: input.instruction, status: 'complete', evidenceIds: [], createdAt: date });
    await storage.saveSession({ ...session, updatedAt: date, modelConfigId: input.configId });
    await saveOrganizationProposal(proposal);
    try {
      stage('organization');
      await generateOrganizationDraft({ ...input, proposal, signal, onUpdate: async next => {
        signal.throwIfAborted();
        await saveOrganizationProposal(next);
        proposal = next;
        stage(`organization:${next.organization!.batches.filter(b => b.status === 'complete').length}/${next.organization!.batches.length}`);
      } });
    } catch (error) {
      if (String(useAppStore.getState().user?.id ?? '') === ownerId) {
        proposal.organization!.status = 'interrupted';
        await saveOrganizationProposal(proposal);
      }
      throw error;
    }
  }, { kind: 'organization', title: input.scopeName, aiConfig: useAppStore.getState().aiConfigs.find(config => config.id === input.configId) });
}
