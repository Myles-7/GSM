#!/usr/bin/env node
'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { build } = require('esbuild');

async function main() {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== '--check')) throw new Error('Usage: node scripts/build-vector-worker.cjs [--check]');
  const root = path.resolve(__dirname, '..');
  const output = path.join(root, 'cloudflare-worker/worker.js');
  const result = await build({
    absWorkingDir: root,
    entryPoints: ['cloudflare-worker/src/index.ts'],
    outfile: output,
    bundle: true,
    format: 'esm',
    platform: 'browser',
    write: false,
  });
  const generated = result.outputFiles[0].text;
  if (args.includes('--check')) {
    const current = await fs.readFile(output, 'utf8');
    if (current.replace(/\r\n/g, '\n') !== generated.replace(/\r\n/g, '\n')) {
      throw new Error('Worker Dashboard bundle is stale. Run npm run build:vector-worker and include cloudflare-worker/worker.js.');
    }
    console.log('Worker Dashboard bundle matches its TypeScript source.');
  } else {
    await fs.writeFile(output, generated);
    console.log('Generated cloudflare-worker/worker.js from TypeScript.');
  }
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
