import { describe, expect, it } from 'vitest';
import { createInitialState } from '../initialState';
import type { AppStoreState } from '../types';
import { normalizePersistedState } from './persistedState';
describe('startup navigation', () => {
  it('starts in repository browsing instead of restoring the project map or settings', () => {
    const restored = normalizePersistedState({currentView:'settings',repositoryViewMode:'cluster'},createInitialState() as AppStoreState);
    expect(restored.currentView).toBe('repositories');
    expect(restored.repositoryViewMode).toBe('grid');
  });
  it('retains the repository list preference on startup', () => {
    const restored=normalizePersistedState({repositoryViewMode:'list'},createInitialState() as AppStoreState);
    expect(restored.repositoryViewMode).toBe('list');
  });
});
