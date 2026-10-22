import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppState } from '../types';
import type { AppActions, AppStoreState } from '../store/types';
import { applyClassificationEdit, classificationEditToken } from '../store/helpers/classificationEdits';
import type { ClassificationGenerationState } from '../types/classification';
type SyncState = AppState & Pick<AppActions, 'setClassificationGeneration'>;
import type { HomeSync } from '../home/sync';
import { createInitialState } from '../store/initialState';

const mocks = vi.hoisted(() => ({ state: {} as SyncState, receiptToken: undefined as string | undefined, sync: null as HomeSync | null, available: true, configured: 'https://backend.example', records: [] as unknown[], pending: [] as unknown[], flush: vi.fn(), force: vi.fn() }));
vi.mock('../store/useAppStore', () => ({ useAppStore: { getState: () => mocks.state } }));
vi.mock('./backendAdapter', () => ({ backend: { get isAvailable() { return mocks.available; }, get configuredUrl() { return mocks.configured; } } }));
vi.mock('../home/desktop', () => ({
  getDesktopHomeSync: () => mocks.sync, getDesktopClassificationReceiptToken: () => mocks.receiptToken ?? classificationSyncToken(mocks.state), subscribeDesktopHome: () => () => {}, waitForDesktopHomeCapture: async () => {}, flushDesktopHome: mocks.flush,
  desktopStoreRecords: (state: AppState) => [{ collection: 'organization', id: 'default', data: { categories: state.customCategories } }, ...state.repositories.map(repo => ({ collection: 'repositories', id: String(repo.id), data: { id: repo.id } }))],
}));
vi.mock('./autoSync', () => ({ forceSyncToBackend: mocks.force }));
import { acknowledgeClassificationSync, classificationSyncToken } from './classificationSyncReceipt';
import { acknowledgeDesktopClassification, classificationPendingOperations, readClassificationSyncView, syncAIClassification } from './classificationSync';
import { desktopStoreRecords } from '../home/desktop';

