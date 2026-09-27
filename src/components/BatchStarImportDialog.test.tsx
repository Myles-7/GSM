import { render as renderBase, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { TooltipProvider } from './ui/tooltip';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BatchStarImportDialog } from './BatchStarImportDialog';

const render = (ui: ReactElement) => renderBase(<TooltipProvider>{ui}</TooltipProvider>);

const mocks = vi.hoisted(() => ({
  rows: [] as unknown[],
  duplicateCount: 0, inputError: '', isResolving: false, isStarring: false, syncError: '',
  pageStatus: 'idle', pageEnabled: false, setPageEnabled: vi.fn(), retry: vi.fn(),
  preview: vi.fn(), toggleRow: vi.fn(), selectAll: vi.fn(), invertSelection: vi.fn(),
  clearPreview: vi.fn(), starSelected: vi.fn(),
}));
vi.mock('../features/repositories/hooks/useBatchStarImport', () => ({ useBatchStarImport: () => mocks }));
vi.mock('../i18n/useT', () => ({ useT: () => (key: string, params?: Record<string, unknown>) => `${key}${params?.name ? ` ${params.name}` : ''}` }));
vi.mock('../hooks/usePageTranslation', () => ({
  usePageTranslation: () => ({
    enabled: mocks.pageEnabled, status: mocks.pageStatus,
    setEnabled: mocks.setPageEnabled, retry: mocks.retry,
  }),
}));

const row = (overrides: Record<string, unknown> = {}) => ({
  candidate: { repositoryFullName: 'owner/repo', originalValue: 'https://github.com/owner/repo', confidence: 'high' },
  detail: { full_name: 'owner/repo', html_url: 'https://github.com/owner/repo', description: 'Example repository', language: 'TypeScript', stargazers_count: 10 },
  status: 'ready', selected: true,
  ...overrides,
});

describe('BatchStarImportDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isResolving = false;
    mocks.isStarring = false;
    mocks.pageStatus = 'idle';
    mocks.pageEnabled = false;
    mocks.rows = [row()];
  });

  it('previews pasted text without starring until the user confirms', async () => {
    const user = userEvent.setup();
    render(<BatchStarImportDialog isOpen onClose={vi.fn()} />);
    expect(screen.getByRole('link', { name: 'owner/repo' })).toHaveAttribute('href', 'https://github.com/owner/repo');
    await user.type(screen.getByRole('textbox', { name: 'batchStar.input-label' }), 'https://github.com/owner/repo');
    await user.click(screen.getByRole('button', { name: 'batchStar.preview' }));
    expect(mocks.preview).toHaveBeenCalledWith('https://github.com/owner/repo');
    expect(mocks.clearPreview).toHaveBeenCalled();
    expect(mocks.starSelected).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'batchStar.star-selected' }));
    expect(mocks.starSelected).toHaveBeenCalledTimes(1);
  });

  it('allows editing the repository selection', async () => {
    const user = userEvent.setup();
    render(<BatchStarImportDialog isOpen onClose={vi.fn()} />);
    await user.click(screen.getByRole('checkbox', { name: 'batchStar.select-repository owner/repo' }));
    expect(mocks.toggleRow).toHaveBeenCalledWith(0);
  });

  it('shows already-starred repositories as checked and disabled checkboxes', () => {
    mocks.rows = [
      row({ status: 'already-starred', selected: false }),
      row({
        candidate: { repositoryFullName: 'other/repo', originalValue: 'https://github.com/other/repo', confidence: 'high' },
        detail: { full_name: 'other/repo', html_url: 'https://github.com/other/repo', description: 'Other', language: 'Go', stargazers_count: 1 },
      }),
    ];
    render(<BatchStarImportDialog isOpen onClose={vi.fn()} />);
    expect(screen.getByRole('checkbox', { name: 'batchStar.select-repository owner/repo' })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: 'batchStar.select-repository owner/repo' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'batchStar.select-repository other/repo' })).toBeEnabled();
    expect(screen.getByRole('checkbox', { name: 'batchStar.select-repository other/repo' })).toBeChecked();
  });

  it('shows repositories starred in this batch as checked and disabled too', () => {
    mocks.rows = [row({ status: 'starred', selected: false })];
    render(<BatchStarImportDialog isOpen onClose={vi.fn()} />);
    expect(screen.getByRole('checkbox', { name: 'batchStar.select-repository owner/repo' })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: 'batchStar.select-repository owner/repo' })).toBeChecked();
  });

  it('selects all and inverts the parsed repositories', async () => {
    const user = userEvent.setup();
    mocks.rows = [row({ status: 'already-starred', selected: false }), row()];
    render(<BatchStarImportDialog isOpen onClose={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'batchStar.select-all' }));
    expect(mocks.selectAll).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'batchStar.invert-selection' }));
    expect(mocks.invertSelection).toHaveBeenCalledTimes(1);
  });

  it('offers the shared whole-page control instead of legacy description translation', async () => {
    const user = userEvent.setup();
    render(<BatchStarImportDialog isOpen onClose={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'pageTranslation.enable' }));
    expect(mocks.setPageEnabled).toHaveBeenCalledWith(true);
    expect(screen.queryByRole('button', { name: 'batchStar.translate-descriptions' })).not.toBeInTheDocument();
  });

  it('renders original descriptions and provides whole-page restoration', () => {
    mocks.pageEnabled = true;
    render(<BatchStarImportDialog isOpen onClose={vi.fn()} />);
    expect(screen.getByText('Example repository')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'pageTranslation.original' })).toBeEnabled();
  });

  it('falls back to the original description when no translation exists', () => {
    render(<BatchStarImportDialog isOpen onClose={vi.fn()} />);
    expect(screen.getByText('Example repository')).toBeInTheDocument();
  });

  it('keeps selection and starring enabled while page translation runs', async () => {
    mocks.pageStatus = 'translating';
    const user = userEvent.setup();
    render(<BatchStarImportDialog isOpen onClose={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'batchStar.select-all' })).toBeEnabled();
    expect(screen.getByRole('textbox')).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'batchStar.star-selected' }));
    expect(mocks.starSelected).toHaveBeenCalledTimes(1);
  });

  it('keeps the dialog closable while a translation is running', () => {
    mocks.pageStatus = 'translating';
    render(<BatchStarImportDialog isOpen onClose={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'batchStar.close' })).toBeEnabled();
  });

  it('keeps a page translation failure separate from star results', () => {
    mocks.pageEnabled = true;
    mocks.pageStatus = 'error';
    render(<BatchStarImportDialog isOpen onClose={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'pageTranslation.retry' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'batchStar.star-selected' })).toBeEnabled();
  });

  it('disables editing and closing while a Star batch is running', () => {
    mocks.isStarring = true;
    render(<BatchStarImportDialog isOpen onClose={vi.fn()} />);
    expect(screen.getByRole('textbox')).toBeDisabled();
    expect(screen.getByRole('checkbox')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'batchStar.close' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'batchStar.starring' })).toBeDisabled();
  });
});
