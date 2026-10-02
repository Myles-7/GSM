import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppLanguage } from '../i18n/languages';
import { makeT } from '../i18n/useT';
import { UpdateChecker } from './UpdateChecker';
import { UpdateNotificationBanner } from './UpdateNotificationBanner';

const mocks = vi.hoisted(() => {
  const state = {
    language: 'zh' as AppLanguage,
    updateNotification: {
      version: '0.8.5', releaseDate: '2026-09-25', changelog: ['Stale notes'],
      downloadUrl: 'https://example.com/stale', dismissed: false,
    },
    setUpdateNotification: vi.fn(),
    dismissUpdateNotification: vi.fn(),
  };
  return {
    state,
    useAppStore: (selector: (value: typeof state) => unknown) => selector(state),
    toast: vi.fn(),
  };
});

vi.mock('../store/useAppStore', () => ({ useAppStore: mocks.useAppStore }));
vi.mock('../hooks/useDialog', () => ({ useDialog: () => ({ toast: mocks.toast }) }));
vi.mock('../services/logger', () => ({ logger: { error: vi.fn() } }));

const fetchMock = vi.fn<typeof fetch>();
const upstreamResponse = (number = '0.8.5') => ({
  ok: true,
  text: async () => `<versions><version>
    <number>${number}</number><releaseDate>2026-09-25</releaseDate>
    <changelog><item>Upstream notes</item></changelog>
    <downloadUrl>https://github.com/AmintaCCCP/GithubStarsManager/releases/tag/v${number}</downloadUrl>
  </version></versions>`,
} as Response);

beforeEach(() => {
  vi.clearAllMocks();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  mocks.state.language = 'zh';
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('manual upstream update UI', () => {
  it('hides an undismissed stale banner before notification cleanup', () => {
    const { container } = render(<UpdateNotificationBanner />);
    expect(container).toBeEmptyDOMElement();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ['zh', '查看上游更新', '不是此个人版可安装的更新'],
    ['en', 'View Upstream Updates', 'not installable updates for this personal build'],
    ['zh-TW', '查看上游更新', '不是此個人版可安裝的更新'],
    ['ja', '上流の更新を確認', 'インストールできる更新ではありません'],
    ['es', 'Ver actualizaciones del proyecto original', 'no actualizaciones instalables'],
    ['pt-BR', 'Ver atualizações do projeto original', 'não atualizações instaláveis'],
    ['ru', 'Посмотреть обновления исходного проекта', 'не являются устанавливаемыми обновлениями'],
    ['fr', "Voir les mises à jour du projet d'origine", 'pas des mises à jour installables'],
    ['de', 'Updates des Ursprungsprojekts ansehen', 'keine installierbaren Updates'],
    ['ko', '원본 프로젝트 업데이트 보기', '설치할 수 있는 업데이트가 아닙니다'],
  ] as const)('checks only on click and labels %s results as upstream reference information', async (language, label, caveat) => {
    mocks.state.language = language;
    fetchMock.mockResolvedValue(upstreamResponse());
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    render(<><UpdateChecker /><UpdateNotificationBanner /></>);
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: label }));
    const dialog = await screen.findByRole('dialog');

    expect(within(dialog).getByText(caveat, { exact: false })).toBeInTheDocument();
    expect(within(dialog).getByRole('heading', { name: /0\.8\.5/ })).toBeInTheDocument();
    expect(within(dialog).getByText('Upstream notes')).toBeInTheDocument();
    expect(mocks.state.setUpdateNotification).not.toHaveBeenCalled();
    expect(mocks.toast).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fireEvent.click(within(dialog).getByRole('button', { name: makeT(language, 'app')('updateChecker.download-now') }));
    expect(open).toHaveBeenCalledWith(
      'https://github.com/AmintaCCCP/GithubStarsManager/releases/tag/v0.8.5', '_blank', 'noopener,noreferrer',
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it.each(['0.8.3', '0.8.4'])('shows upstream %s without claiming the personal build is latest or creating a banner', async (number) => {
    fetchMock.mockResolvedValue(upstreamResponse(number));
    const onUpdateAvailable = vi.fn();
    render(<UpdateChecker onUpdateAvailable={onUpdateAvailable} />);
    fireEvent.click(screen.getByRole('button', { name: '查看上游更新' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: `上游最新发布 v${number}` })).toBeInTheDocument();
    expect(within(dialog).getByText('不能判断个人版是否已是最新', { exact: false })).toBeInTheDocument();
    expect(screen.queryByText('当前已是最新版本！')).not.toBeInTheDocument();
    expect(onUpdateAvailable).not.toHaveBeenCalled();
    expect(mocks.state.setUpdateNotification).not.toHaveBeenCalled();
    expect(mocks.toast).not.toHaveBeenCalled();
  });

  it('shows an actionable error and permits a successful retry', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    fetchMock.mockRejectedValueOnce(new Error('Network unavailable')).mockResolvedValueOnce(upstreamResponse());
    render(<UpdateChecker />);
    fireEvent.click(screen.getByRole('button', { name: '查看上游更新' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('无法获取上游版本信息');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(mocks.toast).toHaveBeenCalledWith(expect.stringContaining('上游'), 'error');
    const retry = screen.getByRole('button', { name: '查看上游更新' });
    expect(retry).toBeEnabled();

    fireEvent.click(retry);
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('prevents duplicate checks, aborts on unmount and ignores late responses', async () => {
    let resolveResponse!: (response: Response) => void;
    fetchMock.mockImplementation(() => new Promise<Response>((resolve) => { resolveResponse = resolve; }));
    const onUpdateAvailable = vi.fn();
    const { unmount } = render(<UpdateChecker onUpdateAvailable={onUpdateAvailable} />);
    const button = screen.getByRole('button', { name: '查看上游更新' });
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('button', { name: '查询上游中…' })).toBeDisabled();
    const signal = fetchMock.mock.calls[0][1]?.signal;

    unmount();
    expect(signal?.aborted).toBe(true);
    await act(async () => { resolveResponse(upstreamResponse()); });

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(onUpdateAvailable).not.toHaveBeenCalled();
    expect(mocks.state.setUpdateNotification).not.toHaveBeenCalled();
    expect(mocks.toast).not.toHaveBeenCalled();
  });
});
