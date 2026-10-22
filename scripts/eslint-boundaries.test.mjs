import assert from 'node:assert/strict';
import test from 'node:test';
import { ESLint } from 'eslint';

const eslint = new ESLint();
for (const filePath of ['src/components/BoundaryProbe.tsx', 'src/features/repositories/components/BoundaryProbe.tsx']) {
  test(`view import and route rules both apply to ${filePath}`, async () => {
    const [result] = await eslint.lintText(
      "export async function probe() { await import('../../../services/githubApi'); return new GitHubApiService('token'); }",
      { filePath },
    );
    const messages = result.messages.filter(message => message.ruleId === 'no-restricted-syntax');
    assert.equal(messages.length, 2, JSON.stringify(result.messages));
    assert.ok(messages.some(message => message.message.includes('dynamically')));
    assert.ok(messages.some(message => message.message.includes('route-mode')));
  });
}
