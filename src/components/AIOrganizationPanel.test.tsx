import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AIOrganizationPanel } from './AIOrganizationPanel';
import { DualOrganizationWizard } from './DualOrganizationWizard';
import type { useAIOrganization } from '../hooks/useAIOrganization';
import type { Repository } from '../types';
import type { WorkbenchProposal } from '../types/aiWorkbench';

vi.mock('../store/useAppStore', () => ({
  useAppStore: (selector: (state: { language: string }) => unknown) => selector({ language: 'zh' }),
}));

vi.mock('../i18n/useT', () => ({
  useT: () => (key: string, options?: Record<string, unknown>) => {
    if (options?.count !== undefined) return `${key}:${options.count}`;
    return key;
  },
}));

const mockRepo1: Repository = {
  id: 101,
  name: 'gsm',
  full_name: 'test/gsm',
  owner: { login: 'test', avatar_url: '' },
  description: 'GitHub Stars Manager',
  topics: ['tool', 'manager'],
  stargazers_count: 50,
  forks_count: 5,
  forks: 5,
  html_url: 'https://github.com/test/gsm',
  language: 'TypeScript',
  created_at: '2026-01-01',
  updated_at: '2026-01-01',
  pushed_at: '2026-01-01',
  category_id: null,
  subcategory_id: null,
};

const mockRepo2: Repository = {
  id: 102,
  name: 'react-app',
  full_name: 'test/react-app',
  owner: { login: 'test', avatar_url: '' },
  description: 'A frontend framework application',
  topics: ['frontend', 'react'],
  stargazers_count: 120,
  forks_count: 10,
  forks: 10,
  html_url: 'https://github.com/test/react-app',
  language: 'TypeScript',
  created_at: '2026-01-01',
  updated_at: '2026-01-01',
  pushed_at: '2026-01-01',
  category_id: null,
  subcategory_id: null,
};

function createMockController(overrides?: Partial<ReturnType<typeof useAIOrganization>>) {
  const proposal: WorkbenchProposal = {
    id: 'prop-1',
    sessionId: 'session-1',
    ownerId: 'user-1',
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    operations: [],
    organization: {
      version: 1,
      revision: 1,
      scope: { name: 'all', repositoryIds: [101, 102] },
      instruction: '',
      configId: 'model-1',
      maxNewSubcategories: 6,
      structureReady: true,
      categories: [
        { id: 'cat-frontend', name: 'Frontend', icon: 'folder', parentId: null, isNew: false },
        { id: 'cat-tools', name: 'Tools', icon: 'folder', parentId: null, isNew: false },
      ],
      entries: [
        {
          repositoryId: 101,
          before: { categoryId: null, subcategoryId: null, locked: false },
          categoryId: 'cat-tools',
          subcategoryId: null,
          reason: 'CLI Tool',
          disposition: 'move',
          selected: true,
          overrideLocked: false,
          manual: false,
          status: 'pending',
        },
        {
          repositoryId: 102,
          before: { categoryId: null, subcategoryId: null, locked: false },
          categoryId: 'cat-frontend',
          subcategoryId: null,
          reason: 'Web app',
          disposition: 'move',
          selected: true,
          overrideLocked: false,
          manual: false,
          status: 'pending',
        },
      ],
      batches: [
        { repositoryIds: [101], status: 'complete' },
        { repositoryIds: [102], status: 'pending' },
      ],
      status: 'generating',
      createdCategoryIds: [],
    },
  };

  const defaultController: ReturnType<typeof useAIOrganization> = {
    recoverableResults: false, retrySave: vi.fn(),
    continueCompleted: vi.fn(),
    treeCategories: [], treePreview: null, editTree: vi.fn(), continueLegacy: vi.fn(), redesignMerge: vi.fn(),
    analysisDepth: 'quick', setAnalysisDepth: vi.fn(), concurrency: undefined, setConcurrency: vi.fn(), concurrencyLimit: 3,
    evidenceSummary: { detailed: 0, stale: 0, pending: 2 }, deepenAll: vi.fn(),
    structureSchemeId: 'purpose',
    reviewScheme: 'purpose', setReviewScheme: vi.fn(), setSchemeSelected: vi.fn(), setRetireCategories: vi.fn(), setCleanupReplaced: vi.fn(), refine: vi.fn(),
    purpose: 'repositories', setPurpose: vi.fn(), mode: 'reorganize', setMode: vi.fn(),
    rangeSummary: { total: 2, assigned: 0, locked: 0, fullLibrary: true },
    bulkEdit: vi.fn(), addStructure: vi.fn(), editStructure: vi.fn(), applyStructure: vi.fn(), restoreStructure: vi.fn(), acceptOriginalGroup: vi.fn(), migrateSelected: vi.fn(),
    scope: 'all',
    setScope: vi.fn(),
    scopeOptions: [{ value: 'all', label: 'All', count: 2 }],
    repositories: [mockRepo1, mockRepo2],
    configId: 'model-1',
    setConfigId: vi.fn(),
    aiConfigs: [{ id: 'model-1', name: 'GPT-4', model: 'gpt-4o', apiKey: 'key', baseUrl: '', isActive: true }],
    instruction: '',
    setInstruction: vi.fn(),
    maxNewSubcategories: 6,
    setMaxNewSubcategories: vi.fn(),
    replaceManual: false,
    setReplaceManual: vi.fn(),
    proposal,
    versions: [proposal],
    selectVersion: vi.fn(),
    saving: false,
    busy: true,
    task: { sessionId: 'session-1', ownerId: 'user-1', stage: 'organization:1/2', running: true },
    error: '',
    readonly: false,
    count: 2,
    scopedRepositories: [mockRepo1, mockRepo2],
    generate: vi.fn(),
    retry: vi.fn(),
    enrich: vi.fn(),
    retryBatch: vi.fn(),
    editEntry: vi.fn(),
    selectEntries: vi.fn(),
    renameCategory: vi.fn(),
    apply: vi.fn(),
    restore: vi.fn(),
    retrySync: vi.fn(),
    stop: vi.fn(),
    newDraft: vi.fn(),
    continueInWorkbench: vi.fn(),
    ...overrides,
  };

  return defaultController;
}

