import { z } from 'zod';
import type { DiscoveryRepo } from '../../../types';

export interface DiscoveryReadingPreferences {
  resumeReading: boolean;
  loading: 'manual' | 'auto';
  batchSize: 20 | 50 | 100;
  autoAnalyze: boolean;
  autoAnalysisLimit: number;
}
export const readingPreferencesSchema = z.object({
  resumeReading: z.boolean().default(true), loading: z.enum(['manual', 'auto']).default('manual'),
  batchSize: z.union([z.literal(20), z.literal(50), z.literal(100)]).default(20),
  autoAnalyze: z.boolean().default(false), autoAnalysisLimit: z.number().int().min(1).max(10).default(10),
});
export const defaultReadingPreferences = (): DiscoveryReadingPreferences => readingPreferencesSchema.parse({});

export const anchorSchema = z.object({
  sessionKey: z.string().min(1), itemKey: z.string().min(1), offset: z.number().finite(),
  previousKeys: z.array(z.string()).max(10).default([]), updatedAt: z.number().finite(),
});
export type DiscoveryReadingAnchor = z.infer<typeof anchorSchema>;
export const browseSessionSchema = z.object({
  key: z.string().min(1), channelId: z.string().min(1), signature: z.string(),
  itemKeys: z.array(z.string()), bufferKeys: z.array(z.string()).default([]),
  nextPage: z.number().int().min(1), hasMore: z.boolean(), totalCount: z.number().nonnegative(),
  refreshedAt: z.string().nullable(), version: z.number().int().nonnegative(), updatedAt: z.number().finite(),
});
export type DiscoveryBrowseSession = z.infer<typeof browseSessionSchema>;
export interface DiscoveryProjectRecord { key: string; sessionKey: string; value: Record<string, unknown> }
export interface DiscoveryRankingStage {
  key: string; channelId: string; signature: string; baseVersion: number;
  mode: 'refresh' | 'reorder';
  targetCount: number; nextPage: number; projectKeys: string[]; hasMore: boolean; totalCount: number;
}
export interface DiscoveryWorkspaceSnapshot {
  version: 1; accountId: string;
  sessions: DiscoveryBrowseSession[]; projects: DiscoveryProjectRecord[];
  preferences: { channelId: string; value: DiscoveryReadingPreferences }[];
  anchors: DiscoveryReadingAnchor[]; stages: DiscoveryRankingStage[];
}
export const workspaceSessionKey = (channelId: string, signature: string) => JSON.stringify([channelId, signature]);
export function discoveryItemKey(repo: DiscoveryRepo): string {
  if (repo.xTweet) return `x:${repo.xTweet.tweetId}:repo:${repo.id}`;
  if (repo.telegram) return `telegram:${repo.telegram.messageId}:repo:${repo.id}`;
  if (repo.weeklyIssue) return `weekly:${repo.weeklyIssue.html_url}:repo:${repo.id}`;
  return `repo:${repo.id}`;
}
export const codeItemKey = (hit: { repo: string; branch: string; path: string }) =>
  `code:${JSON.stringify([hit.repo, hit.branch, hit.path])}`;

export function mergeStableItems<T>(existing: T[], incoming: T[], identify: (item: T) => string): T[] {
  const values = new Map(existing.map(item => [identify(item), item]));
  for (const item of incoming) values.set(identify(item), item);
  return [...values.values()];
}
