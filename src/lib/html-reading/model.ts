import { z } from 'zod';

export const contentFields = {
  summary: 'AI 摘要', description: '原始项目描述', tags: '标签', category: '分类', language: '语言', stars: 'Star 数量', updated: '仓库更新时间', notes: '我的阅读笔记', reason: '发现推荐理由', release: '真实版本说明', sources: '来源链接与分析时间',
} as const;
export const analysisFields = { problem: '解决的问题', features: '主要功能', scenarios: '使用场景', architecture: '技术架构', quickstart: '快速开始', deployment: '部署方式', cost: '成本', maintenance: '维护情况' } as const;
export const operationFields = { read: '已读标记', interest: '感兴趣／忽略', note: '阅读笔记', candidate: '收藏候选' } as const;
export type ReadingField = keyof typeof operationFields;
const flags = <T extends Record<string, string>>(fields: T) => Object.fromEntries(Object.keys(fields).map(k => [k, true])) as Record<keyof T, boolean>;
const flagSchema = <T extends Record<string, string>>(fields: T) => z.object(Object.fromEntries(Object.keys(fields).map(k => [k, z.boolean()])) as Record<keyof T, z.ZodBoolean>).strict();
export const settingsSchema = z.object({
  version: z.literal(1), title: z.string().trim().min(1).max(80),
  repositories: z.boolean(), discovery: z.boolean(), categoryIds: z.array(z.string().max(100)).max(100),
  repositoryLimit: z.number().int().min(1).max(10000), repositorySort: z.enum(['stars', 'updated', 'name']),
  unreadOnly: z.boolean(), hideIgnored: z.boolean(),
  channelIds: z.array(z.string().max(150)).max(100), perChannel: z.number().int().min(1).max(500), historyDays: z.number().int().min(1).max(90),
  fields: flagSchema(contentFields), analysis: flagSchema(analysisFields), operations: flagSchema(operationFields),
  summaryChars: z.number().int().min(100).max(2000), theme: z.enum(['system', 'light', 'dark']), fontSize: z.enum(['14', '16', '18', '20']), density: z.enum(['compact', 'standard']),
  initialPage: z.enum(['repositories', 'discovery']), maxFileMb: z.number().int().min(1).max(15),
  scheduleEnabled: z.boolean(), sendTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), refreshBeforeSend: z.boolean(), waitForDiscovery: z.boolean().default(true),
}).strict();
export type ReadingSettings = z.infer<typeof settingsSchema>;
export const defaultSettings: ReadingSettings = {
  version: 1, title: 'GSM · 每日项目阅读', repositories: true, discovery: true, categoryIds: [], repositoryLimit: 5000, repositorySort: 'stars', unreadOnly: false, hideIgnored: true,
  channelIds: ['trending', 'most-popular', 'topic'], perChannel: 60, historyDays: 7,
  fields: { ...flags(contentFields), notes: false }, analysis: flags(analysisFields), operations: flags(operationFields),
  summaryChars: 600, theme: 'system', fontSize: '16', density: 'compact', initialPage: 'repositories', maxFileMb: 10,
  scheduleEnabled: false, sendTime: '08:00', refreshBeforeSend: true, waitForDiscovery: true,
};
export const readingStateSchema = z.object({ read: z.boolean(), interest: z.enum(['neutral', 'interested', 'ignored']), note: z.string().max(12000), candidate: z.boolean() }).strict();
export type ReadingState = z.infer<typeof readingStateSchema>;
export const emptyReadingState = (): ReadingState => ({ read: false, interest: 'neutral', note: '', candidate: false });
export interface ReadingItem {
  id: number; name: string; url: string; categoryId: string; category: string; summary: string; description: string; tags: string[]; language: string; stars: number; updated: string;
  analysis: Array<{ title: string; text: string }>; sources: Array<{ label: string; url: string }>; generatedAt: string; reason: string; release?: { tag: string; date: string; text: string; url: string };
  state: ReadingState;
}
export interface ReadingSection { id: string; title: string; updatedAt: string; warning?: string; items: ReadingItem[] }
export interface ReadingSnapshot { version: 1; id: string; accountId: string; generatedAt: string; title: string; settings: ReadingSettings; sections: ReadingSection[]; warnings?: string[] }
export const returnSchema = z.object({
  format: z.literal('gsm-reading-changes'), version: z.literal(1), accountId: z.string().regex(/^\d+$/), snapshotId: z.string().max(100),
  operations: z.array(z.object({ id: z.string().uuid(), repoId: z.number().int().positive(), field: z.enum(['read', 'interest', 'note', 'candidate']), base: z.union([z.boolean(), z.string().max(12000)]), value: z.union([z.boolean(), z.string().max(12000)]) }).strict()).max(20000),
}).strict();
export type ReadingReturn = z.infer<typeof returnSchema>;
export function parseReadingReturn(text: string): ReadingReturn {
  if (text.length > 4_000_000) throw new Error('回传内容超过 4 MB，请分批导出。');
  return returnSchema.parse(JSON.parse(text));
}
