import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DiscoveryReadingPreferences } from '../workspace/model';
import { DiscoveryReadingSettings, type DiscoveryReadingSettingsProps } from './DiscoveryReadingSettings';

const store = vi.hoisted(() => ({ language: 'en' }));
vi.mock('../../../store/useAppStore', () => ({
  useAppStore: (selector: (state: { language: string }) => unknown) => selector(store),
}));

const preferences: DiscoveryReadingPreferences = Object.freeze({
  resumeReading: true,
  loading: 'manual',
  batchSize: 20,
  autoAnalyze: false,
  autoAnalysisLimit: 3,
});

function makeProps(overrides: Partial<DiscoveryReadingSettingsProps> = {}): DiscoveryReadingSettingsProps {
  return {
    channelName: 'Trending', open: true, preferences,
    onClose: vi.fn(), onSave: vi.fn<DiscoveryReadingSettingsProps['onSave']>().mockResolvedValue(undefined),
    onResetReading: vi.fn().mockResolvedValue(undefined),
    onClearList: vi.fn().mockResolvedValue(undefined),
    onDeleteAnalysis: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function deferred() {
  let resolve!: () => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function choose(label: string, option: string) {
  const user = userEvent.setup();
  screen.getByRole('combobox', { name: label }).focus();
  await user.keyboard('{Enter}');
  await user.click(screen.getByRole('option', { name: option }));
}

beforeEach(() => { store.language = 'en'; });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('DiscoveryReadingSettings', () => {
  it.each([390, 1280])('keeps the full-screen mobile and right-sheet desktop class contract at %ipx', (width) => {
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(width);
    render(<DiscoveryReadingSettings {...makeProps({ channelName: 'A'.repeat(180) })} />);
    const sheet = screen.getByRole('dialog', { name: 'Reading & AI settings' });
    expect(sheet).toHaveClass('left-auto', 'right-0', 'inset-y-0', 'h-[100dvh]', 'max-h-[100dvh]', 'w-full', 'max-w-none', 'sm:w-[440px]', 'sm:max-w-[100vw]', 'translate-x-0', 'translate-y-0', 'flex', 'flex-col', 'overflow-hidden', 'rounded-none');
    for (const inherited of ['grid', 'left-1/2', 'top-1/2', '-translate-x-1/2', '-translate-y-1/2', 'max-h-[85vh]']) {
      expect(sheet).not.toHaveClass(inherited);
    }
    expect(screen.getByTestId('reading-settings-body')).toHaveClass('min-h-0', 'flex-1', 'overflow-y-auto');
    const footer = screen.getByTestId('reading-settings-footer');
    expect(footer).toHaveClass('shrink-0', 'border-t');
    expect(footer).not.toHaveClass('overflow-y-auto');
    expect(within(footer).getByRole('button', { name: 'Cancel' })).toBeVisible();
    expect(within(footer).getByRole('button', { name: 'Save' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Close' })).toHaveClass('size-10', 'shrink-0');
    expect(screen.getByRole('button', { name: 'Close' })).not.toHaveClass('size-9');
    expect(screen.getByText('A'.repeat(180))).toHaveClass('[overflow-wrap:anywhere]');
    expect(screen.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent)).toEqual(['Reading', 'AI analysis']);
  });

  it('saves the changed draft once and waits for success before closing', async () => {
    const saving = deferred();
    const props = makeProps({ onSave: vi.fn().mockReturnValue(saving.promise) });
    render(<DiscoveryReadingSettings {...props} />);
    expect(screen.getByRole('combobox', { name: 'Loading mode' })).toHaveTextContent('Manual');
    fireEvent.click(screen.getByRole('switch', { name: 'Resume reading' }));
    await choose('Loading mode', 'Automatic');
    await choose('Items per load', '50');
    fireEvent.click(screen.getByRole('switch', { name: 'Automatic analysis' }));
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Automatic analysis limit' }), { target: { value: '7' } });
    const save = screen.getByRole('button', { name: 'Save' });
    fireEvent.click(save);
    fireEvent.click(save);
    expect(props.onSave).toHaveBeenCalledTimes(1);
    expect(props.onSave).toHaveBeenCalledWith({ resumeReading: false, loading: 'auto', batchSize: 50, autoAnalyze: true, autoAnalysisLimit: 7 });
    expect(props.preferences).toEqual(preferences);
    expect(save).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('Saving settings');
    expect(props.onClose).not.toHaveBeenCalled();
    expect(props.onResetReading).not.toHaveBeenCalled();
    expect(props.onClearList).not.toHaveBeenCalled();
    expect(props.onDeleteAnalysis).not.toHaveBeenCalled();
    await act(async () => { saving.resolve(); await saving.promise; });
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it('offers exactly 20, 50, and 100 items and preserves an existing automatic preference', async () => {
    render(<DiscoveryReadingSettings {...makeProps({ preferences: { ...preferences, loading: 'auto' } })} />);
    expect(screen.getByRole('combobox', { name: 'Loading mode' })).toHaveTextContent('Automatic');
    const user = userEvent.setup();
    screen.getByRole('combobox', { name: 'Items per load' }).focus();
    await user.keyboard('{Enter}');
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual(['20', '50', '100']);
    await user.click(screen.getByRole('option', { name: '100' }));
    expect(screen.getByRole('combobox', { name: 'Items per load' })).toHaveTextContent('100');
  });

  it('discards edits on cancel and reads fresh preferences when reopened', () => {
    const props = makeProps();
    const { rerender } = render(<DiscoveryReadingSettings {...props} />);
    fireEvent.click(screen.getByRole('switch', { name: 'Resume reading' }));
    rerender(<DiscoveryReadingSettings {...props} preferences={{ ...preferences }} />);
    expect(screen.getByRole('switch', { name: 'Resume reading' })).not.toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(props.onClose).toHaveBeenCalledTimes(1);
    expect(props.onSave).not.toHaveBeenCalled();
    expect(props.preferences.resumeReading).toBe(true);
    rerender(<DiscoveryReadingSettings {...props} open={false} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    rerender(<DiscoveryReadingSettings {...props} preferences={{ ...preferences, batchSize: 100 }} />);
    expect(screen.getByRole('switch', { name: 'Resume reading' })).toBeChecked();
    expect(screen.getByRole('combobox', { name: 'Items per load' })).toHaveTextContent('100');
  });

  it('starts a new draft on channel changes and ignores late completion from the old sheet', async () => {
    const saving = deferred();
    const props = makeProps({ onSave: vi.fn().mockReturnValue(saving.promise) });
    const { rerender } = render(<DiscoveryReadingSettings {...props} />);
    fireEvent.click(screen.getByRole('switch', { name: 'Resume reading' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    rerender(<DiscoveryReadingSettings {...props} channelName="Topic" />);
    expect(screen.getByRole('switch', { name: 'Resume reading' })).toBeChecked();
    await act(async () => { saving.resolve(); await saving.promise; });
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it.each(['', '0', '11', '2.5'])('rejects automatic limits outside the integer 1-10 contract: %s', (value) => {
    const props = makeProps({ preferences: { ...preferences, autoAnalyze: true } });
    render(<DiscoveryReadingSettings {...props} />);
    const limit = screen.getByRole('spinbutton', { name: 'Automatic analysis limit' });
    expect(limit).toHaveAttribute('min', '1');
    expect(limit).toHaveAttribute('max', '10');
    fireEvent.change(limit, { target: { value } });
    expect(limit).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a whole number from 1 to 10');
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    fireEvent.submit(screen.getByRole('button', { name: 'Save' }).closest('form')!);
    expect(props.onSave).not.toHaveBeenCalled();
  });

  it.each([1, 10])('accepts limit boundary %i', async (value) => {
    const props = makeProps({ preferences: { ...preferences, autoAnalyze: true } });
    render(<DiscoveryReadingSettings {...props} />);
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Automatic analysis limit' }), { target: { value: String(value) } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(props.onSave).toHaveBeenCalledWith({ ...preferences, autoAnalyze: true, autoAnalysisLimit: value }));
  });

  it('hides unsupported controls and passes their supplied preferences unchanged', async () => {
    const props = makeProps({ supportsLoading: false, supportsAnalysis: false, preferences: { ...preferences, loading: 'auto', autoAnalyze: true, autoAnalysisLimit: 9 } });
    render(<DiscoveryReadingSettings {...props} />);
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'AI analysis' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete AI analysis' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('switch', { name: 'Resume reading' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(props.onSave).toHaveBeenCalledWith({ ...props.preferences, resumeReading: false }));
  });

  it.each([
    ['Reset position', 'onResetReading', 'Resetting reading position', 'Reading position reset'],
    ['Clear list cache', 'onClearList', 'Clearing list cache', 'List cache cleared'],
  ] as const)('runs %s independently of settings and analysis', async (label, callback, pendingText, successText) => {
    const operation = deferred();
    const props = makeProps({ [callback]: vi.fn().mockReturnValue(operation.promise) });
    render(<DiscoveryReadingSettings {...props} />);
    fireEvent.click(screen.getByRole('switch', { name: 'Resume reading' }));
    fireEvent.click(screen.getByRole('button', { name: label }));
    expect(props[callback]).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('status')).toHaveTextContent(pendingText);
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(props[callback === 'onClearList' ? 'onResetReading' : 'onClearList']).not.toHaveBeenCalled();
    expect(props.onSave).not.toHaveBeenCalled();
    expect(props.onDeleteAnalysis).not.toHaveBeenCalled();
    await act(async () => { operation.resolve(); await operation.promise; });
    expect(screen.getByRole('status')).toHaveTextContent(successText);
    expect(screen.getByRole('switch', { name: 'Resume reading' })).not.toBeChecked();
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it.each([
    ['Save', 'onSave', 'Could not save settings'],
    ['Reset position', 'onResetReading', 'Could not reset reading position'],
    ['Clear list cache', 'onClearList', 'Could not clear list cache'],
  ] as const)('shows %s failures and permits retry without losing edits', async (label, callback, message) => {
    const command = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);
    const props = makeProps({ [callback]: command });
    render(<DiscoveryReadingSettings {...props} />);
    fireEvent.click(screen.getByRole('switch', { name: 'Resume reading' }));
    fireEvent.click(screen.getByRole('button', { name: label }));
    expect(await screen.findByRole('alert')).toHaveTextContent(`${message}: offline`);
    expect(props.onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('switch', { name: 'Resume reading' })).not.toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: label }));
    await waitFor(() => expect(command).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  });

  it('confirms deletion, keeps failures in the confirmation, and retries only the analysis callback', async () => {
    const deleting = deferred();
    const props = makeProps({ onDeleteAnalysis: vi.fn().mockReturnValueOnce(deleting.promise).mockResolvedValue(undefined) });
    render(<DiscoveryReadingSettings {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete AI analysis' }));
    let confirmation = screen.getByRole('alertdialog');
    expect(props.onDeleteAnalysis).not.toHaveBeenCalled();
    expect(confirmation).toHaveTextContent('List cache, reading position and Stars will be kept');
    expect(confirmation).toHaveTextContent('other channels and your repository list will also be affected');
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(props.onDeleteAnalysis).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Delete AI analysis' }));
    confirmation = screen.getByRole('alertdialog');
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Delete AI analysis' }));
    expect(within(confirmation).getByRole('status')).toHaveTextContent('Deleting AI analysis');
    expect(within(confirmation).getByRole('button', { name: 'Delete AI analysis' })).toBeDisabled();
    await act(async () => { deleting.reject(new Error('permission denied')); await deleting.promise.catch(() => undefined); });
    expect(within(confirmation).getByRole('alert')).toHaveTextContent('Could not delete AI analysis: permission denied');
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Delete AI analysis' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(props.onDeleteAnalysis).toHaveBeenCalledTimes(2);
    expect(props.onSave).not.toHaveBeenCalled();
    expect(props.onResetReading).not.toHaveBeenCalled();
    expect(props.onClearList).not.toHaveBeenCalled();
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it('uses Chinese labels, loading, and failures from the store language', async () => {
    store.language = 'zh-CN';
    const saving = deferred();
    render(<DiscoveryReadingSettings {...makeProps({ onSave: vi.fn().mockReturnValue(saving.promise) })} />);
    expect(screen.getByRole('dialog', { name: '阅读与 AI 设置' })).toBeVisible();
    expect(screen.getByRole('combobox', { name: '加载方式' })).toHaveTextContent('手动加载');
    expect(screen.getByRole('button', { name: '清空列表缓存' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    expect(screen.getByRole('status')).toHaveTextContent('正在保存设置');
    await act(async () => { saving.reject('连接失败'); await saving.promise.catch(() => undefined); });
    expect(screen.getByRole('alert')).toHaveTextContent('保存设置失败: 连接失败');
  });

  it('prevents duplicate submissions and Escape dismissal while saving', async () => {
    const user = userEvent.setup();
    const saving = deferred();
    const props = makeProps({ onSave: vi.fn().mockReturnValue(saving.promise) });
    render(<DiscoveryReadingSettings {...props} />);
    const form = screen.getByRole('button', { name: 'Save' }).closest('form')!;
    fireEvent.submit(form);
    fireEvent.submit(form);
    await user.keyboard('{Escape}{Escape}');
    expect(props.onSave).toHaveBeenCalledTimes(1);
    expect(props.onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Close' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    await act(async () => { saving.resolve(); await saving.promise; });
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it('focuses the safe confirmation choice and returns focus to its trigger on cancel', async () => {
    const user = userEvent.setup();
    const props = makeProps();
    render(<DiscoveryReadingSettings {...props} />);
    const trigger = screen.getByRole('button', { name: 'Delete AI analysis' });
    await user.click(trigger);
    const cancel = within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Cancel' });
    expect(cancel).toHaveFocus();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(props.onDeleteAnalysis).not.toHaveBeenCalled();
  });

  it('provides initial keyboard focus, traps Tab, supports keyboard switches, and returns focus on Escape', async () => {
    const user = userEvent.setup();
    function Harness() {
      const [open, setOpen] = useState(false);
      return <><button onClick={() => setOpen(true)}>Open settings</button><DiscoveryReadingSettings {...makeProps()} open={open} onClose={() => setOpen(false)} /></>;
    }
    render(<Harness />);
    const opener = screen.getByRole('button', { name: 'Open settings' });
    await user.click(opener);
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('switch', { name: 'Resume reading' })).toHaveFocus();
    await user.keyboard(' ');
    expect(screen.getByRole('switch', { name: 'Resume reading' })).not.toBeChecked();
    screen.getByRole('button', { name: 'Save' }).focus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
    await user.tab();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(() => expect(opener).toHaveFocus());
  });
});
