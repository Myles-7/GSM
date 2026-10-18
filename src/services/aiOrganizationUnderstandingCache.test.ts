import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import type { Repository, AIConfig } from '../types';
import type { OrganizationUnderstanding } from '../types/aiOrganization';
vi.mock('./repositoryIdentityGate', () => ({ assertRepositoryIdentityWritable: vi.fn() }));
import { OrganizationUnderstandingCache } from './aiOrganizationUnderstandingCache';
import { organizationFingerprint, organizationSourceMetadata } from './aiOrganizationDual';
import { openRepositoryChatDatabase } from './repositoryChatStorage';
const date = '2026-10-06T00:00:00.000Z';
const repo = { id: 42, full_name: 'fixture/science', description: 'Science CLI', pushed_at: date } as Repository;
const config = { id: 'fixture', model: 'fixture', isActive: true, apiKey: 'never-store-this-secret', baseUrl: 'https://fixture.invalid' } as AIConfig;
const fact = (depth: 'quick' | 'deep'): OrganizationUnderstanding => ({ repositoryId: 42, fingerprint: organizationFingerprint(repo), sourceMetadata: organizationSourceMetadata(repo), status: 'understood', depth, purpose: ['Computation'], technology: ['CLI'], sources: [{ kind: depth === 'deep' ? 'readme' : 'metadata', url: 'https://github.com/fixture/science#readme', retrievedAt: date }] });
beforeEach(() => { Object.defineProperty(window, 'indexedDB', { configurable: true, value: new IDBFactory() }); });
describe('derived understanding cache in the existing chat database', () => {
  it('reuses deep facts in quick mode across instances but isolates accounts and fingerprints', async () => {
    const first = new OrganizationUnderstandingCache(); await first.put('7', repo, config, 'en', fact('deep'));
    const second = new OrganizationUnderstandingCache(); await second.load('7');
    expect(second.get('7', repo, config, 'en', 'quick')?.reused).toBe(true);
    expect(second.get('8', repo, config, 'en', 'quick')).toBeUndefined();
    expect(second.get('7', { ...repo, pushed_at: 'changed' }, config, 'en', 'quick')).toBeUndefined();
    expect(second.get('7', repo, { ...config, model: 'other' }, 'en', 'quick')).toBeUndefined();
  });
  it('never promotes quick or versionless facts into deep verification', async () => {
    const cache = new OrganizationUnderstandingCache(); await cache.put('7', repo, config, 'en', fact('quick'));
    expect(cache.get('7', repo, config, 'en', 'deep')).toBeUndefined();
    const unknown = { ...repo, pushed_at: '' }; const row = { ...fact('deep'), fingerprint: organizationFingerprint(unknown) };
    await cache.put('7', unknown, config, 'en', row); expect(cache.get('7', unknown, config, 'en', 'deep')).toBeUndefined();
  });
  it('adds the cache store without touching conversation stores and persists no credentials', async () => {
    const cache = new OrganizationUnderstandingCache(); await cache.put('7', repo, config, 'en', fact('quick'));
    const db = await openRepositoryChatDatabase(); expect(db.version).toBe(3); expect(db.objectStoreNames.contains('messages')).toBe(true);
    const rows = await new Promise<unknown[]>(resolve => { const request = db.transaction('organizationUnderstandingCache').objectStore('organizationUnderstandingCache').getAll(); request.onsuccess = () => resolve(request.result); });
    expect(JSON.stringify(rows)).not.toContain(config.apiKey); expect(rows).toHaveLength(1); db.close();
  });
});
