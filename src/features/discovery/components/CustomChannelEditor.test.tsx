import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeChannel, makePlan } from '../custom/fixtures.test-support';
import { emptyData, type CustomDiscoveryData } from '../custom/model';

const mocks = vi.hoisted(() => ({ compile: vi.fn(), preview: vi.fn(), update: vi.fn(), run: vi.fn(), select: vi.fn() }));
vi.mock('../hooks/useCustomChannelActions', () => ({ useCustomChannelActions: () => mocks }));
vi.mock('../custom/runner', () => ({ currentAccount: () => '123' }));
vi.mock('../custom/store', () => ({
  useCustomDiscovery: (selector: (state: { account: string }) => unknown) => selector({ account: '123' }),
  updateCustomData: mocks.update, startCustomRun: mocks.run, selectCustomChannel: mocks.select,
}));
import { CustomChannelEditor } from './CustomChannelEditor';

let data: CustomDiscoveryData;
beforeEach(() => {
  vi.clearAllMocks();
  data = emptyData();
  mocks.compile.mockResolvedValue(makePlan());
  mocks.update.mockImplementation(async (change: (value: CustomDiscoveryData) => void) => change(data));
});
afterEach(cleanup);
const fill = () => {
  fireEvent.change(screen.getByRole('textbox', { name: '频道名称' }), { target: { value: 'codex' } });
  fireEvent.change(screen.getByRole('textbox', { name: '你想关注什么' }), { target: { value: '查找 codex 相关的项目' } });
};
const parse = async () => {
  fireEvent.click(screen.getByRole('button', { name: '解析需求' }));
  await waitFor(() => expect(screen.getByRole('button', { name: '保存频道' })).toBeEnabled());
};

