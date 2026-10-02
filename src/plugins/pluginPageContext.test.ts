import { describe, expect, it } from 'vitest';
import { repositoryContext } from './pluginPageContext';
import type { Repository } from '../types';

describe('page repository context', () => {
  it('whitelists public facts plus summaries, never spreads host-only fields', () => {
    const context = repositoryContext({
      id: 7, name: 'repo', full_name: 'owner/repo', owner: { login: 'owner', avatar_url: 'private' },
      description: 'Description', ai_summary: 'Summary', custom_description: 'Notes',
      topics: ['one', 1], language: 'TS', archived: false, disabled: 'not a boolean',
      githubToken: 'secret', analysis_error: 'private error', subcategory: 'private group',
    } as unknown as Repository);
    expect(context).toMatchObject({ id: 7, owner: { login: 'owner' }, ai_summary: 'Summary',
      custom_description: 'Notes', topics: ['one'], archived: false, disabled: null });
    expect(JSON.stringify(context)).not.toMatch(/secret|private|analysis_error|subcategory|avatar_url/);
  });
});
