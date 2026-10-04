import { useAppStore } from '../store/useAppStore';
import { getDesktopHomeSync } from '../home/desktop';
import { backend } from './backendAdapter';
import type { BackupIdentity } from './localBackup';

export function getLocalBackupIdentity(requireBusiness = false): BackupIdentity {
  const account = useAppStore.getState().user?.id;
  const home = getDesktopHomeSync();
  if (requireBusiness && (!account || (backend.configuredUrl && !home))) throw new Error('BACKUP_IDENTITY_NOT_READY');
  if (home && home.identity.githubUserId !== account) throw new Error('BACKUP_IDENTITY_MISMATCH');
  return { githubUserId: account ? String(account) : null, workspaceId: home?.identity.workspaceId ?? null };
}
