import { describe, expect, it } from 'vitest';
import { mergeVectorSearchConfig, normalizeRepositoryChatSettings, normalizeVectorSearchConfig } from './schema';

describe('vector search AI config reference', () => {
  it('defaults legacy and invalid selections to following the current AI config', () => {
    expect(normalizeVectorSearchConfig({}, []).searchAIConfigId).toBe('');
    expect(normalizeVectorSearchConfig({ searchAIConfigId: 42 }, []).searchAIConfigId).toBe('');
    expect(normalizeVectorSearchConfig(null, []).searchAIConfigId).toBe('');
  });

  it('restores unresolved selections without switching providers and supports clearing', () => {
    const restored = normalizeVectorSearchConfig({ searchAIConfigId: 'deleted-deepseek' }, []);
    expect(restored.searchAIConfigId).toBe('deleted-deepseek');
    expect(mergeVectorSearchConfig(restored, { searchTopK: 20 }).searchAIConfigId).toBe('deleted-deepseek');
    expect(mergeVectorSearchConfig(restored, { searchAIConfigId: '' }).searchAIConfigId).toBe('');
  });
});

describe('normalizeRepositoryChatSettings', () => {
  it('migrates legacy tool limits into the evidence-driven agent budget', () => {
    const settings = normalizeRepositoryChatSettings({ maxToolsPerTurn: 7 });

    expect(settings.maxToolsPerTurn).toBe(7);
    expect(settings.agentBudget).toMatchObject({
      maxTurns: 4,
      maxToolCalls: 7,
      maxReadFiles: 8,
      maxCodeReads: 3,
      maxNoProgressRounds: 2,
      maxDurationMs: 90_000,
    });
  });

  it('normalizes every agent budget boundary and keeps code reads within file reads', () => {
    const settings = normalizeRepositoryChatSettings({
      maxToolsPerTurn: 1,
      agentBudget: {
        maxTurns: 99,
        maxToolCalls: 99,
        maxReadFiles: 2,
        maxCodeReads: 12,
        maxNoProgressRounds: 99,
        maxDurationMs: 999_999,
      },
    });

    expect(settings.maxToolsPerTurn).toBe(48);
    expect(settings.agentBudget).toEqual({
      maxTurns: 8,
      maxToolCalls: 48,
      maxReadFiles: 2,
      maxCodeReads: 2,
      maxNoProgressRounds: 4,
      maxDurationMs: 300_000,
    });
  });

  it('normalizes the task depth and rejects unknown values', () => {
    expect(normalizeRepositoryChatSettings({}).taskDepth).toBe('default');
    expect(normalizeRepositoryChatSettings({ taskDepth: 'quick' }).taskDepth).toBe('quick');
    expect(normalizeRepositoryChatSettings({ taskDepth: 'deep' }).taskDepth).toBe('deep');
    expect(normalizeRepositoryChatSettings({ taskDepth: 'unlimited' }).taskDepth).toBe('unlimited');
    expect(normalizeRepositoryChatSettings({ taskDepth: 'bogus' }).taskDepth).toBe('default');
    expect(normalizeRepositoryChatSettings({ taskDepth: 42 }).taskDepth).toBe('default');
  });
});
