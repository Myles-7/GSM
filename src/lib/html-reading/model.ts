import { z } from 'zod';

export const contentFields = {
  summary: 'AI 摘要', description: '原始项目描述', tags: '标签', category: '分类', language: '语言', stars: 'Star 数量', updated: '仓库更新时间', notes: '我的阅读笔记', reason: '发现推荐理由', release: '真实版本说明', sources: '来源链接与分析时间',
} as const;
export const analysisFields = { problem: '解决的问题', features: '主要功能', scenarios: '使用场景', architecture: '技术架构', quickstart: '快速开始', deployment: '部署方式', cost: '成本', maintenance: '维护情况' } as const;
export const operationFields = { read: '已读标记', interest: '感兴趣／忽略', note: '阅读笔记', candidate: '收藏候选' } as const;
export type ReadingField = keyof typeof operationFields;
const flags = <T extends Record<string, string>>(fields: T) => Object.fromEntries(Object.keys(fields).map(k => [k, true])) as Record<keyof T, boolean>;
const flagSchema = <T extends Record<string, string>>(fields: T) => z.object(Object.fromEntries(Object.keys(fields).map(k => [k, z.boolean()])) as Record<keyof T, z.ZodBoolean>).strict();
export const cardFields = { summary: '完整摘要／描述', description: '原始描述', category: '分类', tags: '标签', language: '语言', stars: 'Star', updated: '更新时间' } as const;
export const detailFields = { ...contentFields, ...analysisFields };
export type DetailField = keyof typeof detailFields;
export type DetailMode = 'expanded' | 'collapsed' | 'omit';
const detailKeys = Object.keys(detailFields) as [DetailField, ...DetailField[]];
const cardKeys = Object.keys(cardFields) as [keyof typeof cardFields, ...Array<keyof typeof cardFields>];
export const profileSchema = z.object({
  cardFields: z.array(z.enum(cardKeys)).max(cardKeys.length).refine(v => new Set(v).size === v.length).optional(),
  detailModes: z.partialRecord(z.enum(detailKeys), z.enum(['expanded', 'collapsed', 'omit'])).optional(),
  detailOrder: z.array(z.enum(detailKeys)).max(detailKeys.length).refine(v => new Set(v).size === v.length).optional(),
  perChannel: z.number().int().min(1).max(500).optional(),
  historyCount: z.number().int().min(1).max(90).optional(),
}).strict();
export type ReadingProfileOverride = z.infer<typeof profileSchema>;
export interface ReadingProfile { cardFields: Array<keyof typeof cardFields>; detailModes: Record<DetailField, DetailMode>; detailOrder: DetailField[]; perChannel: number; historyCount: number }
export const settingsSchema = z.object({
  version: z.literal(1), title: z.string().trim().min(1).max(80),
  repositories: z.boolean(), discovery: z.boolean(), categoryIds: z.array(z.string().max(100)).max(100),
  repositoryLimit: z.number().int().min(1).max(10000), repositorySort: z.enum(['stars', 'updated', 'name']),
  unreadOnly: z.boolean(), hideIgnored: z.boolean(),
  channelIds: z.array(z.string().max(150)).max(100), perChannel: z.number().int().min(1).max(500), historyDays: z.number().int().min(1).max(90),
  fields: flagSchema(contentFields), analysis: flagSchema(analysisFields), operations: flagSchema(operationFields),
  summaryChars: z.number().int().min(100).max(2000), summaryLines: z.union([z.literal(4), z.literal(6)]).default(6), theme: z.enum(['desktop', 'system', 'light', 'dark']), fontSize: z.enum(['14', '16', '18', '20']), density: z.enum(['compact', 'standard']),
  initialPage: z.enum(['repositories', 'discovery']), maxFileMb: z.number().int().min(1).max(15),
  scheduleEnabled: z.boolean(), sendTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), refreshBeforeSend: z.boolean(), waitForDiscovery: z.boolean().default(true),
  preset: z.enum(['browse', 'deep']).default('deep'), defaultProfile: profileSchema.default({}),
  repositoryProfile: profileSchema.default({}), discoveryProfile: profileSchema.default({}),
  channelProfiles: z.record(z.string().min(1).max(150), profileSchema).refine(v => Object.keys(v).length <= 100).default({}),
  autoRead: z.boolean().default(true),
  maxCacheAgeDays: z.number().int().min(1).max(7).default(7),
  retryMode: z.enum(['safe', 'manual', 'generation']).default('safe'),
  artifactRetentionDays: z.number().int().min(7).max(365).default(90),
}).strict();
export type ReadingSettings = z.infer<typeof settingsSchema>;
export const defaultSettings: ReadingSettings = {
  version: 1, title: 'GSM · 每日项目阅读', repositories: true, discovery: true, categoryIds: [], repositoryLimit: 5000, repositorySort: 'stars', unreadOnly: false, hideIgnored: true,
  channelIds: ['trending', 'most-popular', 'topic'], perChannel: 60, historyDays: 7,
  fields: { ...flags(contentFields), notes: false }, analysis: flags(analysisFields), operations: flags(operationFields),
  summaryChars: 600, summaryLines: 6, theme: 'desktop', fontSize: '16', density: 'compact', initialPage: 'repositories', maxFileMb: 10,
  scheduleEnabled: false, sendTime: '08:00', refreshBeforeSend: true, waitForDiscovery: true,
  preset: 'deep', defaultProfile: {}, repositoryProfile: {}, discoveryProfile: {}, channelProfiles: {}, autoRead: true,
  maxCacheAgeDays: 7, retryMode: 'safe', artifactRetentionDays: 90,
};
export function resolveReadingProfile(settings: ReadingSettings, sectionId: string): ReadingProfile {
  const detailModes = Object.fromEntries(detailKeys.map(key => [key, key in settings.fields ? settings.fields[key as keyof typeof contentFields] ? 'expanded' : 'omit' : settings.analysis[key as keyof typeof analysisFields] ? 'expanded' : 'omit'])) as Record<DetailField, DetailMode>;
  if (detailModes.description !== 'omit') detailModes.description = 'collapsed';
  if (detailModes.sources !== 'omit') detailModes.sources = 'collapsed';
  if (settings.preset === 'browse') for (const key of ['architecture', 'quickstart', 'deployment', 'cost', 'maintenance'] as const) if (detailModes[key] !== 'omit') detailModes[key] = 'collapsed';
  let profile: ReadingProfile = { cardFields: cardKeys.filter(key => key !== 'description' && settings.fields[key]), detailModes, detailOrder: [...detailKeys], perChannel: settings.perChannel, historyCount: 90 };
  for (const override of [settings.defaultProfile, sectionId === 'repositories' ? settings.repositoryProfile : settings.discoveryProfile, sectionId === 'repositories' ? undefined : settings.channelProfiles[sectionId]]) {
    if (!override) continue;
    profile = { ...profile, ...override, detailModes: { ...profile.detailModes, ...override.detailModes }, detailOrder: override.detailOrder ? [...override.detailOrder, ...detailKeys.filter(key => !override.detailOrder!.includes(key))] : profile.detailOrder };
  }
  return profile;
}
export function profileIncludes(profile: ReadingProfile, key: DetailField): boolean { return profile.detailModes[key] !== 'omit' || profile.cardFields.includes(key as keyof typeof cardFields); }
export function resetReadingPresentation(settings: ReadingSettings, preset: ReadingSettings['preset']): ReadingSettings {
  const keepCounts = (profile: ReadingProfileOverride): ReadingProfileOverride => ({ ...(profile.perChannel === undefined ? {} : { perChannel: profile.perChannel }), ...(profile.historyCount === undefined ? {} : { historyCount: profile.historyCount }) });
  return { ...settings, preset, defaultProfile: keepCounts(settings.defaultProfile), repositoryProfile: keepCounts(settings.repositoryProfile), discoveryProfile: keepCounts(settings.discoveryProfile), channelProfiles: Object.fromEntries(Object.entries(settings.channelProfiles).map(([id, profile]) => [id, keepCounts(profile)]).filter(([, profile]) => Object.keys(profile).length)) };
}
export const readingStateSchema = z.object({ read: z.boolean(), interest: z.enum(['neutral', 'interested', 'ignored']), note: z.string().max(12000), candidate: z.boolean() }).strict();
export type ReadingState = z.infer<typeof readingStateSchema>;
export const emptyReadingState = (): ReadingState => ({ read: false, interest: 'neutral', note: '', candidate: false });
export type ReadingAnalysisKey = keyof typeof analysisFields;
export interface ReadingAnalysisBlock {
  title: string; text: string; key?: ReadingAnalysisKey;
  kind?: 'text' | 'list' | 'steps'; values?: string[]; steps?: Array<{ description: string; command: string | null }>;
}
export interface ReadingRelease { tag: string; date: string; text: string; url: string }
export interface ReadingItem {
  id: number; name: string; url: string; categoryId: string; category: string; summary: string; description: string; tags: string[]; language: string; stars: number; updated: string;
  analysis: ReadingAnalysisBlock[]; sources: Array<{ label: string; url: string }>; generatedAt: string; reason: string; release?: ReadingRelease;
  state: ReadingState;
  hasSourceAnalysis?: boolean;
  dailyChange?: 'new' | 'analysis-updated';
  sourceProvenance?: { channelId: string; sourceSignature: string; fetchedAt: string; retained: boolean };
}
export interface ReadingEntry { repoId: number; reason?: string; release?: ReadingRelease }
export interface ReadingEdition { id: string; date: string; generatedAt: string; complete: boolean; warning?: string; availableCount?: number; entries: ReadingEntry[] }
export interface ReadingSection {
  id: string; title: string; updatedAt: string; warning?: string; items: ReadingItem[];
  kind?: 'repositories' | 'builtin' | 'custom'; entries?: ReadingEntry[]; editions?: ReadingEdition[];
  presentation?: ReadingProfile; targetCount?: number; availableCount?: number;
  sourceStatus?: 'cached' | 'updated' | 'partial' | 'empty' | 'unavailable'; fetchedCount?: number;
}
export interface ReadingTheme {
  presetId: string; label: string; mode: 'light' | 'dark'; light: Record<string, string>; dark: Record<string, string>;
  radius: string; shadow: string; fontSans: string; fontMono: string; reducedMotion: boolean;
}
export interface ReadingResume { viewId: string; repoId: number; notice?: string }
export interface ReadingSnapshot {
  version: 1 | 2; id: string; accountId: string; generatedAt: string; title: string; settings: ReadingSettings;
  sections: ReadingSection[]; warnings?: string[]; items?: Record<string, ReadingItem>; theme?: ReadingTheme;
  sequence?: number; resume?: ReadingResume[]; activeViewId?: string;
  comparisonIndex?: Record<string, string>; comparisonAvailable?: boolean;
}
const returnBase = {
  format: z.literal('gsm-reading-changes'), accountId: z.string().regex(/^\d+$/), snapshotId: z.string().min(1).max(100),
  operations: z.array(z.object({ id: z.string().uuid(), repoId: z.number().int().positive(), field: z.enum(['read', 'interest', 'note', 'candidate']), base: z.union([z.boolean(), z.string().max(12000)]), value: z.union([z.boolean(), z.string().max(12000)]) }).strict()).max(20000),
};
export const returnV1Schema = z.object({
  ...returnBase,
  format: z.literal('gsm-reading-changes'), version: z.literal(1), accountId: z.string().regex(/^\d+$/), snapshotId: z.string().max(100),
}).strict();
export const readingPositionSchema = z.object({ id: z.string().uuid(), viewId: z.string().min(1).max(600), repoId: z.number().int().positive(), revision: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER) }).strict();
export const returnV2Schema = z.object({
  ...returnBase, version: z.literal(2), positions: z.array(readingPositionSchema).max(1000),
  activeView: z.object({ id: z.string().uuid(), viewId: z.string().min(1).max(600), revision: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER) }).strict().nullable(),
}).strict();
export const returnSchema = z.discriminatedUnion('version', [returnV1Schema, returnV2Schema]);
export type ReadingReturn = z.infer<typeof returnSchema>;
export type ReadingPosition = z.infer<typeof readingPositionSchema>;
export function readingViewId(channelId: string, editionId?: string): string { return editionId ? `${channelId}::${encodeURIComponent(editionId)}` : channelId; }
export function snapshotItems(snapshot: ReadingSnapshot): ReadingItem[] { return snapshot.items ? Object.values(snapshot.items) : [...new Map(snapshot.sections.flatMap(s => s.items).map(item => [item.id, item])).values()]; }
export function snapshotViews(snapshot: ReadingSnapshot): Record<string, number[]> {
  const views: Record<string, number[]> = Object.create(null) as Record<string, number[]>;
  for (const section of snapshot.sections) {
    if (section.editions?.length) for (const edition of section.editions) views[readingViewId(section.id, edition.id)] = edition.entries.map(e => e.repoId);
    else views[section.id] = section.entries ? section.entries.map(e => e.repoId) : section.items.map(i => i.id);
  }
  return views;
}
export function parseReadingReturn(text: string): ReadingReturn {
  if (new Blob([text]).size > 4_000_000) throw new Error('回传内容超过 4 MB，请分批导出。');
  return returnSchema.parse(JSON.parse(text));
}
