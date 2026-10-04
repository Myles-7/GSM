// Read-only source-map attribution for Chromium CPU samples; no runtime instrumentation.
const fs = require('node:fs');
const path = require('node:path');
const { TraceMap, originalPositionFor } = require('@jridgewell/trace-mapping');
function selectRendererEvents(events, includeCpu = false) {
  const marker = events.find(event => event.name === 'gsm:diag-operation-start');
  // Operation marks identify this page's renderer main thread, excluding compositor/main-process work.
  if (!marker) return events;
  const profiles = new Set(events.filter(event => event.name === 'Profile' && event.pid === marker.pid && event.tid === marker.tid).map(event => event.id));
  // V8 emits ProfileChunk on its sampler thread; associate it with the main-thread Profile id.
  return events.filter(event => event.pid === marker.pid && (event.tid === marker.tid || includeCpu && event.name === 'ProfileChunk' && profiles.has(event.id)));
}
function summarize(traceFile, buildDir) {
  const events = selectRendererEvents(JSON.parse(fs.readFileSync(traceFile, 'utf8')).traceEvents, true);
  const operationStart = events.find(event => event.name === 'gsm:diag-operation-start')?.ts;
  const operationEnd = events.find(event => event.name === 'gsm:diag-operation-end')?.ts;
  const profiles = new Map(); const maps = new Map(); const totals = new Map();
  function source(frame) {
    try {
      if (!frame?.url || !frame.url.startsWith('file:')) return null;
      const file = require('node:url').fileURLToPath(frame.url);
      const relative = path.relative(buildDir, file);
      if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
      if (!maps.has(file)) maps.set(file, new TraceMap(JSON.parse(fs.readFileSync(`${file}.map`, 'utf8'))));
      const position = originalPositionFor(maps.get(file), { line: frame.lineNumber + 1, column: frame.columnNumber });
      return position.source ? { file: position.source, line: position.line, name: position.name || frame.functionName } : null;
    } catch { return null; }
  }
  for (const event of events) {
    if (event.name !== 'Profile' && event.name !== 'ProfileChunk') continue;
    const key = `${event.pid}:${event.id}`;
    if (!profiles.has(key)) profiles.set(key, { nodes: new Map(), samples: [], deltas: [], start: undefined });
    const profile = profiles.get(key); const data = event.args?.data;
    if (Number.isFinite(data?.startTime)) profile.start = data.startTime;
    for (const node of data?.cpuProfile?.nodes || []) profile.nodes.set(node.id, node);
    profile.samples.push(...data?.cpuProfile?.samples || []); profile.deltas.push(...data?.timeDeltas || []);
  }
  let includedSamples = 0;
  for (const profile of profiles.values()) {
    const parents = new Map();
    for (const node of profile.nodes.values()) {
      if (node.parent) parents.set(node.id, node.parent);
      for (const child of node.children || []) parents.set(child, node.id);
    }
    let cursor = profile.start ?? 0;
    profile.samples.forEach((id, index) => {
      const delta = profile.deltas[index] || 0;
      const previous = cursor; cursor += delta;
      const clipped = profile.start !== undefined && operationStart !== undefined && operationEnd !== undefined
        ? Math.max(0, Math.min(cursor, operationEnd) - Math.max(previous, operationStart)) : delta;
      const ms = clipped / 1000;
      if (!ms) return;
      includedSamples++;
      const seen = new Set(); let node = profile.nodes.get(id); let self = true;
      while (node) {
        const origin = source(node.callFrame);
        if (origin) {
          const key = `${origin.file}:${origin.line}:${origin.name}`;
          if (!totals.has(key)) totals.set(key, { ...origin, sampledSelfMs: 0, sampledInclusiveMs: 0, samples: 0 });
          const row = totals.get(key);
          if (self) row.sampledSelfMs += ms;
          if (!seen.has(key)) { row.sampledInclusiveMs += ms; row.samples++; seen.add(key); }
        }
        self = false; node = profile.nodes.get(parents.get(node.id));
      }
    });
  }
  const rows = [...totals.values()];
  return { trace: path.basename(traceFile), profiles: profiles.size, sampleCount: includedSamples,
    caveat: 'CPU sample interval estimates clipped to operation marks; inclusive rows overlap and must not be summed. Chromium layout/paint are separate trace events.',
    topSelf: rows.sort((a, b) => b.sampledSelfMs - a.sampledSelfMs).slice(0, 30),
    topApplicationInclusive: rows.filter(r => !r.file.includes('node_modules') && r.file.includes('src/')).sort((a, b) => b.sampledInclusiveMs - a.sampledInclusiveMs).slice(0, 30) };
}
if (require.main === module) console.log(JSON.stringify(summarize(path.resolve(process.argv[2]), path.resolve(process.argv[3])), null, 2));
module.exports = { summarize, selectRendererEvents };
