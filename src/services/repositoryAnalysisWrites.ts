import type { Repository } from '../types';

const fields: (keyof Repository)[] = ['ai_summary', 'ai_tags', 'ai_platforms', 'analyzed_at', 'analysis_failed', 'analysis_error'];
const owners = new Map<string, symbol>();
export function beginRepositoryAnalysisWrite(account: number, id: number, details = false) {
  const token = Symbol();
  const owned = details ? [...fields, 'ai_details' as const] : [...fields, 'custom_category' as const];
  for (const field of owned) owners.set(`${account}:${id}:${field}`, token);
  return (latest: Repository, proposed: Repository): Repository => {
    const merged = { ...latest };
    for (const field of owned) if (owners.get(`${account}:${id}:${field}`) === token) {
      Object.assign(merged, { [field]: proposed[field] });
    }
    return merged;
  };
}
