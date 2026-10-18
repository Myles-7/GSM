import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createInitialState } from '../store/initialState';
import type { AppStoreState } from '../store/types';
import type { Repository } from '../types';
import { createCategorySlice } from '../store/slices/categorySlice';
import { createClassificationSlice } from '../store/slices/classificationSlice';
const mocks = vi.hoisted(() => ({ state: {} as AppStoreState, readme: vi.fn(), sync: vi.fn(), runtime: { running: false }, navigate: vi.fn() }));
vi.mock('../store/useAppStore', () => ({ useAppStore: { getState: () => mocks.state, setState: (patch: Partial<AppStoreState>) => { mocks.state = { ...mocks.state, ...patch }; } } }));
vi.mock('./aiWorkbenchService', () => ({ workbenchRuntime: { getSnapshot: () => mocks.runtime } }));
vi.mock('./repositoryDetailReadme', () => ({ getRepositoryDetailReadme: mocks.readme }));
vi.mock('./autoSync', () => ({ forceSyncToBackend: mocks.sync }));
import { repositoryChatStorage as storage, ProposalRevisionError } from './repositoryChatStorage';
import { executeOrganizationTool } from './mcpOrganizationService';
import { applyOrganizationProposal, editOrganizationProposal, restoreOrganizationProposal } from './aiOrganizationExecution';
import { organizationDraftSchema } from './aiOrganizationSchema';

const date = '2026-10-07T00:00:00.000Z';
const repo = (id: number, patch: Partial<Repository> = {}): Repository => ({ id, name: `project-${id}`, full_name: `fixture/project-${id}`, description: 'A numerical computing library',
  html_url: `https://github.com/fixture/project-${id}`, stargazers_count: 1, forks: 0, forks_count: 0, language: 'Python', topics: ['scientific'],
  owner: { login: 'fixture', avatar_url: '' }, created_at: date, updated_at: date, pushed_at: date, category_id: null, subcategory_id: null, ...patch });
type Reply = { taskId: string; expectedRevision: string; aliases: Record<string, string>; replayed?: boolean; error?: { code: string }; coverage: Record<string, { valid: number; missing: number[]; uncertain: number }> };
const call = (name: string, args: Record<string, unknown> = {}, ownerId = '42', signal = new AbortController().signal) => executeOrganizationTool(name, args, ownerId, signal) as Promise<Reply>;
const start = () => call('gsm_organization_start', { ownerId: '42', requestId: crypto.randomUUID(), redesign: true });
beforeEach(async () => {
  localStorage.clear(); sessionStorage.clear();
  const set: Parameters<typeof createCategorySlice>[0] = patch => { mocks.state = { ...mocks.state, ...(typeof patch === 'function' ? patch(mocks.state) : patch) }; };
  const get = () => mocks.state;
  mocks.state = { ...createInitialState(), ...createCategorySlice(set, get), ...createClassificationSlice(set, get), setCurrentView: mocks.navigate,
    user: { id: 42, login: 'fixture' } as never, githubToken: 'private-test-token', repositories: [repo(1), repo(2)] } as unknown as AppStoreState;
  mocks.runtime.running = false; mocks.readme.mockReset().mockResolvedValue({ content: 'Scientific computing', retrievedAt: date }); mocks.sync.mockReset().mockResolvedValue(undefined); mocks.navigate.mockReset();
  const dbs = await indexedDB.databases();
  for (const db of dbs) if (db.name) await new Promise<void>((resolve, reject) => { const request = indexedDB.deleteDatabase(db.name!); request.onsuccess = () => resolve(); request.onerror = () => reject(request.error); });
});

