const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { clean } = require('./clean-workspace.cjs');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gsm-clean-test-'));
  const write = (name, value = 'retain') => {
    const target = path.join(root, name); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, value);
  };
  const dispose = () => {
    // Test-owned temporary fixture only; never used against the project.
    fs.rmSync(root, { recursive: true, force: true });
  };
  return { root, write, dispose };
}
test('defaults to dry-run and preserves runtime data when applied', () => {
  const f = fixture();
  try {
    f.write('scratch-init.png'); f.write('android-emulator.log'); f.write('scripts/__pycache__/audit.cpython-313.pyc');
    const protectedPaths = ['data/main.db', 'home-backend/current/server.js', 'output/backup.json', '.git/config', 'node_modules/package/index.js', 'dist/index.html', 'scripts/current.py', 'scripts/__pycache__/keep.txt'];
    protectedPaths.forEach(name => f.write(name));
    const preview = clean(f.root);
    assert.equal(preview.mode, 'dry-run'); assert.equal(preview.count, 3);
    assert.ok(fs.existsSync(path.join(f.root, 'scratch-init.png')));
    const applied = clean(f.root, { apply: true }); assert.equal(applied.count, 3);
    protectedPaths.forEach(name => assert.ok(fs.existsSync(path.join(f.root, name)), name));
    assert.equal(clean(f.root).count, 0);
  } finally { f.dispose(); }
});
test('does not traverse a linked cache outside the workspace', () => {
  const f = fixture(); const outside = fixture();
  try {
    outside.write('important.pyc'); fs.mkdirSync(path.join(f.root, 'scripts'));
    fs.symlinkSync(outside.root, path.join(f.root, 'scripts/__pycache__'), process.platform === 'win32' ? 'junction' : 'dir');
    assert.throws(() => clean(f.root, { apply: true }), /linked Python cache/);
    assert.ok(fs.existsSync(path.join(outside.root, 'important.pyc')));
  } finally { f.dispose(); outside.dispose(); }
});
