import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { InspirationGrid, INSPIRATION_STORAGE_KEY } from './InspirationGrid';

vi.mock('../../../store/useAppStore', () => ({
  useAppStore: vi.fn((selector) => {
    const state = { language: 'zh' };
    return selector ? selector(state) : state;
  }),
}));

describe('InspirationGrid', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it('renders 6 default depth-matrix cards', () => {
    render(<InspirationGrid onSelectPrompt={vi.fn()} />);

    expect(screen.getByText('💡 灵感看板')).toBeInTheDocument();
    expect(screen.getByText('⚖️ 技术选型与横向对比')).toBeInTheDocument();
    expect(screen.getByText('🚀 开源趋势与黑马挖掘')).toBeInTheDocument();
    expect(screen.getByText('📦 Star 资产智能治理')).toBeInTheDocument();
    expect(screen.getByText('💻 本地工程架构诊断')).toBeInTheDocument();
    expect(screen.getByText('🔄 开源自托管替代品')).toBeInTheDocument();
    expect(screen.getByText('🔬 顶级开源源码精读')).toBeInTheDocument();
  });

  it('triggers onSelectPrompt with the correct scope when a capsule is clicked', () => {
    const onSelect = vi.fn();
    render(<InspirationGrid onSelectPrompt={onSelect} />);

    const pill = screen.getByText('对比 Zustand 与 Redux Toolkit 的性能与体积');
    fireEvent.click(pill);

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(
      '对比 Zustand 与 Redux Toolkit 的性能与体积',
      'selected',
    );
  });

  it('alternates prompt capsules back and forth when repeatedly clicking 换一批 (Shuffle)', () => {
    render(<InspirationGrid onSelectPrompt={vi.fn()} />);

    expect(screen.getByText('对比 Zustand 与 Redux Toolkit 的性能与体积')).toBeInTheDocument();

    const shuffleBtn = screen.getByText('换一批');
    // First click: rotates to alternate pool
    fireEvent.click(shuffleBtn);
    expect(screen.getByText('对比 vLLM 与 Ollama 本地部署吞吐性能')).toBeInTheDocument();

    // Second click: rotates back to original pool
    fireEvent.click(shuffleBtn);
    expect(screen.getByText('对比 Zustand 与 Redux Toolkit 的性能与体积')).toBeInTheDocument();

    // Third click: rotates again
    fireEvent.click(shuffleBtn);
    expect(screen.getByText('对比 vLLM 与 Ollama 本地部署吞吐性能')).toBeInTheDocument();
  });

  it('enters inline edit mode, modifies title and saves to localStorage', async () => {
    render(<InspirationGrid onSelectPrompt={vi.fn()} />);

    const editButtons = screen.getAllByRole('button', { name: /编辑/ });
    fireEvent.click(editButtons[0]);

    expect(screen.getByText('✏️ 原位编辑卡片')).toBeInTheDocument();

    const inputs = screen.getAllByRole('textbox');
    // First textbox in edit form is title
    fireEvent.change(inputs[0], { target: { value: '我的自定义选型卡片' } });

    const saveBtn = screen.getByText('保存');
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(screen.getByText('我的自定义选型卡片')).toBeInTheDocument();
    });

    const saved = localStorage.getItem(INSPIRATION_STORAGE_KEY);
    expect(saved).toBeTruthy();
    expect(saved).toContain('我的自定义选型卡片');
  });

  it('restores default presets and clears localStorage when clicking 恢复预设 (Reset)', async () => {
    localStorage.setItem(
      INSPIRATION_STORAGE_KEY,
      JSON.stringify([
        {
          id: 'custom-1',
          title: '临时测试卡片',
          description: '测试用',
          scope: 'github',
          prompts: ['自定义测试 Prompt'],
          altPrompts: [],
        },
      ]),
    );

    render(<InspirationGrid onSelectPrompt={vi.fn()} />);

    expect(screen.getByText('临时测试卡片')).toBeInTheDocument();

    const resetBtn = screen.getByText('恢复预设');
    fireEvent.click(resetBtn);

    await waitFor(() => {
      expect(screen.getByText('⚖️ 技术选型与横向对比')).toBeInTheDocument();
    });
    expect(localStorage.getItem(INSPIRATION_STORAGE_KEY)).toBeNull();
  });
});
