// Retire this acceptance's explicit artifacts without recursive deletion.
const fs = require('node:fs'), path = require('node:path');
const root = path.resolve(__dirname, '../..');
const scratch = path.resolve(process.argv[2] || '');
if (!path.isAbsolute(process.argv[2] || '') || !/^gsm-failure-fix-[\w-]+$/.test(path.basename(scratch))) throw Error('Explicit owned scratch path required');
const recordPath = path.join(root, 'docs/personal/upgrades/task-failure-fixes-validation-20261017.json');
const report = JSON.parse(fs.readFileSync(recordPath, 'utf8').replace(/^\uFEFF/, ''));
if (report.root.failed || report.server.failed || report.deployment.health !== 'ok') throw Error('Accepted validation required');
const targets = [scratch, path.join(root, 'output/reliability/native-agy'), path.join(root, 'output/reliability/sqlite-smoke')];
const files = [], directories = [];
function inspect(directory) {
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || path.resolve(fs.realpathSync(directory)).toLowerCase() !== directory.toLowerCase()) throw Error('Unexpected link or cleanup root');
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name), item = fs.lstatSync(filename);
    if (item.isSymbolicLink()) throw Error('Links must never be followed');
    if (item.isDirectory()) inspect(filename);
    else if (item.isFile()) files.push({ filename, bytes: item.size, mtime: item.mtimeMs });
    else throw Error('Unexpected filesystem entry');
  }
  directories.push(directory);
}
for (const target of targets) inspect(target);
const summary = { files: files.length, bytes: files.reduce((total, file) => total + file.bytes, 0), allTargetsAbsent: false };
if (process.argv.includes('--apply')) {
  for (const file of files) {
    const current = fs.lstatSync(file.filename);
    if (!current.isFile() || current.isSymbolicLink() || current.size !== file.bytes || current.mtimeMs !== file.mtime) throw Error('Artifact changed during cleanup');
    fs.unlinkSync(file.filename);
  }
  // Postorder removal of verified, now-empty directories; never recursive.
  for (const directory of directories) fs.rmdirSync(directory);
  if (targets.some(target => fs.existsSync(target))) throw Error('Cleanup incomplete');
  const output = path.join(root, 'output/reliability');
  if (fs.existsSync(output) && fs.readdirSync(output).length === 0) fs.rmdirSync(output);
  summary.allTargetsAbsent = true;
  report.cleanup.scratch = summary;
  fs.writeFileSync(recordPath, JSON.stringify(report, null, 2) + '\n');
}
console.log(JSON.stringify(summary));
