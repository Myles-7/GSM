import { describe, expect, it, vi } from 'vitest';
const saved = vi.hoisted(() => new Map<string, string>());
vi.mock('./indexedDbStorage', () => ({ indexedDBStorage: { getItem: async (key: string) => saved.get(key) ?? null, setItem: async (key: string, value: string) => { saved.set(key, value); } } }));
import { organizationExcerpt, organizationRunEvents, redactOrganizationOutput } from './aiOrganizationRunEvents';
describe('safe organization request diagnostics', () => {
  it('caps UTF-8 excerpts and redacts known keys and bearer tokens', () => {
    expect(new TextEncoder().encode(organizationExcerpt('中文'.repeat(10000), 32768)).length).toBeLessThanOrEqual(32768);
    expect(redactOrganizationOutput('Bearer abc123 apiKey="private" supplied-secret', ['supplied-secret'])).not.toMatch(/abc123|private|supplied-secret/);
  });
  it('retains other proposals and persists metadata without result bodies', async () => {
    const owner = 'diagnostic-owner';
    for (const proposalId of ['first', 'second']) {
      organizationRunEvents.begin({ id: proposalId, ownerId: owner, proposalId, runId: 'run', key: 'assignments:both:0', attempt: 1,
        model: 'fixture', repositoryIds: [1], inputChars: 300, state: 'running', createdAt: Date.now(), output: '中文'.repeat(20000) });
      organizationRunEvents.patch(proposalId, proposalId, { state: proposalId === 'first' ? 'failed' : 'verified', endedAt: Date.now() }, true);
    }
    await organizationRunEvents.flush(owner);
    const rows = JSON.parse(saved.get('gsm:organization-diagnostics:diagnostic-owner')!);
    expect(rows).toHaveLength(2);
    expect(rows.find((row: { id: string }) => row.id === 'first').output).toBe('');
    expect(rows.find((row: { id: string }) => row.id === 'second').output).toBe('');
    expect(rows.every((row: object) => !('input' in row) && !('apiKey' in row))).toBe(true);
  });
});
