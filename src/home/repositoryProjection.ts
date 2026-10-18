/** Home carries GSM repository data, never arbitrary GitHub response fields. */
const fields = [
  'id', 'name', 'full_name', 'description', 'html_url', 'stargazers_count', 'forks_count', 'forks',
  'language', 'created_at', 'updated_at', 'pushed_at', 'starred_at', 'topics', 'archived', 'disabled',
  'fork', 'is_template', 'open_issues_count', 'default_branch', 'license', 'ai_summary', 'ai_tags',
  'ai_platforms', 'analyzed_at', 'analysis_failed', 'analysis_error', 'subscribed_to_releases',
  'custom_description', 'custom_tags', 'custom_category', 'category_id', 'subcategory_id',
  'category_candidates', 'category_legacy', 'classifications', 'ai_details', 'category_locked',
  'last_edited', 'vector_indexed_at', 'vector_indexed_license', 'vector_indexed_identity',
  'vector_indexed_generation', 'vector_indexed_content_hash', 'last_release_fetch_time', 'has_fetched_releases',
] as const;

export function repositoryHomeProjection(value: object): Record<string, unknown> {
  const input = value as Record<string, unknown>;
  const output = Object.fromEntries(fields.filter(field => input[field] !== undefined).map(field => [field, input[field]]));
  if (input.owner && typeof input.owner === 'object') {
    const owner = input.owner as Record<string, unknown>;
    output.owner = Object.fromEntries(['login', 'avatar_url'].filter(field => owner[field] !== undefined).map(field => [field, owner[field]]));
  }
  return JSON.parse(JSON.stringify(output)) as Record<string, unknown>;
}
