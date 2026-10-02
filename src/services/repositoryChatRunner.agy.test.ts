import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RepositoryChatTurnInput } from './repositoryChatService';

const mocks = vi.hoisted(() => ({ model: vi.fn(), research: vi.fn(), native: vi.fn() }));
vi.mock('./repositoryChatService', () => ({
  runModelRepositoryChatTurn: mocks.model,
  runEvidenceDrivenRepositoryChatTurn: mocks.research,
  resolveTurnLimits: () => ({ budget: { maxDurationMs: 90_000 } }),
}));
vi.mock('./agentToolLoop', () => ({ runToolLoopRepositoryChatTurn: mocks.native }));
vi.mock('./aiService', () => ({
  supportsChatToolCalls: () => false, isAIToolCallUnsupportedError: () => false,
}));
import { runRepositoryChatTurn } from './repositoryChatRunner';

describe('AGY chat mode selection', () => {
  beforeEach(() => vi.clearAllMocks());
  it.each(['model', 'research'] as const)('routes %s mode without native function calling', async mode => {
    const input = { session: { ownerId: 'test-owner' }, aiConfig: { provider: 'agy-cli', agyMode: mode }, enableAgentToolLoop: true } as RepositoryChatTurnInput;
    await runRepositoryChatTurn(input);
    expect(mode === 'model' ? mocks.model : mocks.research).toHaveBeenCalledWith(expect.objectContaining(input));
    expect(mocks.native).not.toHaveBeenCalled();
    expect(mode === 'model' ? mocks.research : mocks.model).not.toHaveBeenCalled();
  });
  it('does not reserve answer time twice for evidence-only workbench collection', async () => {
    await runRepositoryChatTurn({ session: { ownerId: 'test-owner' }, evidenceOnly: true,
      aiConfig: { provider: 'agy-cli', agyMode: 'research' } } as RepositoryChatTurnInput);
    const input = mocks.research.mock.calls[0][0] as RepositoryChatTurnInput;
    expect(input.retrievalDeadlineAt).toBe(input.deadlineAt);
  });
});
