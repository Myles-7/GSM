import { useEffect, useRef } from "react";
import type { DiscoveryChannelId } from "../../../types";
import { useAppStore } from "../../../store/useAppStore";

export function useDiscoveryEntryLoading(
  identity: string,
  channelId: DiscoveryChannelId,
  enabled: boolean,
  refresh: (
    channel: DiscoveryChannelId,
    page?: number,
    append?: boolean,
  ) => unknown,
) {
  const attempts = useRef(new Set<DiscoveryChannelId>());
  useEffect(() => {
    attempts.current.clear();
  }, [identity]);
  useEffect(() => {
    if (!identity || !enabled || channelId === "code-search") return;
    const state = useAppStore.getState();
    if (
      state.discoveryRepos[channelId]?.length ||
      state.discoveryLastRefresh[channelId] ||
      state.discoveryIsLoading[channelId] ||
      state.discoveryLoadMoreError[channelId] ||
      attempts.current.has(channelId)
    )
      return;
    attempts.current.add(channelId);
    void refresh(channelId, 1, false);
  }, [identity, channelId, enabled, refresh]);
}