describe('custom channel editor interactions', () => {
  it('parses without preview, and saves while preview is stalled', async () => {
    const close = vi.fn();
    let previewSignal: AbortSignal | undefined;
    mocks.preview.mockImplementation((_channel, signal) => {
      previewSignal = signal;
      return new Promise(() => {});
    });
    render(<CustomChannelEditor onClose={close} />);
    fill();
    await parse();
    expect(mocks.preview).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '预览候选' }));
    expect(screen.getByRole('button', { name: '保存频道' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: '保存频道' }));
    await waitFor(() => expect(close).toHaveBeenCalled());
    expect(previewSignal?.aborted).toBe(true);
    expect(data.channels[0].name).toBe('codex');
    expect(mocks.run).toHaveBeenCalled();
  });

  it('preserves manual unlimited across reparsing, and invalidates a changed description', async () => {
    render(<CustomChannelEditor onClose={vi.fn()} />);
    fill();
    // Switch to rules tab and explicitly pick "不限 Stars"
    fireEvent.click(screen.getByRole('tab', { name: /规则与筛选/ }));
    const noLimitBtn = screen.getByRole('button', { name: '不限 Stars' });
    fireEvent.click(noLimitBtn);

    // Switch back to requirements tab and parse
    fireEvent.click(screen.getByRole('tab', { name: /需求与 AI 解析/ }));
    await parse();

    fireEvent.change(screen.getByRole('textbox', { name: '你想关注什么' }), { target: { value: 'another request' } });
    expect(screen.getByRole('button', { name: '保存频道' })).toBeDisabled();
    await parse();

    // Verify minStars remains unlimited
    fireEvent.click(screen.getByRole('tab', { name: /规则与筛选/ }));
    expect(screen.getByRole('button', { name: '不限 Stars' })).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(screen.getByRole('button', { name: '保存频道' }));
    await waitFor(() => expect(data.channels).toHaveLength(1));
    expect(data.channels[0].ruleOverrides?.minStars).toBeNull();
  });

  it('retains inputs on timeout and ignores a cancelled late parse', async () => {
    mocks.compile.mockRejectedValueOnce(new DOMException('Timed out', 'TimeoutError'));
    render(<CustomChannelEditor onClose={vi.fn()} />);
    fill();
    fireEvent.click(screen.getByRole('button', { name: '解析需求' }));
    await screen.findByRole('alert');
    expect(screen.getByRole('textbox', { name: '频道名称' })).toHaveValue('codex');
    let resolve!: (plan: ReturnType<typeof makePlan>) => void;
    mocks.compile.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
    fireEvent.click(screen.getByRole('button', { name: '解析需求' }));
    fireEvent.click(screen.getByRole('button', { name: '取消任务' }));
    await act(async () => resolve(makePlan()));
    expect(screen.getByRole('button', { name: '保存频道' })).toBeDisabled();
  });

  it('fills a template and populates channel name when blank without requesting AI', () => {
    render(<CustomChannelEditor onClose={vi.fn()} />);
    fireEvent.change(screen.getByRole('combobox', { name: '需求模板' }), { target: { value: '0' } });
    expect(screen.getByRole('textbox', { name: '你想关注什么' })).toHaveValue('查找 codex 相关的项目');
    expect(screen.getByRole('textbox', { name: '频道名称' })).toHaveValue('指定产品生态');
    expect(mocks.compile).not.toHaveBeenCalled();
  });

  it('edits saved rules without mandatory reparsing and preserves history', async () => {
    const channel = makeChannel();
    channel.recommended = { '1': '2026-09-27' };
    data.channels.push(channel);
    render(<CustomChannelEditor channel={channel} onClose={vi.fn()} />);

    // Switch to rules tab and pick Stars sort
    fireEvent.click(screen.getByRole('tab', { name: /规则与筛选/ }));
    const starsSortBtn = screen.getByRole('button', { name: /Stars 最多/ });
    fireEvent.click(starsSortBtn);

    fireEvent.click(screen.getByRole('button', { name: '保存频道' }));
    await waitFor(() => expect(mocks.select).toHaveBeenCalled());
    expect(data.channels[0].revision).toBe(2);
    expect(data.channels[0].recommended).toEqual(channel.recommended);
    expect(data.channels[0].ruleOverrides?.sort).toBe('stars');
    expect(mocks.compile).not.toHaveBeenCalled();
  });

  it('displays configure AI button when auth issue occurs and triggers navigation', async () => {
    const close = vi.fn();
    const eventSpy = vi.fn();
    window.addEventListener('gsm:navigate-to-settings-tab', eventSpy);
    mocks.compile.mockRejectedValueOnce({ kind: 'auth' });
    render(<CustomChannelEditor onClose={close} />);
    fill();
    fireEvent.click(screen.getByRole('button', { name: '解析需求' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('请检查 GitHub 登录和当前 AI 配置');
    const configBtn = screen.getByRole('button', { name: '前往 AI 配置' });
    fireEvent.click(configBtn);
    expect(close).toHaveBeenCalled();
    expect(sessionStorage.getItem('gsm:pending-settings-tab')).toBe('ai');
    expect(eventSpy).toHaveBeenCalled();
    window.removeEventListener('gsm:navigate-to-settings-tab', eventSpy);
  });

  it('switches between tabs cleanly', async () => {
    render(<CustomChannelEditor onClose={vi.fn()} />);
    const rulesTab = screen.getByRole('tab', { name: /规则与筛选/ });
    const automationTab = screen.getByRole('tab', { name: /调度与自动化/ });
    const reqTab = screen.getByRole('tab', { name: /需求与 AI 解析/ });

    fireEvent.click(rulesTab);
    expect(rulesTab).toHaveAttribute('aria-selected', 'true');

    fireEvent.click(automationTab);
    expect(automationTab).toHaveAttribute('aria-selected', 'true');

    fireEvent.click(reqTab);
    expect(reqTab).toHaveAttribute('aria-selected', 'true');
  });

  it('allows picking an emoji to prepend to the channel name', async () => {
    render(<CustomChannelEditor onClose={vi.fn()} />);
    const emojiBtn = screen.getByRole('button', { name: '选择 Emoji' });
    fireEvent.click(emojiBtn);

    const robotEmoji = screen.getByText('🤖');
    fireEvent.click(robotEmoji);

    expect(screen.getByRole('textbox', { name: '频道名称' })).toHaveValue('🤖');
  });

  it('renders interactive semantic tags after parse and supports deleting and adding tags', async () => {
    render(<CustomChannelEditor onClose={vi.fn()} />);
    fill();
    await parse();

    expect(screen.getByText('交互式语义规则标签')).toBeInTheDocument();

    const deleteConditionBtns = screen.getAllByRole('button', { name: /删除必要条件/ });
    expect(deleteConditionBtns.length).toBeGreaterThan(0);
    fireEvent.click(deleteConditionBtns[0]);

    // Add a new semantic tag
    const tagInput = screen.getByPlaceholderText('输入规则或关键词，回车快速追加...');
    fireEvent.change(tagInput, { target: { value: 'Rust 编写' } });
    fireEvent.click(screen.getByRole('button', { name: '添加标签' }));

    const matchingTags = await screen.findAllByText('Rust 编写');
    expect(matchingTags.length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /删除必要条件 Rust 编写/ })).toBeInTheDocument();
  });

  it('saves config only without triggering immediate execution when [保存配置] is clicked', async () => {
    const close = vi.fn();
    render(<CustomChannelEditor onClose={close} />);
    fill();
    await parse();

    const saveConfigBtn = screen.getByRole('button', { name: '保存配置' });
    expect(saveConfigBtn).toBeEnabled();
    fireEvent.click(saveConfigBtn);

    await waitFor(() => expect(close).toHaveBeenCalled());
    expect(data.channels[0].name).toBe('codex');
    expect(mocks.run).not.toHaveBeenCalled();
  });

  it('allows picking languages and exclusions in modern parameter form', async () => {
    render(<CustomChannelEditor onClose={vi.fn()} />);
    fill();
    await parse();

    fireEvent.click(screen.getByRole('tab', { name: /规则与筛选/ }));

    // Pick Python language chip
    const pythonBtn = screen.getByRole('button', { name: 'Python' });
    fireEvent.click(pythonBtn);

    // Toggle exclusion
    const forkCheckbox = screen.getByLabelText('排除 Fork 仓库');
    fireEvent.click(forkCheckbox); // Toggle off

    fireEvent.click(screen.getByRole('button', { name: '保存配置' }));
    await waitFor(() => expect(data.channels).toHaveLength(1));
    expect(data.channels[0].ruleOverrides?.language).toBe('Python');
    expect(data.channels[0].ruleOverrides?.excludeForks).toBe(false);
  });
});
