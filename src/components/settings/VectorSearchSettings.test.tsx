import { webcrypto } from 'node:crypto';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeT } from '../../i18n/useT';
import { createVectorGeneration } from '../../services/vectorIndexIdentity';
import type { AIConfig } from '../../types';
import type { VectorSearchActions } from '../../features/settings/hooks/useVectorSearchActions';
import { VectorSearchSettings } from './VectorSearchSettings';

const mocks = vi.hoisted(() => ({
  state: {} as Record<string, unknown>,
  actions: {} as VectorSearchActions,
  dialog: { toast: vi.fn(), confirm: vi.fn() },
}));
vi.mock('../../store/useAppStore', () => ({
  useAppStore: (selector: (state: typeof mocks.state) => unknown) => selector(mocks.state),
}));
vi.mock('../../features/settings/hooks/useVectorSearchActions', () => ({
  useVectorSearchActions: () => mocks.actions,
}));
vi.mock('../../hooks/useDialog', () => ({ useDialog: () => mocks.dialog }));
const t = makeT('en', 'app');
const draft = {
  apiType: 'ollama' as const, baseUrl: 'http://localhost:11434', apiKey: '', model: 'model',
  dimensions: 3, workerUrl: 'https://worker.example', authToken: 'test',
  indexMode: 'description' as const, readmeMaxChars: 6000,
};
const deepseek: AIConfig = { id: 'search-deepseek', name: 'Search DeepSeek', apiType: 'deepseek',
  baseUrl: 'https://api.deepseek.com', apiKey: 'fixture-key', model: 'fixture-model', isActive: false };
