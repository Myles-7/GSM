import type { AppLanguage } from '../i18n/languages';
import type { Category, Repository } from '../types';
import type { ClassificationFacet, ClassificationInsight, ClassificationScheme, ClassificationSchemeId } from '../types/classification';
import type { OrganizationMembership } from '../types/aiOrganization';
import { purposeCatalog, technologyCatalog, type ClassificationDomain, type ClassificationLeaf } from './classificationCatalog';
import { inferFacetGroup, repositoryClassificationInsight } from '../utils/classificationFacets';

export const AI_CLASSIFICATION_VERSION = 'fine-v4';
export const CLASSIFICATION_GROUP_TARGET = 25;
type Evidence = { field: string; value: string; weight: number; group: ClassificationFacet['group']; normalized?: string };
type Match = { score: number; evidence: Evidence[]; specific: boolean };
type Assignment = { membership: OrganizationMembership; insight: ClassificationInsight; domain: ClassificationDomain; leaf: ClassificationLeaf };
const generic = new Set(['tool', 'tools', '工具', 'software', '软件', 'model', '模型', 'system', '系统', 'code', '代码', 'ai', 'data', '数据', 'app', '应用', 'web', '开发', 'browser', '浏览器']);
const aliases: Array<[RegExp, string]> = [
  [/\bmulti[\s-]?agents?\b/g, 'multi agent'], [/\bllms\b/g, 'llm'], [/\bagents\b/g, 'agent'],
  [/\breact[\s-]+native\b/g, 'reactnative'], [/\bmodel context protocol\b/g, 'mcp'],
  [/\bfine[\s-]?tuning\b/g, 'fine tuning'], [/\bnext\.js\b/g, 'nextjs'],
];
function normalize(value: string): string {
  let text = value.normalize('NFKC').toLowerCase().replace(/[_/-]+/g, ' ').replace(/\s+/g, ' ').trim();
  for (const [pattern, replacement] of aliases) text = text.replace(pattern, replacement);
  return text;
}
function strings(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(strings);
  return typeof value === 'string' && value.trim() ? [value.trim()] : [];
}
export function classificationEvidence(repository: Repository, scheme: ClassificationSchemeId): Evidence[] {
  const rows: Evidence[] = [];
  const add = (field: string, value: unknown, weight: number, group: Evidence['group'] = 'scenario') => {
    for (const text of strings(value)) rows.push({ field, value: text, weight, group });
  };
  const d = repository.ai_details;
  if (scheme === 'purpose') {
    add('ai_details.problem', d?.problem, 8); add('ai_details.scenarios', d?.scenarios, 8);
    add('ai_details.features', d?.features, 6); add('ai_details.summary', d?.summary, 6);
    add('ai_summary', repository.ai_summary, 5); add('ai_details.tags', d?.tags, 4);
    add('ai_tags', repository.ai_tags, 3); add('description', repository.custom_description ?? repository.description, 2);
    add('topics', repository.topics, 2);
  } else {
    add('ai_details.technologies', d?.technologies, 9, 'technology');
    add('ai_details.platforms', d?.platforms, 8, 'platform'); add('ai_platforms', repository.ai_platforms, 7, 'platform');
    add('ai_details.architecture', d?.architecture, 7, 'technology'); add('ai_details.deployment', d?.deployment, 6, 'platform');
    add('ai_details.software_forms', d?.software_forms, 5, 'platform'); add('ai_details.deployment_modes', d?.deployment_modes, 5, 'platform');
    add('ai_details.tags', d?.tags, 4, 'technology'); add('ai_tags', repository.ai_tags, 3, 'technology');
    add('topics', repository.topics, 3, 'technology'); add('language', repository.language, 1, 'technology');
    add('ai_details.summary', d?.summary, 2, 'technology'); add('ai_summary', repository.ai_summary, 2, 'technology');
    add('description', repository.description, 1, 'technology');
  }
  const unique = new Map<string, Evidence>();
  for (const row of rows) {
    const key = normalize(row.value);
    row.normalized = key;
    const previous = unique.get(key);
    if (!previous || row.weight > previous.weight || row.weight === previous.weight && row.field < previous.field) unique.set(key, row);
  }
  return [...unique.values()].sort((a, b) => a.field.localeCompare(b.field) || normalize(a.value).localeCompare(normalize(b.value)));
}
interface CompiledTerm { key: string; pattern: string | RegExp; generic: boolean; exactLanguage: boolean }
// Only catalog terms are cached; repository content never enters this cache.
const termPatterns = new Map<string, CompiledTerm>();
function compileTerm(term: string): CompiledTerm {
  const cached = termPatterns.get(term);
  if (cached) return cached;
  const key = normalize(term);
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = /^[a-z0-9 .+#]+$/.test(key)
    ? new RegExp(`(?:^|[^a-z0-9+#])${escaped}(?=$|[^a-z0-9+#])`, 'i') : key;
  const compiled = { key, pattern, generic: generic.has(key), exactLanguage: key === 'go' || key === 'c' };
  termPatterns.set(term, compiled);
  return compiled;
}
function score(rule: ClassificationLeaf, evidence: Evidence[]): Match {
  // A synonym appearing in tags, summaries and repeated features is one fact.
  // Compile invariant catalog terms once instead of normalizing them for every
  // repository/evidence pair. Track max strength without allocating hit arrays.
  const terms = rule.terms.map(compileTerm);
  const byField = new Map<string, { row: Evidence; points: number }>();
  let specific = false;
  for (const row of evidence) {
    const text = row.normalized ?? normalize(row.value);
    const language = row.field === 'language' || row.field === 'ai_details.technologies';
    let strength = 0;
    for (const term of terms) {
      if (term.exactLanguage && !language && text !== term.key) continue;
      const matches = typeof term.pattern === 'string' ? text.includes(term.pattern) : term.pattern.test(text);
      if (matches) strength = Math.max(strength, term.generic ? .12 : 1);
    }
    if (!strength) continue;
    if (strength === 1 && row.field !== 'language') specific = true;
    const points = row.weight * strength;
    const previous = byField.get(row.field);
    if (!previous || points > previous.points) byField.set(row.field, { row, points });
  }
  const hits = [...byField.values()].sort((a, b) => b.points - a.points || a.row.field.localeCompare(b.row.field));
  return { score: hits.slice(0, 3).reduce((sum, hit, index) => sum + hit.points * [1, .45, .2][index], 0), evidence: hits.map(hit => hit.row), specific };
}
const catalog = (scheme: ClassificationSchemeId) => scheme === 'purpose' ? purposeCatalog : technologyCatalog;
const parentId = (scheme: ClassificationSchemeId, domain: ClassificationDomain) => `ai-${scheme}-${domain.key}`;
const childId = (scheme: ClassificationSchemeId, domain: ClassificationDomain, leaf: ClassificationLeaf) => `${parentId(scheme, domain)}-${leaf.key}`;
const label = (value: ClassificationLeaf, language: AppLanguage) => language.startsWith('zh') ? value.zh : value.en;
const explain = (rows: Evidence[]) => [...new Set(rows.map(row => `${row.field}: ${row.value.slice(0, 200)}`))].slice(0, 6);
const fallbackDomain: ClassificationDomain = { key: 'other', zh: '其他用途', en: 'Other purposes', icon: '📁', terms: [], children: [] };
const generalLeaf = (domain: ClassificationDomain): ClassificationLeaf => ({ key: 'general', zh: `${domain.zh} · 通用`, en: `General ${domain.en}`, terms: [] });

function evidenceFacets(repository: Repository, scheme: ClassificationSchemeId, language: AppLanguage): ClassificationFacet[] {
  const result: ClassificationFacet[] = [];
  const seen = new Set<string>();
  const add = (group: NonNullable<Evidence['group']>, values: unknown, field: string) => {
    for (const raw of strings(values)) {
      const name = raw.trim();
      if (name.length > 55 || name.length < 2) continue;
      const actualGroup = inferFacetGroup(name, group);
      const id = `${actualGroup}:${normalize(name)}`;
      if (seen.has(id)) continue;
      seen.add(id); result.push({ id, group: actualGroup, label: name, score: 1, evidence: [`${field}: ${name}`] });
    }
  };
  add('technology', repository.ai_details?.technologies, 'ai_details.technologies');
  add('platform', [...(repository.ai_details?.platforms ?? []), ...(repository.ai_platforms ?? [])], 'ai_details.platforms / ai_platforms');
  add('scenario', repository.ai_details?.tags ?? repository.ai_tags, 'ai_details.tags / ai_tags');
  add('technology', repository.language, 'language');
  add(scheme === 'purpose' ? 'scenario' : 'technology', repository.topics, 'topics');
  const forms: Record<string, string> = { desktop: '桌面', web: 'Web', cli: 'CLI', library: '软件库', plugin: '插件', agent: 'Agent', model: '模型' };
  for (const form of repository.ai_details?.software_forms ?? []) add('platform', language.startsWith('zh') ? forms[form] ?? form : form, 'ai_details.software_forms');
  // Reserve a slot for each evidence dimension instead of filling all six with tags.
  const ordered: ClassificationFacet[] = [];
  for (const group of ['technology', 'platform', 'scenario'] as const) ordered.push(...result.filter(facet => facet.group === group).slice(0, 2));
  return ordered.slice(0, 6);
}

function assignment(repository: Repository, scheme: ClassificationSchemeId, language: AppLanguage): Assignment {
  const evidence = classificationEvidence(repository, scheme);
  const candidates = catalog(scheme).flatMap((domain, rank) => {
    const parent = score(domain, evidence);
    return domain.children.map((leaf, index) => {
      const match = score({ ...leaf, terms: [...leaf.terms, ...(leaf.refinements ?? []).flatMap(item => item.terms)] }, evidence);
      // Language/runtime is fallback evidence; framework/protocol evidence wins.
      const points = domain.key === 'runtime' ? match.score * .18 : match.score + Math.min(parent.score, 8) * .2
        + (scheme === 'technology' && domain.key === 'desktop' && ['electron', 'tauri', 'qt', 'native'].includes(leaf.key) && match.specific ? .5 : 0);
      return { domain, leaf, match, points, rank, index };
    });
  }).filter(item => item.match.score >= 1 && (item.match.specific || item.domain.key === 'runtime'))
    .sort((a, b) => b.points - a.points || a.rank - b.rank || a.index - b.index);
  const winner = candidates[0];
  const parentCandidates = catalog(scheme).map((domain, rank) => ({ domain, rank, match: score(domain, evidence) }))
    .filter(item => item.match.specific && item.match.score >= 2).sort((a, b) => b.match.score - a.match.score || a.rank - b.rank);
  const domain = winner?.domain ?? parentCandidates[0]?.domain ?? { ...fallbackDomain, ...(scheme === 'technology' ? { zh: '技术信息不足', en: 'Insufficient technical information' } : {}) };
  const leaf = winner?.leaf ?? generalLeaf(domain);
  const match = winner?.match;
  const runnerUp = candidates.find(candidate => candidate.domain.key !== domain.key || candidate.leaf.key !== leaf.key);
  const confidence = !match || !match.specific || domain.key === 'runtime' ? 'low'
    : match.score >= 8 && (!runnerUp || winner.points - runnerUp.points >= 1.5) ? 'high' : match.score >= 3 ? 'medium' : 'low';
  const membership = { categoryId: parentId(scheme, domain), subcategoryId: childId(scheme, domain, leaf), locked: false };
  return { domain, leaf, membership, insight: { categoryId: membership.categoryId, subcategoryId: membership.subcategoryId, confidence,
    evidence: explain(match?.evidence ?? parentCandidates[0]?.match.evidence ?? []), facets: evidenceFacets(repository, scheme, language) } };
}

export function splitClassificationRows(rows: Array<{ repository: Repository; result: Assignment }>, scheme: ClassificationSchemeId, language: AppLanguage): { changed: boolean; reason: string } {
  if (rows.length <= CLASSIFICATION_GROUP_TARGET) return { changed: false, reason: language.startsWith('zh') ? '当前分类未超过 25 个项目，无需自动细分。' : 'This group is within the 25-project target.' };
  const original = rows[0].result;
  const refinements = original.leaf.refinements ?? [];
  const choices = rows.map(row => {
    const evidence = classificationEvidence(row.repository, scheme);
    const matches = refinements.map((leaf, index) => ({ leaf, index, ...score(leaf, evidence) }))
      .filter(item => item.specific && item.score >= 3).sort((a, b) => b.score - a.score || a.index - b.index);
    return { row, match: matches[0] };
  });
  const counts = new Map<string, number>();
  choices.forEach(({ match }) => { if (match) counts.set(match.leaf.key, (counts.get(match.leaf.key) ?? 0) + 1); });
  const viable = new Set([...counts].filter(([, count]) => count >= 4).map(([key]) => key));
  const coverage = choices.filter(({ match }) => match && viable.has(match.leaf.key)).length;
  if (viable.size < 2 || coverage / rows.length < .6) {
    const reason = language.startsWith('zh') ? viable.size === 1 && coverage / rows.length >= .6 ? '用途或技术能力相近，保留原分类；可使用辅助筛选。' : '细分证据不足：需要至少两个各含 4 个项目的子群，且覆盖 60% 项目。'
      : 'Insufficient distinct evidence: two groups of 4+ projects must cover at least 60% of this group.';
    rows.forEach(row => { row.result.insight.refinementReason = reason; });
    return { changed: false, reason };
  }
  for (const { row, match } of choices) {
    if (match && viable.has(match.leaf.key)) {
      row.result = { ...row.result, leaf: { ...match.leaf, key: `${original.leaf.key}-${match.leaf.key}` },
        membership: { ...row.result.membership, subcategoryId: `${childId(scheme, original.domain, original.leaf)}-${match.leaf.key}` },
        insight: { ...row.result.insight, evidence: explain(match.evidence), confidence: match.score >= 8 ? 'high' : 'medium', refinementReason: undefined } };
    } else {
      row.result = { ...row.result, leaf: { ...original.leaf, zh: `${original.leaf.zh} · 通用`, en: `General ${original.leaf.en}`, refinements: undefined },
        insight: { ...row.result.insight, refinementReason: language.startsWith('zh') ? '缺少更细的用途或技术证据，保留在通用分组。' : 'No reliable finer evidence; retained in the general group.' } };
    }
    row.result.insight.subcategoryId = row.result.membership.subcategoryId ?? undefined;
    row.result.insight.categoryId = row.result.membership.categoryId ?? undefined;
  }
  return { changed: true, reason: language.startsWith('zh') ? `已按证据细分为 ${viable.size} 个具体分组${coverage < rows.length ? '及通用分组' : ''}。` : `Split into ${viable.size} evidence-based groups${coverage < rows.length ? ' and a general group' : ''}.` };
}

function buildScheme(repositories: Repository[], scheme: ClassificationSchemeId, language: AppLanguage) {
  const rows = repositories.map(repository => ({ repository, result: assignment(repository, scheme, language) }));
  const groups = new Map<string, typeof rows>();
  for (const row of rows) {
    const id = row.result.membership.subcategoryId!;
    groups.set(id, [...(groups.get(id) ?? []), row]);
  }
  for (const group of groups.values()) splitClassificationRows(group, scheme, language);
  const counts = new Map<string, number>();
  const categories = new Map<string, Category>();
  const subcategories = new Map<string, ClassificationScheme['subcategories'][number]>();
  const generatedAt = new Date().toISOString();
  for (const row of rows) {
    const { domain, leaf, membership, insight } = row.result;
    const id = membership.categoryId!;
    counts.set(id, (counts.get(id) ?? 0) + 1);
    categories.set(id, { id, name: label(domain, language), icon: domain.icon, keywords: domain.terms, isCustom: true, source: 'ai', sourceKey: domain.key, generatedAt,
      evidence: [...new Set([...(categories.get(id)?.evidence ?? []), ...insight.evidence])].slice(0, 6) });
    subcategories.set(membership.subcategoryId!, { id: membership.subcategoryId!, parentId: id, name: label(leaf, language), icon: domain.icon });
  }
  const order = catalog(scheme).map(item => parentId(scheme, item));
  const customCategories = [...categories.values()].sort((a, b) => (counts.get(b.id)! - counts.get(a.id)!) || order.indexOf(a.id) - order.indexOf(b.id));
  const children = [...subcategories.values()].sort((a, b) => customCategories.findIndex(item => item.id === a.parentId) - customCategories.findIndex(item => item.id === b.parentId) || a.id.localeCompare(b.id));
  const structure: ClassificationScheme = { initialized: true, customCategories, defaultCategoryOverrides: {}, hiddenDefaultCategoryIds: [],
    categoryOrder: customCategories.map(item => item.id), subcategories: children, subcategoryOrder: children.map(item => item.id), repositoryOrder: [...repositories.map(item => item.id)].sort((a, b) => a - b), categoryListIdMap: {} };
  return { structure, rows };
}
export function buildAIClassification(repositories: Repository[], language: AppLanguage) {
  const purpose = buildScheme(repositories, 'purpose', language);
  const technology = buildScheme(repositories, 'technology', language);
  const assignments: Record<string, { purpose: OrganizationMembership; technology: OrganizationMembership }> = {};
  const insights: Record<string, { purpose: ClassificationInsight; technology: ClassificationInsight }> = {};
  purpose.rows.forEach((row, index) => {
    const id = String(row.repository.id);
    assignments[id] = { purpose: row.result.membership, technology: technology.rows[index].result.membership };
    insights[id] = { purpose: row.result.insight, technology: technology.rows[index].result.insight };
  });
  return { purpose: purpose.structure, technology: technology.structure, assignments, insights, sourceFingerprint: classificationSourceFingerprint(repositories) };
}
export function classificationSourceFingerprint(repositories: Repository[]): string {
  const input = [...repositories].sort((a, b) => a.id - b.id).map(repository => [repository.id,
    ...(['purpose', 'technology'] as const).map(scheme => classificationEvidence(repository, scheme).map(row => [row.field, normalize(row.value), row.weight]))]);
  const text = JSON.stringify([AI_CLASSIFICATION_VERSION, input]);
  let a = 2166136261; let b = 5381;
  for (let i = 0; i < text.length; i++) { a = Math.imul(a ^ text.charCodeAt(i), 16777619); b = Math.imul(b, 33) ^ text.charCodeAt(i); }
  return `${AI_CLASSIFICATION_VERSION}:${(a >>> 0).toString(16)}${(b >>> 0).toString(16)}`;
}

export function classificationReport(repositories: Repository[], scheme: ClassificationSchemeId, structure: ClassificationScheme, language: AppLanguage = 'zh') {
  const membership = (repo: Repository) => scheme === 'purpose' ? { categoryId: repo.category_id, subcategoryId: repo.subcategory_id } : repo.classifications?.technology;
  const groups = structure.subcategories.map(group => {
    const members = repositories.filter(repo => membership(repo)?.categoryId === group.parentId && membership(repo)?.subcategoryId === group.id);
    return { id: group.id, name: group.name, count: members.length,
      lowConfidenceCount: members.filter(repo => repositoryClassificationInsight(repo, scheme)?.confidence === 'low').length,
      reason: members.map(repo => repositoryClassificationInsight(repo, scheme)?.refinementReason).find(Boolean) ?? (members.length > 25 ? language.startsWith('zh') ? '内容相近或尚缺少可靠细分依据，可使用辅助筛选。' : 'Similar content or insufficient evidence for further subdivision. Use facet filters.' : ''),
      examples: [...members].sort((a, b) => a.id - b.id).slice(0, 3).map(repo => ({ id: repo.id, name: repo.full_name, evidence: repositoryClassificationInsight(repo, scheme)?.evidence ?? [] })) };
  });
  return { total: repositories.length, lowConfidenceCount: repositories.filter(repo => repositoryClassificationInsight(repo, scheme)?.confidence === 'low').length, groups };
}

/** Re-evaluate only the existing group's evidence; never repartition its parent. */
export function refineClassificationGroup(repositories: Repository[], scheme: ClassificationSchemeId, group: ClassificationScheme['subcategories'][number], language: AppLanguage) {
  const domain = catalog(scheme).find(item => parentId(scheme, item) === group.parentId);
  const leaf = domain?.children.find(item => childId(scheme, domain, item) === group.id);
  if (!domain || !leaf) return { changed: false, reason: language.startsWith('zh') ? '当前分组已细化或没有可靠的细分目录。' : 'This group is already specific or has no reliable refinement catalog.', rows: [], groups: [] };
  const rows = repositories.map(repository => ({ repository, result: { domain, leaf, membership: { categoryId: group.parentId, subcategoryId: group.id, locked: false }, insight: { ...(repository.classificationInsights?.[scheme] ?? { confidence: 'low', evidence: [], facets: [] }) } } as Assignment }));
  const outcome = splitClassificationRows(rows, scheme, language);
  const groups = [...new Map(rows.map(({ result }) => [result.membership.subcategoryId!, { id: result.membership.subcategoryId!, parentId: group.parentId, name: label(result.leaf, language), icon: domain.icon }])).values()];
  return { ...outcome, rows, groups };
}
