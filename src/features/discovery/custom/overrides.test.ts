import { describe, expect, it } from 'vitest';
import { buildQuery, effectiveRules, localDay, parsePlan, passesFilters, rankAssessments } from './model';
import { makeAssessment, makeChannel, makePlan, makeRepo } from './fixtures.test-support';

describe('effective subscription rules', () => {
  it('follows explicit parsed retrieval settings unless manually overridden', () => {
    const plan = makePlan();
    plan.retrieval = { sort: { value: 'stars', source: 'most stars' }, excludeForks: { value: false, source: 'include forks' } };
    expect(effectiveRules(plan).sort).toBe('stars');
    expect(effectiveRules(plan).excludeForks).toBe(false);
    expect(effectiveRules(plan, { sort: 'updated', excludeForks: true }).sort).toBe('updated');
    expect(effectiveRules(plan, { excludeForks: true }).excludeForks).toBe(true);
    expect(() => parsePlan(JSON.stringify(plan), 'local; no tutorials; Windows preferred')).toThrow('Retrieval source');
  });
  it('keeps legacy defaults and distinguishes unlimited from following parsed values', () => {
    const plan = makePlan();
    plan.filters = { language: 'Python', minStars: 100, maxStars: 1000, createdWithinDays: 30 };
    expect(effectiveRules(plan).plan.filters).toEqual(plan.filters);
    const rules = effectiveRules(plan, { language: null, minStars: null, createdWithinDays: null });
    expect(rules.plan.filters).toEqual({ language: null, minStars: null, maxStars: 1000, createdWithinDays: null });
    expect(plan.filters.minStars).toBe(100);
    expect(rules.excludeStarred).toBe(true);
    expect(effectiveRules({ ...plan, filters: { ...plan.filters, minStars: 300 } }, { minStars: null }).plan.filters.minStars).toBeNull();
  });
  it('uses overrides in query building and local filtering', () => {
    const channel = makeChannel();
    channel.ruleOverrides = { language: 'Rust', minStars: 3, excludeForks: false, excludeArchived: false, scope: 'readme' };
    const query = buildQuery(channel.plan, 0, false, new Date(), channel.ruleOverrides);
    expect(query).toContain('in:readme');
    expect(query).toContain('language:"Rust"');
    expect(query).not.toContain('archived:false');
    expect(passesFilters(makeRepo(1), channel, new Set())).toBe(false);
    expect(passesFilters(makeRepo(1, { language: 'Rust', stargazers_count: 3, fork: true, archived: true }), channel, new Set())).toBe(true);
  });
  it('allows historical repeats but never repeats today or blocked projects', () => {
    const channel = makeChannel();
    channel.recommended = { '1': '2020-01-01', '2': localDay() };
    channel.ruleOverrides = { excludeRecommended: false, excludeStarred: false };
    expect(passesFilters(makeRepo(1), channel, new Set([1]))).toBe(true);
    expect(passesFilters(makeRepo(2), channel, new Set())).toBe(false);
    channel.blocked = [1];
    expect(passesFilters(makeRepo(1), channel, new Set())).toBe(false);
  });
  it('validates ranges and applies explicit sorting', () => {
    expect(() => effectiveRules(makePlan(), { minStars: 10, maxStars: 1 })).toThrow('INVALID_STAR_RANGE');
    const a = makeAssessment(1), b = makeAssessment(2);
    a.relevance = 10;
    b.repo.stargazers_count = 100;
    expect(rankAssessments([a, b])[0].repo.id).toBe(1);
    expect(rankAssessments([a, b], 'stars')[0].repo.id).toBe(2);
  });
});
