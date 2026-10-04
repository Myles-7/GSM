import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GistView } from './GistView';
import { useAppStore } from '../store/useAppStore';
import type { Gist } from '../types';

const mocks = vi.hoisted(() => ({ aiSearch: vi.fn() }));
vi.mock('../store/useAppStore', async () => {
  const { create } = await import('zustand');
  return { useAppStore: create<{
    user: { id: number; login: string; avatar_url: string }; language: string; gists: Gist[]; starredGists: Gist[];
    selectedGistCategory: string; gistSearchFilters: import('../types').GistSearchFilters; gistSearchResults: Gist[];
    setGists: (gists: Gist[]) => void; setGistSearchFilters: (patch: Partial<import('../types').GistSearchFilters>) => void;
    setGistSearchResults: (gists: Gist[]) => void; setSelectedGistCategory: (category: string) => void;
  }>((set) => ({ user: { id: 990099, login: 'me', avatar_url: '' }, language: 'zh', gists: [], starredGists: [],
    selectedGistCategory: 'all', gistSearchFilters: { query: '', sortBy: 'updated', sortOrder: 'desc' }, gistSearchResults: [],
    setGists: gists => set({ gists }), setGistSearchResults: gistSearchResults => set({ gistSearchResults }),
    setSelectedGistCategory: selectedGistCategory => set({ selectedGistCategory }),
    setGistSearchFilters: patch => set(state => ({ gistSearchFilters: { ...state.gistSearchFilters, ...patch } })),
  })) };
});
vi.mock('../features/gists/hooks/useGistActions', async () => {
  const { useAppStore } = await import('../store/useAppStore');
  return { useGistActions: () => ({ ...useAppStore(), aiSearch: mocks.aiSearch }) };
});
vi.mock('../hooks/useTaskTarget', () => ({ useTaskTarget: () => {} }));
vi.mock('./GistCard', () => ({ GistCard: ({ gist }: { gist: Gist }) => <article data-testid="gist-result">{gist.id}:{gist.ai_summary}</article> }));
vi.mock('./GistDetailModal', () => ({ GistDetailModal: () => null }));
vi.mock('./GistEditorModal', () => ({ GistEditorModal: () => null }));

const gist = (id: string, analyzed = false): Gist => ({ id, description: 'Plain snippet', public: true,
  html_url: `https://gist.github.com/${id}`, created_at: '2026-01-01', updated_at: '2026-01-01', comments: 0,
  files: {}, owner: { login: 'me', avatar_url: '' }, ...(analyzed ? { analyzed_at: '2026-01-01' } : {}) });
const submitAI = () => {
  fireEvent.change(screen.getByRole('textbox', { name: '搜索 gist、文件名或摘要' }), { target: { value: 'semantic intent' } });
  fireEvent.click(screen.getByRole('button', { name: 'AI搜索' }));
};
const ids = () => screen.queryAllByTestId('gist-result').map(item => item.textContent?.split(':')[0]);

beforeEach(() => {
  mocks.aiSearch.mockReset();
  useAppStore.setState({ user: { id: 990099, login: 'me', avatar_url: '', name: 'Fixture', email: null }, language: 'zh',
    gists: [gist('a'), gist('b'), gist('c', true)], starredGists: [gist('a')], selectedGistCategory: 'all',
    gistSearchFilters: { query: '', sortBy: 'updated', sortOrder: 'desc' }, gistSearchResults: [] });
  mocks.aiSearch.mockImplementation((query: string, _items: Gist[], onDone: (ranked: Gist[] | null) => void) => {
    useAppStore.getState().setGistSearchFilters({ query }); onDone([gist('b'), gist('a'), gist('c', true)]);
  });
});
describe('submitted Gist AI search', () => {
  it('retains semantic membership through category and metadata changes and honors explicit sorting', async () => {
    render(<GistView />); submitAI();
    await waitFor(() => expect(ids()).toEqual(['b', 'a', 'c']));
    act(() => useAppStore.getState().setGists([gist('a'), { ...gist('b'), ai_summary: 'Updated description' }, gist('c', true)]));
    expect(screen.getByText('b:Updated description')).toBeVisible();
    act(() => useAppStore.getState().setGistSearchFilters({ isAnalyzed: false }));
    await waitFor(() => expect(ids()).toEqual(['b', 'a']));
    fireEvent.click(screen.getByRole('button', { name: '降序' }));
    // Timestamp ties keep stable order; change the selected result timestamps to exercise sorting.
    act(() => useAppStore.getState().setGists([{ ...gist('a'), updated_at: '2026-01-01' }, { ...gist('b'), updated_at: '2026-02-01' }]));
    await waitFor(() => expect(ids()).toEqual(['a', 'b']));
    act(() => useAppStore.getState().setSelectedGistCategory('starred'));
    await waitFor(() => expect(ids()).toEqual(['a']));
    expect(screen.getByRole('status')).toHaveTextContent('最多 120');
  });
  it('keeps an AI empty result empty, and clears it when the user clears the search', async () => {
    mocks.aiSearch.mockImplementation((query: string, _items: Gist[], onDone: (ranked: Gist[] | null) => void) => {
      useAppStore.getState().setGistSearchFilters({ query }); onDone([]);
    });
    render(<GistView />); submitAI();
    await waitFor(() => expect(ids()).toEqual([]));
    expect(screen.getByText('本次搜索或筛选没有匹配的 Gist，可调整条件或重新搜索。')).toBeVisible();
    act(() => useAppStore.getState().setGists([gist('a'), gist('b')]));
    expect(ids()).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: '清除搜索' }));
    await waitFor(() => expect(ids()).toHaveLength(2));
  });
});
