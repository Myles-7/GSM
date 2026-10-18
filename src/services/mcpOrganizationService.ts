import { z } from 'zod';
import { useAppStore } from '../store/useAppStore';
import type { WorkbenchProposal } from '../types/aiWorkbench';
import type { ClassificationSchemeId } from '../types/classification';
import { repositoryChatStorage as storage, ProposalRevisionError } from './repositoryChatStorage';
import { organizationCategorySnapshot, requireOrganizationProposal, saveOrganizationProposal } from './aiOrganizationExecution';
import { changeCategoryTree, previewCategoryApplication } from './aiOrganizationTree';
import { CLASSIFICATION_SCHEME_IDS, createDualOrganizationDraft, organizationFingerprint, organizationSourceMetadata } from './aiOrganizationDual';
import { classificationMembership, classificationProjection } from '../store/helpers/classificationSchemes';
import { sameMembership } from '../store/helpers/aiOrganizationTransaction';
import { stableStructure, structureSnapshot } from '../store/helpers/organizationStructure';
import { getRepositoryDetailReadme } from './repositoryDetailReadme';
import { workbenchRuntime } from './aiWorkbenchService';

const id = z.string().trim().min(1).max(160);
const owner = z.object({ ownerId: id });
const task = owner.extend({ taskId: id });
const page = { offset: z.number().int().min(0).default(0), limit: z.number().int().min(1).max(100).default(50) };
const scheme = z.enum(['purpose', 'technology']);
const categoryEdit = z.object({ schemeId: scheme, kind: z.enum(['create', 'rename', 'merge', 'withdraw']), ref: id.optional(),
  targetId: id.optional(), parentId: id.nullable().optional(), sourceIds: z.array(id).max(50).optional(), name: z.string().trim().min(1).max(120).optional(),
  icon: z.string().max(100).optional(), operationId: id.optional() }).strict();
const assignment = z.object({ schemeId: scheme, repositoryId: z.number().int().positive(), categoryId: id.nullable(), subcategoryId: id.nullable(),
  disposition: z.enum(['move', 'unchanged', 'insufficient']), reason: z.string().trim().min(1).max(2000) }).strict();
