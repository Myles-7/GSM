import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AIConfig, Repository } from '../types';
import { analyzeRepositoryDetails, readRepositoryDetails, repositoryDetailContentSchema } from './repositoryDetailAnalysis';

const mocks = vi.hoisted(() => ({ generate: vi.fn(), readme: vi.fn() }));
vi.mock('./aiService', () => ({ AIService: class { generateChatText = mocks.generate; } }));
vi.mock('./repositoryDetailReadme', () => ({ getRepositoryDetailReadme: mocks.readme }));
vi.mock('./backendAdapter', () => ({ backend: { isAvailable: false } }));
vi.mock('./routeMode', () => ({ shouldBypassBackend: () => true }));

const content = { problem: null, features: [], scenarios: [], architecture: null, quickstart: [], deployment: null, cost: null, maintenance: null };
const repository = { full_name: 'owner/repo', html_url: 'https://github.com/owner/repo', pushed_at: '2026-09-01T00:00:00Z' } as Repository;
const options = { repository, accountId: 1, aiConfig: { model: 'mock-model' } as AIConfig, githubToken: 'mock-token', language: 'en' };

describe('repository detail analysis evidence and validation', () => {
  it('defaults legacy form/mode evidence to unknown and rejects invented enum values', () => {
    expect(repositoryDetailContentSchema.parse(content)).toMatchObject({ software_forms: [], deployment_modes: [] });
    expect(repositoryDetailContentSchema.safeParse({ ...content, software_forms: ['windows'] }).success).toBe(false);
    expect(repositoryDetailContentSchema.safeParse({ ...content, deployment_modes: ['free'] }).success).toBe(false);
    expect(repositoryDetailContentSchema.parse({ ...content, software_forms: ['cli', 'library'], deployment_modes: ['local'] })).toMatchObject({ software_forms: ['cli', 'library'], deployment_modes: ['local'] });
  });
  beforeEach(() => { vi.clearAllMocks(); mocks.readme.mockResolvedValue({ content: '# README', retrievedAt: '2026-09-01T00:00:00Z' }); mocks.generate.mockResolvedValue(JSON.stringify(content)); });
  it('records version, configured model, evidence time and pushed-at independently of model output', async () => {
    const result = await analyzeRepositoryDetails(options);
    expect(result).toMatchObject({ version: 1, model: 'mock-model', repository_pushed_at: repository.pushed_at, problem: null });
    expect(result.sources.map((source) => source.label)).toEqual(['GitHub metadata', 'README']);
    expect(readRepositoryDetails(result)).toEqual(result);
    expect(mocks.generate.mock.calls[0][0].user).toContain('# README');
  });
  it('preserves unknowns when README is unavailable and does not claim README evidence', async () => {
    mocks.readme.mockResolvedValue({ content: '', retrievedAt: '2026-09-01T00:00:00Z' });
    const result = await analyzeRepositoryDetails(options);
    expect(result.sources).toHaveLength(1);
    expect(result.cost).toBeNull();
  });
  it('rejects malformed and extra model fields instead of saving them', async () => {
    mocks.generate.mockResolvedValue(JSON.stringify({ ...content, maturity: 'production-ready' }));
    await expect(analyzeRepositoryDetails(options)).rejects.toThrow();
    expect(repositoryDetailContentSchema.safeParse({ ...content, features: 'invented' }).success).toBe(false);
    expect(readRepositoryDetails({ ...content, version: 99 })).toBeNull();
  });
  it.each([429, 500, 403])('does not generate metadata-only details on README HTTP %s failure', async (status) => {
    mocks.readme.mockRejectedValue(Object.assign(new Error('readme failed'), { status }));
    await expect(analyzeRepositoryDetails(options)).rejects.toThrow('readme failed');
    expect(mocks.generate).not.toHaveBeenCalled();
  });
  it('does not call the model after an abort while collecting evidence', async () => {
    const controller = new AbortController();
    mocks.readme.mockImplementation(async () => { controller.abort(); throw new Error('aborted'); });
    await expect(analyzeRepositoryDetails({ ...options, signal: controller.signal })).rejects.toThrow();
    expect(mocks.generate).not.toHaveBeenCalled();
  });
  it('accepts fenced JSON but never executes documented commands', async () => {
    mocks.readme.mockResolvedValue({ content: '# README\n```sh\nnpm install\n```', retrievedAt: '2026-09-01T00:00:00Z' });
    mocks.generate.mockResolvedValue('```json\n' + JSON.stringify({ ...content, quickstart: [{ description: 'Install', command: 'npm install' }] }) + '\n```');
    const result = await analyzeRepositoryDetails(options);
    expect(result.quickstart[0].command).toBe('npm install');
  });
  it.each(['# README', '', '# README\nnpm install --ignore-scripts'])('rejects fabricated or modified commands against evidence %j', async (readme) => {
    mocks.readme.mockResolvedValue({ content: readme, retrievedAt: '2026-09-01T00:00:00Z' });
    mocks.generate.mockResolvedValue(JSON.stringify({ ...content, quickstart: [{ description: 'Install', command: 'npm install && run-unknown-script' }] }));
    await expect(analyzeRepositoryDetails(options)).rejects.toThrow('not present in README evidence');
  });
  it('accepts literal multiline commands with normalized line endings', async () => {
    mocks.readme.mockResolvedValue({ content: '```sh\r\nnpm install\r\nnpm start\r\n```', retrievedAt: '2026-09-01T00:00:00Z' });
    mocks.generate.mockResolvedValue(JSON.stringify({ ...content, quickstart: [{ description: 'Start', command: 'npm install\nnpm start' }] }));
    expect((await analyzeRepositoryDetails(options)).quickstart[0].command).toBe('npm install\nnpm start');
  });
  it('rejects commands outside the README excerpt actually provided to the model', async () => {
    mocks.readme.mockResolvedValue({ content: 'x'.repeat(36000) + '\nnpm install', retrievedAt: '2026-09-01T00:00:00Z' });
    mocks.generate.mockResolvedValue(JSON.stringify({ ...content, quickstart: [{ description: 'Install', command: 'npm install' }] }));
    await expect(analyzeRepositoryDetails(options)).rejects.toThrow('not present in README evidence');
  });
});
