// Retire only this acceptance run's artifacts, after recorded verification.
// Enumerate and recheck regular files; never recursively remove a directory.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const recordPath = path.join(root, 'docs/personal/upgrades/reliability-validation-20261017.json');
const targets = [
  path.join(root, 'output/reliability'),
  path.resolve(root, '../GSM-recovery/reliability-20261017-1719'),
];
function inspect(target) {
  // Reject junctions/links in both ancestors and artifact contents.
  let ancestor = target;
  while (ancestor !== path.dirname(ancestor)) {
    if (fs.existsSync(ancestor) && fs.lstatSync(ancestor).isSymbolicLink()) throw Error('Linked cleanup path refused');
    ancestor = path.dirname(ancestor);
  }
  const files = [], directories = [];
  function visit(directory) {
    directories.push(directory);
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name), stat = fs.lstatSync(file);
      if (stat.isSymbolicLink()) throw Error('Linked cleanup entry refused');
      if (stat.isDirectory()) visit(file);
      else if (stat.isFile()) files.push({ path: file, bytes: stat.size, mtimeMs: stat.mtimeMs });
      else throw Error('Special cleanup entry refused');
    }
  }
  if (fs.existsSync(target)) visit(target);
  return { files, directories };
}
function main() {
  if (process.argv.slice(2).some(arg => arg !== '--apply')) throw Error('Usage: node scripts/fixtures/reliability-cleanup.cjs [--apply]');
  const record = JSON.parse(fs.readFileSync(recordPath));
  if (record.status !== 'verified-local-source' || !record.gates?.root?.passed || !record.native?.packaged?.packaged || record.originalProfile?.errors !== 0) throw Error('Successful acceptance record required');
  if (JSON.parse(fs.readFileSync(path.join(root, 'package.json'))).name !== 'github-stars-manager') throw Error('Wrong workspace');
  const plans = targets.map(inspect);
  const summary = {
    mode: process.argv.includes('--apply') ? 'applied' : 'dry-run',
    targets: ['output/reliability', '../GSM-recovery/reliability-20261017-1719'],
    files: plans.reduce((n, plan) => n + plan.files.length, 0),
    bytes: plans.reduce((n, plan) => n + plan.files.reduce((total, file) => total + file.bytes, 0), 0),
  };
  if (summary.mode === 'applied') {
    // Check the whole inventory again before touching any file.
    targets.forEach((target, index) => {
      if (JSON.stringify(inspect(target)) !== JSON.stringify(plans[index])) throw Error('Cleanup inventory changed');
    });
    for (const plan of plans) {
      for (const file of plan.files) {
        const stat = fs.lstatSync(file.path);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== file.bytes || stat.mtimeMs !== file.mtimeMs) throw Error('Cleanup file changed');
        fs.unlinkSync(file.path);
      }
      for (const directory of [...plan.directories].reverse()) fs.rmdirSync(directory);
    }
    if (targets.some(target => fs.existsSync(target))) throw Error('Cleanup incomplete');
    record.cleanup = { ...summary, verifiedAbsent: true, completedAt: new Date().toISOString() };
    fs.writeFileSync(recordPath, JSON.stringify(record, null, 2) + '\n');
  }
  console.log(JSON.stringify(summary));
}
if (require.main === module) main();