describe('local agent draft-only organization', () => {
  it('reads paginated metadata and both trees without exposing credentials; README is opt-in', async () => {
    const overview = await call('gsm_organization_overview'); expect(JSON.stringify(overview)).not.toContain('private-test-token');
    const page = await call('gsm_organization_repositories', { ownerId: '42', offset: 1, limit: 1 }); expect(JSON.stringify(page)).toContain('fixture/project-2');
    await call('gsm_organization_evidence', { ownerId: '42', repositoryId: 1 }); expect(mocks.readme).not.toHaveBeenCalled();
    await call('gsm_organization_evidence', { ownerId: '42', repositoryId: 1, readme: true }); expect(mocks.readme).toHaveBeenCalledOnce();
    expect((await call('gsm_organization_repositories', { ownerId: 'another' })).error?.code).toBe('ACCOUNT_CHANGED');
  });
  it('creates a genuinely pending checkpoint and resumes without applying classifications', async () => {
    const result = await start(); expect(result.error).toBeUndefined(); expect(result.coverage.purpose.valid).toBe(0); expect(result.coverage.purpose.missing).toEqual([1, 2]);
    expect(mocks.state.repositories.map(r => r.category_id)).toEqual([null, null]);
    const stored = await storage.getProposal(result.taskId); expect(organizationDraftSchema.safeParse(stored!.organization).success).toBe(true);
    expect(stored!.organization!.dual!.schemes.purpose.entries.every(row => !row.manual)).toBe(true);
    const continued = await call('gsm_organization_start', { ownerId: '42', requestId: 'continue' }); expect(continued.taskId).not.toBe(result.taskId);
    expect((await storage.getProposal(continued.taskId))!.organization!.externalAgent!.baseProposalId).toBe(result.taskId);
  });
  it('is idempotent for task creation and rejects changed request content', async () => {
    const args = { ownerId: '42', requestId: 'start-once', redesign: true };
    const a = await call('gsm_organization_start', args); const b = await call('gsm_organization_start', args);
    expect(a.taskId).toBe(b.taskId); expect(b.replayed).toBe(true);
    expect((await call('gsm_organization_start', { ...args, instruction: 'changed' })).error?.code).toBe('REQUEST_ID_REUSED');
  });
  it('edits both schemes with request-local aliases, saves partial coverage, rejects stale revisions, and never mutates Store', async () => {
    const task = await start();
    const input = { ownerId: '42', taskId: task.taskId, expectedRevision: task.expectedRevision, requestId: 'edit-once',
      categories: [{ schemeId: 'purpose', kind: 'create', name: 'Scientific Work', ref: 'science' }, { schemeId: 'technology', kind: 'create', name: 'Numerical Libraries', ref: 'numerical' }],
      assignments: [{ schemeId: 'purpose', repositoryId: 1, categoryId: 'science', subcategoryId: null, disposition: 'move', reason: 'Numerical computations' },
        { schemeId: 'technology', repositoryId: 1, categoryId: 'numerical', subcategoryId: null, disposition: 'move', reason: 'Python numerical library' }] };
    const edited = await call('gsm_organization_edit', input); expect(edited.error).toBeUndefined(); expect(edited.coverage.purpose.valid).toBe(1); expect(edited.coverage.technology.valid).toBe(1);
    expect(edited.coverage.purpose.missing).toEqual([2]); expect(mocks.state.customCategories).toEqual([]);
    const repeated = await call('gsm_organization_edit', input); expect(repeated.replayed).toBe(true); expect(repeated.aliases).toEqual(edited.aliases);
    expect((await call('gsm_organization_edit', { ...input, categories: [], assignments: [], requestId: 'stale' })).error?.code).toBe('REVISION_CONFLICT');
    expect((await call('gsm_organization_edit', { ...input, progress: 'different' })).error?.code).toBe('REQUEST_ID_REUSED');
    const proposal = (await storage.getProposal(task.taskId))!; expect(proposal.organization!.dual!.outcome).toBe('partial');
    const applied = await applyOrganizationProposal(task.taskId, proposal.updatedAt); expect(applied.organization!.dual!.schemes.purpose.entries[0].status).toBe('success');
    expect(mocks.state.repositories[0].category_id).toBe(edited.aliases['purpose:science']);
    const restored = await restoreOrganizationProposal(task.taskId, applied.updatedAt); expect(restored.organization!.dual!.schemes.purpose.entries[0].status).toBe('restored');
    expect(mocks.state.repositories[0].category_id).toBeNull();
  });
  it('rolls back a whole invalid edit before persisting any new category', async () => {
    const task = await start(); const input = { ownerId: '42', taskId: task.taskId, expectedRevision: task.expectedRevision, requestId: 'invalid',
      categories: [{ schemeId: 'purpose', kind: 'create', name: 'Valid Category', ref: 'new' }],
      assignments: [{ schemeId: 'purpose', repositoryId: 999, categoryId: 'new', subcategoryId: null, disposition: 'move', reason: 'Unknown repository' }] };
    expect((await call('gsm_organization_edit', input)).error?.code).toBe('INVALID_REPOSITORY');
    expect((await storage.getProposal(task.taskId))!.updatedAt).toBe(task.expectedRevision);
  });
  it('protects manual decisions and exposes locked proposals without authorizing them', async () => {
    mocks.state.repositories = [repo(1, { category_id: 'devtools', category_locked: true }), repo(2)]; const task = await start();
    const changed = await call('gsm_organization_edit', { ownerId: '42', taskId: task.taskId, expectedRevision: task.expectedRevision, requestId: 'locked',
      categories: [{ schemeId: 'purpose', kind: 'create', name: 'Scientific Work', ref: 'science' }],
      assignments: [{ schemeId: 'purpose', repositoryId: 1, categoryId: 'science', subcategoryId: null, disposition: 'move', reason: 'Scientific tool' }] });
    expect(changed.error).toBeUndefined();
    const stored = (await storage.getProposal(task.taskId))!; const row = stored.organization!.dual!.schemes.purpose.entries[0]; expect(row.selected).toBe(false); expect(row.overrideLocked).toBe(false);
    const manual = await editOrganizationProposal(task.taskId, stored.updatedAt, { schemeId: 'purpose', repositoryId: 2, patch: { categoryId: row.categoryId, subcategoryId: null } });
    const protectedResult = await call('gsm_organization_edit', { ownerId: '42', taskId: task.taskId, expectedRevision: manual.updatedAt, requestId: 'protected',
      assignments: [{ schemeId: 'purpose', repositoryId: 2, categoryId: 'devtools', subcategoryId: null, disposition: 'move', reason: 'Agent disagrees' }] });
    expect(protectedResult.error?.code).toBe('MANUAL_RESULT_PROTECTED');
  });
  it('returns review coverage and opens only the preview, never applying changes', async () => {
    const task = await start();
    expect((await call('gsm_organization_review', { ownerId: '42', taskId: task.taskId })).coverage.technology.missing).toEqual([1, 2]);
    await call('gsm_organization_open_preview', { ownerId: '42', taskId: task.taskId }); expect(mocks.navigate).toHaveBeenCalledWith('repositories');
    expect(JSON.parse(sessionStorage.getItem('gsm:pending-agent-organization')!).taskId).toBe(task.taskId); expect(mocks.sync).not.toHaveBeenCalled();
  });
  it('rejects account changes, cancellation, active application and unknown write tools', async () => {
    const task = await start(); mocks.runtime.running = true;
    expect((await call('gsm_organization_edit', { ownerId: '42', taskId: task.taskId, expectedRevision: task.expectedRevision, requestId: 'busy' })).error?.code).toBe('TASK_BUSY');
    mocks.runtime.running = false; mocks.state.user = { id: 7 } as never;
    expect((await call('gsm_organization_checkpoint', { ownerId: '42', taskId: task.taskId })).error?.code).toBe('ACCOUNT_CHANGED');
    expect((await call('gsm_apply')).error?.code).toBe('UNKNOWN_TOOL');
    const controller = new AbortController(); controller.abort(); expect((await call('gsm_organization_overview', {}, '7', controller.signal)).error?.code).toBe('GSM_REQUEST_TIMEOUT');
  });
  it('atomically refuses an outdated storage write rather than silently falling back', async () => {
    const task = await start(); const proposal = (await storage.getProposal(task.taskId))!;
    await expect(storage.saveProposal({ ...proposal, updatedAt: 'later' }, 'obsolete')).rejects.toBeInstanceOf(ProposalRevisionError);
    expect((await storage.getProposal(task.taskId))!.updatedAt).toBe(task.expectedRevision);
  });
  it('renames and merges subcategories without changing main membership or locks, then restores after UI confirmation', async () => {
    mocks.state.customCategories = [{ id: 'science', name: 'Science', icon: 'folder', keywords: [], isCustom: true }];
    mocks.state.subcategories = [{ id: 'numeric', parentId: 'science', name: 'Numeric', icon: 'folder' }, { id: 'data', parentId: 'science', name: 'Data', icon: 'folder' }];
    mocks.state.repositories = [repo(1, { category_id: 'science', subcategory_id: 'numeric', category_locked: true }), repo(2, { category_id: 'science', subcategory_id: 'data' })];
    const task = await start();
    const edited = await call('gsm_organization_edit', { ownerId: '42', taskId: task.taskId, expectedRevision: task.expectedRevision, requestId: 'subgroup-merge', categories: [
      { schemeId: 'purpose', kind: 'rename', targetId: 'numeric', name: 'Scientific Computing' },
      { schemeId: 'purpose', kind: 'merge', targetId: 'numeric', sourceIds: ['data'] },
    ] });
    expect(edited.error).toBeUndefined();
    expect(mocks.state.repositories[1].subcategory_id).toBe('data');
    const preview = await call('gsm_organization_review', { ownerId: '42', taskId: task.taskId });
    expect((preview as unknown as { deferred: unknown[] }).deferred).toEqual([]);
    const applied = await applyOrganizationProposal(task.taskId, edited.expectedRevision);
    expect(mocks.state.repositories.map(row => row.category_id)).toEqual(['science', 'science']);
    expect(mocks.state.repositories.map(row => row.subcategory_id)).toEqual(['numeric', 'numeric']);
    expect(mocks.state.repositories[0].category_locked).toBe(true);
    expect(mocks.state.subcategories.map(row => row.id)).toEqual(['numeric']);
    await restoreOrganizationProposal(task.taskId, applied.updatedAt);
    expect(mocks.state.repositories[1].subcategory_id).toBe('data');
    expect(mocks.state.subcategories.find(row => row.id === 'numeric')!.name).toBe('Numeric');
  });
  it('rejects nonexistent category targets instead of creating an unintended merge destination', async () => {
    const task = await start();
    expect((await call('gsm_organization_edit', { ownerId: '42', taskId: task.taskId, expectedRevision: task.expectedRevision, requestId: 'invalid-merge',
      categories: [{ schemeId: 'purpose', kind: 'merge', targetId: 'typo', sourceIds: ['devtools'], name: 'Typo' }] })).error?.code).toBe('INVALID_TARGET');
  });
});
