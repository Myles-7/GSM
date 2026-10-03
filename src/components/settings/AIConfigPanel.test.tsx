import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AIConfig } from '../../types';
import { makeT } from '../../i18n/useT';
import { useAppStore } from '../../store/useAppStore';
import { isAIConfigAvailable } from '../../utils/aiConfig';
import { AIConfigPanel } from './AIConfigPanel';
import { aiConnectionFingerprint } from '../../features/settings/hooks/useAIConfigActions';

vi.unmock('../../store/useAppStore');
const mocks = vi.hoisted(() => ({ testDraft: vi.fn(), toast: vi.fn(), results: {} }));
vi.mock('../../hooks/useDialog', () => ({ useDialog: () => ({ toast: mocks.toast, confirm: vi.fn() }) }));
vi.mock('../../features/settings/hooks/useAgySettings', () => ({ useAgySettings: () => ({ available: false, state: null }) }));
vi.mock('../../features/settings/hooks/useAIConfigActions', async importOriginal => ({
  ...await importOriginal<typeof import('../../features/settings/hooks/useAIConfigActions')>(),
  useAIConfigActions: () => ({ testDraft: mocks.testDraft, testConfig: vi.fn(), results: mocks.results, testingId: null, testingForm: false }),
}));

const config: AIConfig = { id: 'fixture-api', name: 'API fixture', apiType: 'mimo', mimoPlan: 'token-plan',
  baseUrl: 'https://example.invalid/v1', apiKey: 'old-fixture', apiKeyStatus: 'decrypt_failed', model: 'fixture-model', isActive: false, supportsToolCalls: true };
const renderPanel = () => render(<AIConfigPanel t={makeT('en', 'app')} />);
const edit = () => fireEvent.click(screen.getByRole('button', { name: 'Configure API fixture' }));
const input = (id: string, value: string) => fireEvent.change(document.getElementById(id)!, { target: { value } });
beforeEach(() => {
  vi.clearAllMocks(); mocks.results = {};
  useAppStore.setState({ language: 'en', aiConfigs: [config], activeAIConfig: config.id });
});

describe('API settings form', () => {
  it('replacing a failed credential makes the saved API configuration available', () => {
    renderPanel(); edit(); input('ai-api-key', '  replacement-fixture  ');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    const saved = useAppStore.getState().aiConfigs[0];
    expect(saved).toMatchObject({ apiKey: 'replacement-fixture', apiKeyStatus: 'ok', credentialSource: 'device' });
    expect(isAIConfigAvailable(saved)).toBe(true);
  });
  it('tests the complete draft including MiMo channel and tool capability', () => {
    renderPanel(); edit();
    fireEvent.click(screen.getByRole('button', { name: 'Test Connection' }));
    expect(mocks.testDraft).toHaveBeenCalledWith(expect.objectContaining({ mimoPlan: 'token-plan', supportsToolCalls: true, apiType: 'mimo' }));
  });
  it('hides an earlier draft test result when its model changes', () => {
    mocks.results = { __draft__: { success: true, message: 'Fixture connection passed', at: Date.now(),
      fingerprint: aiConnectionFingerprint({ ...config, id: '', apiKeyStatus: 'ok', credentialSource: 'device' }) } };
    renderPanel(); edit();
    expect(screen.getByText('Fixture connection passed')).toBeInTheDocument();
    input('ai-model-name', 'changed-model');
    expect(screen.queryByText('Fixture connection passed')).toBeNull();
  });
});
