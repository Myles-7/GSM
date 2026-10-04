import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { PageTranslationButton } from './PageTranslationButton';
import { usePageTranslationLifecycle } from '../hooks/usePageTranslation';
import { useAppStore } from '../store/useAppStore';
import { TooltipProvider } from './ui/tooltip';

const mocks = vi.hoisted(() => ({ start: vi.fn(), stop: vi.fn() }));
vi.mock('../store/useAppStore', async () => {
  const { create } = await import('zustand');
  return { useAppStore: create<{ language: string; pageTranslationEnabled: boolean; setPageTranslationEnabled: (enabled: boolean) => void }>(set => ({
    language: 'zh', pageTranslationEnabled: false, setPageTranslationEnabled: pageTranslationEnabled => set({ pageTranslationEnabled }),
  })) };
});
vi.mock('../services/pageTranslation', () => ({ pageTranslation: {
  ...mocks, subscribe: () => () => {}, getSnapshot: () => 'idle', retry: vi.fn(),
} }));
const Harness = () => { usePageTranslationLifecycle(); return <TooltipProvider><PageTranslationButton /></TooltipProvider>; };
describe('page translation consent', () => {
  it('does not send page text until informed consent, allows declining and can be turned off', async () => {
    localStorage.removeItem('gsm:page-translation-consent-v1');
    useAppStore.setState({ language: 'zh', pageTranslationEnabled: true });
    const user = userEvent.setup(); render(<Harness />);
    await waitFor(() => expect(useAppStore.getState().pageTranslationEnabled).toBe(false));
    expect(mocks.start).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: '整页翻译为中文' }));
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Microsoft Edge');
    await user.click(screen.getByRole('button', { name: '暂不启用' }));
    expect(mocks.start).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: '整页翻译为中文' }));
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: '整页翻译为中文' }));
    await waitFor(() => expect(mocks.start).toHaveBeenCalledOnce());
    expect(localStorage.getItem('gsm:page-translation-consent-v1')).toBe('accepted');
    await user.click(screen.getByRole('button', { name: '显示全页原文' }));
    expect(useAppStore.getState().pageTranslationEnabled).toBe(false);
    expect(mocks.stop).toHaveBeenCalled();
  });
});
