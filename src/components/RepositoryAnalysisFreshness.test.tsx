import { act, fireEvent, render, screen } from '@testing-library/react';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { AIConfig, Repository } from '../types';
import type { RepositoryDetailsAnalysis } from '../types/repositoryDetails';
import { useAppStore } from '../store/useAppStore';
import { initializeRepositoryAnalysisAssets, saveRepositoryAnalysisAsset } from '../services/repositoryAnalysisAssets';
import { RepositoryAnalysisFreshness } from './RepositoryAnalysisFreshness';
vi.mock('../store/useAppStore', async () => {
  const { create } = await import('zustand');
  return { useAppStore: create(() => ({ user: { id: 1 }, language: 'en', activeAIConfig: 'ai', aiConfigs: [] as AIConfig[] })) };
});
const repo = { id: 1, full_name: 'owner/repo', pushed_at: '2026-09-01T00:00:00Z' } as Repository;
const config = { id: 'ai', name: 'test', model: 'test' } as AIConfig;
const details: RepositoryDetailsAnalysis = { version: 1, generated_at: '2026-10-01T00:00:00Z', repository_pushed_at: repo.pushed_at!,
  model: 'test', sources: [], summary: 'Saved summary', problem: null, features: [], scenarios: [], architecture: null,
  quickstart: [], deployment: null, cost: null, maintenance: null };
beforeEach(async () => {
  vi.stubGlobal('indexedDB', new IDBFactory());
  useAppStore.setState({ user: { id: 1 } as never, language: 'en', activeAIConfig: 'ai', aiConfigs: [config] });
  await initializeRepositoryAnalysisAssets('1', []);
});
afterEach(() => vi.unstubAllGlobals());
it('shows no icon for fresh analysis, then a stale icon and tooltip on repository or config changes', async () => {
  await saveRepositoryAnalysisAsset('1', repo, 'en', config, details);
  const { rerender } = render(<RepositoryAnalysisFreshness repository={repo} />);
  expect(screen.queryByRole('img')).not.toBeInTheDocument();
  rerender(<RepositoryAnalysisFreshness repository={{ ...repo, pushed_at: '2026-10-02T00:00:00Z' }} />);
  const icon = screen.getByRole('img', { name: /Repository has new commits/ });
  fireEvent.focus(icon);
  expect(await screen.findByRole('tooltip')).toHaveTextContent('Repository has new commits');
  expect(screen.getByRole('tooltip')).toHaveTextContent(`Model: test; Generated: ${new Date(details.generated_at).toLocaleString('en')}`);
  act(() => useAppStore.setState({ aiConfigs: [{ ...config, model: 'changed' }] }));
  expect(screen.getByRole('img', { name: /AI configuration changed/ })).toBeInTheDocument();
});
it('subscribes to asset saves, shows a language fallback icon, and clears it when current-language results arrive', async () => {
  const { rerender } = render(<RepositoryAnalysisFreshness repository={repo} />);
  expect(screen.queryByRole('img')).not.toBeInTheDocument();
  await act(async () => saveRepositoryAnalysisAsset('1', repo, 'zh', config, details));
  expect(screen.getByRole('img', { name: /Analysis language: zh; current language: en; Model: test; Generated:/ })).toBeInTheDocument();
  await act(async () => saveRepositoryAnalysisAsset('1', repo, 'en', config, details));
  expect(screen.queryByRole('img')).not.toBeInTheDocument();
  act(() => useAppStore.setState({ user: { id: 2 } as never }));
  rerender(<RepositoryAnalysisFreshness repository={repo} />);
  expect(screen.queryByRole('img')).not.toBeInTheDocument();
});
it('does not infer the language of an unlabelled legacy success from the current UI language', async () => {
  await initializeRepositoryAnalysisAssets('1', [{ ...repo, ai_details: details }]);
  render(<RepositoryAnalysisFreshness repository={repo} />);
  expect(screen.getByRole('img', { name: /Analysis language: Unknown legacy language; current language: en/ })).toBeInTheDocument();
});
