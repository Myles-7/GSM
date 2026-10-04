'use strict';
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { performance } = require('node:perf_hooks');
const source = path.resolve(__dirname, '../src/utils/latestRepositoryRelease.ts');
const compiled = require('esbuild').transformSync(fs.readFileSync(source, 'utf8'), { loader: 'ts', format: 'cjs' }).code;
const loaded = new Module(source); loaded._compile(compiled, source);
const { latestRepositoryRelease } = loaded.exports;

const before = (releases, repositoryId) => releases.filter(release => release.repository.id === repositoryId)
  .sort((a, b) => Date.parse(b.published_at) - Date.parse(a.published_at))[0];
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
function sample(count, lookup) {
  const releases = Array.from({ length: count * 2 }, (_, i) => ({ id: i, repository: { id: Math.floor(i / 2) }, published_at: `2026-10-0${i % 2 + 1}T00:00:00.000Z` }));
  const started = performance.now();
  const selected = [];
  for (let i = 0; i < Math.min(count, 50); i++) selected.push(lookup(releases, i)?.id);
  return { ms: performance.now() - started, selected };
}
const scenarios = [100, 1000, 5000].map(count => {
  for (let i = 0; i < 5; i++) { sample(count, before); sample(count, latestRepositoryRelease); }
  const old = [], next = [];
  for (let i = 0; i < 9; i++) {
    // Alternate order to reduce one-sided warmup/GC bias.
    let a, b;
    if (i % 2) { b = sample(count, latestRepositoryRelease); a = sample(count, before); }
    else { a = sample(count, before); b = sample(count, latestRepositoryRelease); }
    if (JSON.stringify(a.selected) !== JSON.stringify(b.selected)) throw new Error('Lookup results differ');
    old.push(a.ms); next.push(b.ms);
  }
  return { repositories: count, releases: count * 2, visibleCards: 50, samples: 9,
    beforeMedianMs: median(old), afterMedianMs: median(next), beforeSamplesMs: old, afterSamplesMs: next,
    beforeFilterRecordsVisited: 50 * count * 2, afterIndexRecordsVisited: count * 2,
    afterCandidateRecordsVisited: Math.min(count, 50) * 2 };
});
console.log(JSON.stringify({ runtime: process.version, scope: 'CPU-only cold release-array lookup, excluding React, DOM and storage; not an end-to-end latency benchmark', scenarios }, null, 2));