beforeEach(async () => {
  vi.clearAllMocks();
  sessionStorage.clear();
  mocks.dialog.confirm.mockResolvedValue(true);
  vi.stubGlobal('crypto', webcrypto);
  Object.assign(mocks.state, {
    aiConfigs: [deepseek], activeAIConfig: 'global-model', setCurrentView: vi.fn(),
    embeddingConfigs: [{ id: 'embedding', name: 'Model', ...draft, isActive: true }],
    activeEmbeddingConfig: 'embedding',
    vectorSearchConfig: {
      ...draft, enabled: true, embeddingConfigId: 'embedding',
      activeIndex: await createVectorGeneration(draft, draft),
    },
    vectorIndexingState: { isIndexing: false, phase: null, phaseDone: 0, phaseTotal: 0, result: null },
    setVectorSearchConfig: vi.fn(), addEmbeddingConfig: vi.fn(), updateEmbeddingConfig: vi.fn(),
    setActiveEmbeddingConfig: vi.fn(),
  });
  Object.assign(mocks.actions, {
    testingEmbedding: false, embeddingTestResult: null, testingWorker: false, workerTestResult: null,
    incrementalTargetCount: 120, unindexedRepoCount: 0,
    testEmbedding: vi.fn(), testWorker: vi.fn(), rebuildIndex: vi.fn().mockResolvedValue(undefined),
    incrementalIndex: vi.fn().mockResolvedValue(undefined), abortIndexing: vi.fn(),
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('vector settings integration', () => {
  it('defaults to following the current AI and saves an independent search model without rebuilding', () => {
    render(<VectorSearchSettings t={t} />);
    fireEvent.click(screen.getByText(t('vectorSearchSettings.search-parameters')));
    const selector = screen.getByRole('combobox', { name: t('vectorSearchSettings.search-ai-config') });
    expect(selector).toHaveTextContent(t('vectorSearchSettings.follow-current-ai-config'));
    fireEvent.keyDown(selector, { key: 'ArrowDown' });
    fireEvent.click(screen.getByRole('option', { name: 'Search DeepSeek · fixture-model' }));
    fireEvent.click(screen.getByRole('button', { name: t('vectorSearchSettings.save-search-parameters') }));
    expect(mocks.state.setVectorSearchConfig).toHaveBeenCalledWith(expect.objectContaining({ searchAIConfigId: deepseek.id }));
    expect(mocks.state.activeAIConfig).toBe('global-model');
    expect(mocks.actions.rebuildIndex).not.toHaveBeenCalled();
  });

  it('retains a missing selected configuration and warns instead of showing the follow-current option', () => {
    Object.assign(mocks.state.vectorSearchConfig as object, { searchAIConfigId: 'deleted-search-model' });
    render(<VectorSearchSettings t={t} />);
    fireEvent.click(screen.getByText(t('vectorSearchSettings.search-parameters')));
    expect(screen.getByRole('combobox', { name: t('vectorSearchSettings.search-ai-config') })).toHaveTextContent('deleted-search-model');
    expect(screen.getByRole('alert')).toHaveTextContent(t('vectorSearchSettings.search-ai-unavailable'));
    fireEvent.click(screen.getByRole('button', { name: t('vectorSearchSettings.save-search-parameters') }));
    expect(mocks.state.setVectorSearchConfig).toHaveBeenCalledWith(expect.objectContaining({ searchAIConfigId: 'deleted-search-model' }));
  });

  it('warns about unavailable credentials and links to existing AI settings when DeepSeek is absent', () => {
    mocks.state.aiConfigs = [{ ...deepseek, apiType: 'openai', apiKeyStatus: 'decrypt_failed' }];
    Object.assign(mocks.state.vectorSearchConfig as object, { searchAIConfigId: deepseek.id });
    const navigate = vi.fn();
    window.addEventListener('gsm:navigate-to-settings-tab', navigate);
    try {
      render(<VectorSearchSettings t={t} />);
      fireEvent.click(screen.getByText(t('vectorSearchSettings.search-parameters')));
      expect(screen.getByRole('alert')).toHaveTextContent(t('vectorSearchSettings.search-ai-unavailable'));
      fireEvent.click(screen.getByRole('button', { name: t('vectorSearchSettings.configure-deepseek') }));
      expect(sessionStorage.getItem('gsm:pending-settings-tab')).toBe('ai');
      expect(mocks.state.setCurrentView).toHaveBeenCalledWith('settings');
      expect(navigate).toHaveBeenCalledWith(expect.objectContaining({ detail: { tab: 'ai' } }));
    } finally {
      window.removeEventListener('gsm:navigate-to-settings-tab', navigate);
    }
  });

  it('puts independent operations ahead of configuration and scans even with no local pending', () => {
    render(<VectorSearchSettings t={t} />);
    const operations = screen.getByRole('region', { name: t('vectorSearchSettings.index-management') });
    const configuration = screen.getByRole('heading', { name: /Embedding Model Configuration/ });
    expect(operations.compareDocumentPosition(configuration) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(mocks.actions.incrementalIndex).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: t('vectorSearchSettings.incremental-index') }));
    expect(mocks.actions.incrementalIndex).toHaveBeenCalledExactlyOnceWith(draft);
  });

  it('blocks unsaved model changes without invoking the engine or connections', () => {
    render(<VectorSearchSettings t={t} />);
    fireEvent.change(screen.getByLabelText(t('vectorSearchSettings.model-name')), { target: { value: 'unsaved' } });
    expect(screen.getByRole('button', { name: t('vectorSearchSettings.rebuild-vector-index') })).toBeDisabled();
    expect(screen.getByRole('button', { name: t('vectorSearchSettings.incremental-index') })).toBeDisabled();
    expect(mocks.actions.rebuildIndex).not.toHaveBeenCalled();
    expect(mocks.actions.testEmbedding).not.toHaveBeenCalled();
    expect(mocks.actions.testWorker).not.toHaveBeenCalled();
  });

  it('allows long connection and command buttons to wrap on narrow screens', () => {
    render(<VectorSearchSettings t={t} />);
    fireEvent.click(screen.getByText(t('vectorSearchSettings.delete-index')));
    for (const key of ['test-embedding-connection', 'test-worker-connection', 'copy-delete-command', 'copy-create-command']) {
      const button = screen.getByRole('button', { name: t(`vectorSearchSettings.${key}`) });
      expect(button).toHaveClass('max-w-full', 'whitespace-normal');
      expect(button.parentElement).toHaveClass('flex-wrap');
    }
  });

  it('commits only connection fields from the ② save button', () => {
    render(<VectorSearchSettings t={t} />);
    fireEvent.change(screen.getByLabelText(t('vectorSearchSettings.worker-url')), { target: { value: 'https://other-worker.example' } });
    fireEvent.click(screen.getByRole('button', { name: t('vectorSearchSettings.save-connection') }));
    expect(mocks.state.setVectorSearchConfig).toHaveBeenCalledTimes(1);
    expect(mocks.state.setVectorSearchConfig).toHaveBeenCalledWith({
      workerUrl: 'https://other-worker.example', authToken: 'test', embeddingConfigId: 'embedding',
    });
  });

  it('commits only index content fields from the ④ save button even when ⑤ is dirty', () => {
    render(<VectorSearchSettings t={t} />);
    fireEvent.click(screen.getByText(t('vectorSearchSettings.search-parameters')));
    fireEvent.click(screen.getByRole('switch', { name: t('vectorSearchSettings.hyde-query-preprocessing') }));
    fireEvent.click(screen.getByText(t('vectorSearchSettings.index-content'), { selector: 'summary' }));
    fireEvent.click(screen.getByRole('button', { name: t('vectorSearchSettings.save-index-config') }));
    expect(mocks.state.setVectorSearchConfig).toHaveBeenCalledTimes(1);
    expect(mocks.state.setVectorSearchConfig).toHaveBeenCalledWith({ indexMode: 'description', readmeMaxChars: 6000 });
  });

  it('commits only search parameters from the ⑤ save button', () => {
    render(<VectorSearchSettings t={t} />);
    fireEvent.click(screen.getByText(t('vectorSearchSettings.search-parameters')));
    fireEvent.click(screen.getByRole('switch', { name: t('vectorSearchSettings.hyde-query-preprocessing') }));
    fireEvent.click(screen.getByRole('button', { name: t('vectorSearchSettings.save-search-parameters') }));
    expect(mocks.state.setVectorSearchConfig).toHaveBeenCalledTimes(1);
    expect(mocks.state.setVectorSearchConfig).toHaveBeenCalledWith({
      searchThreshold: 0.35, searchTopK: 30, enableHyDE: false, enableReranking: true, searchAIConfigId: '',
    });
  });

  it('marks the edited section with an unsaved badge and a jump chip in the operations panel', () => {
    render(<VectorSearchSettings t={t} />);
    expect(screen.queryByText(t('vectorSearchSettings.unsaved-changes'))).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(t('vectorSearchSettings.model-name')), { target: { value: 'unsaved' } });
    expect(screen.getByText(t('vectorSearchSettings.unsaved-changes'))).toBeInTheDocument();
    const chip = screen.getByRole('button', { name: t('vectorSearchSettings.embedding-model-configuration') });
    expect(chip).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: t('vectorSearchSettings.cloudflare-vectorize-connection') })).not.toBeInTheDocument();
  });

  it('confirms before leaving to AI settings with unsaved drafts and honours cancel', async () => {
    mocks.state.aiConfigs = [{ ...deepseek, apiType: 'openai', apiKeyStatus: 'decrypt_failed' }];
    render(<VectorSearchSettings t={t} />);
    fireEvent.click(screen.getByText(t('vectorSearchSettings.search-parameters')));
    fireEvent.change(screen.getByLabelText(t('vectorSearchSettings.model-name')), { target: { value: 'unsaved' } });
    const jump = screen.getByRole('button', { name: t('vectorSearchSettings.configure-deepseek') });
    mocks.dialog.confirm.mockResolvedValueOnce(false);
    fireEvent.click(jump);
    await waitFor(() => expect(mocks.dialog.confirm).toHaveBeenCalled());
    expect(mocks.state.setCurrentView).not.toHaveBeenCalled();
    expect(sessionStorage.getItem('gsm:pending-settings-tab')).toBeNull();
    mocks.dialog.confirm.mockResolvedValueOnce(true);
    fireEvent.click(jump);
    await waitFor(() => expect(mocks.state.setCurrentView).toHaveBeenCalledWith('settings'));
  });

  it('shows a first-time guide and hides advanced sections until any config exists', () => {
    mocks.state.embeddingConfigs = [];
    mocks.state.activeEmbeddingConfig = null;
    mocks.state.vectorSearchConfig = { ...draft, workerUrl: '', authToken: '', enabled: false, embeddingConfigId: '' };
    render(<VectorSearchSettings t={t} />);
    expect(screen.getByRole('heading', { name: new RegExp(t('vectorSearchSettings.empty-title')) })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: t('vectorSearchSettings.empty-cta') })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: new RegExp(t('vectorSearchSettings.embedding-model-configuration')) })).toBeInTheDocument();
    expect(screen.getByText(t('vectorSearchSettings.deploy-guide'))).toBeInTheDocument();
    expect(screen.queryByText(t('vectorSearchSettings.enable-vector-search'))).not.toBeInTheDocument();
    expect(screen.queryByText(t('vectorSearchSettings.search-parameters'))).not.toBeInTheDocument();
    expect(screen.queryByText(t('vectorSearchSettings.delete-index'))).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: t('vectorSearchSettings.index-management') })).not.toBeInTheDocument();
  });

  it('renames the dimensions shortcut to restore-default and adopts detected dimensions from a passed test', () => {
    mocks.actions.embeddingTestResult = { success: true, dimensions: 99 };
    render(<VectorSearchSettings t={t} />);
    expect(screen.getByRole('button', { name: t('vectorSearchSettings.restore-default-dimensions') })).toBeInTheDocument();
    const adopt = screen.getByRole('button', { name: t('vectorSearchSettings.use-detected-dimensions', { dimensions: 99 }) });
    expect(adopt).toBeInTheDocument();
    fireEvent.click(adopt);
    expect(screen.getByLabelText(t('vectorSearchSettings.vector-dimensions'))).toHaveValue(99);
    expect(screen.queryByRole('button', { name: t('vectorSearchSettings.use-detected-dimensions', { dimensions: 99 }) })).not.toBeInTheDocument();
  });

  it('flashes copied feedback on the wrangler command buttons', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<VectorSearchSettings t={t} />);
    fireEvent.click(screen.getByText(t('vectorSearchSettings.delete-index')));
    fireEvent.click(screen.getByRole('button', { name: t('vectorSearchSettings.copy-delete-command') }));
    expect(await screen.findByText(`✓ ${t('vectorSearchSettings.copied')}`)).toBeInTheDocument();
    expect(writeText).toHaveBeenCalledWith('npx wrangler vectorize delete github-stars');
  });

  it('offers retry of the last indexing operation after a failed run', () => {
    mocks.state.vectorIndexingState = { isIndexing: false, phase: null, phaseDone: 0, phaseTotal: 0,
      result: { indexed: 0, skipped: 0, errors: 3, error: 'boom' } };
    render(<VectorSearchSettings t={t} />);
    expect(screen.queryByRole('button', { name: t('vectorSearchSettings.retry-last-index') })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: t('vectorSearchSettings.rebuild-vector-index') }));
    expect(mocks.actions.rebuildIndex).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: t('vectorSearchSettings.retry-last-index') }));
    expect(mocks.actions.rebuildIndex).toHaveBeenCalledTimes(2);
  });
});
