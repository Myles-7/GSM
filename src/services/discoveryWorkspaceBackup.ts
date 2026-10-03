import { z } from 'zod';
import { planSchema, overrideSchema, editionKey, type ChannelDailyEdition, type CustomDiscoveryData } from '../features/discovery/custom/model';
import { validateDiscoveryWorkspace } from '../features/discovery/workspace/storage';
import type { DiscoveryWorkspaceSnapshot } from '../features/discovery/workspace/model';
import { validateRepositoryAnalysisAssets } from './repositoryAnalysisAssets';
import { validateRepositoryIdentityMappings, type RepositoryIdentityMapping } from '../utils/repositoryIdentity';

const text = z.string().min(1);
const id = z.number().int().positive().safe();
const repositorySchema = z.object({ id, full_name: text.regex(/^[^/\\\s]+\/[^/\\\s]+$/) }).passthrough();
const assessmentSchema = z.object({
  repo: repositorySchema, verdict: z.enum(['match', 'unknown']), reason: z.string(), evidence: z.array(z.string()),
  method: z.enum(['rules', 'ai']), relevance: z.number().finite(), preference: z.number().finite(),
  screening: z.boolean().optional(), relation: z.enum(['direct', 'ecosystem']).optional(),
  acceptance: z.object({ sourceEditionKey: text, sourceRevision: z.number().int(), acceptedAt: text }).optional(),
});
const channelSchema = z.object({
  id: z.string().startsWith('custom:'), name: text, instruction: z.string(), revision: z.number().int().positive(),
  plan: z.lazy(() => planSchema), ruleOverrides: z.lazy(() => overrideSchema).optional(), enabled: z.boolean(), paused: z.boolean(),
  ai: z.boolean(), autoAnalyze: z.boolean().optional(), limit: z.number().int().positive(),
  hour: z.number().int().min(0).max(23), cursors: z.array(z.number().int().nonnegative()),
  blocked: z.array(id), read: z.array(id), recommended: z.record(z.string(), z.string()),
  manualAccepted: z.record(z.string(), z.string()).optional(), lastCompletedDate: z.string().optional(),
  lastRefresh: z.string().optional(),
});
const effectiveRulesSchema = z.object({
  plan: z.lazy(() => planSchema), sort: z.enum(['relevance', 'stars', 'updated']), scope: z.enum(['metadata', 'readme', 'all']).optional(),
  excludeArchived: z.boolean(), excludeForks: z.boolean(), excludeStarred: z.boolean(), excludeRecommended: z.boolean(),
});
const editionSchema = z.object({
  channelId: z.string().startsWith('custom:'), date: text, revision: z.number().int().positive(), instruction: z.string(),
  entries: z.array(assessmentSchema), pending: z.array(assessmentSchema), errors: z.array(z.string()),
  complete: z.boolean(), searched: z.number().int().nonnegative(), filtered: z.number().int().nonnegative(),
  generatedAt: text, ruleSnapshot: effectiveRulesSchema.optional(),
});
const customSchema = z.object({
  channels: z.array(channelSchema), editions: z.array(editionSchema),
  builtinPreferences: z.record(z.string(), z.object({ autoAnalyze: z.boolean().optional(), prereleases: z.boolean().optional() })).optional(),
});
const analysesSchema = z.object({
  version: z.literal(1), accountId: text, assets: z.array(z.unknown()),
});
type AnalysisBackup = ReturnType<typeof validateRepositoryAnalysisAssets>;
type CustomBackup = z.infer<typeof customSchema>;
export interface DiscoveryWorkspaceBackup {
  version: 1;
  accountId: string;
  workspace?: DiscoveryWorkspaceSnapshot;
  analyses?: AnalysisBackup;
  customDiscovery?: CustomBackup;
}

const privateFields = /^(?:.*(?:token|credential|password|secret|authorization|cookie).*|(?:api|access|private)[_-]?key|ct0|leases?(?:[_A-Z].*)?|tasks?(?:[_A-Z].*)?|runtime|controller|expires|retryAt|issues)$/i;
function portable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(portable);
  if (value && typeof value === 'object') return Object.fromEntries(
    Object.entries(value).filter(([key]) => !privateFields.test(key))
      .map(([key, item]) => [key, portable(item)]),
  );
  return value;
}
function accountRequired(account: string) {
  if (!account?.trim()) throw new Error('DISCOVERY_BACKUP_ACCOUNT_REQUIRED');
}
function unique<T>(items: T[], key: (item: T) => string) {
  if (new Set(items.map(key)).size !== items.length) throw new Error('DISCOVERY_BACKUP_DUPLICATE_RECORD');
}
function canonicalize(backup: DiscoveryWorkspaceBackup) {
  const sort = <T>(items: T[], key: (item: T) => string) => items.sort((a, b) => key(a).localeCompare(key(b)));
  if (backup.workspace) {
    sort(backup.workspace.sessions, row => row.key);
    sort(backup.workspace.projects, row => JSON.stringify([row.sessionKey, row.key]));
    sort(backup.workspace.preferences, row => row.channelId);
    sort(backup.workspace.anchors, row => row.sessionKey);
  }
  if (backup.analyses) sort(backup.analyses.assets, row => JSON.stringify([row.repositoryId, row.language]));
  return backup;
}

