'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

// Only regenerable, explicitly retired outputs. Runtime data and builds are excluded.
const retiredFiles = [
  'android-build-verification.log', 'android-emulator-error.log', 'android-emulator.log',
  'android-test-verification.log', 'dev-desktop-output.log', 'scratch-init.png',
  'tsconfig.app.tsbuildinfo', 'tsconfig.node.tsbuildinfo',
];

function regularFile(root, relative) {
  const target = path.resolve(root, relative);
  if (!target.startsWith(root + path.sep)) throw new Error('Cleanup path escaped the workspace');
  let current = root;
  for (const part of relative.split(/[\\/]/)) {
    current = path.join(current, part);
    if (!fs.existsSync(current)) return null;
    if (fs.lstatSync(current).isSymbolicLink()) throw new Error(`Cleanup refuses links: ${relative}`);
  }
  const stat = fs.statSync(target);
  if (!stat.isFile()) return null;
  return { path: relative.replaceAll('\\', '/'), bytes: stat.size, modifiedMs: stat.mtimeMs,
    sha256: crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex') };
}

function clean(root, { apply = false } = {}) {
  root = fs.realpathSync(root);
  const candidates = [...retiredFiles];
  const cache = path.join(root, 'scripts', '__pycache__');
  if (fs.existsSync(cache)) {
    if (fs.lstatSync(cache).isSymbolicLink()) throw new Error('Cleanup refuses a linked Python cache');
    for (const name of fs.readdirSync(cache)) if (/\.py[co]$/.test(name)) candidates.push(`scripts/__pycache__/${name}`);
  }
  const files = candidates.map(relative => regularFile(root, relative)).filter(Boolean);
  if (apply) {
    for (const file of files) {
      const current = regularFile(root, file.path);
      if (!current || current.sha256 !== file.sha256 || current.modifiedMs !== file.modifiedMs) throw new Error(`File changed during cleanup: ${file.path}`);
      fs.unlinkSync(path.join(root, file.path));
    }
    if (fs.existsSync(cache) && fs.readdirSync(cache).length === 0) fs.rmdirSync(cache);
  }
  return { mode: apply ? 'applied' : 'dry-run', count: files.length, bytes: files.reduce((sum, file) => sum + file.bytes, 0), files };
}

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== '--apply')) throw new Error('Usage: node scripts/clean-workspace.cjs [--apply]');
  console.log(JSON.stringify(clean(path.resolve(__dirname, '..'), { apply: args.includes('--apply') }), null, 2));
}
module.exports = { clean };
