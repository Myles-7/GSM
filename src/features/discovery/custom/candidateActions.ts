import {
  effectiveRules,
  editionKey,
  localDay,
  type CustomChannelId,
  type CustomDiscoveryData,
} from "./model";
import { updateCustomData } from "./store";

export interface ApprovalRequest {
  channelId: CustomChannelId;
  editionKey: string;
  repoId: number;
}

/** Copy a human decision into today; the source assessment is never mutated. */
export function approveInData(
  data: CustomDiscoveryData,
  request: ApprovalRequest,
  now = new Date(),
): boolean {
  const channel = data.channels.find((c) => c.id === request.channelId);
  const source = data.editions.find(
    (e) =>
      e.channelId === request.channelId && editionKey(e) === request.editionKey,
  );
  const candidate = source?.pending.find((a) => a.repo.id === request.repoId);
  if (!channel || !source || !candidate)
    throw new Error("INVALID_STALE_CANDIDATE");
  const date = localDay(now);
  if (
    channel.recommended[String(request.repoId)] === date ||
    data.editions.some(
      (e) =>
        e.channelId === channel.id &&
        e.date === date &&
        e.entries.some((a) => a.repo.id === request.repoId),
    )
  )
    return false;
  let today = data.editions.find(
    (e) =>
      e.channelId === channel.id &&
      e.date === date &&
      e.revision === channel.revision,
  );
  if (!today) {
    today = {
      channelId: channel.id,
      date,
      revision: channel.revision,
      instruction: channel.instruction,
      entries: [],
      pending: [],
      errors: [],
      complete: false,
      searched: 0,
      filtered: 0,
      generatedAt: now.toISOString(),
      ruleSnapshot: effectiveRules(channel.plan, channel.ruleOverrides),
    };
    data.editions.push(today);
  }
  today.entries.push({
    ...candidate,
    screening: undefined,
    acceptance: {
      sourceEditionKey: request.editionKey,
      sourceRevision: source.revision,
      acceptedAt: now.toISOString(),
    },
  });
  channel.recommended[String(request.repoId)] = date;
  channel.manualAccepted ??= {};
  channel.manualAccepted[String(request.repoId)] = date;
  channel.blocked = channel.blocked.filter((id) => id !== request.repoId);
  return true;
}

export const approveCandidate = (request: ApprovalRequest) =>
  updateCustomData((data) => {
    approveInData(data, request);
  });
export const blockCandidate = ({
  channelId,
  repoId,
  blocked = true,
}: {
  channelId: CustomChannelId;
  repoId: number;
  blocked?: boolean;
}) =>
  updateCustomData((data) => {
    const channel = data.channels.find((c) => c.id === channelId);
    if (!channel) throw new Error("INVALID_STALE_CHANNEL");
    channel.blocked = blocked
      ? [...new Set([...channel.blocked, repoId])]
      : channel.blocked.filter((id) => id !== repoId);
  });
