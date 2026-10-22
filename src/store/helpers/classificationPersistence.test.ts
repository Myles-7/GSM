import { describe, expect, it } from 'vitest';
import { createStore } from 'zustand/vanilla';
import { createInitialState } from '../initialState';
import { createCategorySlice } from '../slices/categorySlice';
import { createClassificationSlice } from '../slices/classificationSlice';
import type { AppStoreState } from '../types';
import type { Repository } from '../../types';
import { buildAIClassification } from '../../services/aiClassificationRebuild';
import { classificationBackupExport, classificationExport, classificationProjection } from './classificationSchemes';
import { incomingOrganizationSnapshot } from './repositoryOrganization';
import { normalizePersistedState } from '../normalizers/persistedState';
import { decodeLocalBackup } from '../../services/localBackup';
import { planLocalBackupRestore } from '../../services/localBackupRestorePlan';
import { repositoryHomeProjection } from '../../home/repositoryProjection';
import { getAllCategories, sortCategoriesByOrder } from './categoryHelpers';
import { validateOperation } from '../../../server/src/services/syncV2';

const repository: Repository = { id: 1, name: 'notes', full_name: 'fixture/notes', html_url: 'https://github.com/fixture/notes',
  description: null, ai_summary: 'React knowledge notes web application', ai_tags: ['React', 'notes'], ai_platforms: ['Web'],
  stargazers_count: 1, forks_count: 0, forks: 0, language: 'TypeScript', topics: [], owner: { login: 'fixture', avatar_url: '' }, created_at: '2026-01-01', updated_at: '2026-01-01', pushed_at: '2026-01-01' };
function store() { return createStore<AppStoreState>((set, get) => ({ ...createInitialState(), ...createCategorySlice(set, get), ...createClassificationSlice(set, get), repositories: [repository], searchResults: [repository], language: 'en' } as AppStoreState)); }

describe('classification result persistence', () => {
  it('retains a real result through reload, backup restore and strict v2 projection', () => {
    const current = store(); const result = buildAIClassification([repository], 'en');
    current.getState().setClassificationGeneration({ algorithmVersion: 'test-v2' });
    current.getState().replaceAIClassification(result);
    expect(current.getState().classificationSchemes?.generation?.algorithmVersion).toBe('test-v2');
    expect(current.getState().classificationSchemes?.generation?.repositoryIds).toEqual([1]);
    current.getState().setClassificationGeneration({ algorithmVersion: 'test-v2', queuedRepositoryIds: [1], syncPending: true });
    const state = current.getState();
    expect(state.repositories[0].classificationInsights).toEqual(result.insights['1']);
    expect(state.hiddenDefaultCategoryIds).not.toContain('all');
    const remote = classificationExport(state);
    expect(remote).not.toHaveProperty('generation');
    expect(() => validateOperation({ opId: 'org', collection: 'organization', id: 'default', baseVersion: 0, kind: 'put', data: { classificationSchemes: remote } })).not.toThrow();
    expect(() => validateOperation({ opId: 'repo', collection: 'repositories', id: '1', baseVersion: 0, kind: 'put', data: repositoryHomeProjection(state.repositories[0]) })).not.toThrow();
    const reloaded = normalizePersistedState(JSON.parse(JSON.stringify(state)), current.getState());
    expect(reloaded.repositories?.[0].classificationInsights).toEqual(result.insights['1']);
    expect(reloaded.classificationSchemes?.generation).toEqual(state.classificationSchemes?.generation);
    const decoded = decodeLocalBackup(JSON.stringify({ version: '1.0', data: { repositories: state.repositories, classificationSchemes: classificationBackupExport(state), customCategories: state.customCategories, subcategories: state.subcategories, hiddenDefaultCategoryIds: state.hiddenDefaultCategoryIds } }));
    const plan = planLocalBackupRestore(store().getState(), decoded, ['repositories', 'customCategories'], 'replace', { githubUserId: '999', workspaceId: null }, true);
    expect(plan.after.classificationSchemes).toEqual(decoded.data.classificationSchemes);
    expect((plan.after.repositories as Repository[])[0].classificationInsights).toEqual(result.insights['1']);
  });
  it('rejects incomplete and invalid replacements before any state is changed', () => {
    const current = store(); const before = current.getState(); const result = buildAIClassification([repository], 'en');
    expect(() => before.replaceAIClassification({ ...result, assignments: {} })).toThrow();
    expect(current.getState()).toBe(before);
    result.assignments['1'].technology.subcategoryId = 'missing';
    expect(() => before.replaceAIClassification(result)).toThrow();
    expect(current.getState()).toBe(before);
  });
  it('preserves the local generation journal when applying remote snapshots', () => {
    const current = store(); const result = buildAIClassification([repository], 'en'); current.getState().replaceAIClassification(result);
    const state = current.getState(); const patch = incomingOrganizationSnapshot(state, { classificationSchemes: { ...classificationExport(state), generation: { status: 'failed', generation: 99, queuedRepositoryIds: [] } } }, state.repositories);
    expect(patch.classificationSchemes?.generation).toBe(state.classificationSchemes?.generation);
  });
  it('repairs ALL visibility and keeps canonical writes independent after switching views', () => {
    const current = store(); const result = buildAIClassification([repository], 'en'); current.getState().replaceAIClassification(result);
    current.getState().hideDefaultCategory('all'); current.getState().setCategoryOrder(['all', ...result.purpose.categoryOrder]);
    expect(current.getState().hiddenDefaultCategoryIds).not.toContain('all'); expect(current.getState().categoryOrder).not.toContain('all');
    const damaged = normalizePersistedState({ ...current.getState(), hiddenDefaultCategoryIds: ['all'], categoryOrder: ['all'] }, current.getState());
    expect(damaged.hiddenDefaultCategoryIds).toEqual([]); expect(damaged.categoryOrder).toEqual([]);
    expect(sortCategoriesByOrder(getAllCategories([], 'en', ['all']), ['devtools', 'all'])[0].id).toBe('all');
    current.getState().setClassificationScheme('technology');
    const technology = current.getState().classificationSchemes?.technology;
    current.getState().addCustomCategory({ id: 'purpose-only', name: 'Purpose only', icon: '', keywords: [] });
    expect(current.getState().customCategories.some(category => category.id === 'purpose-only')).toBe(true);
    expect(current.getState().classificationSchemes?.technology).toBe(technology);
    const view = classificationProjection(current.getState(), 'technology');
    expect(view.repositories[0].classifications?.purpose?.categoryId).toBe(current.getState().repositories[0].category_id);
  });
});