/** Validate every present block before any storage service is allowed to write. */
export function validateDiscoveryWorkspaceBackup(account: string, payload: unknown): DiscoveryWorkspaceBackup | undefined {
  if (payload === undefined) return undefined;
  accountRequired(account);
  const parsed = z.object({ version: z.literal(1), accountId: text,
    workspace: z.unknown().optional(), analyses: analysesSchema.optional(), customDiscovery: customSchema.optional(),
  }).parse(portable(payload));
  if (parsed.accountId !== account || parsed.analyses?.accountId !== undefined && parsed.analyses.accountId !== account) {
    throw new Error('DISCOVERY_BACKUP_ACCOUNT_CONFLICT');
  }
  const result: DiscoveryWorkspaceBackup = { version: 1, accountId: account };
  if (parsed.workspace !== undefined) {
    const workspace = validateDiscoveryWorkspace(account, parsed.workspace);
    unique(workspace.sessions, row => row.key);
    unique(workspace.projects, row => JSON.stringify([row.sessionKey, row.key]));
    unique(workspace.preferences, row => row.channelId);
    unique(workspace.anchors, row => row.sessionKey);
    for (const session of workspace.sessions) unique([...session.itemKeys, ...session.bufferKeys], key => key);
    for (const project of workspace.projects) {
      if (!project.key.trim() || !project.sessionKey.trim()) throw new Error('DISCOVERY_BACKUP_INVALID_PROJECT');
      const repositoryKey = project.key.match(/repo:(\d+)$/);
      if (repositoryKey) {
        const repository = repositorySchema.parse(project.value);
        if (repository.id !== Number(repositoryKey[1])) throw new Error('DISCOVERY_BACKUP_INVALID_PROJECT_IDENTITY');
      }
      else if (project.key.startsWith('code:')) z.object({ repo: text, branch: text, path: text }).parse(project.value);
      else if (!Object.keys(project.value).length) throw new Error('DISCOVERY_BACKUP_INVALID_PROJECT');
    }
    result.workspace = workspace;
  }
  if (parsed.analyses) {
    if (parsed.analyses.assets.some(asset => asset && typeof asset === 'object'
      && 'accountId' in asset && asset.accountId !== account)) throw new Error('DISCOVERY_BACKUP_ACCOUNT_CONFLICT');
    result.analyses = validateRepositoryAnalysisAssets(account, parsed.analyses);
  }
  if (parsed.customDiscovery) {
    unique(parsed.customDiscovery.channels, row => row.id);
    unique(parsed.customDiscovery.editions, row => JSON.stringify([row.channelId, editionKey(row as unknown as ChannelDailyEdition)]));
    result.customDiscovery = parsed.customDiscovery;
  }
  return canonicalize(result);
}

export async function exportDiscoveryWorkspaceBackup(account: string, includeCustom = true): Promise<DiscoveryWorkspaceBackup> {
  accountRequired(account);
  const [{ exportDiscoveryWorkspace }, { exportRepositoryAnalysisAssets }, { loadData }] = await Promise.all([
    import('../features/discovery/workspace/storage'), import('./repositoryAnalysisAssets'), import('../features/discovery/custom/storage'),
  ]);
  const [workspace, analyses, customDiscovery] = await Promise.all([
    typeof indexedDB === 'undefined' ? undefined : exportDiscoveryWorkspace(account),
    exportRepositoryAnalysisAssets(account), includeCustom ? loadData(account) : undefined,
  ]);
  return validateDiscoveryWorkspaceBackup(account, { version: 1, accountId: account, workspace, analyses, customDiscovery })!;
}

