import { describe, expect, it } from 'vitest';
import { taskPrompt, validateTaskResult } from '../../src/services/taskModel.js';

describe('durable AI output quality', () => {
  it('keeps programming languages out of platform filters', () => {
    expect(validateTaskResult('summary', JSON.stringify({ summary: 'A Python CLI', tags: ['Python'],
      platforms: ['Python', 'CLI', 'linux', 'linux', 'unknown'] }), [])).toMatchObject({ platforms: ['cli', 'linux'] });
  });

  it('extracts requirements from the user request without mixing in assistant policies', () => {
    const prompt = taskPrompt('requirements', { prompt: 'Find an offline Python notes CLI', language: 'en' }, []);
    expect(JSON.parse(prompt.user)).toEqual({ request: 'Find an offline Python notes CLI', defaultLanguage: 'en' });
    expect(prompt.system).toContain('purpose describes the user');
    expect(prompt.system).not.toContain('Before retrieving or drafting');
  });
});
