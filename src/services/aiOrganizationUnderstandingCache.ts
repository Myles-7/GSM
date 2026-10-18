import type { AIConfig, Repository } from '../types';
import type { OrganizationAnalysisDepth, OrganizationUnderstanding } from '../types/aiOrganization';
import { openRepositoryChatDatabase } from './repositoryChatStorage';
import { organizationUnderstandingSchema } from './aiOrganizationDualSchema';
import { organizationFingerprint } from './aiOrganizationDual';
import { agyProfileIdentity } from './agyProfiles';
import { assertRepositoryIdentityWritable } from './repositoryIdentityGate';

const STORE = 'organizationUnderstandingCache';
const MAX_AGE = 90 * 86400000;
const MAX_BYTES = 20 * 1024 * 1024;
interface Entry { id: string; ownerId: string; signature: string; usedAt: number; bytes: number; row: OrganizationUnderstanding }
const signature = (repo: Repository, config: AIConfig, language: string) => JSON.stringify([
  1, organizationFingerprint(repo), config.id, config.provider, agyProfileIdentity(config, 'organization'), config.reasoningEffort, language,
]);
const key = (owner: string, repo: number, depth: OrganizationAnalysisDepth) => JSON.stringify([owner, repo, depth]);
const value = <T>(request: IDBRequest<T>) => new Promise<T>((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });

/** Derived facts only: intentionally excluded from conversation exports and Home projections. */
export class OrganizationUnderstandingCache {
  private entries = new Map<string, Entry>();
  async load(ownerId: string): Promise<void> {
    try {
      const db = await openRepositoryChatDatabase();
      try {
        const rows = await value<Entry[]>(db.transaction(STORE).objectStore(STORE).index('ownerId').getAll(ownerId));
        for (const entry of rows) if (entry.usedAt > Date.now() - MAX_AGE && organizationUnderstandingSchema.safeParse(entry.row).success) this.entries.set(entry.id, entry);
      } finally { db.close(); }
    } catch { /* A cache failure must not make the task or its checkpoints unavailable. */ }
  }
  get(owner: string, repo: Repository, config: AIConfig, language: string, depth: OrganizationAnalysisDepth): OrganizationUnderstanding | undefined {
    for (const candidate of depth === 'quick' ? ['deep', 'quick'] as const : ['deep'] as const) {
      const entry = this.entries.get(key(owner, repo.id, candidate));
      if (!entry || entry.signature !== signature(repo, config, language) || entry.row.status !== 'understood') continue;
      if (depth === 'deep' && (!repo.pushed_at || entry.row.depth !== 'deep' || entry.row.staleAnalysis)) continue;
      entry.usedAt = Date.now();
      return { ...structuredClone(entry.row), reused: true, activity: undefined };
    }
  }
  async put(ownerId: string, repo: Repository, config: AIConfig, language: string, row: OrganizationUnderstanding): Promise<void> {
    if (row.status !== 'understood' || !row.depth) return;
    const clean = structuredClone(row); delete clean.activity; delete clean.reused;
    const entry: Entry = { id: key(ownerId, repo.id, row.depth), ownerId, signature: signature(repo, config, language), usedAt: Date.now(), bytes: 0, row: clean };
    entry.bytes = new TextEncoder().encode(JSON.stringify(entry)).byteLength;
    this.entries.set(entry.id, entry);
    await this.persist(entry);
  }
  async touch(owner: string, repo: Repository, depth: OrganizationAnalysisDepth): Promise<void> {
    const entry = this.entries.get(key(owner, repo.id, depth)); if (entry) await this.persist(entry);
  }
  private async persist(entry: Entry): Promise<void> {
    try {
      assertRepositoryIdentityWritable();
      const db = await openRepositoryChatDatabase();
      try {
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(STORE, 'readwrite'); const store = tx.objectStore(STORE);
          tx.oncomplete = () => resolve(); tx.onerror = tx.onabort = () => reject(tx.error);
          store.put(entry);
          const read = store.getAll();
          read.onsuccess = () => {
            try { assertRepositoryIdentityWritable(); } catch { tx.abort(); return; }
            const rows = (read.result as Entry[]).sort((a, b) => b.usedAt - a.usedAt);
            const counts = new Map<string, number>(); let bytes = 0;
            for (const row of rows) {
              const count = (counts.get(row.ownerId) ?? 0) + 1;
              if (row.usedAt < Date.now() - MAX_AGE || count > 2000 || bytes + row.bytes > MAX_BYTES) store.delete(row.id);
              else { counts.set(row.ownerId, count); bytes += row.bytes; }
            }
          };
        });
      } finally { db.close(); }
    } catch { /* Derived data is optional; the independently saved proposal remains authoritative. */ }
  }
}
