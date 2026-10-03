import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '../store/useAppStore';
import { repositoryChatStorage as storage } from '../services/repositoryChatStorage';
import { workbenchRuntime } from '../services/aiWorkbenchService';
import { useAIOrganization } from './useAIOrganization';
import { useAIWorkbench } from '../features/ai-workbench/hooks/useAIWorkbench';
import type { AppState, Repository } from '../types';
import type { WorkbenchRequirements } from '../types/aiWorkbench';

vi.unmock('../store/useAppStore');
const mocks = vi.hoisted(() => ({ generate: vi.fn() }));
vi.mock('../services/aiService', async original => ({
  ...await original<typeof import('../services/aiService')>(),
  AIService: class { generateChatText = mocks.generate; },
}));
const date = '2026-09-28T00:00:00.000Z';
const repository: Repository = {
  id: 99, full_name: 'fixture/repo', name: 'repo', owner: { login: 'fixture', avatar_url: '' },
  description: 'A local developer tool', topics: ['cli'], stargazers_count: 1, forks_count: 0, forks: 0,
  html_url: 'https://github.com/fixture/repo', language: 'Python',
  created_at: date, updated_at: date, pushed_at: date, category_id: null, subcategory_id: null,
};
const input = { filteredRepositories: [repository], selectedRepositoryIds: [], categoryId: 'all' };
const requirements: WorkbenchRequirements = {
  purpose: 'Find developer tools', required: [], preferred: [], excluded: [], questions: [],
  queries: ['developer tools'],
};
function reply({ user }: { user: string }) {
  const prompt = JSON.parse(user);
  if (typeof prompt.task !== 'string') {
    if (typeof prompt.question !== 'string') throw new Error('Unexpected AI fixture prompt');
    return JSON.stringify(requirements);
  }
  if (prompt.task.startsWith('Suggest')) return '{"categories":[]}';
  return JSON.stringify({ assignments: prompt.repositories.map((r: { id: number }) => ({
    repositoryId: r.id, categoryId: prompt.categories.find((c: { parentId: string | null }) => c.parentId === null).id,
    subcategoryId: null, disposition: 'move', reason: 'Developer tool',
  })) });
}
beforeEach(() => {
  localStorage.clear(); sessionStorage.clear(); vi.clearAllMocks();
  Object.defineProperty(window, 'indexedDB', { configurable: true, value: undefined });
  useAppStore.setState({
    ...useAppStore.getInitialState(), user: { id: 77, login: 'fixture' } as NonNullable<AppState['user']>,
    githubToken: 'fixture-token', repositories: [repository], language: 'en',
    aiConfigs: [{ id: 'model', name: 'Fixture', model: 'fixture', apiKey: 'test-key', baseUrl: 'https://fixture.invalid', isActive: true }],
    activeAIConfig: 'model',
  });
  mocks.generate.mockImplementation(reply);
});
describe('organization conversation and task lifecycle', () => {
  it('resumes a research session and prepares requirements without applying organization data', async () => {
    const id = 'research-session';
    const timestamp = new Date().toISOString();
    await storage.saveSession({
      id, ownerId: '77', kind: 'workbench', repoId: 0, repoFullName: '', sourceRefSha: '',
      title: 'Research', createdAt: timestamp, updatedAt: timestamp,
      workbench: { scope: 'github', depth: 'standard', selectedRepositories: [], searchBatches: [] },
    });
    sessionStorage.setItem('gsm:ai-workbench-session', id);
    const repositories = useAppStore.getState().repositories;
    const categories = useAppStore.getState().customCategories;
    const subcategories = useAppStore.getState().subcategories;
    const hook = renderHook(useAIWorkbench);
    await waitFor(() => expect(hook.result.current.active?.id).toBe(id));
    await act(async () => { await hook.result.current.send('Find developer tools'); });
    expect(hook.result.current.error).toBe('');
    await waitFor(() => expect(hook.result.current.active?.workbench?.requirements).toEqual(requirements));
    expect(JSON.parse(mocks.generate.mock.calls[0][0].user)).toEqual({ question: 'Find developer tools', recentConversation: [] });
    expect(await storage.listProposals('77', id)).toEqual([]);
    expect((await storage.listMessages(id)).map(message => message.status)).toEqual(['complete', 'complete']);
    expect((await storage.listWorkbenchSessions('77')).map(session => session.id)).toEqual([id]);
    expect(useAppStore.getState().repositories).toEqual(repositories);
    expect(useAppStore.getState().customCategories).toEqual(categories);
    expect(useAppStore.getState().subcategories).toEqual(subcategories);
    hook.unmount();
  });

  it('creates a shared session without applying data and resumes the same session in workbench', async () => {
    const hook = renderHook(() => useAIOrganization(input));
    await act(async () => { await hook.result.current.generate(); });
    await waitFor(() => expect(hook.result.current.proposal?.organization?.status).toBe('ready'));
    const proposal = hook.result.current.proposal!;
    expect(useAppStore.getState().repositories[0].category_id).toBeNull();
    expect(await storage.listMessages(proposal.sessionId)).toHaveLength(1);
    act(() => hook.result.current.continueInWorkbench());
    hook.unmount();
    const workbench = renderHook(useAIWorkbench);
    await waitFor(() => expect(workbench.result.current.active?.id).toBe(proposal.sessionId));
    expect(workbench.result.current.proposals).toHaveLength(1);
    await act(async () => { await workbench.result.current.send('Use existing categories only'); });
    await waitFor(() => expect(workbench.result.current.proposals).toHaveLength(2));
    expect((await storage.listWorkbenchSessions('77')).map(s => s.id)).toEqual([proposal.sessionId]);
    expect(await storage.listMessages(proposal.sessionId)).toHaveLength(2);
    expect(useAppStore.getState().repositories[0].category_id).toBeNull();
    workbench.unmount();
  });

  it('continues after unmount and resumes the task result without copying history', async () => {
    let resolve!: (text: string) => void;
    mocks.generate.mockImplementationOnce(() => new Promise<string>(done => { resolve = done; }));
    const hook = renderHook(() => useAIOrganization(input));
    let pending!: Promise<void>;
    act(() => { pending = hook.result.current.generate(); });
    await waitFor(() => expect(mocks.generate).toHaveBeenCalled());
    const id = workbenchRuntime.getSnapshot().sessionId!;
    hook.unmount();
    await act(async () => { resolve('{"categories":[]}'); await pending; });
    const resumed = renderHook(() => useAIOrganization(input));
    await waitFor(() => expect(resumed.result.current.proposal?.sessionId).toBe(id));
    expect(resumed.result.current.proposal?.organization?.status).toBe('ready');
    expect(await storage.listMessages(id)).toHaveLength(1);
    resumed.unmount();
  });

  it('marks stopped generation interrupted, rejects late output, and retries safely', async () => {
    let resolve!: (text: string) => void;
    mocks.generate.mockImplementationOnce(() => new Promise<string>(done => { resolve = done; }));
    const hook = renderHook(() => useAIOrganization(input));
    let pending!: Promise<void>;
    act(() => { pending = hook.result.current.generate(); });
    await waitFor(() => expect(mocks.generate).toHaveBeenCalled());
    act(() => hook.result.current.stop());
    await act(async () => { resolve('{"categories":[]}'); await pending; });
    await waitFor(() => expect(hook.result.current.proposal?.organization?.status).toBe('interrupted'));
    expect(hook.result.current.proposal?.organization?.entries[0].disposition).toBe('insufficient');
    await act(async () => { await hook.result.current.retry(); });
    await waitFor(() => expect(hook.result.current.proposal?.organization?.status).toBe('ready'));
    expect(hook.result.current.versions).toHaveLength(1);
    expect(useAppStore.getState().repositories[0].category_id).toBeNull();
    hook.unmount();
  });

  it('does not overwrite a different selected session with a late task completion', async () => {
    let resolve!: (text: string) => void;
    mocks.generate.mockImplementationOnce(() => new Promise<string>(done => { resolve = done; }));
    const hook = renderHook(({ sessionId }: { sessionId?: string }) => useAIOrganization({ ...input, sessionId }), { initialProps: { sessionId: undefined as string | undefined } });
    let pending!: Promise<void>;
    act(() => { pending = hook.result.current.generate(); });
    await waitFor(() => expect(mocks.generate).toHaveBeenCalled());
    await storage.saveSession({ id: 'other', ownerId: '77', kind: 'workbench', repoId: 0, repoFullName: '', sourceRefSha: '', title: 'Other', createdAt: date, updatedAt: date });
    hook.rerender({ sessionId: 'other' });
    await act(async () => { resolve('{"categories":[]}'); await pending; });
    await waitFor(() => expect(hook.result.current.proposal).toBeNull());
    expect(await storage.listProposals('77', 'other')).toEqual([]);
    hook.unmount();
  });
});
