const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs/promises');

function assertProfile(profile) {
  const target = path.resolve(profile);
  const relative = path.relative(os.tmpdir(), target);
  if (relative.startsWith('..') || path.isAbsolute(relative) || relative.includes(path.sep) || !relative.startsWith('gsm-render-diag-')) throw new Error('Refusing non-diagnostic profile');
  return target;
}
async function removeProfile(profile) { await fs.rm(assertProfile(profile), { recursive: true, force: true }); }
function allowResource(raw, buildDir, devOrigin) {
  try {
    const url = new URL(raw);
    if (url.protocol === 'data:' || url.protocol === 'blob:') return true;
    if (url.protocol === 'file:') {
      const { fileURLToPath } = require('node:url');
      const relative = path.relative(path.resolve(buildDir), fileURLToPath(url));
      return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
    }
    if (!devOrigin || url.pathname.startsWith('/api')) return false;
    const dev = new URL(devOrigin);
    return url.origin === devOrigin && url.protocol === 'http:' || url.protocol === 'ws:' && url.host === dev.host;
  } catch { return false; }
}
function stats(values) {
  if (!values.length || values.some(v => !Number.isFinite(v))) throw new Error('Incomplete samples');
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return { n: sorted.length, median: sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2, min: sorted[0], max: sorted.at(-1) };
}
function assertSampleCompleteness(samples, sizes, scenarios, repetitions) {
  if (!scenarios.length || samples.length !== sizes.length * scenarios.length * repetitions) throw new Error('Incomplete scenario matrix');
  for (const size of sizes) for (const name of scenarios) {
    const rows = samples.filter(row => row.size === size && row.name === name);
    if (rows.length !== repetitions || new Set(rows.map(row => row.iteration)).size !== repetitions
      || rows.some(row => !Number.isInteger(row.iteration) || row.iteration < 0 || row.iteration >= repetitions)) throw new Error(`Incomplete samples: ${size}:${name}`);
  }
  for (const row of samples) {
    if (!Number.isFinite(row.paintOpportunityMs) || row.paintOpportunityMs <= 0 || !Number.isFinite(row.observationMs)
      || row.observationMs < row.paintOpportunityMs || row.repositoryCount !== row.size || !row.focused || row.visibility !== 'visible') throw new Error('Invalid sample state');
  }
}
module.exports = { assertProfile, removeProfile, allowResource, stats, assertSampleCompleteness };