beforeEach(() => {
  mocks.receiptToken = undefined; mocks.available = true; mocks.configured = 'https://backend.example'; mocks.sync = null; mocks.pending = []; mocks.records = [];
  mocks.flush.mockReset().mockResolvedValue(true); mocks.force.mockReset().mockResolvedValue(undefined);
  mocks.state = { ...createInitialState(), user: { id: 42 }, repositories: [{ id: 1 }, { id: 2 }], classificationSchemes: { technology: { repositoryOrder: [1] }, generation: { status: 'ready', generation: 3, sourceFingerprint: 'snapshot', queuedRepositoryIds: [1, 2], syncPending: true } },
    setClassificationGeneration: (updates: Partial<ClassificationGenerationState>) => { mocks.state = { ...mocks.state, classificationSchemes: { ...mocks.state.classificationSchemes, generation: { ...mocks.state.classificationSchemes!.generation!, ...updates } } }; },
  } as unknown as SyncState;
});
const desktop = () => {
  mocks.records = desktopStoreRecords(mocks.state).map(record => ({ ...record, version: 1 }));
  mocks.sync = { identity: { githubUserId: 42 }, view: { status: 'synced' }, db: { pending: async () => mocks.pending, allRecords: async () => mocks.records } } as unknown as HomeSync;
};
describe('classification delivery receipts', () => {
  it('only clears the same account and generation snapshot', () => {
    const snapshot = mocks.state;
    mocks.state = { ...mocks.state, user: { id: 99 } } as SyncState;
    expect(acknowledgeClassificationSync(snapshot)).toBe(false);
    mocks.state = { ...snapshot, classificationSchemes: { ...snapshot.classificationSchemes, generation: { ...snapshot.classificationSchemes!.generation!, generation: 4 } } };
    expect(acknowledgeClassificationSync(snapshot)).toBe(false);
    mocks.state = snapshot;
    expect(acknowledgeClassificationSync(snapshot)).toBe(true);
    expect(mocks.state.classificationSchemes!.generation!.syncPending).toBe(false);
  });
  it('counts durable classification operations using generation snapshot IDs', async () => {
    desktop(); mocks.pending = [
      { collection: 'organization', id: 'default' }, { collection: 'repositories', id: '1' },
      { collection: 'repositories', id: '2' }, { collection: 'releases', id: '8' },
    ];
    expect(classificationPendingOperations(mocks.pending as never, mocks.state)).toHaveLength(2);
    expect(await readClassificationSyncView()).toMatchObject({ status: 'pending', pending: 2 });
  });
  it('never acknowledges a classification conflict, even when generic flush resolves', async () => {
    desktop(); mocks.pending = [{ collection: 'organization', id: 'default', conflict: null, rejected: 'VERSION_MISMATCH' }];
    await expect(syncAIClassification()).rejects.toThrow('分类尚未同步');
    expect(mocks.state.classificationSchemes!.generation!.syncPending).toBe(true);
    expect(await readClassificationSyncView()).toMatchObject({ status: 'conflict', pending: 1 });
    mocks.pending = [];
    expect(await acknowledgeDesktopClassification(mocks.state)).toBe(true);
    expect(mocks.state.classificationSchemes!.generation!.syncPending).toBe(false);
  });
  it('does not acknowledge optimistic records while matching operations remain queued', async () => {
    desktop(); mocks.pending = [{ collection: 'repositories', id: '1' }];
    expect(await acknowledgeDesktopClassification(mocks.state)).toBe(false);
  });
  it('includes manually moved repositories added after the previous generation in conflict checks', async () => {
    mocks.state = { ...mocks.state,
      customCategories: ['a', 'b'].map(id => ({ id, name: id, icon: '📁', keywords: [] })),
      repositories: mocks.state.repositories.map(repo => ({ ...repo, category_id: 'a', subcategory_id: null })),
      classificationSchemes: { ...mocks.state.classificationSchemes, generation: { ...mocks.state.classificationSchemes!.generation!, repositoryIds: [1] } },
    };
    const before = mocks.state as AppStoreState;
    mocks.state = { ...mocks.state, ...applyClassificationEdit(before, 'purpose', {
      type: 'assign', repositoryIds: [2], categoryId: 'b', subcategoryId: null,
      expectedAccountId: 42, expectedToken: classificationEditToken(before, 'purpose'),
    }) };
    desktop(); mocks.pending = [{ collection: 'repositories', id: '2', rejected: 'VERSION_MISMATCH' }];
    expect(await readClassificationSyncView()).toMatchObject({ status: 'conflict', pending: 1 });
    expect(await acknowledgeDesktopClassification(mocks.state)).toBe(false);
    await expect(syncAIClassification()).rejects.toThrow('分类尚未同步');
    expect(mocks.state.classificationSchemes!.generation!.syncPending).toBe(true);
  });
  it('shows local save without waiting when no backend exists, and offline when configured', async () => {
    mocks.available = false; mocks.configured = '';
    await syncAIClassification();
    expect(await readClassificationSyncView()).toEqual({ status: 'local', pending: 0 });
    expect(mocks.state.classificationSchemes!.generation!.syncPending).toBe(false);
    mocks.configured = 'https://backend.example';
    await expect(syncAIClassification()).rejects.toThrow('后端离线');
    expect(await readClassificationSyncView()).toMatchObject({ status: 'offline' });
    expect(mocks.state.classificationSchemes!.generation!.syncPending).toBe(true);
  });
  it('does not let an old failed request mark a newer generation as pending', async () => {
    mocks.force.mockImplementation(async () => {
      mocks.state.setClassificationGeneration({ generation: 4, syncPending: false });
      throw new Error('old request failed');
    });
    await expect(syncAIClassification()).rejects.toThrow('old request failed');
    expect(mocks.state.classificationSchemes!.generation).toMatchObject({ generation: 4, syncPending: false });
  });
});




it('requires a receipt captured before the request for this exact generation, even when payload bytes match', async () => {
  desktop();
  mocks.receiptToken = classificationSyncToken(mocks.state);
  mocks.state.setClassificationGeneration({ generation: 4 });
  expect(await acknowledgeDesktopClassification(mocks.state)).toBe(false);
  expect(mocks.state.classificationSchemes!.generation!.syncPending).toBe(true);
});
