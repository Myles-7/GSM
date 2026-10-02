import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { AIWorkbench } from './AIWorkbench';
import type { WorkbenchProposal } from '../../../types/aiWorkbench';

const mockWorkbench = {
  active: { id: 's1', title: 'Test Session', createdAt: new Date().toISOString() },
  activeId: 's1',
  repositories: [],
  sessions: [{ id: 's1', title: 'Test Session', repoFullName: 'user/repo' }],
  projects: [],
  data: {
    scope: 'github' as const,
    depth: 'standard' as const,
    requirements: undefined,
    selectedRepositories: [] as any[],
    searchBatches: [] as any[],
  },
  task: { running: false, stage: 'idle', sessionId: 's1', elapsedSeconds: 0 },
  settings: { retainSessionDays: 90, chatConfigId: null },
  aiConfigs: [{ id: 'c1', name: 'DeepSeek', model: 'deepseek-chat', apiKey: 'k', baseUrl: 'url', apiType: 'openai', isActive: true }],
  modelId: 'c1',
  messages: [] as any[],
  proposals: [] as WorkbenchProposal[],
  evidence: [] as any[],
  freshness: {} as Record<string, string>,
  mode: 'active' as const,
  project: null,
  localProject: null,
  error: null,
  guard: vi.fn((fn: () => any) => fn()),
  createSession: vi.fn().mockResolvedValue({ id: 's2', title: 'New' }),
  select: vi.fn(),
  send: vi.fn(),
  stop: vi.fn(),
  search: vi.fn(),
  execute: vi.fn(),
  patchData: vi.fn().mockResolvedValue(undefined),
  patchSession: vi.fn(),
  setSettings: vi.fn(),
  setMode: vi.fn(),
  createProject: vi.fn(),
  saveProject: vi.fn(),
  deleteProject: vi.fn(),
  restoreSession: vi.fn(),
  claim: vi.fn(),
  star: vi.fn(),
  addRepository: vi.fn(),
  chooseLocalProject: vi.fn(),
  exportBackup: vi.fn().mockResolvedValue({}),
  importBackup: vi.fn(),
};

vi.mock('../hooks/useAIWorkbench', () => ({
  useAIWorkbench: () => mockWorkbench,
}));

vi.mock('../../../hooks/useAIOrganization', () => ({
  useAIOrganization: () => ({
    filteredRepositories: [],
    selectedRepositoryIds: [],
    selectVersion: vi.fn(),
    state: {},
  }),
}));

vi.mock('../../../components/AIOrganizationPanel', () => ({
  AIOrganizationPanel: () => null,
}));

vi.mock('../../../store/useAppStore', () => ({
  useAppStore: vi.fn((selector) => {
    const state = { language: 'zh' };
    return selector ? selector(state) : state;
  }),
}));

