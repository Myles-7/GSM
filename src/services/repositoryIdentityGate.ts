const prefix = 'gsm:repository-identity-maintenance:';
const held = new Set<string>();
function hasPersistentGate(accountId?: string): boolean {
  try {
    if (typeof localStorage === 'undefined') return false;
    if (accountId) return localStorage.getItem(prefix + accountId) !== null;
    for (let index = 0; index < localStorage.length; index++) {
      if (localStorage.key(index)?.startsWith(prefix)) return true;
    }
    return false;
  } catch {
    throw new Error('REPOSITORY_IDENTITY_STORAGE_UNAVAILABLE');
  }
}
export function assertRepositoryIdentityWritable(accountId?: string): void {
  if (held.size || hasPersistentGate(accountId)) throw new Error('REPOSITORY_IDENTITY_MAINTENANCE_REQUIRED');
}
export function holdRepositoryIdentityWrites(accountId: string, journalId: string): void {
  // Synchronous marker makes a reload fail closed even before the next IDB checkpoint.
  if (typeof localStorage !== 'undefined') localStorage.setItem(prefix + accountId, journalId);
  held.add(accountId);
}
export function releaseRepositoryIdentityWrites(accountId: string): void {
  if (typeof localStorage !== 'undefined') localStorage.removeItem(prefix + accountId);
  held.delete(accountId);
}

/** A scoped maintenance writer must own the persistent gate, including after reload. */
export function assertRepositoryMaintenanceOwner(accountId: string, journalId: string): void {
  if (typeof localStorage === 'undefined' || localStorage.getItem(prefix + accountId) !== journalId) {
    throw new Error('REPOSITORY_MAINTENANCE_OWNER_MISMATCH');
  }
}
