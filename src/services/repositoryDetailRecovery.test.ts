import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AIConfig, Repository } from '../types';
import type { AgyRecoveryRecord } from '../types/agy';
const mocks = vi.hoisted(() => ({ read: vi.fn(), list: vi.fn(), stage: vi.fn(), ack: vi.fn(), assertAsset: vi.fn(), generate: vi.fn(), readme: vi.fn() }));
vi.mock('./agyClient', () => ({ listAgyRecovery: mocks.list, readAgyRecovery: mocks.read, acknowledgeAgyRecovery: mocks.ack,
  agyRecoverySession: async () => ({ session: 'session', api: { recoveryStage: mocks.stage } }) }));
vi.mock('./repositoryAnalysisAssets', () => ({ assertRepositoryAnalysisAssetWrite: mocks.assertAsset }));
vi.mock('./aiService', () => ({ AIService: class { generateChatText = mocks.generate; } }));
vi.mock('./repositoryDetailReadme', () => ({ getRepositoryDetailReadme: mocks.readme }));
import { analyzeRepositoryDetails } from './repositoryDetailAnalysis';
import { confirmRepositoryDetailRecovery, detailRecoveryContext, recoverRepositoryDetail, stageRepositoryDetailRecovery } from './repositoryDetailRecovery';

const repo = { id: 71, full_name: 'fixture/repo', html_url: 'https://github.com/fixture/repo', pushed_at: '2026-09-01', ai_summary: 'before' } as Repository;
const config: AIConfig = { id: 'agy', name: 'AGY', provider: 'agy-cli', model: 'original', agyMode: 'model', agyEffort: 'high', isActive: true, deviceBound: true };
const record: AgyRecoveryRecord = { requestId: 'result', taskId: 'task', itemId: '71', step: 'details:71', inputDigest: 'input', profile: 'profile',
  dispatch: 'sent', providerOutcome: 'succeeded', recoverable: true, resultDigest: 'digest', createdAt: '2026-10-17T00:00:00Z' };
const response = JSON.stringify({ problem: null, features: [], scenarios: [], architecture: null, quickstart: [{ description: 'Install', command: 'npm install --ignore-scripts' }], deployment: null, cost: null, maintenance: null });
function payload() {
  return { record, result: { text: response, usage: {} }, context: detailRecoveryContext(repo, { fullName: repo.full_name,
    pushedAt: repo.pushed_at!, language: 'en', model: 'original', readme: { content: 'npm install --ignore-scripts', retrievedAt: '2026-10-16T00:00:00Z' } }, config) };
}
beforeEach(() => {
  vi.clearAllMocks(); vi.stubGlobal('electronAPI', { agy: { recoveryList: vi.fn() } });
  mocks.read.mockResolvedValue(payload()); mocks.list.mockResolvedValue([record]); mocks.stage.mockResolvedValue({ ok: true });
  mocks.ack.mockResolvedValue(undefined); mocks.assertAsset.mockResolvedValue(undefined);
});
afterEach(() => vi.unstubAllGlobals());
describe('detail and subscription encrypted save-only recovery', () => {
  it('reuses original response, README and provenance even with a disabled replacement configuration', async () => {
    const onConfig = vi.fn();
    const value = await analyzeRepositoryDetails({ repository: repo, accountId: 7, aiConfig: { ...config, isActive: false, model: 'replacement' },
      githubToken: '', language: 'en', recovery: { requestId: record.requestId, onConfig } });
    expect(value.model).toBe('original'); expect(value.generated_at).toBe(record.createdAt);
    expect(value.quickstart[0].command).toBe('npm install --ignore-scripts');
    expect(onConfig).toHaveBeenCalledWith(expect.objectContaining({ model: 'original', agyEffort: 'high' }));
    expect(mocks.generate).not.toHaveBeenCalled(); expect(mocks.readme).not.toHaveBeenCalled(); expect(mocks.ack).not.toHaveBeenCalled();
  });
  it('keeps results recoverable through stage and receipt failures without a new provider call', async () => {
    mocks.stage.mockResolvedValueOnce({ ok: false, code: 'RECOVERY_IO_FAILED' });
    await expect(stageRepositoryDetailRecovery(7, record, repo)).rejects.toThrow('RECOVERY_IO_FAILED');
    expect(mocks.ack).not.toHaveBeenCalled();
    await stageRepositoryDetailRecovery(7, record, repo);
    mocks.ack.mockRejectedValueOnce(new Error('receipt lost'));
    await expect(confirmRepositoryDetailRecovery(7, record)).rejects.toThrow('receipt lost');
    await analyzeRepositoryDetails({ repository: repo, accountId: 7, aiConfig: config, githubToken: '', language: 'en', recovery: { requestId: 'result' } });
    await confirmRepositoryDetailRecovery(7, record);
    expect(mocks.generate).not.toHaveBeenCalled(); expect(mocks.ack).toHaveBeenCalledTimes(2);
  });
  it('rejects changed repository identity, evidence, language and revoked asset versions', async () => {
    for (const changed of [{ ...repo, full_name: 'other/repo' }, { ...repo, pushed_at: '2026-10-17' }, { ...repo, ai_summary: 'manual replacement' }])
      await expect(recoverRepositoryDetail(7, changed, 'en', 'result')).rejects.toThrow('RECOVERY_CONFLICT');
    await expect(recoverRepositoryDetail(7, repo, 'zh', 'result')).rejects.toThrow('RECOVERY_CONFLICT');
    const saved = payload(); saved.context.assetVersion = { accountId: '7', repositoryId: 71, generation: 1, repositoryGeneration: 1 };
    mocks.read.mockResolvedValue(saved); mocks.assertAsset.mockRejectedValue(new Error('asset revoked'));
    await expect(recoverRepositoryDetail(7, repo, 'en', 'result')).rejects.toThrow('asset revoked');
  });
  it('accepts the identical staged business result after a lost consumption receipt', async () => {
    const target = { ...repo, ai_summary: 'saved' };
    await stageRepositoryDetailRecovery(7, record, target);
    const commit = mocks.stage.mock.calls[0][3];
    mocks.read.mockResolvedValue({ ...payload(), commit });
    expect((await recoverRepositoryDetail(7, target, 'en', 'result'))?.record.requestId).toBe('result');
    await expect(recoverRepositoryDetail(7, { ...target, ai_summary: 'new edit' }, 'en', 'result')).rejects.toThrow('RECOVERY_CONFLICT');
  });
});
