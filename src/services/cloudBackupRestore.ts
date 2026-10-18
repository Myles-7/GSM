import { z } from 'zod';
import type { AppStoreState } from '../store/types';
import type { AIConfig, WebDAVConfig } from '../types';
import { assertLocalBackupIdentity, decodeLocalBackup, type LocalBackup, type BackupIdentity } from './localBackup';
import { planLocalBackupRestore, RELEASE_BACKUP_KEYS, restoreScopeSnapshot, safeBackupTypes, type LocalRestorePlan } from './localBackupRestorePlan';
import { exportDiscoveryWorkspaceBackup, validateDiscoveryWorkspaceBackup } from './discoveryWorkspaceBackup';
import type { RestoreConfigurationLane } from './localBackupRestore';
import { restoreAIConfigs } from '../utils/aiConfig';

const id = z.number().int().positive().safe();
const text = z.string();
const endpoint = text.refine(value => { try { return ['http:', 'https:'].includes(new URL(value).protocol); } catch { return false; } }, 'BACKUP_INVALID_ENDPOINT');
const aiBase = z.object({ id: text.min(1), name: text, model: text, isActive: z.boolean(), provider: z.enum(['http', 'agy-cli']).optional() }).passthrough();
const ai = z.union([
  aiBase.extend({ provider: z.literal('agy-cli'), agyEffort: z.enum(['low', 'medium', 'high', 'max']), agyMode: z.enum(['model', 'research']), deviceBound: z.boolean() }),
  aiBase.extend({ provider: z.literal('http').optional(), baseUrl: endpoint, apiKey: text }),
]);
const dav = z.object({ id: text.min(1), name: text, url: endpoint, username: text, password: text, path: text, isActive: z.boolean() }).passthrough();
const proxy = z.object({ enabled: z.boolean(), type: z.enum(['http', 'socks5']), host: text, port: z.number().int().min(1).max(65535), username: text.optional(), password: text.optional() }).passthrough();
const rpc = z.object({ enabled: z.boolean(), host: text, port: z.number().int().min(1).max(65535), secret: text.optional() }).passthrough();
const releaseRepo = z.object({ id, name: text, full_name: text.regex(/^[^/\\\s]+\/[^/\\\s]+$/) }).passthrough();
const release = z.object({ id, tag_name: text, name: text.nullable(), body: text.nullable(), published_at: text, html_url: text,
  repository: releaseRepo, assets: z.array(z.object({ id, name: text, size: z.number().nonnegative(), download_count: z.number().nonnegative(), browser_download_url: text, content_type: text, created_at: text, updated_at: text }).passthrough()) }).passthrough();
const sourceRepo = releaseRepo.extend({ html_url: text, owner: z.object({ login: text, avatar_url: text }) }).passthrough();
const sourceSettings = z.object({ enabledSourceIds: z.array(z.enum(['starred-release-subscription', 'watch-custom-release', 'custom-release'])), watchCustomReleaseRepos: z.array(sourceRepo), customReleaseRepos: z.array(sourceRepo) });
const unique = (rows: { id: string | number }[]) => { if (new Set(rows.map(row => row.id)).size !== rows.length) throw new Error('BACKUP_DUPLICATE_ID'); };

/** Old flat cloud files use exactly the same decoder; absence of a version is not a validation bypass. */
export function decodeCloudBackup(content: string): LocalBackup {
  if (new TextEncoder().encode(content).byteLength > 20 * 1024 * 1024) throw new Error('BACKUP_TOO_LARGE');
  const raw = z.record(z.string(), z.unknown()).parse(JSON.parse(content));
  return decodeLocalBackup(raw.version === undefined ? JSON.stringify({ ...raw, version: '1.2' }) : content);
}

