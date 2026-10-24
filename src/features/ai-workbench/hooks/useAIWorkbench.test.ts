import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '../../../store/useAppStore';
import { repositoryChatStorage as storage } from '../../../services/repositoryChatStorage';
import { workbenchRuntime } from '../../../services/aiWorkbenchService';
import { useAIWorkbench } from './useAIWorkbench';
import { AIService } from '../../../services/aiService';
import type { AppState, Repository } from '../../../types';
import type { WorkbenchProposal } from '../../../types/aiWorkbench';
vi.unmock('../../../store/useAppStore');

const mocks = vi.hoisted(() => ({
  prepare: vi.fn(), search: vi.fn(), answer: vi.fn(), overviewAnswer: vi.fn(), retryOverview: vi.fn(), propose: vi.fn(), execute: vi.fn(), restore: vi.fn(),
  bindLocal: vi.fn(), getLocal: vi.fn(), researchLocal: vi.fn(), organize: vi.fn(),
}));
vi.mock('../../../services/aiOrganizationWorkflow', () => ({ runOrganizationGeneration: mocks.organize }));
vi.mock('../../../services/localResearchGrants', () => ({
  bindLocalResearchGrant: mocks.bindLocal, getLocalResearchGrant: mocks.getLocal,
}));
vi.mock('../../../services/localResearch', () => ({ researchLocalProject: mocks.researchLocal }));
vi.mock('../../../services/aiWorkbenchService', async (original) => ({
  ...await original<typeof import('../../../services/aiWorkbenchService')>(),
  prepareWorkbenchRequirements: mocks.prepare,
  searchWorkbench: mocks.search,
  answerWorkbench: mocks.answer,
  answerWorkbenchOverview: mocks.overviewAnswer,
  overviewWorkbenchBatch: mocks.retryOverview,
}));
vi.mock('../../../services/aiWorkbenchOperations', () => ({
  proposeWorkbenchOperations: mocks.propose,
  executeWorkbenchProposal: mocks.execute,
  restoreWorkbenchProposal: mocks.restore,
}));
const requirements = { purpose: 'Modeling', required: [], preferred: [], excluded: [], questions: [], queries: ['modeling'] };
const user = { id: 77, login: 'fixture' } as NonNullable<AppState['user']>;
const repository = {
  id: 99, full_name: 'fixture/repo', name: 'repo', owner: { login: 'fixture', avatar_url: '' },
  description: '', topics: [], stargazers_count: 1, forks_count: 0, forks: 0,
  html_url: 'https://github.com/fixture/repo', language: 'Python',
  created_at: new Date().toISOString(), updated_at: new Date().toISOString(), pushed_at: new Date().toISOString(),
} as Repository;

beforeEach(() => {
  localStorage.clear(); sessionStorage.clear(); vi.clearAllMocks();
  Object.defineProperty(window, 'indexedDB', { configurable: true, value: undefined });
  useAppStore.setState({
    ...useAppStore.getInitialState(), user, githubToken: 'fixture-token', repositories: [repository], language: 'en',
  });
  mocks.prepare.mockResolvedValue(requirements);
  mocks.answer.mockResolvedValue({ content: 'Evidence-backed answer', evidences: [] });
  mocks.overviewAnswer.mockResolvedValue({ content: 'A local editor; cloud sync is unknown.', evidences: [], quality: 'unreviewed' });
  mocks.getLocal.mockReturnValue(undefined);
  mocks.bindLocal.mockResolvedValue({ id: 'grant', name: 'fixture', identity: 'a'.repeat(64), entries: [], truncated: false });
  mocks.researchLocal.mockResolvedValue({ content: 'Local answer', evidences: [], quality: 'model-reviewed', claims: [], coverage: [] });
  mocks.propose.mockResolvedValue({ id: 'proposal', ownerId: '77', sessionId: '', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), operations: [] });
});

