import type { HomeApi } from './api';

/** One-way migration from Electron safeStorage into the authenticated backend vault.
 * The caller must verify the active desktop account and Electron capability first.
 * Credentials are never returned, cached, projected, or added to sync records.
 */
export async function migrateDesktopXCredentials(
  api: Pick<HomeApi, 'request'>,
  identity: { workspaceId: string; githubUserId: number },
  readEncryptedAuth: () => Promise<{ authToken: string; ct0: string } | null>,
): Promise<boolean> {
  const query = new URLSearchParams({ workspaceId: identity.workspaceId, githubUserId: String(identity.githubUserId) });
  const status = await api.request<{ configured: boolean }>(`/discovery/x/credentials?${query}`);
  if (status.configured) return false;
  const auth = await readEncryptedAuth();
  if (!auth?.authToken || !auth.ct0) return false;
  await api.request('/discovery/x/credentials', { ...identity, authToken: auth.authToken, ct0: auth.ct0 });
  return true;
}
