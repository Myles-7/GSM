import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AIOrganizationPanel } from './AIOrganizationPanel';
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

describe('AIOrganizationPanel Phase 3 features', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders high-frequency prompt presets and fills instruction upon click', async () => {
    const user = userEvent.setup();
    const controller = createMockController({ busy: false });
    render(<AIOrganizationPanel open={true} onOpenChange={vi.fn()} controller={controller} />);

    // Check prompt preset chips are rendered
    const domainChip = screen.getByText('🏷️ 领域与形态');
    const techChip = screen.getByText('💻 技术栈与编程语言');
    const preserveChip = screen.getByText('🎯 保持一级分类');
    const tagsChip = screen.getByText('🧹 提取关键词生成规范标签');

    expect(domainChip).toBeInTheDocument();
    expect(techChip).toBeInTheDocument();
    expect(preserveChip).toBeInTheDocument();
    expect(tagsChip).toBeInTheDocument();

    // Click domain chip
    await user.click(domainChip);
    expect(controller.setInstruction).toHaveBeenCalledWith(
      expect.stringContaining('请按项目所属应用领域与工程形态'),
    );

    // Click tech stack chip
    await user.click(techChip);
    expect(controller.setInstruction).toHaveBeenCalledWith(
      expect.stringContaining('请以主要编程语言与底层技术栈'),
    );

    // Click preserve categories chip
    await user.click(preserveChip);
    expect(controller.setInstruction).toHaveBeenCalledWith(
      expect.stringContaining('请严格保留现有的所有一级分类体系'),
    );

    // Click tags chip
    await user.click(tagsChip);
    expect(controller.setInstruction).toHaveBeenCalledWith(
      expect.stringContaining('请深入提取每个仓库的核心功能特性与关键词'),
    );
  });

  it('renders dual-track progress bar: overall progress and current batch card', () => {
    const controller = createMockController({ busy: true });
    render(<AIOrganizationPanel open={true} onOpenChange={vi.fn()} controller={controller} />);

    // Track 1: Overall progress text: 1 / 2 completed -> 50%
    expect(screen.getByText(/已就绪 1 \/ 2 \(50%\)/)).toBeInTheDocument();

    // Track 2: Active batch processing card: Batch 2 / 2 · 处理中 (1 项)
    expect(screen.getByText(/批次 2 \/ 2 · 处理中 \(1 项\)/)).toBeInTheDocument();

    // Highlight ready item in the repository list: repository 101 is in completed batch
    const readyBadges = screen.getAllByText('已就绪');
    expect(readyBadges.length).toBeGreaterThan(0);
  });

  it('renders batch failure card and triggers single batch retry', async () => {
    const user = userEvent.setup();
    const failedController = createMockController({
      busy: false,
      proposal: {
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
          categories: [],
          entries: [],
          batches: [
            { repositoryIds: [101], status: 'complete' },
            { repositoryIds: [102], status: 'failed', error: 'Network timeout' },
          ],
          status: 'interrupted',
          createdCategoryIds: [],
        },
      },
    });

    render(<AIOrganizationPanel open={true} onOpenChange={vi.fn()} controller={failedController} />);

    // Batch 2 failed card
    expect(screen.getByText(/批次 2 \/ 2 · 失败 \(1 项\)/)).toBeInTheDocument();
    expect(screen.getByText(/\(Network timeout\)/)).toBeInTheDocument();

    // Click single batch retry button
    const retryBatchBtn = screen.getByRole('button', { name: /重试批次 2/ });
    await user.click(retryBatchBtn);

    expect(failedController.retryBatch).toHaveBeenCalledWith(1);
  });

  it('renders multiple failed batch cards allowing independent retries', async () => {
    const user = userEvent.setup();
    const multiFailedController = createMockController({
      busy: false,
      proposal: {
        id: 'prop-1',
        sessionId: 'session-1',
        ownerId: 'user-1',
        createdAt: '2026-01-01',
        updatedAt: '2026-01-01',
        operations: [],
        organization: {
          version: 1,
          revision: 1,
          scope: { name: 'all', repositoryIds: [101, 102, 103] },
          instruction: '',
          configId: 'model-1',
          maxNewSubcategories: 6,
          structureReady: true,
          categories: [],
          entries: [],
          batches: [
            { repositoryIds: [101], status: 'complete' },
            { repositoryIds: [102], status: 'failed', error: 'Timeout' },
            { repositoryIds: [103], status: 'failed', error: 'Rate limit' },
          ],
          status: 'interrupted',
          createdCategoryIds: [],
        },
      },
    });

    render(<AIOrganizationPanel open={true} onOpenChange={vi.fn()} controller={multiFailedController} />);

    expect(screen.getByText(/批次 2 \/ 3 · 失败 \(1 项\)/)).toBeInTheDocument();
    expect(screen.getByText(/批次 3 \/ 3 · 失败 \(1 项\)/)).toBeInTheDocument();

    const retryBatch3Btn = screen.getByRole('button', { name: /重试批次 3/ });
    await user.click(retryBatch3Btn);

    expect(multiFailedController.retryBatch).toHaveBeenCalledWith(2);
  });

  it('supports staged apply for ready items and disables button during saving', async () => {
    const user = userEvent.setup();
    const controller = createMockController({ busy: true, saving: false });
    const { rerender } = render(<AIOrganizationPanel open={true} onOpenChange={vi.fn()} controller={controller} />);

    // Repository 101 belongs to completed batch 1 and is selected move pending
    const stagedApplyBtn = screen.getByRole('button', { name: /应用当前已就绪的 1 项变更/ });
    expect(stagedApplyBtn).toBeInTheDocument();
    expect(stagedApplyBtn).not.toBeDisabled();

    await user.click(stagedApplyBtn);
    expect(controller.apply).toHaveBeenCalledWith([101]);

    // When saving is true, button is disabled
    const savingController = createMockController({ busy: true, saving: true });
    rerender(<AIOrganizationPanel open={true} onOpenChange={vi.fn()} controller={savingController} />);
    const disabledBtn = screen.getByRole('button', { name: /应用当前已就绪的 1 项变更/ });
    expect(disabledBtn).toBeDisabled();
  });

  it('keeps standard apply button with spinner when saving outside generation without disappearing or morphing', () => {
    const readyController = createMockController({
      busy: true,
      saving: true,
      proposal: {
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
          categories: [],
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
          ],
          batches: [{ repositoryIds: [101], status: 'complete' }],
          status: 'ready',
          createdCategoryIds: [],
        },
      },
    });

    render(<AIOrganizationPanel open={true} onOpenChange={vi.fn()} controller={readyController} />);

    expect(screen.queryByRole('button', { name: /应用当前已就绪的/ })).not.toBeInTheDocument();
    const standardApplyBtn = screen.getByRole('button', { name: /aiOrganization\.apply:1/ });
    expect(standardApplyBtn).toBeInTheDocument();
    expect(standardApplyBtn).toBeDisabled();
  });

  it('renders both active processing card and failed batch card simultaneously during batch retry', () => {
    const retryController = createMockController({
      busy: true,
      proposal: {
        id: 'prop-1',
        sessionId: 'session-1',
        ownerId: 'user-1',
        createdAt: '2026-01-01',
        updatedAt: '2026-01-01',
        operations: [],
        organization: {
          version: 1,
          revision: 1,
          scope: { name: 'all', repositoryIds: [101, 102, 103] },
          instruction: '',
          configId: 'model-1',
          maxNewSubcategories: 6,
          structureReady: true,
          categories: [],
          entries: [],
          batches: [
            { repositoryIds: [101], status: 'complete' },
            { repositoryIds: [102], status: 'pending' },
            { repositoryIds: [103], status: 'failed', error: 'Rate limit' },
          ],
          status: 'generating',
          createdCategoryIds: [],
        },
      },
    });

    render(<AIOrganizationPanel open={true} onOpenChange={vi.fn()} controller={retryController} />);

    expect(screen.getByText(/批次 2 \/ 3 · 处理中 \(1 项\)/)).toBeInTheDocument();
    expect(screen.getByText(/批次 3 \/ 3 · 失败 \(1 项\)/)).toBeInTheDocument();
  });
});

