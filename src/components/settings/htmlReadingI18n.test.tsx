import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ensureLanguageLoaded } from '../../i18n';
import { useAppStore } from '../../store/useAppStore';
import { defaultSettings, resolveReadingProfile } from '../../lib/html-reading/model';
import type { useHtmlReading } from '../../features/settings/hooks/useHtmlReading';
import { HtmlReadingProfile } from './HtmlReadingProfile';
import { HtmlReadingMail } from './HtmlReadingMail';

vi.mock('../../store/useAppStore', async () => {
  const { create } = await import('zustand');
  return { useAppStore: create(() => ({ language: 'zh' })) };
});

afterEach(() => { useAppStore.setState({ language: 'zh' }); });

it('updates reading labels and accessible movement names when switching languages', async () => {
  await ensureLanguageLoaded('en');
  useAppStore.setState({ language: 'zh' });
  render(<HtmlReadingProfile title="Fixture" quantity inherited={resolveReadingProfile(defaultSettings, 'trending')} override={{ perChannel: 7, cardFields: ['summary', 'tags'] }} onChange={vi.fn()} />);
  expect(screen.getByLabelText('每频道／每期项目上限')).toHaveValue(7);
  act(() => useAppStore.setState({ language: 'en' }));
  expect(screen.getByLabelText('Item limit per channel/edition')).toHaveValue(7);
  expect(screen.getByLabelText('AI summary')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Move Fixture card Tags up' })).toBeEnabled();
  expect(screen.queryByLabelText('每频道／每期项目上限')).toBeNull();
});

it('keeps the unconfirmed delivery guard and retry count in English', async () => {
  await ensureLanguageLoaded('en');
  useAppStore.setState({ language: 'en' });
  window.electronAPI = { htmlReading: { resend: vi.fn() } } as unknown as Window['electronAPI'];
  const controller = {
    account: '42', settings: defaultSettings, saved: defaultSettings, busy: false,
    mail: { credential: { accountId: '42', from: 'fixture@gmail.com', to: 'fixture@example.test', configured: true }, runs: [{ id: 'fixture', accountId: '42', startedAt: '2026-10-04T00:00:00Z', status: 'unconfirmed', hasAttachment: true, retryCount: 2, phase: 'verifying' }] },
    generate: vi.fn(), resend: vi.fn(),
  } as unknown as ReturnType<typeof useHtmlReading>;
  render(<HtmlReadingMail controller={controller} />);
  expect(screen.getByText('Retried 2 times')).toBeInTheDocument();
  expect(screen.getByText('Phase: Verifying connection')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Resend saved attachment' }));
  expect(controller.resend).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Inbox checked; resend' }));
  expect(controller.resend).toHaveBeenCalledWith('fixture', true);
});
