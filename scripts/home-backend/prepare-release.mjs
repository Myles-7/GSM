import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';

const repository = fileURLToPath(new URL('../../', import.meta.url));
const argumentsMap = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  if (!process.argv[index].startsWith('--') || !process.argv[index + 1]) throw new Error('Use --output <new-directory> --expected-node <exact-version> [--npm-cli <npm-cli.js>]');
  argumentsMap.set(process.argv[index], process.argv[index + 1]);
}
if (process.platform !== 'win32') throw new Error('Windows service releases must be prepared on Windows for the target native SQLite ABI.');
if (argumentsMap.get('--expected-node') !== process.version) throw new Error('Supply --expected-node matching the exact Node runtime selected for deployment.');
if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('Node 22+ is required.');
const outputArg = argumentsMap.get('--output');
if (!outputArg || !path.isAbsolute(outputArg)) throw new Error('--output must be an absolute NEW directory.');
const output = path.resolve(outputArg);
if (fs.existsSync(output)) throw new Error('Output already exists. Select a new release directory.');
const source = path.join(repository, 'server');
const npmCli = argumentsMap.get('--npm-cli') || process.env.npm_execpath || path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
if (!fs.existsSync(npmCli) || !npmCli.endsWith('.js')) throw new Error('Cannot locate npm-cli.js. Supply --npm-cli from the selected Node distribution.');
const sourcePackage = JSON.parse(fs.readFileSync(path.join(source, 'package.json'), 'utf8'));
const rootPackage = JSON.parse(fs.readFileSync(path.join(repository, 'package.json'), 'utf8'));
if (sourcePackage.version !== rootPackage.version) throw new Error('Root and server versions differ. Run the repository version sync before packaging.');
function run(script, args, cwd) {
  const result = spawnSync(process.execPath, [script, ...args], { cwd, stdio: 'inherit', env: { ...process.env, PATH: `${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH || ''}` } });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Build command failed with exit code ${result.status}`);
}
const compiler = path.join(source, 'node_modules/typescript/bin/tsc');
if (!fs.existsSync(compiler)) throw new Error('Install locked server development dependencies first: npm --prefix server ci');
const target = path.join(output, 'server');
fs.mkdirSync(target, { recursive: true });
// Deliberate allowlist: never package source data, keys, .env files, logs or the repository.
for (const name of ['package.json', 'package-lock.json']) fs.copyFileSync(path.join(source, name), path.join(target, name));
// Compile directly into the new staging directory so stale files in server/dist cannot leak into a release.
run(compiler, ['--project', path.join(source, 'tsconfig.json'), '--outDir', path.join(target, 'dist')], repository);
run(npmCli, ['ci', '--omit=dev', '--no-audit', '--no-fund'], target);
const smoke = spawnSync(process.execPath, ['-e', "const D=require('./node_modules/better-sqlite3');const d=new D(':memory:');d.exec('CREATE TABLE probe(v)');d.close()"], { cwd: target, stdio: 'inherit' });
if (smoke.error || smoke.status !== 0) throw new Error('Packaged native SQLite binding does not match this Node runtime.');
const sha256 = filename => crypto.createHash('sha256').update(fs.readFileSync(filename)).digest('hex');
fs.writeFileSync(path.join(output, 'release-manifest.json'), JSON.stringify({
  applicationVersion: sourcePackage.version,
  nodeVersion: process.version,
  nodeArchitecture: process.arch,
  nodeSha256: sha256(process.execPath),
  packageLockSha256: sha256(path.join(target, 'package-lock.json')),
  preparedAt: new Date().toISOString(),
}, null, 2) + '\n');
console.log(`Prepared Windows backend release: ${output}`);
console.log('Deploy using the same verified node.exe. Manifest hashes document build provenance, not independent publisher authenticity.');
