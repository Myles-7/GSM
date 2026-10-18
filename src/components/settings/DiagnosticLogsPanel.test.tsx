import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DiagnosticLogsPanel } from './DiagnosticLogsPanel';
import { makeT } from '../../i18n/useT';
import { logger } from '../../services/logger';
import type { ElectronAPI } from '../../services/electronProxy';

vi.unmock('../../store/useAppStore');
vi.mock('../../services/backendAdapter', () => ({ backend: { isAvailable: false } }));
const t = makeT('en', 'app');
const native = [{ id: 'main', timestamp: '2026-10-17T01:00:00Z', source: 'main', level: 'info', module: 'electron.startup', message: 'Desktop started' },
  { id: 'network', timestamp: '2026-10-17T01:00:01Z', source: 'main', level: 'warn', module: 'electron.netTap', message: 'Network failed' },
  { id: 'plugin', timestamp: '2026-10-17T01:00:02Z', source: 'plugins', level: 'info', module: 'plugin.example', message: 'Plugin ready' }];
let original: ElectronAPI | undefined;
beforeEach(() => { original = window.electronAPI; logger.clear(); });
afterEach(() => { window.electronAPI = original; vi.restoreAllMocks(); });

it('shows native sources and network separately, with metadata-only policy', async () => {
  window.electronAPI = { diagnostics: { getLogs: vi.fn().mockResolvedValue(native), append: vi.fn(), flush: vi.fn() } } as unknown as ElectronAPI;
  render(<DiagnosticLogsPanel t={t} />);
  await screen.findByText('Desktop started');
  expect(screen.getAllByText(/Debug mode does not enable body capture/).length).toBeGreaterThan(0);
  fireEvent.click(screen.getByRole('button', { name: 'Network' }));
  expect(screen.getByText('Network failed')).toBeInTheDocument();
  expect(screen.queryByText('Plugin ready')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Plugins' }));
  expect(screen.getByText('Plugin ready')).toBeInTheDocument();
  expect(screen.queryByText('Desktop started')).not.toBeInTheDocument();
});

it('re-redacts the complete exported bundle and displays export failures', async () => {
  const exportBundle = vi.fn().mockResolvedValue({ environment: {}, entries: [{ apiKey: 'private-secret', requestBody: 'private-body' }] });
  window.electronAPI = { diagnostics: { getLogs: vi.fn().mockResolvedValue([]), exportBundle, append: vi.fn(), flush: vi.fn() } } as unknown as ElectronAPI;
  let blob: Blob | undefined;
  vi.spyOn(URL, 'createObjectURL').mockImplementation(value => { blob = value as Blob; return 'blob:test'; });
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  render(<DiagnosticLogsPanel t={t} />);
  fireEvent.click(screen.getByRole('button', { name: 'Export diagnostic bundle' }));
  await waitFor(() => expect(blob).toBeDefined());
  const text = await new Promise<string>(resolve => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.readAsText(blob!); });
  expect(text).not.toContain('private-secret');
  expect(text).not.toContain('private-body');
  exportBundle.mockRejectedValue(new Error('offline'));
  fireEvent.click(screen.getByRole('button', { name: 'Export diagnostic bundle' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not read or export diagnostics');
});
