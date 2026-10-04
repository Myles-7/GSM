import { useAppStore } from '../store/useAppStore';
import { indexedDBStorage } from './indexedDbStorage';
import { assertRepositoryIdentityWritable, assertRepositoryMaintenanceOwner, holdRepositoryIdentityWrites } from './repositoryIdentityGate';

export const localBackupJournalKey = (account: string) => `gsm-local-backup-journal:${account}`;
/** Tiny startup check; the full restore coordinator loads only from the backup UI. */
export async function hasPendingLocalBackupRestore(): Promise<boolean> {
  const owner = String(useAppStore.getState().user?.id ?? 'global');
  const text = await indexedDBStorage.getItem(localBackupJournalKey(owner));
  if (!text) return false;
  const journal = JSON.parse(text) as { version: number; account: string; id: string };
  if (journal.version !== 1 || journal.account !== owner || !journal.id?.startsWith('local-backup:')) throw new Error('BACKUP_JOURNAL_INVALID');
  try { assertRepositoryMaintenanceOwner(owner, journal.id); }
  catch { assertRepositoryIdentityWritable(); holdRepositoryIdentityWrites(owner, journal.id); }
  return true;
}
