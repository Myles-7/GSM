import { expect, it } from 'vitest';
import { repositoryHomeProjection } from './repositoryProjection';

it('projects domain fields while excluding raw and nested GitHub credentials', () => {
  const input = { id: 1, name: 'repo', owner: { login: 'owner', avatar_url: 'https://example.test/avatar', token: 'private' },
    temp_clone_token: 'private', template_repository: { temp_clone_token: 'private' },
    category_id: null, classifications: { scheme: { categoryId: 'category' } }, ai_details: { summary: 'saved' } };
  const result = repositoryHomeProjection(input);
  expect(result).toEqual({ id: 1, name: 'repo', owner: { login: 'owner', avatar_url: 'https://example.test/avatar' }, category_id: null,
    classifications: input.classifications, ai_details: input.ai_details });
  expect(input.temp_clone_token).toBe('private');
  expect(repositoryHomeProjection(result)).toEqual(result);
});