describe('AIWorkbench Component (Phase 1)', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    mockWorkbench.activeId = 's1';
    mockWorkbench.messages = [];
    mockWorkbench.proposals = [];
    mockWorkbench.settings.retainSessionDays = 90;
    mockWorkbench.data.scope = 'github';
  });

  it('1.1 renders InspirationGrid in empty state and clicking a prompt capsule populates the input and updates scope', async () => {
    render(<AIWorkbench />);

    expect(screen.getByText('💡 灵感看板')).toBeInTheDocument();
    expect(screen.getByText('⚖️ 技术选型与横向对比')).toBeInTheDocument();

    const pill = screen.getByText('对比 Zustand 与 Redux Toolkit 的性能与体积');
    fireEvent.click(pill);

    expect(mockWorkbench.patchData).toHaveBeenCalledWith('s1', { scope: 'selected' });
    const textarea = screen.getByLabelText('问题') as HTMLTextAreaElement;
    expect(textarea.value).toBe('对比 Zustand 与 Redux Toolkit 的性能与体积');
  });

  it('1.3 OperationPreview renders diffs cleanly with Tag Badges and (未设置) without JSON.stringify quotes', () => {
    mockWorkbench.proposals = [
      {
        id: 'prop-1',
        ownerId: 'u1',
        sessionId: 's1',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        operations: [
          {
            id: 'op-1',
            kind: 'update',
            status: 'proposed',
            selected: true,
            overrideLocked: false,
            repository: {
              id: 101,
              name: 'react',
              full_name: 'facebook/react',
              owner: { login: 'facebook', avatar_url: '' },
              stargazers_count: 200000,
              description: 'The library for web and native UIs',
            } as any,
            reason: 'Categorize under frontend framework',
            before: {
              custom_category: undefined,
              custom_tags: [],
              custom_description: undefined,
            },
            after: {
              custom_category: '前端框架',
              custom_tags: ['ui', 'react'],
              custom_description: '现代 UI 响应式视图框架',
            },
          },
        ],
      },
    ];

    render(<AIWorkbench />);

    expect(screen.getByText('facebook/react')).toBeInTheDocument();
    // Tags diff
    expect(screen.getByText('(无标签)')).toBeInTheDocument();
    expect(screen.getByText('#ui')).toBeInTheDocument();
    expect(screen.getByText('#react')).toBeInTheDocument();

    // Category and description diff
    expect(screen.getAllByText('(未设置)').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('前端框架')).toBeInTheDocument();
    expect(screen.getByText('现代 UI 响应式视图框架')).toBeInTheDocument();
  });

  it('1.4 Retention renders as a semantic Chip with Popover options and handles custom input', () => {
    render(<AIWorkbench />);

    const chip = screen.getByText('90天');
    expect(chip).toBeInTheDocument();

    fireEvent.click(chip);

    expect(screen.getByText('30天')).toBeInTheDocument();
    expect(screen.getByText('180天')).toBeInTheDocument();
    expect(screen.getByText('永久保存')).toBeInTheDocument();

    fireEvent.click(screen.getByText('180天'));
    expect(mockWorkbench.setSettings).toHaveBeenCalledWith({ retainSessionDays: 180 });

    // Test custom input
    const input = screen.getByLabelText('自定义保留天数');
    fireEvent.change(input, { target: { value: '45' } });
    expect(mockWorkbench.setSettings).toHaveBeenCalledWith({ retainSessionDays: 45 });
  });

  it('1.5 Project dialog renders header icon, description and structured fields', () => {
    render(<AIWorkbench />);

    const newProjectBtn = screen.getByTitle('新建项目');
    fireEvent.click(newProjectBtn);

    expect(screen.getByText(/项目用于归集特定主题的研究会话与关联仓库/)).toBeInTheDocument();
    expect(screen.getByText(/取消/)).toBeInTheDocument();
    expect(screen.getByText(/创建项目/)).toBeInTheDocument();
  });

  it('1.6 User and Assistant messages render with role-specific containers and evidence links', () => {
    mockWorkbench.messages = [
      {
        id: 'm1',
        role: 'user',
        content: '推荐几个好用的前端状态管理库',
        status: 'complete',
        evidenceIds: [],
      },
      {
        id: 'm2',
        role: 'assistant',
        content: '推荐 Zustand、Jotai 和 Redux Toolkit。',
        status: 'complete',
        evidenceIds: ['ev1', 'ev2'],
      },
    ];
    mockWorkbench.evidence = [
      {
        id: 'ev1',
        source: 'github',
        repoFullName: 'pmndrs/zustand',
        path: 'README.md',
        lineStart: 1,
        lineEnd: 25,
        url: 'https://github.com/pmndrs/zustand',
      },
      {
        id: 'ev2',
        source: 'local',
        repoFullName: 'local-workspace/gsm',
        path: 'package.json',
        lineStart: 10,
        // No lineEnd - test single line boundary
        url: 'local://workspace/package.json',
      },
    ];
    mockWorkbench.freshness = { ev1: 'current', ev2: 'current' };

    render(<AIWorkbench />);

    expect(screen.getByText('推荐几个好用的前端状态管理库')).toBeInTheDocument();
    expect(screen.getByText('AI 助手')).toBeInTheDocument();
    expect(screen.getByText('推荐 Zustand、Jotai 和 Redux Toolkit。')).toBeInTheDocument();
    expect(screen.getByText('pmndrs/zustand')).toBeInTheDocument();
    expect(screen.getByText('(L1-25)')).toBeInTheDocument();
    // Test single line evidence link formatting (L10) without undefined
    expect(screen.getByText('(L10)')).toBeInTheDocument();
  });

  it('correctly localizes scope labels for local and mixed research scopes on mobile toolbar', () => {
    mockWorkbench.data.scope = 'local' as any;
    const { rerender } = render(<AIWorkbench />);

    // Mobile toolbar button displays currentScopeLabel
    expect(screen.getByTitle('参数设置')).toHaveTextContent(/本地项目/);

    mockWorkbench.data.scope = 'mixed' as any;
    rerender(<AIWorkbench />);
    expect(screen.getByTitle('参数设置')).toHaveTextContent(/本地 \+ 所选仓库/);
  });

  describe('Phase 2: Interaction Integrity & UX Fixes', () => {
    it('2.1 shows floating capsule button when proposals exist and scrolls smoothly', () => {
      // Spy on scrollIntoView
      const scrollIntoViewMock = vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(() => {});

      mockWorkbench.proposals = [
        {
          id: 'prop-1',
          ownerId: 'u1',
          sessionId: 's1',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          operations: [],
        },
      ];

      render(<AIWorkbench />);

      // The proposal capsule should be in the document
      const capsule = screen.getByRole('button', { name: /查看新提案/ });
      expect(capsule).toBeInTheDocument();
      expect(capsule).toHaveTextContent('📋 查看新提案 ↓');

      fireEvent.click(capsule);
      expect(scrollIntoViewMock).toHaveBeenCalled();
    });

    it('2.4 candidate card button turns into green added state and shows context badge in form', () => {
      const repo1 = {
        id: 101,
        name: 'react',
        full_name: 'facebook/react',
        owner: { login: 'facebook', avatar_url: '' },
        stargazers_count: 200000,
        description: 'React library',
        language: 'JavaScript',
        topics: ['ui', 'react'],
        license: 'MIT',
        pushed_at: '2026-01-01',
      };

      mockWorkbench.data.searchBatches = [
        {
          id: 'b1',
          requirements: { purpose: 'UI', required: [], preferred: [], excluded: [], questions: [], queries: [] },
          nextPage: 2,
          candidates: [
            {
              repository: repo1 as any,
              summary: 'React library summary',
              reasons: [],
              limitations: [],
              sources: [],
              status: 'candidate',
            },
          ],
        },
      ];

      // Initially repo is not in selectedRepositories
      mockWorkbench.data.selectedRepositories = [];
      const { rerender } = render(<AIWorkbench />);

      const contextBtn = screen.getByRole('button', { name: /用于对话/ });
      expect(contextBtn).toBeInTheDocument();
      fireEvent.click(contextBtn);
      expect(mockWorkbench.addRepository).toHaveBeenCalledWith(repo1);

      // Now re-render with repo1 in selectedRepositories
      mockWorkbench.data.selectedRepositories = [repo1 as any];
      rerender(<AIWorkbench />);

      // Candidate card button should now show "已添加"
      expect(screen.getByRole('button', { name: /已加入对话上下文/ })).toHaveTextContent('已添加');

      // Context badge should be displayed above textarea
      expect(screen.getByText('对话上下文:')).toBeInTheDocument();
      expect(screen.getAllByText('facebook/react').length).toBeGreaterThanOrEqual(2);

      // Click remove button in context badge
      const removeBtn = screen.getByTitle('移出上下文');
      fireEvent.click(removeBtn);
      expect(mockWorkbench.patchData).toHaveBeenCalledWith('s1', {
        selectedRepositories: [],
      });
    });

    it('2.4 language metadata tolerance: infers language from topics or falls back to Multilingual/General', () => {
      const repoWithTopics = {
        id: 201,
        name: 'torch-model',
        full_name: 'ai/torch-model',
        owner: { login: 'ai', avatar_url: '' },
        stargazers_count: 500,
        description: 'AI model',
        language: null,
        topics: ['deep-learning', 'pytorch'],
        license: 'MIT',
        pushed_at: '2026-01-01',
      };

      const repoUnknown = {
        id: 202,
        name: 'misc-tools',
        full_name: 'user/misc-tools',
        owner: { login: 'user', avatar_url: '' },
        stargazers_count: 50,
        description: 'Random tools',
        language: null,
        topics: ['random-topic-without-language'],
        license: 'MIT',
        pushed_at: '2026-01-01',
      };

      mockWorkbench.data.searchBatches = [
        {
          id: 'b1',
          requirements: { purpose: 'Testing', required: [], preferred: [], excluded: [], questions: [], queries: [] },
          nextPage: 2,
          candidates: [
            { repository: repoWithTopics as any, summary: 'AI model', reasons: [], limitations: [], sources: [], status: 'candidate' },
            { repository: repoUnknown as any, summary: 'Random tools', reasons: [], limitations: [], sources: [], status: 'candidate' },
          ],
        },
      ];

      render(<AIWorkbench />);

      // repoWithTopics has language: null but topics contains pytorch -> resolves to Python
      expect(screen.getByText('Python')).toBeInTheDocument();

      // repoUnknown has language: null and no recognized topic -> falls back to "多语言 / 通用"
      expect(screen.getByText('多语言 / 通用')).toBeInTheDocument();
    });

    it('2.1 smoothly locates at messagesEndRef on session switch when messages load asynchronously', async () => {
      const scrollIntoViewMock = vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(() => {});

      mockWorkbench.activeId = 's1';
      mockWorkbench.messages = [
        { id: 'm1', role: 'user', content: 'Hello s1', status: 'complete', evidenceIds: [] },
      ];

      const { rerender } = render(<AIWorkbench />);
      expect(scrollIntoViewMock).toHaveBeenCalled();
      scrollIntoViewMock.mockClear();

      // Switch session to s2, but messages are not loaded yet in this render tick
      mockWorkbench.activeId = 's2';
      mockWorkbench.messages = [];
      rerender(<AIWorkbench />);

      // At next tick, s2 messages arrive
      mockWorkbench.messages = [
        { id: 'm2', role: 'assistant', content: 'Hello from s2', status: 'complete', evidenceIds: [] },
      ];
      rerender(<AIWorkbench />);

      // Verify messagesEndRef is scrolled for the newly loaded session
      expect(scrollIntoViewMock).toHaveBeenCalledWith(
        expect.objectContaining({ behavior: 'smooth', block: 'end' })
      );
    });

    it('2.4 clears all context repositories when clicking the Clear all button', () => {
      const repo1 = {
        id: 101, name: 'react', full_name: 'facebook/react',
        owner: { login: 'facebook', avatar_url: '' }, stargazers_count: 200000,
        description: 'React library', language: 'JavaScript',
      };
      const repo2 = {
        id: 102, name: 'vue', full_name: 'vuejs/core',
        owner: { login: 'vuejs', avatar_url: '' }, stargazers_count: 50000,
        description: 'Vue core', language: 'TypeScript',
      };

      mockWorkbench.data.selectedRepositories = [repo1 as any, repo2 as any];
      render(<AIWorkbench />);

      expect(screen.getByText('facebook/react')).toBeInTheDocument();
      expect(screen.getByText('vuejs/core')).toBeInTheDocument();

      const clearBtn = screen.getByRole('button', { name: '清空' });
      expect(clearBtn).toBeInTheDocument();
      fireEvent.click(clearBtn);

      expect(mockWorkbench.patchData).toHaveBeenCalledWith('s1', {
        selectedRepositories: [],
      });
    });

    it('2.4 compound topics language tolerance: recognizes compound topics like vuejs and rust-crate', () => {
      const repoVue = {
        id: 301, name: 'vue-comp', full_name: 'ui/vue-comp',
        owner: { login: 'ui', avatar_url: '' }, stargazers_count: 300,
        description: 'UI components', language: null,
        topics: ['vuejs', 'components'], license: 'MIT', pushed_at: '2026-01-01',
      };
      const repoRust = {
        id: 302, name: 'fast-parser', full_name: 'dev/fast-parser',
        owner: { login: 'dev', avatar_url: '' }, stargazers_count: 800,
        description: 'Fast parser', language: 'null',
        topics: ['rust-crate', 'parser'], license: 'Apache-2.0', pushed_at: '2026-01-01',
      };

      mockWorkbench.data.searchBatches = [
        {
          id: 'b1',
          requirements: { purpose: 'Testing', required: [], preferred: [], excluded: [], questions: [], queries: [] },
          nextPage: 2,
          candidates: [
            { repository: repoVue as any, summary: 'UI components', reasons: [], limitations: [], sources: [], status: 'candidate' },
            { repository: repoRust as any, summary: 'Fast parser', reasons: [], limitations: [], sources: [], status: 'candidate' },
          ],
        },
      ];

      render(<AIWorkbench />);

      expect(screen.getByText('TypeScript')).toBeInTheDocument();
      expect(screen.getByText('Rust')).toBeInTheDocument();
    });

    it('2.4 edge cases: removes single context repo cleanly and handles None/undefined string languages', () => {
      const repoNone = {
        id: 401, name: 'py-nlp', full_name: 'ai/py-nlp',
        owner: { login: 'ai', avatar_url: '' }, stargazers_count: 120,
        description: 'NLP', language: 'None',
        topics: ['nlp', 'python'], license: 'MIT',
      };
      const repoOther = {
        id: 402, name: 'other-tool', full_name: 'dev/other-tool',
        owner: { login: 'dev', avatar_url: '' }, stargazers_count: 50,
        description: 'Tool', language: 'Go',
      };

      mockWorkbench.data.selectedRepositories = [repoNone as any, repoOther as any];
      mockWorkbench.data.searchBatches = [
        {
          id: 'b1',
          requirements: { purpose: 'Test', required: [], preferred: [], excluded: [], questions: [], queries: [] },
          nextPage: 2,
          candidates: [
            { repository: repoNone as any, summary: 'NLP', reasons: [], limitations: [], sources: [], status: 'candidate' },
          ],
        },
      ];

      render(<AIWorkbench />);

      // Language "None" sanitized -> inferred from python topic -> "Python"
      expect(screen.getByText('Python')).toBeInTheDocument();

      // Remove only repoNone
      const removeButtons = screen.getAllByTitle('移出上下文');
      fireEvent.click(removeButtons[0]);

      expect(mockWorkbench.patchData).toHaveBeenCalledWith('s1', {
        selectedRepositories: [repoOther],
      });
    });
  });

  describe('Scenario C: Mobile Virtual Keyboard and Drawer Badges (Phase 3)', () => {
    it('displays amber badge on mobile header drawers when pending proposals or candidates exist', () => {
      // Initially empty proposals and candidates -> no amber badge
      mockWorkbench.proposals = [];
      mockWorkbench.data.requirements = undefined;
      mockWorkbench.data.searchBatches = [];
      const { unmount } = render(<AIWorkbench />);
      expect(screen.queryByTestId('badge-mobile-left')).not.toBeInTheDocument();
      expect(screen.queryByTestId('badge-mobile-right')).not.toBeInTheDocument();
      unmount();

      // Now add proposals
      mockWorkbench.proposals = [{
        id: 'prop-1',
        sessionId: 's1',
        ownerId: 'u1',
        createdAt: '2026-01-01',
        updatedAt: '2026-01-01',
        operations: [],
      } as any];

      render(<AIWorkbench />);
      expect(screen.getByTestId('badge-mobile-left')).toBeInTheDocument();
      expect(screen.getByTestId('badge-mobile-right')).toBeInTheDocument();
    });

    it('adapts when visualViewport resize fires (mobile virtual keyboard opens)', () => {
      let resizeListener: (() => void) | null = null;
      const originalVisualViewport = window.visualViewport;
      const originalInnerWidth = window.innerWidth;
      const originalInnerHeight = window.innerHeight;

      // Mock mobile screen width and visualViewport
      Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 390 });
      Object.defineProperty(window, 'innerHeight', { writable: true, configurable: true, value: 844 });
      const mockVv = {
        height: 844,
        addEventListener: vi.fn((event, handler) => {
          if (event === 'resize') resizeListener = handler;
        }),
        removeEventListener: vi.fn(),
      };
      Object.defineProperty(window, 'visualViewport', { writable: true, configurable: true, value: mockVv });

      const { container } = render(<AIWorkbench />);
      const rootDiv = container.firstChild as HTMLElement;
      const header = container.querySelector('header') as HTMLElement;

      // Before keyboard opens: normal height
      expect(rootDiv.className).toContain('h-[calc(100dvh-4.5rem)]');
      expect(header.className).toContain('h-11');

      // Virtual keyboard popup: visualViewport height drops to 400px (diff > 140px)
      mockVv.height = 400;
      if (resizeListener) {
        fireEvent(window, new Event('resize'));
        act(() => {
          (resizeListener as () => void)();
        });
      }

      // After keyboard opens: adapts to 100dvh and compact h-9 header
      expect(rootDiv.className).toContain('h-[100dvh]');
      expect(header.className).toContain('h-9');

      // Virtual keyboard closes: visualViewport height returns to 844px
      mockVv.height = 844;
      if (resizeListener) {
        fireEvent(window, new Event('resize'));
        act(() => {
          (resizeListener as () => void)();
        });
      }

      // Reverts back to normal height
      expect(rootDiv.className).toContain('h-[calc(100dvh-4.5rem)]');
      expect(header.className).toContain('h-11');

      // Restores mocks
      Object.defineProperty(window, 'visualViewport', { writable: true, configurable: true, value: originalVisualViewport });
      Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: originalInnerWidth });
      Object.defineProperty(window, 'innerHeight', { writable: true, configurable: true, value: originalInnerHeight });
    });
  });
});


