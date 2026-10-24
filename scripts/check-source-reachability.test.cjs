'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { checkReachability } = require('./check-source-reachability.cjs');

function fixture(files, run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gsm-source-gate-'));
  try {
    for (const [file, content] of Object.entries(files)) {
      const target = path.join(root, 'src', file);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, content);
    }
    run(root);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

test('follows static imports, re-exports, lazy modules and worker URLs', () => {
  fixture({
    'main.tsx': "import './barrel'; void import('./lazy'); new Worker(new URL('./worker.ts', import.meta.url));",
    'barrel.ts': "export { value } from './value';",
    'value.ts': 'export const value = 1;',
    'lazy.ts': "const helper = require('./helper');",
    'helper.ts': 'export const helper = 1;',
    'worker.ts': 'self.postMessage(1);',
  }, root => assert.deepEqual(checkReachability(root), { count: 6, unreachable: [] }));
});

test('detects test-only code and disconnected cycles without treating fixtures as production', () => {
  fixture({
    'main.tsx': 'export {};',
    'retired.ts': 'export const value = 1;',
    'retired.test.ts': "import './retired';",
    'cycleA.ts': "import './cycleB';",
    'cycleB.ts': "import './cycleA';",
    'example.fixture.ts': 'export {};',
    'test/setup.ts': 'export {};',
    '__fixtures__/data.ts': 'export {};',
  }, root => assert.deepEqual(checkReachability(root), { count: 4, unreachable: ['src/cycleA.ts', 'src/cycleB.ts', 'src/retired.ts'] }));
});

test('refuses to report success when the declared application entry is missing', () => {
  fixture({ 'orphan.ts': 'export {};' }, root => assert.throws(() => checkReachability(root), /Missing source entry/));
});