function configurationLane(state: AppStoreState, data: LocalBackup['data']): RestoreConfigurationLane | undefined {
  const after: Partial<AppStoreState> = {};
  const includeKeys = data.includeKeysInBackup ?? true;
  if (data.aiConfigs !== undefined) {
    const incoming = z.array(ai).parse(data.aiConfigs);
    unique(incoming);
    after.aiConfigs = restoreAIConfigs(state.aiConfigs, incoming as AIConfig[], includeKeys);
    if (!after.aiConfigs.some(config => config.id === state.activeAIConfig)) after.activeAIConfig = null;
    if (!after.aiConfigs.some(config => config.id === state.repositoryChatSettings.chatConfigId)) after.repositoryChatSettings = { ...state.repositoryChatSettings, chatConfigId: null };
  }
  if (data.webdavConfigs !== undefined) {
    const incoming = z.array(dav).parse(data.webdavConfigs);
    unique(incoming);
    after.webdavConfigs = incoming.map(config => {
      const existing = state.webdavConfigs.find(row => row.id === config.id);
      return { ...config, password: includeKeys && config.password !== '***' && config.password ? config.password : existing?.password ?? '', isActive: existing?.isActive ?? false } as WebDAVConfig;
    });
    if (!after.webdavConfigs.some(config => config.id === state.activeWebDAVConfig)) after.activeWebDAVConfig = null;
  }
  if (data.proxyConfig !== undefined) {
    const incoming = proxy.parse(data.proxyConfig);
    after.proxyConfig = { ...incoming, password: includeKeys && incoming.password && incoming.password !== '***' ? incoming.password : state.proxyConfig.password };
  }
  if (data.rpcDownloadConfig !== undefined) {
    const incoming = rpc.parse(data.rpcDownloadConfig);
    after.rpcDownloadConfig = { ...incoming, secret: includeKeys && incoming.secret && incoming.secret !== '***' ? incoming.secret : state.rpcDownloadConfig.secret };
  }
  if (includeKeys && data.backendApiSecret !== undefined && data.backendApiSecret !== '***') after.backendApiSecret = data.backendApiSecret;
  const keys = Object.keys(after);
  return keys.length ? { before: Object.fromEntries(keys.map(key => [key, state[key as keyof AppStoreState]])), after } : undefined;
}

/** All lanes are preflighted before capturing a pre-image or invoking any writer. */
export async function planCloudBackupRestore(state: AppStoreState, backup: LocalBackup, identity: BackupIdentity, legacyConfirmed: boolean): Promise<{ plan: LocalRestorePlan; configuration?: RestoreConfigurationLane }> {
  if (!backup.identity && !legacyConfirmed) throw new Error('BACKUP_LEGACY_IDENTITY_CONFIRMATION_REQUIRED');
  assertLocalBackupIdentity(backup, identity);
  const data = backup.data;
  const selected = safeBackupTypes(data);
  const configuration = configurationLane(state, data);
  const discovery = validateDiscoveryWorkspaceBackup(identity.githubUserId ?? '', data.discoveryWorkspace);
  if ((RELEASE_BACKUP_KEYS.some(key => data[key] !== undefined) || discovery) && !identity.githubUserId) throw new Error('BACKUP_ACCOUNT_REQUIRED');
  if (data.releases !== undefined) unique(z.array(release).parse(data.releases));
  if (data.releaseSourceSettings !== undefined) sourceSettings.parse(data.releaseSourceSettings);
  const plan = selected.length ? planLocalBackupRestore(state, backup, selected, 'replace', identity, legacyConfirmed)
    : { identity, mode: 'replace' as const, keys: [], before: {}, after: {}, summary: '' };
  for (const key of [...RELEASE_BACKUP_KEYS, 'routeMode'] as const) {
    if (data[key] !== undefined) { plan.keys.push(key); plan.after[key] = data[key]; }
  }
  plan.before = restoreScopeSnapshot(state, plan.keys);
  if (discovery) {
    const exported = await exportDiscoveryWorkspaceBackup(identity.githubUserId!);
    const before = { ...exported };
    for (const key of ['workspace', 'analyses', 'customDiscovery'] as const) {
      if (discovery[key] === undefined) delete before[key];
      else if (before[key] === undefined) throw new Error('BACKUP_DISCOVERY_PREIMAGE_UNAVAILABLE');
    }
    plan.discovery = { before, after: discovery };
  }
  if (!plan.keys.length && !discovery && !configuration) throw new Error('BACKUP_NOTHING_SELECTED');
  plan.summary = JSON.stringify({ mode: 'replace', fields: plan.keys, business: plan.summary ? JSON.parse(plan.summary) : undefined, discovery: !!discovery, configuration: configuration ? 'session-only; review after interrupted restore' : undefined }, null, 2);
  return { plan, configuration };
}