const schemas = {
  gsm_organization_overview: z.object({}).strict(),
  gsm_organization_repositories: owner.extend({ ...page, query: z.string().max(500).optional() }).strict(),
  gsm_organization_evidence: owner.extend({ repositoryId: z.number().int().positive(), readme: z.boolean().default(false) }).strict(),
  gsm_organization_start: owner.extend({ requestId: id, baseProposalId: id.optional(), repositoryIds: z.array(z.number().int().positive()).min(1).max(10000).optional(), instruction: z.string().max(10000).default(''), redesign: z.boolean().default(false) }).strict(),
  gsm_organization_checkpoint: task.extend({ ...page, schemeId: scheme.default('purpose') }).strict(),
  gsm_organization_edit: task.extend({ expectedRevision: id, requestId: id, categories: z.array(categoryEdit).max(50).default([]), assignments: z.array(assignment).max(100).default([]), replaceManual: z.boolean().default(false), progress: z.string().max(1000).optional() }).strict(),
  gsm_organization_review: task.strict(), gsm_organization_open_preview: task.strict(),
};
type ToolName = keyof typeof schemas;
export class OrganizationToolError extends Error {
  constructor(public code: string, message: string, public details?: unknown) { super(message); }
}
const fail = (code: string, message: string, details?: unknown): never => { throw new OrganizationToolError(code, message, details); };
const clone = <T,>(value: T): T => structuredClone(value);
async function hash(value: unknown) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value)));
  return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
}
function coverage(proposal: WorkbenchProposal) {
  return Object.fromEntries(CLASSIFICATION_SCHEME_IDS.map(schemeId => {
    const entries = proposal.organization!.dual!.schemes[schemeId].entries;
    const accepted = entries.filter(row => row.manual || row.verification === 'verified');
    return [schemeId, { total: entries.length, processed: accepted.length,
      valid: accepted.filter(row => row.categoryId && row.disposition !== 'insufficient').length,
      uncertain: accepted.filter(row => row.disposition === 'insufficient').length,
      missing: entries.filter(row => !row.manual && row.verification !== 'verified').map(row => row.repositoryId),
      lockedMoves: entries.filter(row => row.before.locked && row.categoryId !== row.before.categoryId).map(row => row.repositoryId) }];
  }));
}
function summary(proposal: WorkbenchProposal) {
  return { taskId: proposal.id, sessionId: proposal.sessionId, ownerId: proposal.ownerId, expectedRevision: proposal.updatedAt,
    revision: proposal.organization!.revision, status: proposal.organization!.status, coverage: coverage(proposal),
    progress: proposal.organization!.externalAgent?.progress ?? '', applied: proposal.organization!.status === 'applied',
    partiallyApplied: CLASSIFICATION_SCHEME_IDS.some(schemeId => proposal.organization!.dual!.schemes[schemeId].application?.status === 'applied') };
}
function editable(proposal: WorkbenchProposal) {
  if (!proposal.organization?.externalAgent || !proposal.organization.dual) fail('NOT_AGENT_DRAFT', 'Start or resume an agent draft first.');
  if (!['ready', 'interrupted'].includes(proposal.organization!.status) || workbenchRuntime.getSnapshot().running) fail('TASK_BUSY', 'Draft generation or application is active; wait before editing.');
}
function protectManual(before: WorkbenchProposal, after: WorkbenchProposal, replace: boolean) {
  if (replace) return;
  for (const schemeId of CLASSIFICATION_SCHEME_IDS) for (const old of before.organization!.dual!.schemes[schemeId].entries) {
    if (!old.manual) continue;
    const next = after.organization!.dual!.schemes[schemeId].entries.find(row => row.repositoryId === old.repositoryId);
    if (!next || next.categoryId !== old.categoryId || next.subcategoryId !== old.subcategoryId || next.disposition !== old.disposition) {
      fail('MANUAL_RESULT_PROTECTED', 'Manual decisions are preserved. Ask the user before replacing them.', { schemeId, repositoryId: old.repositoryId });
    }
  }
}

