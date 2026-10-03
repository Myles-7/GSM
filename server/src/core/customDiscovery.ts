// Pure desktop custom-discovery rule model, mirrored for the standalone server build.
import { z } from 'zod';
export type Repository = Record<string, unknown> & {id:number;full_name:string;description:string|null;topics:string[];language:string|null;stargazers_count:number;created_at:string;pushed_at:string};


const text = z.string().trim().min(1).max(240);
const term = z.string().trim().min(1).max(80).regex(/^[\p{L}\p{N} .+#/-]+$/u);
const condition = z.object({ text, source: text }).strict();
const retrievalSchema = z.object({
  sort: z.object({ value: z.enum(['relevance', 'stars', 'updated']), source: text }).strict().optional(),
  scope: z.object({ value: z.enum(['metadata', 'readme', 'all']), source: text }).strict().optional(),
  excludeArchived: z.object({ value: z.boolean(), source: text }).strict().optional(),
  excludeForks: z.object({ value: z.boolean(), source: text }).strict().optional(),
  excludeStarred: z.object({ value: z.boolean(), source: text }).strict().optional(),
  excludeRecommended: z.object({ value: z.boolean(), source: text }).strict().optional(),
}).strict();
export const planSchema = z.object({
  version: z.literal(1),
  required: z.array(condition).max(12),
  excluded: z.array(condition).max(12),
  preferred: z.array(condition).max(12),
  branches: z.array(z.object({
    terms: z.array(term).min(1).max(3),
    readme: z.boolean(),
    role: z.enum(['core', 'synonym', 'ecosystem']).optional(),
  }).strict()).min(1).max(6),
  filters: z.object({
    language: z.string().max(40).regex(/^[\p{L}\p{N} +#.-]*$/u).nullable(),
    minStars: z.number().int().min(0).nullable(),
    maxStars: z.number().int().min(0).nullable(),
    createdWithinDays: z.number().int().min(1).max(36500).nullable(),
  }).strict(),
  filterSources: z.object({
    language: z.string().max(240).nullable(),
    minStars: z.string().max(240).nullable(),
    maxStars: z.string().max(240).nullable(),
    createdWithinDays: z.string().max(240).nullable(),
  }).strict(),
  conflicts: z.array(text).max(8),
  retrieval: retrievalSchema.optional(),
}).strict();
export type CompiledSubscriptionPlan = z.infer<typeof planSchema>;
export const overrideSchema = z.object({
  language: planSchema.shape.filters.shape.language.optional(),
  minStars: planSchema.shape.filters.shape.minStars.optional(),
  maxStars: planSchema.shape.filters.shape.maxStars.optional(),
  createdWithinDays: planSchema.shape.filters.shape.createdWithinDays.optional(),
  sort: z.enum(['relevance', 'stars', 'updated']).optional(),
  scope: z.enum(['metadata', 'readme', 'all']).optional(),
  excludeArchived: z.boolean().optional(),
  excludeForks: z.boolean().optional(),
  excludeStarred: z.boolean().optional(),
  excludeRecommended: z.boolean().optional(),
  branches: planSchema.shape.branches.optional(),
  required: planSchema.shape.required.optional(),
  excluded: planSchema.shape.excluded.optional(),
  preferred: planSchema.shape.preferred.optional(),
}).strict();
export type RuleOverrides = z.infer<typeof overrideSchema>;
export interface EffectiveRules {
  plan: CompiledSubscriptionPlan;
  sort: 'relevance' | 'stars' | 'updated';
  scope?: 'metadata' | 'readme' | 'all';
  excludeArchived: boolean;
  excludeForks: boolean;
  excludeStarred: boolean;
  excludeRecommended: boolean;
}
export function effectiveRules(plan: CompiledSubscriptionPlan, overrides: RuleOverrides = {}): EffectiveRules {
  const o = overrideSchema.parse(overrides);
  const filters = { ...plan.filters };
  for (const key of ['language', 'minStars', 'maxStars', 'createdWithinDays'] as const) {
    if (o[key] !== undefined) Object.assign(filters, { [key]: o[key] });
  }
  if (filters.minStars !== null && filters.maxStars !== null && filters.minStars > filters.maxStars) {
    throw new Error('INVALID_STAR_RANGE');
  }
  return {
    plan: { ...plan, filters, branches: o.branches ?? plan.branches,
      required: o.required ?? plan.required, excluded: o.excluded ?? plan.excluded, preferred: o.preferred ?? plan.preferred },
    sort: o.sort ?? plan.retrieval?.sort?.value ?? 'relevance',
    scope: o.scope ?? plan.retrieval?.scope?.value,
    excludeArchived: o.excludeArchived ?? plan.retrieval?.excludeArchived?.value ?? true,
    excludeForks: o.excludeForks ?? plan.retrieval?.excludeForks?.value ?? true,
    excludeStarred: o.excludeStarred ?? plan.retrieval?.excludeStarred?.value ?? true,
    excludeRecommended: o.excludeRecommended ?? plan.retrieval?.excludeRecommended?.value ?? true,
  };
}
export interface CustomDiscoveryChannel {
  id: string;
  name: string;
  instruction: string;
  revision: number;
  plan: CompiledSubscriptionPlan;
  ruleOverrides?: RuleOverrides;
  enabled: boolean;
  paused: boolean;
  ai: boolean;
  autoAnalyze?: boolean;
  limit: number;
  hour: number;
  cursors: number[];
  blocked: number[];
  read: number[];
  recommended: Record<string, string>;
  manualAccepted?: Record<string, string>;
  lastCompletedDate?: string;
  lastRefresh?: string;
  retryAt?: number;
}
export interface CandidateAssessment {
  repo: Repository;
  verdict: 'match' | 'unknown';
  reason: string;
  evidence: string[];
  method: 'rules' | 'ai';
  relevance: number;
  preference: number;
  screening?: boolean;
  relation?: 'direct' | 'ecosystem';
  acceptance?: { sourceEditionKey: string; sourceRevision: number; acceptedAt: string };
}
export interface ChannelDailyEdition {
  channelId: string;
  date: string;
  revision: number;
  instruction: string;
  entries: CandidateAssessment[];
  pending: CandidateAssessment[];
  errors: string[];
  complete: boolean;
  searched: number;
  filtered: number;
  generatedAt: string;

  ruleSnapshot?: EffectiveRules;
}

const localDay=(date=new Date())=>date.toISOString().slice(0,10);
export function buildQuery(plan: CompiledSubscriptionPlan, branch: number, recent: boolean, now = new Date(), overrides: RuleOverrides = {}): string {
  const rules = effectiveRules(plan, overrides);
  const item = rules.plan.branches[branch];
  const parts = item.terms.map(value => `"${value}"`);
  parts.push(rules.scope === 'all' ? 'in:name,description,topics,readme'
    : rules.scope === 'readme' || (!rules.scope && item.readme) ? 'in:readme' : 'in:name,description,topics', 'is:public');
  if (rules.excludeArchived) parts.push('archived:false');
  parts.push(rules.excludeForks ? 'fork:false' : 'fork:true');
  const f = rules.plan.filters;
  if (f.language) parts.push(`language:"${f.language}"`);
  if (f.minStars !== null) parts.push(`stars:>=${f.minStars}`);
  if (f.maxStars !== null) parts.push(`stars:<=${f.maxStars}`);
  if (f.createdWithinDays !== null) parts.push(`created:>=${new Date(now.getTime() - f.createdWithinDays * 86400000).toISOString().slice(0, 10)}`);
  if (recent) parts.push(`pushed:>=${new Date(now.getTime() - 30 * 86400000).toISOString().slice(0, 10)}`);
  return parts.join(' ');
}

export function passesFilters(repo: Repository, channel: CustomDiscoveryChannel, starred: Set<number>, now = Date.now()): boolean {
  const flags = repo as Repository & { private?: boolean; archived?: boolean; fork?: boolean; disabled?: boolean };
  const rules = effectiveRules(channel.plan, channel.ruleOverrides);
  const lastRecommended = channel.recommended[String(repo.id)];
  if (!Number.isSafeInteger(repo.id) || repo.id <= 0 || flags.private || flags.disabled
    || (rules.excludeArchived && flags.archived) || (rules.excludeForks && flags.fork)
    || (rules.excludeStarred && starred.has(repo.id)) || channel.blocked.includes(repo.id)
    || (lastRecommended && (rules.excludeRecommended || lastRecommended === localDay(new Date(now))))) return false;
  const f = rules.plan.filters;
  if (f.language && repo.language?.toLowerCase() !== f.language.toLowerCase()) return false;
  if (f.minStars !== null && repo.stargazers_count < f.minStars) return false;
  if (f.maxStars !== null && repo.stargazers_count > f.maxStars) return false;
  if (f.createdWithinDays !== null && !(Date.parse(repo.created_at) >= now - f.createdWithinDays * 86400000)) return false;
  return true;
}

export function lexicalScore(repo: Repository, plan: CompiledSubscriptionPlan): number {
  const name = repo.full_name.toLowerCase();
  const description = (repo.description || '').toLowerCase();
  const topics = (repo.topics || []).join(' ').toLowerCase();
  return [...new Set(plan.branches.flatMap(b => b.terms).map(t => t.toLowerCase()))]
    .reduce((score, t) => score + (name.includes(t) ? 3 : 0) + (topics.includes(t) ? 2 : 0) + (description.includes(t) ? 1 : 0), 0);
}

const findingSchema = z.object({
  kind: z.enum(['required', 'excluded', 'preferred']),
  index: z.number().int().min(0),
  status: z.enum(['yes', 'no', 'unknown']),
  quote: z.string().max(800),
}).strict();
export const assessmentSchema = z.array(z.object({
  id: z.number().int().positive(),
  relevance: z.number().int().min(0).max(3),
  reason: z.string().max(600),
  findings: z.array(findingSchema).max(36),
}).strict()).max(40);

export function assessResults(raw: unknown, candidates: { repo: Repository; text: string }[], plan: CompiledSubscriptionPlan): CandidateAssessment[] {
  const parsed = assessmentSchema.parse(raw);
  if (new Set(parsed.map(p => p.id)).size !== parsed.length || parsed.some(p => !candidates.some(c => c.repo.id === p.id))) {
    throw new Error('Invalid candidate identity');
  }
  return candidates.flatMap(({ repo, text: evidenceText }) => {
    const result = parsed.find(p => p.id === repo.id);
    let unknown = !result;
    let excluded = false;
    let preference = 0;
    const evidence: string[] = [];
    for (const kind of ['required', 'excluded', 'preferred'] as const) {
      plan[kind].forEach((_, index) => {
        const matches = result?.findings.filter(f => f.kind === kind && f.index === index) ?? [];
        const f = matches.length === 1 ? matches[0] : undefined;
        const verified = f && f.status !== 'unknown' && f.quote.trim().length >= 8 && evidenceText.includes(f.quote);
        const status = verified ? f.status : 'unknown';
        if (verified) evidence.push(f.quote);
        if ((kind === 'required' && status === 'no') || (kind === 'excluded' && status === 'yes')) excluded = true;
        if (kind !== 'preferred' && status === 'unknown') unknown = true;
        if (kind === 'preferred' && status === 'yes') preference++;
      });
    }
    if (excluded || result?.relevance === 0) return [];
    return [{
      repo, verdict: unknown ? 'unknown' as const : 'match' as const,
      reason: result?.reason || 'Insufficient evidence', evidence, method: 'ai' as const,
      relevance: result?.relevance ?? 0, preference,
    }];
  });
}

export function rankAssessments(items: CandidateAssessment[], sort: EffectiveRules['sort'] = 'relevance'): CandidateAssessment[] {
  return [...items].sort((a, b) =>
    (sort === 'stars' ? b.repo.stargazers_count - a.repo.stargazers_count : sort === 'updated'
      ? (Date.parse(b.repo.pushed_at) || 0) - (Date.parse(a.repo.pushed_at) || 0) : 0)
    || b.relevance - a.relevance || b.preference - a.preference
    || (Date.parse(b.repo.pushed_at) || 0) - (Date.parse(a.repo.pushed_at) || 0)
    || b.repo.stargazers_count - a.repo.stargazers_count || a.repo.id - b.repo.id);
}

export function parsePlan(raw: string, instruction: string): CompiledSubscriptionPlan {
  const plan = planSchema.parse(JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, '').trim()));
  for (const value of Object.values(plan.retrieval ?? {})) {
    if (value && !instruction.includes(value.source)) throw new Error('Retrieval source is not present in the instruction');
  }
  for (const rule of [...plan.required, ...plan.excluded, ...plan.preferred]) {
    if (!instruction.includes(rule.source)) throw new Error('Rule source is not present in the instruction');
  }
  for (const key of ['language', 'minStars', 'maxStars', 'createdWithinDays'] as const) {
    if (plan.filters[key] !== null) {
      const source = plan.filterSources[key];
      if (!source || !instruction.includes(source)) throw new Error(`Missing original source for ${key}`);
    }
  }
  const { minStars, maxStars } = plan.filters;
  if (minStars !== null && maxStars !== null && minStars > maxStars) {
    plan.conflicts.push('Minimum stars exceeds maximum stars');
  }
  return plan;
}

