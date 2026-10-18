import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgyRecoveryRecord } from '../types/agy';
import type { WorkbenchProposal } from '../types/aiWorkbench';
import type { AITaskRecord } from './aiTaskJournal';
const mocks = vi.hoisted(() => ({ list: vi.fn(), read: vi.fn(), ack: vi.fn(), stage: vi.fn(), get: vi.fn(), require: vi.fn(), save: vi.fn(), provider: vi.fn(),
  patch: vi.fn(), state: { user: { id: 7 }, language: 'en' } }));
vi.mock('./agyClient', () => ({ listAgyRecovery: mocks.list, readAgyRecovery: mocks.read, acknowledgeAgyRecovery: mocks.ack,
  agyRecoverySession: async () => ({ session: 'session', api: { recoveryStage: mocks.stage } }) }));
vi.mock('./aiTaskJournal', () => ({ aiTaskJournal: { snapshot: () => [], patch: mocks.patch } }));
vi.mock('./repositoryChatStorage', () => ({ repositoryChatStorage: { getProposal: mocks.get } }));
vi.mock('./aiOrganizationExecution', () => ({ requireOrganizationProposal: mocks.require, saveOrganizationProposal: mocks.save }));
vi.mock('../store/useAppStore', () => ({ useAppStore: { getState: () => mocks.state } }));
vi.mock('./aiService', () => ({ AIService: class { generateChatText = mocks.provider; } }));
import { acknowledgeOrganizationResults, findOrganizationResponse, organizationRecoveryConfig, registerOrganizationResult,
  retryOrganizationTaskSave, stageOrganizationResults, validateOrganizationResult } from './aiOrganizationResultRecovery';
import { organizationHash } from './aiOrganizationPlanning';
const record: AgyRecoveryRecord = { requestId: 'result', taskId: 'task', step: 'organization:proposal:step', inputDigest: '',
  profile: 'original:model:high:text-v1', dispatch: 'sent', providerOutcome: 'succeeded', recoverable: true,
  resultDigest: 'digest', createdAt: '2026-10-17T00:00:00Z' };
const task = { id: 'task', owner: '7', kind: 'organization', state: 'partial', updatedAt: record.createdAt, items: [] } as AITaskRecord;
const proposal = (): WorkbenchProposal => ({ id: 'proposal', ownerId: '7', sessionId: 'session', createdAt: record.createdAt, updatedAt: record.createdAt,
  operations: [], organization: { revision: 1, instruction: '', scope: { name: 'all', repositoryIds: [1] }, entries: [], categories: [] } as never });
beforeEach(() => {
  vi.clearAllMocks(); mocks.list.mockResolvedValue([record]); mocks.ack.mockResolvedValue(undefined); mocks.stage.mockResolvedValue({ ok: true });
  mocks.get.mockResolvedValue(proposal()); mocks.require.mockResolvedValue(proposal()); mocks.save.mockResolvedValue(undefined);
});
describe('Organization save-only recovery', () => {
  it('replays exact original input without requiring the current executable or a fresh model call', async () => {
    const full = 'system\nApplication output ceiling: 4000 characters. Stay within it without dropping requested requirements. Return a complete result, never truncated JSON.';
    const saved = { ...record, inputDigest: await organizationHash([full, 'input', record.profile, { guard: 'unchanged' }]) };
    mocks.list.mockResolvedValue([saved]); mocks.read.mockResolvedValue({ record: saved, result: { text: '{"saved":true}' } });
    expect(await findOrganizationResponse('7', 'proposal', 'step', 'system', 'input', { guard: 'unchanged' }, 'replacement:other:low:text-v1', 500)).toBe('{"saved":true}');
    await expect(findOrganizationResponse('7', 'proposal', 'step', 'system', 'changed', { guard: 'unchanged' }, 'replacement', 500)).rejects.toThrow('CONTEXT_CONFLICT');
    expect(mocks.provider).not.toHaveBeenCalled();
    expect(await organizationRecoveryConfig('7', 'proposal', 'removed-config')).toMatchObject({ id: 'removed-config', model: 'model', agyEffort: 'high', isActive: false });
  });
  it('retains failed encrypted staging and rejects intervening manual draft changes', async () => {
    registerOrganizationResult('proposal', 'step', record); validateOrganizationResult('proposal', 'step', true);
    const next = proposal(); const existing = proposal();
    existing.organization!.entries = [{ manual: true, repositoryId: 1 }] as never;
    await expect(stageOrganizationResults(next, existing)).rejects.toThrow('CONTEXT_CONFLICT');
    mocks.stage.mockResolvedValueOnce({ ok: false, code: 'RECOVERY_IO_FAILED' });
    await expect(stageOrganizationResults(next, proposal())).rejects.toThrow('RECOVERY_IO_FAILED');
    const rows = await stageOrganizationResults(next, proposal());
    expect(rows).toHaveLength(1); expect(mocks.ack).not.toHaveBeenCalled();
    mocks.ack.mockRejectedValueOnce(new Error('lost receipt'));
    await expect(acknowledgeOrganizationResults(next, rows)).rejects.toThrow('lost receipt');
    await acknowledgeOrganizationResults(next, rows);
    expect(await stageOrganizationResults(next, next)).toHaveLength(0);
    expect(mocks.provider).not.toHaveBeenCalled();
  });
  it('recognizes a committed result after ACK loss without overwriting a later draft edit', async () => {
    const current = proposal(); current.updatedAt = '2026-10-17T01:00:00Z';
    current.organization!.agyReceipts = [{ requestId: record.requestId, digest: record.resultDigest! }];
    mocks.require.mockResolvedValue(current);
    mocks.read.mockResolvedValue({ record, result: { text: '{}' }, commit: { kind: 'organization', expectedUpdatedAt: record.createdAt, proposal: proposal() } });
    await retryOrganizationTaskSave(task);
    expect(mocks.save).not.toHaveBeenCalled(); expect(mocks.ack).toHaveBeenCalledWith('7', 'result', 'digest');
  });
  it('refuses stale staged snapshots and account changes instead of calling the provider', async () => {
    mocks.require.mockResolvedValue({ ...proposal(), updatedAt: '2026-10-17T01:00:00Z' });
    mocks.read.mockResolvedValue({ record, commit: { kind: 'organization', expectedUpdatedAt: record.createdAt, proposal: proposal() } });
    await expect(retryOrganizationTaskSave(task)).rejects.toThrow('CONTEXT_CONFLICT');
    await expect(retryOrganizationTaskSave({ ...task, owner: '8' })).rejects.toThrow('Account changed');
    expect(mocks.save).not.toHaveBeenCalled(); expect(mocks.ack).not.toHaveBeenCalled(); expect(mocks.provider).not.toHaveBeenCalled();
  });
});