function dualController(overrides: Partial<ReturnType<typeof useAIOrganization>> = {}) {
  const controller = createMockController({ busy: false });
  const proposal = structuredClone(controller.proposal!); const draft = proposal.organization!;
  const before = { customCategories: [], defaultCategoryOverrides: {}, hiddenDefaultCategoryIds: [], categoryOrder: [], subcategories: [], subcategoryOrder: [], repositoryOrder: [], categoryListIdMap: {} };
  draft.version = 3; draft.status = 'ready';
  const scheme = () => ({ selected: true, ready: true, categories: structuredClone(draft.categories), entries: structuredClone(draft.entries), before, createdCategoryIds: [] });
  draft.dual = { phase: 'review', outcome: 'complete', requests: {}, errors: [], understanding: [], summaries: [], schemes: { purpose: scheme(), technology: scheme() } };
  return { ...controller, proposal, versions: [proposal], ...overrides };
}

describe('compact organization wizard', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  it('shows the remaining pending repository in problem view and offers explicit continuation', async () => {
    const current = dualController({ busy: true }); const draft = current.proposal!.organization!;
    draft.status = 'generating'; draft.dual!.phase = 'understanding';
    draft.dual!.understanding = [101, 102].map((id, i) => ({ repositoryId: id, fingerprint: '', sources: [],
      sourceMetadata: { name: i ? 'fixture/slow' : 'fixture/done', description: '', summary: '', tags: [], language: '', details: '' },
      status: i ? 'pending' as const : 'understood' as const, purpose: i ? [] : ['Known use'], technology: [], activity: i ? 'understanding' as const : undefined }));
    const user = userEvent.setup(); render(<AIOrganizationPanel open onOpenChange={vi.fn()} controller={current} />);
    expect(document.querySelectorAll('[data-organization-repository]')).toHaveLength(2);
    expect(screen.getByText('organizationRuntime.title')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'organizationSpeed.deferPending:1' }));
    expect(current.continueCompleted).toHaveBeenCalledOnce();
  });
  it('resets filters when another draft opens', async () => {
    const current = dualController(); const user = userEvent.setup();
    const { rerender } = render(<DualOrganizationWizard open onOpenChange={vi.fn()} controller={current} />);
    await user.click(screen.getByRole('button', { name: /^Tools/ }));
    expect(document.querySelectorAll('[data-organization-repository]')).toHaveLength(1);
    const next = structuredClone(current.proposal!); next.id = 'next';
    next.organization!.dual!.schemes.purpose.entries.forEach(entry => { entry.categoryId = 'cat-frontend'; });
    rerender(<DualOrganizationWizard open onOpenChange={vi.fn()} controller={{ ...current, proposal: next, versions: [next] }} />);
    expect(document.querySelectorAll('[data-organization-repository]')).toHaveLength(2);
  });
  it('shows target editors only after opening a repository', async () => {
    const current = dualController(); const user = userEvent.setup();
    render(<AIOrganizationPanel open onOpenChange={vi.fn()} controller={current} />);
    expect(screen.queryByRole('combobox', { name: 'aiOrganization.targetMain' })).not.toBeInTheDocument();
    await user.click(document.querySelector<HTMLButtonElement>('[data-open-organization-detail]')!);
    expect(screen.getByRole('combobox', { name: 'aiOrganization.targetMain' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'organizationUx.closeDetail' }));
    expect(screen.queryByRole('combobox', { name: 'aiOrganization.targetMain' })).not.toBeInTheDocument();
  });
  it('blocks generation for an unavailable model and removes duplicate technical tabs', () => {
    const current = createMockController({ versions: [], busy: false, proposal: undefined });
    render(<AIOrganizationPanel open onOpenChange={vi.fn()} controller={current} />);
    expect(screen.getByRole('button', { name: 'dualOrganization.start' })).toBeDisabled();
    expect(screen.queryByRole('tab', { name: 'aiOrganization.purpose.repositories' })).not.toBeInTheDocument();
  });
  it('renders a common AGY fault as paused, not as every repository failed', () => {
    const current = dualController(); const draft = current.proposal!.organization!;
    draft.status = 'interrupted'; draft.dual!.blocked = { code: 'AGY_DISABLED', message: 'AGY_DISABLED', phase: 'understanding' };
    render(<AIOrganizationPanel open onOpenChange={vi.fn()} controller={current} />);
    expect(screen.getByText('organizationUx.paused')).toBeInTheDocument();
    expect(screen.getByText(/organizationUx.problems.disabled/)).toBeInTheDocument();
    expect(screen.getByText('dualOrganization.failed:0')).toBeInTheDocument();
  });
  it('keeps old drafts readable without resurrecting old prompt controls', () => {
    const current = createMockController({ busy: false });
    render(<AIOrganizationPanel open onOpenChange={vi.fn()} controller={current} />);
    expect(screen.getByText('organizationUx.history')).toBeInTheDocument();
    expect(document.querySelectorAll('[data-organization-repository]')).toHaveLength(2);
    expect(screen.queryByText(/Domain & Form/)).not.toBeInTheDocument();
  });
});

