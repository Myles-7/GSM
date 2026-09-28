import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '../../../store/useAppStore';
import { repositoryChatStorage as storage } from '../../../services/repositoryChatStorage';
import { workbenchRuntime } from '../../../services/aiWorkbenchService';
import { useAIWorkbench } from './useAIWorkbench';
import type { AppState, Repository } from '../../../types';
vi.unmock('../../../store/useAppStore');

const mocks = vi.hoisted(() => ({
  prepare: vi.fn(), search: vi.fn(), answer: vi.fn(), propose: vi.fn(), execute: vi.fn(), restore: vi.fn(),
}));
vi.mock('../../../services/aiWorkbenchService', async (original) => ({
  ...await original<typeof import('../../../services/aiWorkbenchService')>(),
  prepareWorkbenchRequirements: mocks.prepare,
  searchWorkbench: mocks.search,
  answerWorkbench: mocks.answer,
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
});

describe('AI workbench integration', () => {
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
