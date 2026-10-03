
import { useT } from '../../../i18n/useT';
import { useCallback, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { AIConfig } from '../../../types';
import { useAppStore } from '../../../store/useAppStore';
import { useDialog } from '../../../hooks/useDialog';
import { AIService } from '../../../services/aiService';

export interface AIConfigActions {
  testingId: string | null;
  testingForm: boolean;
  results: Record<string, AIConnectionResult>;
  testConfig: (config: AIConfig) => Promise<void>;
  testDraft: (config: AIConfig) => Promise<void>;
}

export interface AIConnectionResult { success: boolean; message: string; at: number; fingerprint: string }
export const aiConnectionFingerprint = (config: AIConfig): string => JSON.stringify(config.provider === 'agy-cli'
  ? [config.provider, config.model, config.agyEffort]
  : [config.apiType, config.baseUrl, config.apiKey, config.model, config.reasoningEffort, config.mimoPlan, config.supportsToolCalls, config.credentialSource, config.backendAvailable]);

/**
 * Encapsulates AI connection tests so settings presentation code never creates
 * service instances or turns provider failures into UI messages directly.
 */
export const useAIConfigActions = (): AIConfigActions => {
  const t = useT('settings');
  const language = useAppStore(useShallow((state) => state.language));
  const { toast } = useDialog();
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testingForm, setTestingForm] = useState(false);
  const [results, setResults] = useState<Record<string, AIConnectionResult>>({});
  const testLock = useRef(false);

  const runConnectionTest = useCallback(async (config: AIConfig) => {
    let success = false;
    let message = '';
    try {
      const result = await new AIService(config, language).testConnection();
      success = result.success;
      message = success ? t('useAIConfigActions.ai-service-connection-successful') : result.message;
    } catch (error) {
      console.error('AI test failed:', error);
      message = t('useAIConfigActions.ai-service-test-failed-please-check-network-conn');
    }
    setResults(previous => ({ ...previous, [config.id || '__draft__']: { success, message, at: Date.now(), fingerprint: aiConnectionFingerprint(config) } }));
    toast(message, success ? 'success' : 'error');
  }, [language, t, toast]);

  const testConfig = useCallback(async (config: AIConfig) => {
    if (testLock.current) return;
    testLock.current = true;
    setTestingId(config.id);
    try {
      await runConnectionTest(config);
    } finally {
      testLock.current = false;
      setTestingId(null);
    }
  }, [runConnectionTest]);

  const testDraft = useCallback(async (config: AIConfig) => {
    if (testLock.current) return;
    testLock.current = true;
    setTestingForm(true);
    try {
      await runConnectionTest(config);
    } finally {
      testLock.current = false;
      setTestingForm(false);
    }
  }, [runConnectionTest]);

  return { testingId, testingForm, results, testConfig, testDraft };
};
