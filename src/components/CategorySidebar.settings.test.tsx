import { webcrypto } from 'node:crypto';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Repository, VectorSearchConfig } from '../types';
import { createVectorGeneration } from '../services/vectorIndexIdentity';
import { CategorySidebar } from './CategorySidebar';

const mocks = vi.hoisted(() => ({ state: {} as Record<string, unknown>, electron: true }));
vi.mock('../store/useAppStore', () => ({
  useAppStore: (selector: (state: typeof mocks.state) => unknown) => selector(mocks.state),
  getAllCategories: () => [{ id: 'all', name: 'All categories', icon: '', keywords: [] }],
  sortCategoriesByOrder: (categories: unknown) => categories,
}));
vi.mock('../services/electronProxy', () => ({ isElectron: () => mocks.electron }));
vi.mock('./CategoryEditModal', () => ({ CategoryEditModal: () => null }));
vi.mock('../hooks/useDialog', () => ({ useDialog: () => ({ confirm: vi.fn(), toast: vi.fn() }) }));
vi.mock('../features/repositories/hooks/useCategorySyncActions', () => ({
  useCategorySyncActions: () => ({ forceSyncToBackend: vi.fn() }),
}));
const embedding = {
  id: 'embedding', name: 'Model', isActive: true, apiType: 'ollama' as const,
  model: 'model', baseUrl: 'http://localhost:11434', dimensions: 3, apiKey: '',
};
let config: VectorSearchConfig;
let repositories: Repository[];
const select = vi.fn();

beforeEach(async () => {
  vi.clearAllMocks();
  vi.stubGlobal('crypto', webcrypto);
  config = {
    enabled: true, embeddingConfigId: 'embedding', indexMode: 'readme', readmeMaxChars: 6000,
    workerUrl: 'https://worker.example', authToken: 'test',
    activeIndex: await createVectorGeneration(embedding, {
      workerUrl: 'https://worker.example', indexMode: 'readme', readmeMaxChars: 6000,
    }),
  };
  repositories = Array.from({ length: 120 }, (_, id) => ({ id, analyzed_at: '2026-09-01' } as Repository));
  Object.assign(mocks.state, {
    language: 'en', repositories, embeddingConfigs: [embedding], activeEmbeddingConfig: embedding.id,
    vectorSearchConfig: config, customCategories: [], hiddenDefaultCategoryIds: [], defaultCategoryOverrides: {},
    categoryOrder: [], collapsedSidebarCategoryCount: 6, categoryMatchMode: 'effective',
    isSidebarCollapsed: false, setSidebarCollapsed: vi.fn(), setCurrentView: vi.fn(),
  });
  mocks.electron = true;
  sessionStorage.clear();
});
afterEach(() => vi.unstubAllGlobals());
const sidebar = () => <CategorySidebar repositories={repositories} selectedCategory="all" onCategorySelect={select} />;

describe('category sidebar settings integration', () => {
  it.each(['mobile', 'expanded', 'collapsed'])('shows capped local pending and plugin name in %s navigation', (layout) => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: layout === 'mobile' ? 375 : 1440 });
    mocks.state.isSidebarCollapsed = layout === 'collapsed';
    render(sidebar());
    expect(screen.getByText('99+')).toHaveAttribute('aria-label', '120 locally known pending');
    expect(screen.getByRole('button', { name: 'Plugin Management' })).toBeTruthy();
    expect(fetch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Vector Search' }));
    expect(sessionStorage.getItem('gsm:pending-settings-tab')).toBe('vectorSearch');
    expect(mocks.state.setCurrentView).toHaveBeenCalledWith('settings');
    expect(select).not.toHaveBeenCalled();
  });

  it('opens plugin management through the existing settings-tab contract', () => {
    render(sidebar());
    fireEvent.click(screen.getByRole('button', { name: 'Plugin Management' }));
    expect(sessionStorage.getItem('gsm:pending-settings-tab')).toBe('plugins');
    expect(mocks.state.setCurrentView).toHaveBeenCalledWith('settings');
  });

  it('hides a disabled badge and desktop-only plugin management in web', () => {
    config.enabled = false;
    mocks.electron = false;
    render(sidebar());
    expect(screen.queryByText('99+')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Plugin Management' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Vector Search' })).toBeTruthy();
  });
});
