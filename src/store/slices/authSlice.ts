import { logger } from '../../services/logger';
import { resetSyncHashes } from '../../services/autoSync';
import type { AppStoreSlice } from '../types';
import { accountIdKey, applyAccountWorkspace, captureAccountWorkspace, switchAccountWorkspace } from '../helpers/accountWorkspace';
import { clearAuthMirror, writeAuthMirror, writeSessionBackendSecret } from '../persistence/authStorage';
import { normalizeDiscoveryChannels, externalChannelSelection } from '../helpers/discoveryChannels';
import { isExternalDiscoveryChannelId } from '../../services/externalFeedConfig';
import type { AppStoreState } from '../types';

const switchExternalFeeds = (state: AppStoreState, accountId: string | null): Partial<AppStoreState> => {
  const channels = normalizeDiscoveryChannels([
    ...state.discoveryChannels.filter(channel => !isExternalDiscoveryChannelId(channel.id)),
    ...(accountId ? state.accountWorkspaces[accountId]?.externalDiscoveryChannels ?? [] : []),
  ]);
  const builtinsOnly = <T,>(map: Record<string, T>): Record<string, T> =>
    Object.fromEntries(Object.entries(map).filter(([id]) => !isExternalDiscoveryChannelId(id)));
  return {
    discoveryChannels: channels,
    selectedDiscoveryChannel: externalChannelSelection(channels, state.selectedDiscoveryChannel),
    discoveryRepos: builtinsOnly(state.discoveryRepos),
    discoveryLastRefresh: builtinsOnly(state.discoveryLastRefresh),
    discoveryIsLoading: builtinsOnly(state.discoveryIsLoading),
    discoveryIsLoadingMore: builtinsOnly(state.discoveryIsLoadingMore),
    discoveryLoadMoreError: builtinsOnly(state.discoveryLoadMoreError),
    discoveryHasMore: builtinsOnly(state.discoveryHasMore),
    discoveryNextPage: builtinsOnly(state.discoveryNextPage),
    discoveryTotalCount: builtinsOnly(state.discoveryTotalCount),
    discoveryScrollPositions: builtinsOnly(state.discoveryScrollPositions),
  };
};

export const createAuthSlice: AppStoreSlice<Pick<import('../types').AppActions, 'setUser' | 'setGitHubToken' | 'setBackendApiSecret' | 'logout'>> = (set, get) => ({
      setUser: (user) => {
        logger.info('store.setUser', 'Setting user', { hasUser: !!user, userId: user?.id ?? null });
        const current = get();
        const previousAccountId = accountIdKey(current.user);
        const nextAccountId = accountIdKey(user);
        if (user && nextAccountId) {
          const switched = switchAccountWorkspace(current, previousAccountId, nextAccountId);
          set({
            user,
            isAuthenticated: true,
            accountWorkspaces: switched.accountWorkspaces,
            ...(switched.workspace ?? {}),
            ...(previousAccountId !== nextAccountId ? switchExternalFeeds(current, nextAccountId) : {}),
          });
        } else {
          set({ user, isAuthenticated: !!user });
        }
        const { githubToken, backendApiSecret } = get();
        writeAuthMirror({ user, githubToken, backendApiSecret });
      },
      setGitHubToken: (token) => {
        logger.info('store.setGitHubToken', 'Setting GitHub token', { hasToken: !!token });
        set({ githubToken: token });
        const { user, backendApiSecret } = get();
        writeAuthMirror({ user, githubToken: token, backendApiSecret });
      },
      setBackendApiSecret: (backendApiSecret) => {
        writeSessionBackendSecret(backendApiSecret);
        set({ backendApiSecret });
        const { user, githubToken } = get();
        writeAuthMirror({ user, githubToken, backendApiSecret });
      },
      logout: () => {
        // Credential teardown only. Snapshot the GitHub-id workspace first, then
        // park the live lists so the login screen cannot inherit another account.
        const current = get();
        const accountId = accountIdKey(current.user);
        const accountWorkspaces = accountId
          ? { ...current.accountWorkspaces, [accountId]: captureAccountWorkspace(current) }
          : current.accountWorkspaces;
        clearAuthMirror();
        writeSessionBackendSecret(null);
        // Reset sync fingerprints so the next force sync (e.g. backend
        // login restore) applies every shard even if the backend data has
        // not changed since this session.
        resetSyncHashes();
        set({
          user: null,
          githubToken: null,
          backendApiSecret: null,
          isAuthenticated: false,
          accountWorkspaces,
          ...applyAccountWorkspace(undefined),
          ...switchExternalFeeds(current, null),
        });
      },

});
