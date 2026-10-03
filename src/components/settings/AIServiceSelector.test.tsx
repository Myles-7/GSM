import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { AIConfig } from '../../types';
import { makeT } from '../../i18n/useT';
import type { useAgySettings } from '../../features/settings/hooks/useAgySettings';
import { aiConnectionFingerprint, type AIConfigActions } from '../../features/settings/hooks/useAIConfigActions';
import { AIServiceSelector } from './AIServiceSelector';

vi.mock('../../i18n/useT', async importOriginal => ({ ...await importOriginal<typeof import('../../i18n/useT')>(), useT: () => makeT('en', 'settings') }));
const config: AIConfig = { id: 'paid', name: 'API fixture', baseUrl: 'https://example.invalid', apiKey: 'fixture', model: 'fixture', isActive: false };
const agy = { available: true, probeMatches: true, state: { supported: true, enabled: true, executable: { fingerprint: 'fixture' }, prefs: { model: 'fixture' } } } as ReturnType<typeof useAgySettings>;
const actions: AIConfigActions = { testingId: null, testingForm: false, results: {}, testConfig: vi.fn(), testDraft: vi.fn() };

describe('Unified AI selection', () => {
  it('switches both ways with one controlled current-service value', () => {
    const select = vi.fn();
    const props = { configs: [config], active: 'agy-cli-local', select, agy, actions, configureAgy: vi.fn(), edit: vi.fn(), remove: vi.fn() };
    const view = render(<AIServiceSelector {...props} />);
    fireEvent.click(screen.getByLabelText('API fixture'));
    expect(select).toHaveBeenLastCalledWith('paid');
    view.rerender(<AIServiceSelector {...props} active="paid" />);
    expect(screen.getByRole('radio', { name: 'API fixture' })).toBeChecked();
    fireEvent.click(screen.getByLabelText('AGY CLI'));
    expect(select).toHaveBeenLastCalledWith('agy-cli-local');
  });
  it('offers configuration when AGY is unavailable and never switches automatically', () => {
    const select = vi.fn(); const configure = vi.fn();
    render(<AIServiceSelector configs={[config]} active="agy-cli-local" select={select} agy={{ ...agy, available: false }} actions={actions} configureAgy={configure} edit={vi.fn()} remove={vi.fn()} />);
    expect(screen.getByRole('radio', { name: 'AGY CLI' })).toBeDisabled();
    expect(screen.getByText(/The selected service is unavailable/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Configure AGY' }));
    expect(configure).toHaveBeenCalledOnce();
    expect(select).not.toHaveBeenCalled();
  });
  it('invalidates a test result after connection parameters change', () => {
    const props = { configs: [config], active: 'paid', select: vi.fn(), agy, configureAgy: vi.fn(), edit: vi.fn(), remove: vi.fn(),
      actions: { ...actions, results: { paid: { success: true, message: 'fixture result', at: Date.now(), fingerprint: aiConnectionFingerprint(config) } } } };
    const view = render(<AIServiceSelector {...props} />);
    expect(screen.getByText(/Test passed/)).toBeInTheDocument();
    view.rerender(<AIServiceSelector {...props} configs={[{ ...config, model: 'changed' }]} />);
    expect(screen.queryByText(/Test passed/)).toBeNull();
    expect(screen.getByText('Not tested')).toBeInTheDocument();
  });
});
