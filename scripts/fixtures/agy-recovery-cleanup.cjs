// Delete only this recovery acceptance run's owned artifacts after verification.
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const recordPath = path.join(root, 'docs/personal/upgrades/agy-recovery-validation-20261017.json');
const tag = 'recovery/agy-recovery-20261017';
function inspect(target) {
  let ancestor = target;
  while (ancestor !== path.dirname(ancestor)) {
    if (fs.existsSync(ancestor) && fs.lstatSync(ancestor).isSymbolicLink()) throw Error('Linked cleanup path');
    ancestor = path.dirname(ancestor);
  }
  const files = [], directories = [];
  const visit = file => {
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink()) throw Error('Linked cleanup entry');
    if (stat.isDirectory()) {
      directories.push(file);
      for (const name of fs.readdirSync(file)) visit(path.join(file, name));
    } else if (stat.isFile()) files.push({ path: file, size: stat.size, mtimeMs: stat.mtimeMs });
    else throw Error('Special cleanup entry');
  };
  if (fs.existsSync(target)) visit(target);
  return { files, directories };
}
function main() {
  if (process.argv.slice(2).some(arg => arg !== '--apply')) throw Error('Usage: agy-recovery-cleanup.cjs [--apply]');
  const record = JSON.parse(fs.readFileSync(recordPath));
  if (record.status !== 'verified-local-source-and-unpacked' || record.root.failed || !record.root.passed
    || !record.native.packaged.rendererMatchesBuild || !record.native.profile.businessFieldsPreserved
    || !record.originalProfile.allHashesUnchanged || record.gates.some(gate => gate.exitCode !== 0)) throw Error('Successful acceptance required');
  const targets = fs.readdirSync(path.join(root, 'output')).filter(name => name.startsWith('agy-recovery-'))
    .map(name => path.join(root, 'output', name));
  const debug = path.join(root, 'release/agy-recovery-20261017/builder-debug.yml');
  if (fs.existsSync(debug)) targets.push(debug);
  const plans = targets.map(inspect);
  const summary = { mode: process.argv.includes('--apply') ? 'applied' : 'dry-run',
    targets: targets.map(target => path.relative(root, target)),
    files: plans.reduce((n, plan) => n + plan.files.length, 0),
    bytes: plans.reduce((n, plan) => n + plan.files.reduce((total, file) => total + file.size, 0), 0) };
  if (summary.mode === 'applied') {
    targets.forEach((target, index) => {
      if (JSON.stringify(inspect(target)) !== JSON.stringify(plans[index])) throw Error('Cleanup inventory changed');
    });
    for (const plan of plans) {
      for (const file of plan.files) {
        const stat = fs.lstatSync(file.path);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== file.size || stat.mtimeMs !== file.mtimeMs) throw Error('Cleanup file changed');
        fs.unlinkSync(file.path);
      }
      for (const directory of [...plan.directories].reverse()) fs.rmdirSync(directory);
    }
    if (targets.some(target => fs.existsSync(target))) throw Error('Cleanup incomplete');
    const present = cp.spawnSync('git', ['show-ref', '--verify', '--quiet', 'refs/tags/' + tag], { cwd: root });
    if (present.status === 0) {
      const deleted = cp.spawnSync('git', ['tag', '-d', tag], { cwd: root });
      if (deleted.status !== 0) throw Error('Checkpoint tag deletion failed');
    } else if (present.status !== 1) throw Error('Cannot inspect checkpoint tag');
    if (cp.spawnSync('git', ['show-ref', '--verify', '--quiet', 'refs/tags/' + tag], { cwd: root }).status !== 1) throw Error('Checkpoint tag remains');
    record.cleanup = { ...summary, verifiedAbsent: true, sourceCheckpointTagAbsent: true, completedAt: new Date().toISOString() };
    fs.writeFileSync(recordPath, JSON.stringify(record, null, 2) + '\n');
  }
  console.log(JSON.stringify(summary));
}
if (require.main === module) main();
