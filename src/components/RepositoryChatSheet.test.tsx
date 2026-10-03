import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RepositoryChatMessage } from '../types/repositoryChat';
import { makeRepo } from '../features/discovery/custom/fixtures.test-support';

const mocks = vi.hoisted(() => ({
  sessionId: 'first', messages: [] as RepositoryChatMessage[],
  resized: (() => {}) as () => void,
}));
vi.mock('../i18n/useT', () => ({ useT: () => (key: string) => key, makeT: () => (key: string) => key }));
vi.mock('../store/useAppStore', () => ({ useAppStore: (select: (state: unknown) => unknown) => select({
  language: 'en', repositoryChatSettings: { taskDepth: 'default' }, setCurrentView: vi.fn(), setRepositoryChatSettings: vi.fn(),
}) }));
vi.mock('../hooks/useDialog', () => ({ useDialog: () => ({ toast: vi.fn() }) }));
vi.mock('../features/repository-chat/hooks/useRepositoryChatSessions', () => ({ useRepositoryChatSessions: () => ({
  activeSession: { id: mocks.sessionId }, sessions: [], messages: mocks.messages,
  isLoading: false, error: null, createSession: vi.fn(), selectSession: vi.fn(), deleteSession: vi.fn(), updateSession: vi.fn(), setMessages: vi.fn(),
}) }));
vi.mock('../features/repository-chat/hooks/useRepositoryChat', () => ({ useRepositoryChat: () => ({
  canChat: true, isSending: true, error: null, toolEvents: [], evidenceById: {}, send: vi.fn(), stop: vi.fn(), retry: vi.fn(), regenerate: vi.fn(),
}) }));
vi.mock('./MarkdownRenderer', () => ({ default: ({ content }: { content: string }) => <p>{content}</p> }));
vi.mock('./AnswerReviewStatus', () => ({ AnswerReviewStatus: () => null }));
vi.mock('./RepositoryChatHistoryPanel', () => ({ RepositoryChatHistoryPanel: () => null }));
import RepositoryChatSheet from './RepositoryChatSheet';

const originalObserver = window.ResizeObserver;
const originalScrollTo = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollTo');
beforeEach(() => {
  mocks.sessionId = 'first';
  mocks.messages = [{ id: 'answer', role: 'assistant', status: 'streaming', content: 'First chunk', evidenceIds: [] } as unknown as RepositoryChatMessage];
  window.ResizeObserver = class {
    constructor(private callback: ResizeObserverCallback) {}
    observe(target: Element) {
      if (target.parentElement?.classList.contains('h-full')) mocks.resized = () => this.callback([], this);
    }
    unobserve() {} disconnect() {}
  };
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, writable: true, value: vi.fn() });
});
afterEach(() => {
  cleanup(); vi.restoreAllMocks(); window.ResizeObserver = originalObserver;
  if (originalScrollTo) Object.defineProperty(HTMLElement.prototype, 'scrollTo', originalScrollTo);
  else Reflect.deleteProperty(HTMLElement.prototype, 'scrollTo');
});

describe('chat scroll intent', () => {
  it('follows near the bottom, but keeps user reading position across streamed and async height changes', () => {
    const props = { repository: makeRepo(), isOpen: true, onClose: vi.fn() };
    const { rerender } = render(<RepositoryChatSheet {...props} />);
    const region = screen.getByText('First chunk').closest('.h-full.overflow-y-auto') as HTMLDivElement;
    Object.defineProperties(region, { scrollHeight: { configurable: true, value: 1600 }, clientHeight: { configurable: true, value: 400 } });
    const scrollTo = vi.spyOn(region, 'scrollTo');
    act(() => mocks.resized());
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 1600 });

    region.scrollTop = 200;
    fireEvent.scroll(region);
    scrollTo.mockClear();
    mocks.messages = [{ ...mocks.messages[0], content: 'Another streamed chunk' }];
    rerender(<RepositoryChatSheet {...props} />);
    act(() => mocks.resized());
    expect(scrollTo).not.toHaveBeenCalled();
    expect(region.scrollTop).toBe(200);
    expect(screen.getByRole('button', { name: 'repositoryChatSheet.scroll-to-latest' })).toBeInTheDocument();

    region.scrollTop = 1150;
    fireEvent.scroll(region);
    act(() => mocks.resized());
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 1600 });
  });

  it('resets follow intent for a different session and supports an explicit jump to latest', () => {
    const props = { repository: makeRepo(), isOpen: true, onClose: vi.fn() };
    const { rerender } = render(<RepositoryChatSheet {...props} />);
    const region = screen.getByText('First chunk').closest('.h-full.overflow-y-auto') as HTMLDivElement;
    Object.defineProperties(region, { scrollHeight: { configurable: true, value: 1600 }, clientHeight: { configurable: true, value: 400 } });
    const scrollTo = vi.spyOn(region, 'scrollTo');
    region.scrollTop = 200;
    fireEvent.scroll(region);
    fireEvent.click(screen.getByRole('button', { name: 'repositoryChatSheet.scroll-to-latest' }));
    expect(scrollTo).toHaveBeenCalledWith({ top: 1600, behavior: 'smooth' });

    region.scrollTop = 200;
    fireEvent.scroll(region);
    scrollTo.mockClear();
    mocks.sessionId = 'second';
    rerender(<RepositoryChatSheet {...props} />);
    act(() => mocks.resized());
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 1600 });
    expect(screen.queryByRole('button', { name: 'repositoryChatSheet.scroll-to-latest' })).not.toBeInTheDocument();
  });
});
