const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createLocalProjects, within } = require('./agyLocalProjects');

test('native-selected source scope respects ignores, sensitive files and ownership', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gsm-local-test-'));
  const service = createLocalProjects({ selectDirectory: async () => root });
  try {
    await fs.mkdir(path.join(root, 'src'));
    await fs.mkdir(path.join(root, 'node_modules'));
    for (const [file, text] of Object.entries({ 'README.md': 'Synthetic project', 'src/main.ts': 'export const value = 1;',
      '.env.local': 'synthetic-secret', 'ignored.md': 'ignored', '.gitignore': 'ignored.md\n', 'node_modules/lib.ts': 'dependency' })) {
      await fs.writeFile(path.join(root, file), text);
    }
    const project = await service.choose(1);
    assert.match(project.identity, /^[a-f0-9]{64}$/);
    const rebound = await service.choose(1);
    assert.equal(rebound.identity, project.identity);
    assert.notEqual(rebound.id, project.id);
    assert.deepEqual(project.entries.map(entry => entry.path).sort(), ['README.md', 'src/main.ts']);
    const source = await service.read(1, project.id, 'src/main.ts');
    assert.match(source.contentHash, /^[a-f0-9]{64}$/);
    assert.equal(source.content, 'export const value = 1;');
    await assert.rejects(service.read(2, project.id, 'src/main.ts'), { code: 'LOCAL_GRANT_REQUIRED' });
    await assert.rejects(service.read(1, project.id, '../secret.txt'), { code: 'LOCAL_PATH_DENIED' });
    await assert.rejects(service.read(1, project.id, '.env.local'), { code: 'LOCAL_PATH_DENIED' });
    service.revoke(1);
    await assert.rejects(service.read(1, project.id, 'README.md'), { code: 'LOCAL_GRANT_REQUIRED' });
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('directory boundary rejects sibling prefixes and the root itself', () => {
  const root = path.resolve('synthetic-project');
  assert.equal(within(root, path.join(root, 'src', 'a.ts')), true);
  assert.equal(within(root, `${root}-other/a.ts`), false);
  assert.equal(within(root, root), false);
});
