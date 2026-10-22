import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { AppStoreState } from '../../../store/types';
import { createInitialState } from '../../../store/initialState';
const mocks = vi.hoisted(() => ({ state: {} as AppStoreState, enqueue: vi.fn() }));
vi.mock('../../../store/useAppStore', () => ({ useAppStore: (selector: (state: AppStoreState) => unknown) => selector(mocks.state) }));
vi.mock('../../../services/aiClassificationRebuild', () => ({ AI_CLASSIFICATION_VERSION: 'current', enqueueAIClassificationRebuild: mocks.enqueue }));
import { useAIClassificationBootstrap } from './useAIClassificationBootstrap';
beforeEach(() => {
  mocks.enqueue.mockReset();
  mocks.state = { ...createInitialState(), user: { id: 42 }, hasHydrated: true, isAuthenticated: true, repositories: [{ id: 1, ai_summary: 'coding agent' }],
    classificationSchemes: { generation: { status: 'ready', generation: 1, queuedRepositoryIds: [], algorithmVersion: 'old' } } } as unknown as AppStoreState;
});
describe('classification startup scheduling', () => {
  it('upgrades exactly once even when generation objects and repository references change', () => {
    const { rerender } = renderHook(useAIClassificationBootstrap);
    expect(mocks.enqueue).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 5; i++) {
      mocks.state = { ...mocks.state, repositories: [...mocks.state.repositories], classificationSchemes: { generation: { ...mocks.state.classificationSchemes!.generation!, status: 'stale' } } };
      rerender();
    }
    expect(mocks.enqueue).toHaveBeenCalledTimes(1);
  });
  it('does not automatically retry a failed build on every render', () => {
    mocks.state.classificationSchemes!.generation!.status = 'failed';
    const { rerender } = renderHook(useAIClassificationBootstrap);
    rerender(); expect(mocks.enqueue).not.toHaveBeenCalled();
  });
  it('resumes an interrupted local build once on startup', () => {
    mocks.state.classificationSchemes!.generation = { status: 'running', generation: 1, queuedRepositoryIds: [], algorithmVersion: 'current' };
    renderHook(useAIClassificationBootstrap);
    expect(mocks.enqueue).toHaveBeenCalledExactlyOnceWith([1], { force: true });
  });
  it('does not rebuild a ready current version after hydration or sync', () => {
    mocks.state.classificationSchemes!.generation!.algorithmVersion = 'current';
    renderHook(useAIClassificationBootstrap);
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });
  it('schedules independently for a different signed-in account', () => {
    const { rerender } = renderHook(useAIClassificationBootstrap);
    mocks.state = { ...mocks.state, user: { ...mocks.state.user!, id: 99 } }; rerender();
    expect(mocks.enqueue).toHaveBeenCalledTimes(2);
  });
});