describe('AI workbench integration', () => {
  it('researches library matches in relevance order while keeping authoritative scoped repositories', async () => {
    const second = { ...repository, id: 100, name: 'second', full_name: 'fixture/second' };
    useAppStore.setState({ repositories: [repository, second], activeAIConfig: 'model', aiConfigs: [{
      id: 'model', name: 'Fixture', model: 'fixture', apiKey: 'synthetic', baseUrl: 'https://fixture.invalid', isActive: true,
    }] });
    const selection = vi.spyOn(AIService.prototype, 'searchRepositoriesWithSelection').mockResolvedValue([
      { ...second, description: 'Model must not overwrite source metadata' }, repository, second,
      { ...repository, id: 101, full_name: 'outside/scope' },
    ]);
    const hook = renderHook(useAIWorkbench);
    try {
      await act(async () => { await hook.result.current.chooseTask('research', 'library'); });
      await act(async () => { await hook.result.current.send('Find relevant projects'); });
      expect(mocks.answer).toHaveBeenCalledWith(expect.objectContaining({ repositories: [second, repository] }));
    } finally { hook.unmount(); selection.mockRestore(); }
  });
  it('configures a task before session activation and persists it across reopening without sending', async () => {
    const hook = renderHook(useAIWorkbench);
    let seeded = '';
    await act(async () => {
      const record = await hook.result.current.chooseTask('organize', 'github', created => {
        expect(sessionStorage.getItem('gsm:ai-workbench-session')).toBeNull();
        seeded = created.id;
        expect(created.workbench).toMatchObject({ taskMode: 'organize', scope: 'library', inputIntent: 'research' });
      });
      expect(record.id).toBe(seeded);
    });
    expect(await storage.listMessages(seeded)).toEqual([]);
    expect(mocks.prepare).not.toHaveBeenCalled();
    expect(mocks.answer).not.toHaveBeenCalled();
    expect(mocks.propose).not.toHaveBeenCalled();
    hook.unmount();
    const reopened = renderHook(useAIWorkbench);
    await waitFor(() => expect(reopened.result.current.data.taskMode).toBe('organize'));
    await act(async () => { await reopened.result.current.chooseTask('discover'); });
    expect((await storage.getSession(seeded))?.workbench).toMatchObject({ taskMode: 'discover', scope: 'github', inputIntent: 'search' });
    expect(await storage.listWorkbenchSessions('77')).toHaveLength(1);
    reopened.unmount();
  });

  it('keeps the last rapid task choice and creates only one configured session', async () => {
    const hook = renderHook(useAIWorkbench);
    const callback = vi.fn();
    await act(async () => {
      const first = hook.result.current.chooseTask('discover', undefined, callback).catch(error => error);
      const second = hook.result.current.chooseTask('research', 'library', callback);
      expect(await first).toMatchObject({ name: 'AbortError' });
      expect((await second).workbench).toMatchObject({ taskMode: 'research', scope: 'library', inputIntent: 'research' });
    });
    expect(callback).toHaveBeenCalledOnce();
    expect(await storage.listWorkbenchSessions('77')).toHaveLength(1);
    hook.unmount();
  });

  it('reuses a session still being saved when a newer task choice arrives', async () => {
    const hook = renderHook(useAIWorkbench);
    const originalSave = storage.saveSession.bind(storage);
    let release!: () => void;
    let saving!: () => void;
    const started = new Promise<void>(resolve => { saving = resolve; });
    const delayed = vi.spyOn(storage, 'saveSession').mockImplementationOnce(async record => {
      saving(); await new Promise<void>(resolve => { release = resolve; }); await originalSave(record);
    });
    const callback = vi.fn();
    let first!: Promise<unknown>;
    act(() => { first = hook.result.current.chooseTask('discover').catch(error => error); });
    await started;
    let second!: Promise<unknown>;
    act(() => { second = hook.result.current.chooseTask('research', 'selected', callback); });
    await act(async () => {
      release();
      expect(await first).toMatchObject({ name: 'AbortError' });
      expect(await second).toMatchObject({ workbench: { taskMode: 'research', scope: 'selected' } });
    });
    expect(callback).toHaveBeenCalledOnce();
    expect(await storage.listWorkbenchSessions('77')).toHaveLength(1);
    delayed.mockRestore();
    hook.unmount();
  });

  it('sends immediately after task setup into the same session without waiting for a render', async () => {
    const hook = renderHook(useAIWorkbench);
    let id = '';
    await act(async () => {
      id = (await hook.result.current.chooseTask('research', 'selected')).id;
      await hook.result.current.send('Explain the selected repositories');
    });
    expect(mocks.answer).toHaveBeenCalledWith(expect.objectContaining({ session: expect.objectContaining({ id }) }));
    expect(await storage.listWorkbenchSessions('77')).toHaveLength(1);
    expect(await storage.listMessages(id)).toHaveLength(2);
    hook.unmount();
  });

  it('seeds local session drafts before activation and records local research only after a folder is chosen', async () => {
    const hook = renderHook(useAIWorkbench);
    const callback = vi.fn(record => {
      expect(sessionStorage.getItem('gsm:ai-workbench-session')).toBeNull();
      expect(record.ownerId).toBe('77');
    });
    await act(async () => { await hook.result.current.chooseLocalProject(callback); });
    expect(callback).toHaveBeenCalledOnce();
    expect(hook.result.current.active?.workbench).toMatchObject({ scope: 'local', taskMode: 'research', inputIntent: 'research',
      localProject: { name: 'fixture', identity: 'a'.repeat(64) } });
    expect(mocks.researchLocal).not.toHaveBeenCalled();
    hook.unmount();
  });

  it('does not activate a task session when the user changes conversations during persistence', async () => {
    const hook = renderHook(useAIWorkbench);
    const originalSave = storage.saveSession.bind(storage);
    let release!: () => void;
    let saving!: () => void;
    const started = new Promise<void>(resolve => { saving = resolve; });
    const delayed = vi.spyOn(storage, 'saveSession').mockImplementationOnce(async record => {
      saving(); await new Promise<void>(resolve => { release = resolve; }); await originalSave(record);
    });
    const callback = vi.fn();
    let pending!: Promise<unknown>;
    act(() => { pending = hook.result.current.chooseTask('research', 'selected', callback).catch(error => error); });
    await started;
    act(() => hook.result.current.select('another-conversation'));
    await act(async () => { release(); expect(await pending).toMatchObject({ name: 'AbortError' }); });
    expect(hook.result.current.activeId).toBe('another-conversation');
    expect(sessionStorage.getItem('gsm:ai-workbench-session')).toBe('another-conversation');
    expect(callback).not.toHaveBeenCalled();
    delayed.mockRestore();
    hook.unmount();
  });

  it('does not publish an obsolete task patch while a newer configuration is still saving', async () => {
    const hook = renderHook(useAIWorkbench);
    await act(async () => { await hook.result.current.chooseTask('research', 'selected'); });
    const originalSave = storage.saveSession.bind(storage);
    const releases: Array<() => void> = [];
    const delayed = vi.spyOn(storage, 'saveSession').mockImplementation(async record => {
      await new Promise<void>(resolve => { releases.push(resolve); });
      await originalSave(record);
    });
    let first!: Promise<unknown>;
    act(() => { first = hook.result.current.chooseTask('organize').catch(error => error); });
    await waitFor(() => expect(releases).toHaveLength(1));
    let second!: Promise<unknown>;
    act(() => { second = hook.result.current.chooseTask('discover'); });
    await act(async () => { releases[0](); expect(await first).toMatchObject({ name: 'AbortError' }); });
    await waitFor(() => expect(releases).toHaveLength(2));
    await act(async () => { await hook.result.current.refresh(); });
    expect(hook.result.current.data.taskMode).toBe('research');
    await act(async () => { releases[1](); await second; });
    expect(hook.result.current.data.taskMode).toBe('discover');
    delayed.mockRestore();
    hook.unmount();
  });

  it('does not activate a newly saved local session after manual navigation', async () => {
    const hook = renderHook(useAIWorkbench);
    const originalSave = storage.saveSession.bind(storage);
    let release!: () => void;
    const delayed = vi.spyOn(storage, 'saveSession').mockImplementationOnce(async record => {
      await new Promise<void>(resolve => { release = resolve; }); await originalSave(record);
    });
    const callback = vi.fn();
    let pending!: Promise<unknown>;
    act(() => { pending = hook.result.current.chooseLocalProject(callback).catch(error => error); });
    await waitFor(() => expect(release).toBeDefined());
    act(() => hook.result.current.select('another-conversation'));
    await act(async () => { release(); expect(await pending).toMatchObject({ name: 'AbortError' }); });
    expect(hook.result.current.activeId).toBe('another-conversation');
    expect(callback).not.toHaveBeenCalled();
    expect(mocks.bindLocal).toHaveBeenCalledOnce();
    delayed.mockRestore();
    hook.unmount();
  });

  it('ignores a folder chosen after the user switches conversations', async () => {
    const hook = renderHook(useAIWorkbench);
    let original = '';
    await act(async () => { original = (await hook.result.current.chooseTask('research', 'selected')).id; });
    const before = await storage.getSession(original);
    let release!: (grant: unknown) => void;
    mocks.bindLocal.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    let pending!: Promise<unknown>;
    act(() => { pending = hook.result.current.chooseLocalProject().catch(error => error); });
    await waitFor(() => expect(mocks.bindLocal).toHaveBeenCalledOnce());
    let other = '';
    await act(async () => { other = (await hook.result.current.createSession()).id; });
    await act(async () => {
      release({ id: 'old-grant', name: 'old-folder', identity: 'b'.repeat(64) });
      expect(await pending).toMatchObject({ name: 'AbortError' });
    });
    expect(hook.result.current.activeId).toBe(other);
    expect(await storage.getSession(original)).toEqual(before);
    expect((await storage.getSession(other))?.workbench?.localProject).toBeUndefined();
    hook.unmount();
  });

  it('does not let a late local folder choice override a newer task mode', async () => {
    const hook = renderHook(useAIWorkbench);
    await act(async () => { await hook.result.current.chooseTask('research', 'selected'); });
    let release!: (grant: unknown) => void;
    mocks.bindLocal.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    let pending!: Promise<unknown>;
    act(() => { pending = hook.result.current.chooseLocalProject().catch(error => error); });
    await waitFor(() => expect(mocks.bindLocal).toHaveBeenCalledOnce());
    await act(async () => { await hook.result.current.chooseTask('discover'); });
    await act(async () => {
      release({ id: 'old-grant', name: 'old-folder', identity: 'b'.repeat(64) });
      expect(await pending).toMatchObject({ name: 'AbortError' });
    });
    expect(hook.result.current.data).toMatchObject({ taskMode: 'discover', scope: 'github' });
    expect(hook.result.current.data.localProject).toBeUndefined();
    hook.unmount();
  });

  it('orders overlapping local pickers and persists only the newest chosen folder', async () => {
    const hook = renderHook(useAIWorkbench);
    await act(async () => { await hook.result.current.chooseTask('research', 'selected'); });
    let release!: (grant: unknown) => void;
    mocks.bindLocal.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    mocks.bindLocal.mockResolvedValueOnce({ id: 'new-grant', name: 'new-folder', identity: 'c'.repeat(64) });
    let first!: Promise<unknown>;
    act(() => { first = hook.result.current.chooseLocalProject().catch(error => error); });
    await waitFor(() => expect(mocks.bindLocal).toHaveBeenCalledOnce());
    let second!: Promise<unknown>;
    act(() => { second = hook.result.current.chooseLocalProject(); });
    expect(mocks.bindLocal).toHaveBeenCalledOnce();
    await act(async () => {
      release({ id: 'old-grant', name: 'old-folder', identity: 'b'.repeat(64) });
      expect(await first).toMatchObject({ name: 'AbortError' });
      await second;
    });
    expect(mocks.bindLocal).toHaveBeenCalledTimes(2);
    expect(hook.result.current.data).toMatchObject({ taskMode: 'research', scope: 'local',
      localProject: { name: 'new-folder', identity: 'c'.repeat(64) } });
    hook.unmount();
  });

  it('derives organization from the persisted task and overrides it for explicit repository research', async () => {
    const hook = renderHook(useAIWorkbench);
    await act(async () => { await hook.result.current.chooseTask('organize'); });
    await act(async () => { await hook.result.current.send('Organize my library'); });
    expect(mocks.propose).toHaveBeenCalledOnce();
    await act(async () => { await hook.result.current.send('Explain this repository', true, false, { repositories: [repository] }); });
    expect(mocks.answer).toHaveBeenCalledWith(expect.objectContaining({ repositories: [repository],
      session: expect.objectContaining({ workbench: expect.objectContaining({ taskMode: 'research', scope: 'selected' }) }) }));
    expect((await storage.getSession(hook.result.current.activeId!))?.workbench).toMatchObject({ taskMode: 'research', scope: 'selected', inputIntent: 'research' });
    expect(mocks.propose).toHaveBeenCalledOnce();
    hook.unmount();
  });

  it.each(['discover', 'research'] as const)('does not let historical organization drafts hijack %s tasks', async taskMode => {
    const hook = renderHook(useAIWorkbench);
    let id = '';
    await act(async () => { id = (await hook.result.current.chooseTask(taskMode, 'selected')).id; });
    await storage.saveProposal({ id: 'old-organization', ownerId: '77', sessionId: id, createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(), operations: [], organization: { revision: 1, version: 2,
        scope: { name: 'Library', repositoryIds: [repository.id] }, instruction: '', configId: '', maxNewSubcategories: 6,
        structureReady: true, categories: [], entries: [], batches: [], status: 'ready', createdCategoryIds: [] } } satisfies WorkbenchProposal);
    await act(async () => { await hook.result.current.send('A new task', true); });
    expect(mocks.organize).not.toHaveBeenCalled();
    expect(mocks.propose).not.toHaveBeenCalled();
    expect(taskMode === 'discover' ? mocks.prepare : mocks.answer).toHaveBeenCalledOnce();
    hook.unmount();
  });

  it('researches legacy library sessions with historical organization unless manage is explicitly requested', async () => {
    const date = new Date().toISOString();
    const id = 'legacy-library';
    await storage.saveSession({ id, ownerId: '77', kind: 'workbench', repoId: 0, repoFullName: '', sourceRefSha: '',
      title: 'Library history', createdAt: date, updatedAt: date,
      workbench: { scope: 'library', depth: 'standard', selectedRepositories: [], searchBatches: [] } });
    await storage.saveProposal({ id: 'legacy-organization', ownerId: '77', sessionId: id, createdAt: date, updatedAt: date,
      operations: [], organization: { revision: 1, version: 2, scope: { name: 'Library', repositoryIds: [repository.id] },
        instruction: '', configId: '', maxNewSubcategories: 6, structureReady: true,
        categories: [], entries: [], batches: [], status: 'ready', createdCategoryIds: [] } });
    sessionStorage.setItem('gsm:ai-workbench-session', id);
    const hook = renderHook(useAIWorkbench);
    await waitFor(() => expect(hook.result.current.active?.id).toBe(id));
    await act(async () => { await hook.result.current.send('Explain my saved repositories'); });
    expect(mocks.answer).toHaveBeenCalledWith(expect.objectContaining({ repositories: [repository],
      session: expect.objectContaining({ id }) }));
    expect(mocks.organize).not.toHaveBeenCalled();
    expect(mocks.propose).not.toHaveBeenCalled();
    await act(async () => { await hook.result.current.send('Continue this organization draft', true); });
    expect(mocks.organize).toHaveBeenCalledWith(expect.objectContaining({ sessionId: id, previous: expect.objectContaining({ id: 'legacy-organization' }) }));
    expect(mocks.answer).toHaveBeenCalledOnce();
    hook.unmount();
  });

  it('merges bulk repository selections from current storage and marks selected research', async () => {
    const hook = renderHook(useAIWorkbench);
    let id = '';
    await act(async () => { id = (await hook.result.current.chooseTask('organize')).id; });
    const extra = { ...repository, id: 100, full_name: 'fixture/extra', name: 'extra' };
    const another = { ...repository, id: 101, full_name: 'fixture/another', name: 'another' };
    const latest = (await storage.getSession(id))!;
    await storage.saveSession({ ...latest, workbench: { ...latest.workbench!, selectedRepositories: [extra], depth: 'deep' } });
    await act(async () => { await Promise.all([hook.result.current.addRepositories([repository]), hook.result.current.addRepositories([another])]); });
    expect((await storage.getSession(id))?.workbench).toMatchObject({ taskMode: 'research', scope: 'selected', inputIntent: 'research', depth: 'deep',
      selectedRepositories: [extra, repository, another] });
    hook.unmount();
  });

  it.each(['local', 'mixed'] as const)('keeps local evidence when adding repositories to %s research', async scope => {
    const hook = renderHook(useAIWorkbench);
    let id = '';
    await act(async () => { id = (await hook.result.current.chooseTask('research', scope)).id; });
    const record = (await storage.getSession(id))!;
    const localProject = { name: 'Local fixture', identity: 'a'.repeat(64) };
    await storage.saveSession({ ...record, workbench: { ...record.workbench!, localProject } });
    await act(async () => { await hook.result.current.addRepositories([repository]); });
    expect((await storage.getSession(id))?.workbench).toMatchObject({ taskMode: 'research', scope: 'mixed',
      inputIntent: 'research', localProject, selectedRepositories: [repository] });
    hook.unmount();
  });

  it('treats canceling the local folder picker as a quiet no-op', async () => {
    const hook = renderHook(useAIWorkbench);
    await act(async () => { await hook.result.current.chooseTask('research', 'local'); });
    const original = await storage.getSession(hook.result.current.activeId!);
    mocks.bindLocal.mockRejectedValueOnce(new Error('AGY_CANCELED'));
    await act(async () => { await hook.result.current.guard(async () => { expect(await hook.result.current.chooseLocalProject()).toBe(false); }); });
    expect(hook.result.current.error).toBe('');
    expect(await storage.getSession(original!.id)).toEqual(original);
    expect(await storage.listMessages(original!.id)).toEqual([]);
    expect(mocks.researchLocal).not.toHaveBeenCalled();
    hook.unmount();
  });

  it('keeps a new draft and empty selection untouched when the first folder picker is canceled', async () => {
    localStorage.setItem('gsm:workbench-draft:77:new', 'My unsent question');
    const hook = renderHook(useAIWorkbench);
    const callback = vi.fn();
    mocks.bindLocal.mockRejectedValueOnce(new Error('AGY_CANCELED'));
    await act(async () => { expect(await hook.result.current.chooseLocalProject(callback, 'mixed')).toBe(false); });
    expect(hook.result.current.activeId).toBeNull();
    expect(sessionStorage.getItem('gsm:ai-workbench-session')).toBeNull();
    expect(await storage.listWorkbenchSessions('77')).toEqual([]);
    expect(localStorage.getItem('gsm:workbench-draft:77:new')).toBe('My unsent question');
    expect(callback).not.toHaveBeenCalled();
    expect(mocks.researchLocal).not.toHaveBeenCalled();
    hook.unmount();
  });

  it('keeps a legacy local transcript selected when canceling a folder migration', async () => {
    const date = new Date().toISOString();
    await storage.saveSession({ id: 'legacy-local', ownerId: '77', kind: 'workbench', repoId: 0, repoFullName: '',
      sourceRefSha: '', title: 'Legacy local research', createdAt: date, updatedAt: date, deviceOnly: true,
      workbench: { scope: 'mixed', depth: 'deep', selectedRepositories: [repository], searchBatches: [], localProject: { name: 'legacy-folder' } } });
    await storage.saveMessage({ id: 'legacy-message', sessionId: 'legacy-local', role: 'user', content: 'Earlier local question',
      status: 'complete', evidenceIds: [], createdAt: date });
    sessionStorage.setItem('gsm:ai-workbench-session', 'legacy-local');
    localStorage.setItem('gsm:workbench-draft:77:legacy-local', 'Keep this draft');
    const before = await storage.getSession('legacy-local');
    const hook = renderHook(useAIWorkbench);
    await waitFor(() => expect(hook.result.current.active?.id).toBe('legacy-local'));
    const callback = vi.fn();
    mocks.bindLocal.mockRejectedValueOnce(new Error('AGY_CANCELED'));
    await act(async () => { expect(await hook.result.current.chooseLocalProject(callback)).toBe(false); });
    expect(hook.result.current.activeId).toBe('legacy-local');
    expect(sessionStorage.getItem('gsm:ai-workbench-session')).toBe('legacy-local');
    expect(await storage.listWorkbenchSessions('77')).toHaveLength(1);
    expect(await storage.getSession('legacy-local')).toEqual(before);
    expect(await storage.listMessages('legacy-local')).toHaveLength(1);
    expect(localStorage.getItem('gsm:workbench-draft:77:legacy-local')).toBe('Keep this draft');
    expect(callback).not.toHaveBeenCalled();
    hook.unmount();
  });

  it('binds a new mixed source before saving or activating its session', async () => {
    const hook = renderHook(useAIWorkbench);
    mocks.bindLocal.mockImplementationOnce(async (id: string) => {
      expect(await storage.getSession(id)).toBeNull();
      expect(hook.result.current.activeId).toBeNull();
      return { id: 'mixed-grant', name: 'mixed-folder', identity: 'd'.repeat(64) };
    });
    const callback = vi.fn(record => {
      expect(sessionStorage.getItem('gsm:ai-workbench-session')).toBeNull();
      expect(record.workbench).toMatchObject({ scope: 'mixed', taskMode: 'research', localProject: { name: 'mixed-folder' } });
    });
    await act(async () => { await hook.result.current.chooseLocalProject(callback, 'mixed'); });
    expect(callback).toHaveBeenCalledOnce();
    expect(hook.result.current.data).toMatchObject({ scope: 'mixed', taskMode: 'research', inputIntent: 'research' });
    expect(await storage.listWorkbenchSessions('77')).toHaveLength(1);
    hook.unmount();
  });

  it('lets an explicit local scope replace an existing mixed scope', async () => {
    const hook = renderHook(useAIWorkbench);
    await act(async () => { await hook.result.current.chooseTask('research', 'mixed'); });
    await act(async () => { await hook.result.current.chooseLocalProject(undefined, 'local'); });
    expect(hook.result.current.data.scope).toBe('local');
    hook.unmount();
  });

  it('opens the AI settings tab without creating a session or calling a model', () => {
    const hook = renderHook(useAIWorkbench);
    act(() => hook.result.current.openAISettings());
    expect(useAppStore.getState().currentView).toBe('settings');
    expect(sessionStorage.getItem('gsm:pending-settings-tab')).toBe('ai');
    expect(mocks.prepare).not.toHaveBeenCalled();
    expect(mocks.answer).not.toHaveBeenCalled();
    hook.unmount();
  });
  it('routes result follow-ups to the overview without another requirements interview or deep research', async () => {
    const hook = renderHook(useAIWorkbench);
    await act(async () => { await hook.result.current.createSession(); });
    await waitFor(() => expect(hook.result.current.active).not.toBeNull());
    await act(async () => { await hook.result.current.send('Explain this batch', false, false, { intent: 'results', candidates: [{
      repository, summary: 'Editor', reasons: [], limitations: [], sources: [], status: 'candidate',
    }] }); });
    expect(mocks.overviewAnswer).toHaveBeenCalledOnce();
    expect(mocks.prepare).not.toHaveBeenCalled();
    expect(mocks.answer).not.toHaveBeenCalled();
    expect((await storage.listMessages(hook.result.current.active!.id)).slice(-1)[0]).toMatchObject({ status: 'complete', answerPhase: 'final', quality: 'unreviewed' });
    hook.unmount();
  });

  it('passes recent answered conditions into requirements preparation', async () => {
    const hook = renderHook(useAIWorkbench);
    await act(async () => { await hook.result.current.send('Find a local editor'); });
    await waitFor(() => expect(hook.result.current.active).not.toBeNull());
    await act(async () => { await hook.result.current.send('Windows only, no cloud services'); });
    expect(mocks.prepare.mock.calls[1][0].messages).toEqual(expect.arrayContaining([expect.objectContaining({ content: 'Find a local editor' })]));
    hook.unmount();
  });

  it('appends pagination into the same result set and enables overview mode', async () => {
    const hook = renderHook(useAIWorkbench);
    await act(async () => { await hook.result.current.createSession(); });
    await waitFor(() => expect(hook.result.current.active).not.toBeNull());
    const first = { id: 'batch', createdAt: new Date().toISOString(), requirements, candidates: [{ repository, summary: 'First', reasons: [], limitations: [], sources: [], status: 'candidate' as const }], queries: ['modeling'], nextPage: 2 };
    await act(async () => { await hook.result.current.patchData(hook.result.current.active!.id, { searchBatches: [first] }); });
    mocks.search.mockImplementation(async input => { await input.onUpdate({ ...input.previous, nextPage: 3 }); });
    await act(async () => { await hook.result.current.search(requirements, 2, 'batch'); });
    expect(mocks.search.mock.calls[0][0]).toMatchObject({ overview: true, previous: { id: 'batch' } });
    const session = await storage.getSession(hook.result.current.active!.id);
    expect(session?.workbench?.searchBatches).toHaveLength(1);
    expect(session?.workbench?.searchBatches[0].nextPage).toBe(3);
    expect(session?.workbench?.inputIntent).toBe('results');
    hook.unmount();
  });

  it('publishes running status within 300ms and an arriving draft within 500ms, then atomically replaces it', async () => {
    useAppStore.setState({ aiConfigs: [{ id: 'http', name: 'Fixture', apiKey: 'fixture', baseUrl: 'https://example.com',
      model: 'fixture', apiType: 'openai', isActive: true }], activeAIConfig: 'http' });
    const hook = renderHook(useAIWorkbench);
    await act(async () => { await hook.result.current.chooseLocalProject(); });
    mocks.getLocal.mockReturnValue(await mocks.bindLocal.mock.results[0].value);
    let events!: (event: { phase: string; content: string }) => void;
    let finish!: (value: unknown) => void;
    mocks.researchLocal.mockImplementation((_grant, _question, _config, _language, _signal, options) => {
      events = options.onAnswerEvent;
      return new Promise(resolve => { finish = resolve; });
    });
    const started = performance.now();
    let pending!: Promise<void>;
    act(() => { pending = hook.result.current.send('Explain the local project'); });
    await waitFor(() => expect(hook.result.current.task.running).toBe(true));
    expect(performance.now() - started).toBeLessThan(300);
    await waitFor(() => expect(events).toBeDefined());
    const arrived = performance.now();
    act(() => events({ phase: 'draft', content: 'Partial draft' }));
    await waitFor(() => expect(hook.result.current.messages.slice(-1)[0]?.content).toBe('Partial draft'));
    expect(performance.now() - arrived).toBeLessThan(500);
    expect((await storage.listMessages(hook.result.current.active!.id)).slice(-1)[0]?.status).toBe('streaming');
    act(() => events({ phase: 'reviewing', content: 'Partial draft' }));
    await act(async () => {
      finish({ content: 'Final reviewed answer', evidences: [], quality: 'model-reviewed', missing: [] });
      await pending;
    });
    await waitFor(() => expect(hook.result.current.messages.slice(-1)[0]).toMatchObject({
      content: 'Final reviewed answer', status: 'complete', answerPhase: 'final',
    }));
    expect(hook.result.current.messages.filter(m => m.role === 'assistant')).toHaveLength(1);
    hook.unmount();
  });

  it('stores device-only local selection, streams a draft and keeps final review metadata', async () => {
    useAppStore.setState({ aiConfigs: [{ id: 'http', name: 'Fixture', apiKey: 'fixture', baseUrl: 'https://example.com',
      model: 'fixture', apiType: 'openai', isActive: true }], activeAIConfig: 'http' });
    const hook = renderHook(useAIWorkbench);
    await act(async () => { await hook.result.current.chooseLocalProject(); });
    await waitFor(() => expect(hook.result.current.active?.workbench?.scope).toBe('local'));
    const session = hook.result.current.active!;
    expect(session.deviceOnly).toBe(true);
    expect(session.workbench?.localProject).toEqual({ name: 'fixture', identity: 'a'.repeat(64) });
    mocks.getLocal.mockReturnValue(await mocks.bindLocal.mock.results[0].value);
    let finish!: (result: unknown) => void;
    mocks.researchLocal.mockImplementation((_grant, _question, _config, _language, _signal, options) => {
      options.onAnswerEvent({ phase: 'draft', content: 'Draft preview' });
      return new Promise(resolve => { finish = resolve; });
    });
    let pending!: Promise<void>;
    act(() => { pending = hook.result.current.send('Explain the local project'); });
    await waitFor(() => expect(hook.result.current.messages.some(message => message.content === 'Draft preview')).toBe(true));
    hook.unmount();
    await act(async () => {
      finish({ content: 'Reviewed answer', evidences: [], quality: 'model-reviewed', claims: [], coverage: [] });
      await pending;
    });
    expect((await storage.listMessages(session.id))[1]).toMatchObject({
      content: 'Reviewed answer', status: 'complete', answerPhase: 'final', quality: 'model-reviewed',
    });
    expect((await storage.exportWorkbench('77') as { sessions: unknown[] }).sessions).toEqual([]);
    const reopened = renderHook(useAIWorkbench);
    await waitFor(() => expect(reopened.result.current.active?.id).toBe(session.id));
    mocks.researchLocal.mockResolvedValue({ content: 'Follow up', evidences: [] });
    await act(async () => { await reopened.result.current.send('And its limitations?'); });
    expect(mocks.researchLocal.mock.calls[1][5].messages).toHaveLength(2);
    mocks.getLocal.mockReturnValue(undefined);
    await expect(reopened.result.current.send('After restart')).rejects.toThrow();
    expect(await storage.listMessages(session.id)).toHaveLength(4);
  });

  it('rejects a different project folder without modifying the existing transcript', async () => {
    const hook = renderHook(useAIWorkbench);
    await act(async () => { await hook.result.current.chooseLocalProject(); });
    await waitFor(() => expect(hook.result.current.active?.workbench?.scope).toBe('local'));
    const original = hook.result.current.active!;
    mocks.bindLocal.mockRejectedValueOnce(new Error('LOCAL_PROJECT_CHANGED'));
    await expect(hook.result.current.chooseLocalProject()).rejects.toThrow();
    expect(mocks.bindLocal).toHaveBeenLastCalledWith(original.id, '77', 'a'.repeat(64));
    expect(await storage.getSession(original.id)).toEqual(original);
  });

  it('creates an account-owned GitHub search session and requires an explicit search action', async () => {
    const { result } = renderHook(useAIWorkbench);
    await act(async () => { await result.current.send('Find modeling tools'); });
    await waitFor(() => expect(result.current.active?.workbench?.requirements).toEqual(requirements));
    expect(result.current.active).toMatchObject({ ownerId: '77', kind: 'workbench', workbench: { scope: 'github', depth: 'standard' } });
    expect(mocks.search).not.toHaveBeenCalled();
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(await storage.listMessages(result.current.active!.id)).toHaveLength(2);
  });

  it('continues a task after the page unmounts without creating a second transcript', async () => {
    let resolve!: (value: typeof requirements) => void;
    mocks.prepare.mockReturnValue(new Promise((done) => { resolve = done; }));
    const hook = renderHook(useAIWorkbench);
    let pending!: Promise<void>;
    act(() => { pending = hook.result.current.send('Continue after navigation'); });
    await waitFor(() => expect(mocks.prepare).toHaveBeenCalled());
    const id = workbenchRuntime.getSnapshot().sessionId!;
    hook.unmount();
    await act(async () => { resolve(requirements); await pending; });
    expect((await storage.listMessages(id)).map((m) => m.status)).toEqual(['complete', 'complete']);
    expect((await storage.listWorkbenchSessions('77')).map((s) => s.id)).toEqual([id]);
    expect(workbenchRuntime.getSnapshot().running).toBe(false);
  });

  it('does not publish late requirements after stop or overwrite another selected conversation', async () => {
    let resolve!: (value: typeof requirements) => void;
    mocks.prepare.mockReturnValue(new Promise((done) => { resolve = done; }));
    const { result } = renderHook(useAIWorkbench);
    let pending!: Promise<void>;
    act(() => { pending = result.current.send('First question').catch(() => undefined); });
    await waitFor(() => expect(mocks.prepare).toHaveBeenCalled());
    const first = workbenchRuntime.getSnapshot().sessionId!;
    act(() => workbenchRuntime.stop());
    let second = '';
    await act(async () => { second = (await result.current.createSession()).id; });
    await act(async () => { resolve(requirements); await pending; });
    await waitFor(() => expect(result.current.activeId).toBe(second));
    expect((await storage.getSession(first))?.workbench?.requirements).toBeUndefined();
    expect((await storage.listMessages(first))[1].status).toBe('aborted');
    expect(await storage.listMessages(second)).toEqual([]);
  });

  it('resumes the existing repository session ID and keeps its selected repository on preference changes', async () => {
    const date = new Date().toISOString();
    await storage.saveSession({ id: 'card-session', ownerId: '77', kind: 'repository', repoId: 99,
      repoFullName: repository.full_name, sourceRefSha: 'abc', title: 'Card question', createdAt: date, updatedAt: date });
    sessionStorage.setItem('gsm:ai-workbench-session', 'card-session');
    const { result } = renderHook(useAIWorkbench);
    await waitFor(() => expect(result.current.active?.id).toBe('card-session'));
    await act(async () => { await result.current.patchData('card-session', { depth: 'deep' }); });
    expect((await storage.getSession('card-session'))?.workbench).toMatchObject({
      scope: 'selected', depth: 'deep', selectedRepositories: [{ id: 99 }],
    });
    await act(async () => { await result.current.send('Explain this repository'); });
    expect(mocks.answer).toHaveBeenCalledWith(expect.objectContaining({ session: expect.objectContaining({ id: 'card-session' }), repositories: [repository] }));
  });

  it('hides another account and unclaimed history from active conversation loading', async () => {
    const date = new Date().toISOString();
    await storage.saveSession({ id: 'foreign', ownerId: '88', repoId: 99, repoFullName: 'private/repo',
      sourceRefSha: '', title: 'Private', createdAt: date, updatedAt: date });
    sessionStorage.setItem('gsm:ai-workbench-session', 'foreign');
    const { result } = renderHook(useAIWorkbench);
    await act(async () => { await result.current.refresh(); });
    expect(result.current.active).toBeNull();
    expect(result.current.messages).toEqual([]);
    expect(result.current.sessions).toEqual([]);
    await expect(result.current.patchSession('foreign', { title: 'Changed' })).rejects.toThrow();
  });
});
