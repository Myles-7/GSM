import { webcrypto } from 'node:crypto';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeT } from '../../i18n/useT';
import { createVectorGeneration } from '../../services/vectorIndexIdentity';
import type { VectorSearchActions } from '../../features/settings/hooks/useVectorSearchActions';
import { VectorSearchSettings } from './VectorSearchSettings';

const mocks = vi.hoisted(() => ({ state: {} as Record<string, unknown>, actions: {} as VectorSearchActions }));
vi.mock('../../store/useAppStore', () => ({
  useAppStore: (selector: (state: typeof mocks.state) => unknown) => selector(mocks.state),
}));
vi.mock('../../features/settings/hooks/useVectorSearchActions', () => ({
  useVectorSearchActions: () => mocks.actions,
}));
vi.mock('../../hooks/useDialog', () => ({ useDialog: () => ({ toast: vi.fn() }) }));
const t = makeT('en', 'app');
const draft = {
  apiType: 'ollama' as const, baseUrl: 'http://localhost:11434', apiKey: '', model: 'model',
  dimensions: 3, workerUrl: 'https://worker.example', authToken: 'test',
  indexMode: 'description' as const, readmeMaxChars: 6000,
};
beforeEach(async () => {
  vi.clearAllMocks();
  vi.stubGlobal('crypto', webcrypto);
  Object.assign(mocks.state, {
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
    for (const key of ['test-embedding-connection', 'test-worker-connection', 'copy-delete-command', 'copy-create-command']) {
      const button = screen.getByRole('button', { name: t(`vectorSearchSettings.${key}`) });
      expect(button).toHaveClass('max-w-full', 'whitespace-normal');
      expect(button.parentElement).toHaveClass('flex-wrap');
    }
  });
});