export async function importDiscoveryWorkspaceBackup(account: string, payload: unknown, mode: 'merge' | 'replace', migration = false): Promise<void> {
  const backup = validateDiscoveryWorkspaceBackup(account, payload);
  if (!backup) return;
  if (mode !== 'merge' && mode !== 'replace') throw new Error('DISCOVERY_BACKUP_INVALID_MODE');
  const [{ importDiscoveryWorkspace }, { importRepositoryAnalysisAssets }, { transact }] = await Promise.all([
    import('../features/discovery/workspace/storage'), import('./repositoryAnalysisAssets'), import('../features/discovery/custom/storage'),
  ]);
  if (backup.workspace) await importDiscoveryWorkspace(account, backup.workspace, mode, migration);
  if (backup.analyses) await importRepositoryAnalysisAssets(account, backup.analyses, mode, migration);
  if (backup.customDiscovery) await transact(account, current => {
    const incoming = backup.customDiscovery!;
    if (mode === 'replace') {
      // Keep legacy completed analyses: this backup block contains channel history only.
      current.channels = incoming.channels as CustomDiscoveryData['channels'];
      current.editions = incoming.editions as unknown as CustomDiscoveryData['editions'];
      current.builtinPreferences = incoming.builtinPreferences;
    } else {
      const channelIds = new Set<string>(current.channels.map(row => row.id));
      const editions = new Set(current.editions.map(row => JSON.stringify([row.channelId, editionKey(row)])));
      current.channels.push(...incoming.channels.filter(row => !channelIds.has(row.id)) as CustomDiscoveryData['channels']);
      current.editions.push(...incoming.editions.filter(row => !editions.has(JSON.stringify([row.channelId, editionKey(row as unknown as ChannelDailyEdition)]))) as unknown as CustomDiscoveryData['editions']);
      current.builtinPreferences = { ...incoming.builtinPreferences, ...current.builtinPreferences };
    }
  });
}

/** Also used by the coordinator's synchronous recovery fingerprint preview. */
export function remapDiscoveryWorkspaceBackup(backup: DiscoveryWorkspaceBackup, mappings: readonly RepositoryIdentityMapping[]): number {
  validateRepositoryIdentityMappings(mappings);
  let changed = 0;
  const workspace = backup.workspace;
  if (workspace) {
    const remapped = new Map<string, string>();
    for (const project of workspace.projects) {
      const named = mappings.find(row => typeof project.value.full_name === 'string'
        && row.fullName.toLowerCase() === project.value.full_name.toLowerCase());
      if (named && project.value.id !== named.oldId && project.value.id !== named.newId) throw new Error('DISCOVERY_WORKSPACE_IDENTITY_CONFLICT');
      const canonical = mappings.find(row => row.newId === project.value.id);
      if (canonical && (typeof project.value.full_name !== 'string'
        || project.value.full_name.toLowerCase() !== canonical.fullName.toLowerCase())) throw new Error('DISCOVERY_WORKSPACE_IDENTITY_CONFLICT');
      const mapping = mappings.find(row => row.oldId === project.value.id);
      if (!mapping) continue;
      if (typeof project.value.full_name !== 'string' || project.value.full_name.toLowerCase() !== mapping.fullName.toLowerCase()) {
        throw new Error('DISCOVERY_WORKSPACE_IDENTITY_CONFLICT');
      }
      const old = project.key;
      project.key = old.replace(/repo:\d+$/, `repo:${mapping.newId}`);
      project.value.id = mapping.newId;
      remapped.set(JSON.stringify([project.sessionKey, old]), project.key);
      changed++;
    }
    unique(workspace.projects, row => JSON.stringify([row.sessionKey, row.key]));
    const key = (session: string, value: string) => remapped.get(JSON.stringify([session, value])) ?? value;
    for (const session of workspace.sessions) {
      session.itemKeys = session.itemKeys.map(value => key(session.key, value));
      session.bufferKeys = session.bufferKeys.map(value => key(session.key, value));
    }
    for (const anchor of workspace.anchors) {
      anchor.itemKey = key(anchor.sessionKey, anchor.itemKey);
      anchor.previousKeys = anchor.previousKeys.map(value => key(anchor.sessionKey, value));
    }
  }
  if (backup.analyses) {
    const normalized = validateRepositoryAnalysisAssets(backup.accountId, backup.analyses);
    const key = (asset: AnalysisBackup['assets'][number]) => JSON.stringify([asset.repositoryId, asset.language]);
    const assets = new Map(normalized.assets.map(asset => [key(asset), asset]));
    for (const mapping of mappings) {
      for (const [oldKey, asset] of [...assets]) {
        if (asset.repositoryId !== mapping.oldId) continue;
        if (asset.fullName && asset.fullName.toLowerCase() !== mapping.fullName.toLowerCase()) throw new Error('ANALYSIS_ASSET_IDENTITY_CONFLICT');
        const moved = { ...asset, repositoryId: mapping.newId, fullName: mapping.fullName };
        const target = assets.get(key(moved));
        if (target && (target.fullName.toLowerCase() !== mapping.fullName.toLowerCase()
          || JSON.stringify(target.details) !== JSON.stringify(asset.details))) throw new Error('ANALYSIS_ASSET_IDENTITY_COLLISION');
        assets.delete(oldKey);
        assets.set(key(moved), target && Date.parse(target.details.generated_at) >= Date.parse(moved.details.generated_at) ? target : moved);
        changed++;
      }
    }
    backup.analyses = { ...normalized, assets: [...assets.values()] };
  }
  canonicalize(backup);
  return changed;
}
