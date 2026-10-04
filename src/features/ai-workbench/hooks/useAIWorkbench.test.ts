import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '../../../store/useAppStore';
import { repositoryChatStorage as storage } from '../../../services/repositoryChatStorage';
import { workbenchRuntime } from '../../../services/aiWorkbenchService';
import { useAIWorkbench } from './useAIWorkbench';
import type { AppState, Repository } from '../../../types';
vi.unmock('../../../store/useAppStore');

const mocks = vi.hoisted(() => ({
  prepare: vi.fn(), search: vi.fn(), answer: vi.fn(), overviewAnswer: vi.fn(), retryOverview: vi.fn(), propose: vi.fn(), execute: vi.fn(), restore: vi.fn(),
  bindLocal: vi.fn(), getLocal: vi.fn(), researchLocal: vi.fn(),
}));
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
});

describe('AI workbench integration', () => {
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
