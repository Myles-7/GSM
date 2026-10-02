import { describe, expect, it } from 'vitest';
import { isRepositoryCodePath, rankedCandidatePaths } from './repositoryChatService';
import { needsReindex } from './vectorSearchService';
import { sanitizeForLog } from '../utils/logSanitizer';

describe('AI audit acceptance', () => {
  it('allows tests as source evidence when the question explicitly targets tests', () => {
    expect(isRepositoryCodePath('tests/parser.test.ts')).toBe(true);
    expect(rankedCandidatePaths([{ path: 'tests/parser.test.ts', type: 'blob' }], 'parser tests', 'implementation'))
      .toContain('tests/parser.test.ts');
  });
  it('includes common source languages independent of directory layout', () => {
    for (const path of ['main.py', 'cmd/server/main.go', 'internal/auth/service.go', 'src/main.cpp',
      'src/App.vue', 'Sources/App.swift', 'lib/main.dart', 'packages/app/src/main.rs', 'Program.cs']) {
      expect(isRepositoryCodePath(path), path).toBe(true);
      expect(rankedCandidatePaths([{ path, type: 'blob' }], 'implementation', 'implementation')).toContain(path);
    }
  });

  it('does not expand evidence into credentials, dependencies or generated outputs', () => {
    for (const path of ['node_modules/x/index.js', '.env.local', 'credentials.json', '../main.py',
      'src/../../secret.py', 'vendor/app.go', '/root.py', 'C:/main.py', 'dist/app.js',
      'src/key.pem', 'build/config.json', '.git/config', 'bundle.min.js']) {
      expect(isRepositoryCodePath(path), path).toBe(false);
      expect(rankedCandidatePaths([{ path, type: 'blob' }], path, 'implementation')).not.toContain(path);
    }
  });

  it('reserves root README and manifests before the candidate cap', () => {
    const paths = rankedCandidatePaths([
      { path: 'README.md', type: 'blob' }, { path: 'package.json', type: 'blob' },
      ...Array.from({ length: 100 }, (_, n) => ({ path: `docs/deployment-${n}.md`, type: 'blob' })),
    ], 'deployment configuration', 'deployment');
    expect(paths).toContain('README.md');
    expect(paths).toContain('package.json');
    expect(paths.length).toBeLessThanOrEqual(80);
  });

  it('invalidates incrementally indexed content when the upstream repository changes', () => {
    expect(needsReindex({
      pushed_at: '2026-09-27T00:00:00Z', updated_at: '2026-09-27T00:00:00Z',
      vector_indexed_at: '2026-09-02T00:00:00Z',
    }, false)).toBe(true);
  });

  it('redacts credentials embedded in multiline prose', () => {
    const raw = 'Example:\nAPI_KEY=sk-audit-fake-secret-12345678901234567890\nsecret=synthetic-value';
    const logged = JSON.stringify(sanitizeForLog({ content: raw }));
    expect(logged).not.toContain('12345678901234567890');
    expect(logged).not.toContain('synthetic-value');
    expect(logged).toContain('[redacted]');
  });
});