async function runTool(name: ToolName, raw: unknown, capturedOwnerId: string, signal: AbortSignal): Promise<unknown> {
  const check = () => {
    signal.throwIfAborted();
    const current = String(useAppStore.getState().user?.id ?? '');
    if (!current) fail('ACCOUNT_REQUIRED', 'Sign in to GSM first.');
    if (current !== capturedOwnerId) fail('ACCOUNT_CHANGED', 'The GSM account changed. Read overview again.');
  };
  check();
  const parsed = schemas[name].parse(raw);
  if ('ownerId' in parsed && parsed.ownerId !== capturedOwnerId) fail('ACCOUNT_CHANGED', 'The requested account is not active.');
  const state = useAppStore.getState();
  if (name === 'gsm_organization_overview') {
    const drafts = (await storage.listProposals(capturedOwnerId)).filter(p => p.organization?.dual);
    check();
    return { ownerId: capturedOwnerId, login: state.user!.login, repositoryCount: state.repositories.length,
      schemes: Object.fromEntries(CLASSIFICATION_SCHEME_IDS.map(schemeId => [schemeId, { categories: organizationCategorySnapshot(schemeId),
        classified: state.repositories.filter(repo => classificationMembership(repo, schemeId).categoryId).length }])),
      drafts: drafts.slice(0, 20).map(p => ({ taskId: p.id, sessionId: p.sessionId, revision: p.organization!.revision, updatedAt: p.updatedAt, status: p.organization!.status, source: p.organization!.externalAgent?.source ?? 'gsm' })),
      capabilities: { draftOnly: true, humanApplicationRequired: true, schemes: CLASSIFICATION_SCHEME_IDS } };
  }
  if (name === 'gsm_organization_repositories') {
    const args = schemas.gsm_organization_repositories.parse(raw);
    const query = args.query?.toLocaleLowerCase();
    const repos = state.repositories.filter(repo => !query || `${repo.full_name} ${repo.description ?? ''} ${repo.ai_summary ?? ''}`.toLocaleLowerCase().includes(query));
    return { ownerId: capturedOwnerId, total: repos.length, offset: args.offset, limit: args.limit,
      items: repos.slice(args.offset, args.offset + args.limit).map(repo => ({ repositoryId: repo.id, ...organizationSourceMetadata(repo), pushedAt: repo.pushed_at,
        memberships: Object.fromEntries(CLASSIFICATION_SCHEME_IDS.map(schemeId => [schemeId, classificationMembership(repo, schemeId)])) })) };
  }
  if (name === 'gsm_organization_evidence') {
    const args = schemas.gsm_organization_evidence.parse(raw); const repo = state.repositories.find(row => row.id === args.repositoryId);
    if (!repo) fail('REPOSITORY_NOT_FOUND', 'Repository is not in the active library.');
    const metadata = organizationSourceMetadata(repo!);
    const readme = args.readme ? await getRepositoryDetailReadme({ repository: repo!, accountId: state.user!.id, githubToken: state.githubToken ?? '', signal }) : undefined;
    check();
    if (organizationFingerprint(useAppStore.getState().repositories.find(row => row.id === repo!.id) ?? repo!) !== organizationFingerprint(repo!)) fail('EVIDENCE_CHANGED', 'Repository metadata changed during reading.');
    return { repositoryId: repo!.id, metadata, analysis: repo!.ai_details ?? null, ...(readme ? { readme: { ...readme, content: readme.content.slice(0, 32000), truncated: readme.content.length > 32000 } } : {}),
      source: `https://github.com/${repo!.full_name}${readme ? '#readme' : ''}`, pushedAt: repo!.pushed_at, untrustedContent: true };
  }
  if (name === 'gsm_organization_start') {
    if (workbenchRuntime.getSnapshot().running) fail('TASK_BUSY', 'Stop the running GSM task before starting an agent draft.');
    const args = schemas.gsm_organization_start.parse(raw); const signature = await hash(args);
    const proposals = (await storage.listProposals(capturedOwnerId)).filter(p => p.organization); check();
    const duplicate = proposals.find(p => p.organization!.externalAgent?.startRequestId === args.requestId);
    if (duplicate) {
      if (duplicate.organization!.externalAgent!.startHash !== signature) fail('REQUEST_ID_REUSED', 'Use a new requestId for different content.');
      return { ...summary(duplicate), replayed: true };
    }
    const base = args.baseProposalId ? proposals.find(p => p.id === args.baseProposalId) : proposals.find(p => p.organization?.dual && !['imported', 'applying', 'restoring'].includes(p.organization.status));
    if (args.baseProposalId && !base) fail('DRAFT_NOT_FOUND', 'Base draft is not in this account.');
    if (base && !base.organization?.dual) fail('LEGACY_DRAFT', 'Continue legacy drafts in GSM first; no automatic reinterpretation.');
    const ids = args.repositoryIds ?? (!args.redesign && base ? base.organization!.scope.repositoryIds : state.repositories.map(repo => repo.id));
    if (new Set(ids).size !== ids.length || ids.some(id => !state.repositories.some(repo => repo.id === id))) fail('INVALID_SCOPE', 'Scope must contain distinct repositories from the active account.');
    const repositories = state.repositories.filter(repo => ids.includes(repo.id));
    if (!repositories.length) fail('EMPTY_SCOPE', 'No repositories to organize.');
    const oldSession = base ? await storage.getSession(base.sessionId) : null; check();
    const sessionId = oldSession?.ownerId === capturedOwnerId && !oldSession.archived && !oldSession.deletedAt ? oldSession.id : crypto.randomUUID();
    const now = new Date().toISOString();
    const draft = createDualOrganizationDraft({ repositories, scopeName: 'local-agent', instruction: args.instruction, configId: 'local-agent', previous: base?.organization });
    draft.revision = Math.max(0, ...proposals.filter(p => p.sessionId === sessionId).map(p => p.organization!.revision)) + 1;
    const resumable = base?.organization?.dual && !args.redesign && !['applied', 'restored', 'imported'].includes(base.organization.status);
    if (resumable) {
      for (const schemeId of CLASSIFICATION_SCHEME_IDS) {
        const old = base!.organization!.dual!.schemes[schemeId];
        if (stableStructure(structureSnapshot(classificationProjection(state, schemeId))) !== stableStructure(old.after ?? old.before)) fail('SOURCE_CHANGED', 'Actual categories changed since the source draft. Start with redesign=true.');
        const previous = clone(old); delete previous.application; delete previous.after;
        previous.structureOperations = previous.structureOperations?.filter(op => ['pending', 'conflict'].includes(op.status));
        previous.entries = repositories.map(repo => {
          const entry = previous.entries.find(row => row.repositoryId === repo.id);
          const original = base!.organization!.dual!.understanding.find(row => row.repositoryId === repo.id);
          if (!entry || !sameMembership(entry.before, classificationMembership(repo, schemeId)) || original?.fingerprint !== organizationFingerprint(repo)) return draft.dual!.schemes[schemeId].entries.find(row => row.repositoryId === repo.id)!;
          const result = { ...entry, status: 'pending' as const, overrideLocked: false };
          if (result.before.locked && result.categoryId !== result.before.categoryId) result.selected = false;
          return result;
        });
        // Merge operations cannot be resumed with only part of their full membership.
        if (previous.structureOperations?.some(op => op.kind === 'merge' && op.members.some(member => !ids.includes(member.repositoryId)))) fail('INCOMPLETE_MERGE_SCOPE', 'Include every member of the pending merge or start a fresh draft.');
        draft.dual!.schemes[schemeId] = previous;
      }
    }
    for (const schemeId of CLASSIFICATION_SCHEME_IDS) { draft.dual!.schemes[schemeId].ready = true; draft.dual!.schemes[schemeId].cleanupReplaced = false; }
    draft.status = 'ready'; draft.structureReady = true; draft.dual!.phase = 'review'; draft.dual!.outcome = 'empty';
    draft.externalAgent = { source: 'local-agent', startRequestId: args.requestId, startHash: signature, ...(base ? { baseProposalId: base.id } : {}), receipts: [] };
    const proposal: WorkbenchProposal = { id: crypto.randomUUID(), ownerId: capturedOwnerId, sessionId, createdAt: now, updatedAt: now, operations: [], organization: draft };
    check();
    if (sessionId !== oldSession?.id) await storage.saveSession({ id: sessionId, ownerId: capturedOwnerId, kind: 'workbench', repoId: 0, repoFullName: '', sourceRefSha: '',
      title: state.language.startsWith('zh') ? '本地 Agent 整理' : 'Local Agent Organization', modelConfigId: null, createdAt: now, updatedAt: now });
    check(); await saveOrganizationProposal(proposal); check(); return summary(proposal);
  }
  const args = task.passthrough().parse(raw);
  const stored = await requireOrganizationProposal(args.taskId); check();
  if (!stored.organization?.dual) fail('LEGACY_DRAFT', 'Legacy draft is not a dual-scheme task.');
  if (name === 'gsm_organization_checkpoint') {
    const input = schemas.gsm_organization_checkpoint.parse(raw); const value = stored.organization!.dual!.schemes[input.schemeId];
    return { ...summary(stored), schemeId: input.schemeId, categories: value.categories, structureOperations: value.structureOperations ?? [],
      total: value.entries.length, offset: input.offset, entries: value.entries.slice(input.offset, input.offset + input.limit) };
  }
  if (name === 'gsm_organization_edit') {
    editable(stored); const input = schemas.gsm_organization_edit.parse(raw); const signature = await hash({ ...input, expectedRevision: undefined }); check();
    const receipt = stored.organization!.externalAgent!.receipts.find(row => row.requestId === input.requestId);
    if (receipt) {
      if (receipt.hash !== signature) fail('REQUEST_ID_REUSED', 'Use a different requestId for new content.');
      return { ...summary(stored), aliases: receipt.aliases, replayed: true };
    }
    if (stored.updatedAt !== input.expectedRevision) fail('REVISION_CONFLICT', 'Read the newest checkpoint before editing.', { expectedRevision: stored.updatedAt });
    let next = clone(stored); const aliases: Record<string, string> = {};
    const resolve = (value: string | null | undefined, schemeId: ClassificationSchemeId) => value ? aliases[`${schemeId}:${value}`] ?? value : value;
    for (const item of input.categories) {
      if (item.ref && aliases[`${item.schemeId}:${item.ref}`]) fail('DUPLICATE_REF', 'Request-local category references must be distinct.');
      const targetId = resolve(item.targetId, item.schemeId);
      if (targetId && !next.organization!.dual!.schemes[item.schemeId].categories.some(row => row.id === targetId)) fail('INVALID_TARGET', 'Category target does not exist in this scheme.');
      const before = new Set(next.organization!.dual!.schemes[item.schemeId].categories.map(row => row.id));
      next = changeCategoryTree(next, item.schemeId, { ...item, targetId: resolve(item.targetId, item.schemeId) ?? undefined,
        parentId: resolve(item.parentId, item.schemeId), sourceIds: item.sourceIds?.map(value => resolve(value, item.schemeId)!) });
      const created = next.organization!.dual!.schemes[item.schemeId].categories.find(row => !before.has(row.id));
      if (item.ref) { if (!created) fail('INVALID_REF', 'Only creation can declare a new category reference.'); aliases[`${item.schemeId}:${item.ref}`] = created!.id; }
    }
    const seen = new Set<string>();
    for (const item of input.assignments) {
      const key = `${item.schemeId}:${item.repositoryId}`; if (seen.has(key)) fail('DUPLICATE_ASSIGNMENT', 'Each repository/scheme pair must appear once per edit.'); seen.add(key);
      const value = next.organization!.dual!.schemes[item.schemeId]; const row = value.entries.find(entry => entry.repositoryId === item.repositoryId);
      if (!row || row.status !== 'pending') fail('INVALID_REPOSITORY', 'Repository is outside this editable scope.');
      const categoryId = resolve(item.categoryId, item.schemeId) ?? null; const subcategoryId = resolve(item.subcategoryId, item.schemeId) ?? null;
      if (categoryId && !value.categories.some(c => c.id === categoryId && !c.parentId) || subcategoryId && !value.categories.some(c => c.id === subcategoryId && c.parentId === categoryId)) fail('INVALID_TARGET', 'Choose a valid main category and its child.');
      const unchanged = categoryId === row!.before.categoryId && subcategoryId === row!.before.subcategoryId;
      if (item.disposition !== 'insufficient' && (!categoryId || (item.disposition === 'unchanged') !== unchanged)) fail('INVALID_DISPOSITION', 'Classification requires a main category and an accurate move/unchanged disposition.');
      if (item.disposition === 'insufficient' && !unchanged) fail('INVALID_UNCERTAIN_TARGET', 'Uncertain repositories must retain their original membership.');
      Object.assign(row!, { categoryId, subcategoryId, reason: item.reason, disposition: item.disposition, verification: 'verified', manual: row!.manual,
        selected: item.disposition === 'move' && !(row!.before.locked && categoryId !== row!.before.categoryId), overrideLocked: false }); delete row!.error;
    }
    protectManual(stored, next, input.replaceManual);
    // Tree merge helpers mark explicit UI decisions as manual; external suggestions are not manual authorizations.
    for (const schemeId of CLASSIFICATION_SCHEME_IDS) for (const row of next.organization!.dual!.schemes[schemeId].entries) {
      const original = stored.organization!.dual!.schemes[schemeId].entries.find(old => old.repositoryId === row.repositoryId);
      row.manual = original?.manual ?? false; row.overrideLocked = false;
      if (row.before.locked && row.categoryId !== row.before.categoryId) row.selected = false;
    }
    next.organization!.externalAgent!.progress = input.progress ?? next.organization!.externalAgent!.progress;
    next.organization!.externalAgent!.receipts = [...next.organization!.externalAgent!.receipts, { requestId: input.requestId, hash: signature, aliases }].slice(-100);
    const counts = coverage(next); const all = Object.values(counts);
    next.organization!.dual!.outcome = all.every(value => !value.missing.length && !value.uncertain) ? 'complete' : all.some(value => value.valid) ? 'partial' : 'empty';
    next.organization!.batches.forEach(batch => { batch.status = CLASSIFICATION_SCHEME_IDS.every(schemeId => batch.repositoryIds.every(id => {
      const row = next.organization!.dual!.schemes[schemeId].entries.find(entry => entry.repositoryId === id); return row?.manual || row?.verification === 'verified';
    })) ? 'complete' : 'pending'; });
    check(); editable(await requireOrganizationProposal(next.id, stored.updatedAt)); check();
    await saveOrganizationProposal(next, stored.updatedAt); check(); return { ...summary(next), aliases };
  }
  if (name === 'gsm_organization_review') {
    const preview = previewCategoryApplication(stored);
    return { ...summary(stored), eligible: preview.eligible, deferred: preview.deferred, conflicts: preview.conflicts, humanApplicationRequired: true };
  }
  if (name === 'gsm_organization_open_preview') {
    check(); sessionStorage.setItem(`gsm:organization-session:${capturedOwnerId}`, stored.sessionId);
    sessionStorage.setItem('gsm:pending-agent-organization', JSON.stringify({ taskId: stored.id, sessionId: stored.sessionId, ownerId: capturedOwnerId }));
    useAppStore.getState().setCurrentView('repositories');
    window.dispatchEvent(new CustomEvent('gsm:agent-organization-open'));
    return { ...summary(stored), previewRequested: true, humanApplicationRequired: true };
  }
  return fail('UNKNOWN_TOOL', 'Unsupported organization tool.');
}

