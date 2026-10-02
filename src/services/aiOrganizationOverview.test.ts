import { describe, expect, it } from 'vitest';
import type { Repository } from '../types';
import { buildOrganizationOverview } from './aiOrganizationOverview';

describe('organization input budget', () => {
  it('bounds large-library context and includes minority language/category strata', () => {
    const repos = Array.from({ length: 5000 }, (_, id) => ({
      id, full_name: `owner/repo-${id}`, description: 'x'.repeat(10000), ai_summary: 'y'.repeat(10000),
      language: id === 4999 ? 'Swift' : 'TypeScript', category_id: id === 4999 ? 'mobile' : 'web', topics: ['tool'],
    } as Repository));
    const overview = buildOrganizationOverview(repos);
    expect(overview.totalRepositories).toBe(5000);
    expect(overview.repositories.length).toBeLessThanOrEqual(80);
    expect(JSON.stringify(overview.repositories).length).toBeLessThan(49000);
    expect(overview.repositories.some(repo => repo.id === 4999)).toBe(true);
    expect(overview.topicCounts).toContainEqual(['tool', 5000]);
    expect(overview.omittedRepositories + overview.sampledRepositories).toBe(5000);
  });

  it('keeps every repository in small scopes and handles an empty scope', () => {
    expect(buildOrganizationOverview([{ id: 1, full_name: 'a/b' } as Repository]).repositories).toHaveLength(1);
    expect(buildOrganizationOverview([]).repositories).toEqual([]);
  });
});
