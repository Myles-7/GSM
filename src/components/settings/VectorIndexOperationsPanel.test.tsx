import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeT } from '../../i18n/useT';
import type { VectorIndexingState } from '../../types';
import { VectorIndexOperationsPanel } from './VectorIndexOperationsPanel';

const t = makeT('en', 'app');
const idle: VectorIndexingState = { isIndexing: false, phase: null, phaseDone: 0, phaseTotal: 0, result: null };
const props = () => ({
  t, state: { ...idle }, configComplete: true, settingsSaved: true, compatibleIndex: true,
  candidateCount: 120, localPendingCount: 0,
  onRebuild: vi.fn().mockResolvedValue(undefined), onIncremental: vi.fn().mockResolvedValue(undefined),
  onAbort: vi.fn(),
});
beforeEach(() => vi.clearAllMocks());

describe('vector operations', () => {
  it('keeps incremental inspection available when local pending is zero and requires user action', () => {
    const value = props();
    render(<VectorIndexOperationsPanel {...value} />);
    expect(value.onRebuild).not.toHaveBeenCalled();
    expect(value.onIncremental).not.toHaveBeenCalled();
    expect(screen.getByText('Incremental scan candidates')).toBeTruthy();
    expect(screen.getByText('120')).toBeTruthy();
    expect(screen.queryByText('99+')).toBeNull();
    const incremental = screen.getByRole('button', { name: t('vectorSearchSettings.incremental-index') });
    expect(incremental).toBeEnabled();
    fireEvent.click(incremental);
    expect(value.onIncremental).toHaveBeenCalledOnce();
  });

  it('caps pending badges without capping either full count', () => {
    render(<VectorIndexOperationsPanel {...props()} localPendingCount={110} />);
    expect(screen.getByText('99+')).toHaveAttribute('aria-label', '110 locally known pending');
    expect(screen.getByText('110')).toBeTruthy();
    expect(screen.getByText('120')).toBeTruthy();
  });

  it.each(['settingsSaved', 'configComplete'] as const)('blocks both operations when %s is false', (key) => {
    render(<VectorIndexOperationsPanel {...props()} {...{ [key]: false }} />);
    expect(screen.getByRole('button', { name: t('vectorSearchSettings.rebuild-vector-index') })).toBeDisabled();
    expect(screen.getByRole('button', { name: t('vectorSearchSettings.incremental-index') })).toBeDisabled();
  });

  it('requires a rebuild for incompatible identity but permits a full rebuild', () => {
    render(<VectorIndexOperationsPanel {...props()} compatibleIndex={false} />);
    expect(screen.getByRole('button', { name: t('vectorSearchSettings.rebuild-vector-index') })).toBeEnabled();
    expect(screen.getByRole('button', { name: t('vectorSearchSettings.incremental-index') })).toBeDisabled();
  });

  it('disables incremental scanning with no candidates', () => {
    render(<VectorIndexOperationsPanel {...props()} candidateCount={0} />);
    expect(screen.getByRole('button', { name: t('vectorSearchSettings.incremental-index') })).toBeDisabled();
  });

  it('shows preparing before progress, disables restarts and exposes abort', () => {
    const value = props();
    render(<VectorIndexOperationsPanel {...value} state={{ ...idle, isIndexing: true }} />);
    expect(screen.getByRole('status')).toHaveTextContent(t('vectorSearchSettings.preparing'));
    expect(screen.getByRole('button', { name: t('vectorSearchSettings.rebuild-vector-index') })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: t('vectorSearchSettings.abort') }));
    expect(value.onAbort).toHaveBeenCalledOnce();
  });

  it('exposes bounded accessible progress and preserves failure details', () => {
    render(<VectorIndexOperationsPanel {...props()} state={{
      ...idle, isIndexing: true, phase: 'uploading', phaseDone: 4, phaseTotal: 2,
      result: { indexed: 1, skipped: 2, errors: 1, error: 'Previous generation retained' },
    }} />);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
    expect(screen.getByRole('alert')).toHaveTextContent('Previous generation retained');
  });
});