let queue: Promise<unknown> = Promise.resolve();
export function executeOrganizationTool(name: string, args: unknown, ownerId: string, signal: AbortSignal): Promise<unknown> {
  const execute = async () => {
    try {
      if (!Object.prototype.hasOwnProperty.call(schemas, name)) fail('UNKNOWN_TOOL', 'Unsupported organization tool.');
      return await runTool(name as ToolName, args, ownerId, signal);
    } catch (error) {
      if (error instanceof OrganizationToolError) return { error: { code: error.code, message: error.message, details: error.details } };
      if (error instanceof ProposalRevisionError) return { error: { code: 'REVISION_CONFLICT', message: error.message } };
      if (error instanceof z.ZodError) return { error: { code: 'INVALID_INPUT', message: 'Invalid tool arguments or draft structure.', issues: error.issues.map(issue => ({ path: issue.path, message: issue.message })) } };
      if (signal.aborted) return { error: { code: 'GSM_REQUEST_TIMEOUT', message: 'GSM request expired. Read checkpoint before retrying.' } };
      const message = error instanceof Error ? error.message : '';
      const known = ['Draft changed', 'Only the latest', 'read-only', 'account', 'Account', 'Locked', 'category', 'Category', 'merge', 'Merge', 'Withdraw'];
      return { error: { code: name === 'gsm_organization_evidence' ? 'EVIDENCE_READ_FAILED' : 'DRAFT_VALIDATION_FAILED',
        message: known.some(word => message.includes(word)) ? message.slice(0, 500) : 'Request failed. Check GSM configuration or read the newest checkpoint.' } };
    }
  };
  if (!['gsm_organization_start', 'gsm_organization_edit'].includes(name)) return execute();
  const result = queue.then(execute, execute); queue = result.then(() => undefined, () => undefined); return result;
}
