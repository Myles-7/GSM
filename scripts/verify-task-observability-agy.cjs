// Explicit one-shot live acceptance: at most six synthetic requests, no retries.
// Uses the production isolated runtime and main-process queue; no renderer E2E claim.
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const { createAgyWorker } = require('../electron/agyRuntime');
const { AgyQueue } = require('../electron/agyQueue');

async function main() {
  if (!process.argv.includes('--run')) throw new Error('Explicit --run required');
  const output = path.resolve(__dirname, '../output/project-audit-20261021/agy-task-observability-20261022/live-agy.json');
  // Reserve the whole run before any dispatch so an accidental rerun cannot spend again.
  const file = await fs.open(output, 'wx');
  await file.close();
  const device = JSON.parse(await fs.readFile(path.join(process.env.APPDATA, 'Electron', 'agy-device.json'), 'utf8'));
  const override = device.prefs.featureOverrides?.organization ?? {};
  const model = override.model ?? device.prefs.model;
  const effort = override.effort ?? device.prefs.effort;
  const timeoutMs = (override.timeoutSeconds ?? device.prefs.timeoutSeconds) * 1000;
  const executable = typeof device.executable === 'string' ? device.executable : device.executable?.path;
  const report = { synthetic: true, scope: 'Production isolated worker and AgyQueue; not renderer or persisted task UI E2E',
    startedAt: new Date().toISOString(), model, effort, timeoutMs, configuredConcurrency: device.prefs.concurrency,
    maxCalls: 6, calls: 0, requests: [], freeMemoryBytes: os.freemem() };
  const save = () => fs.writeFile(output, JSON.stringify(report, null, 2));
  let worker, queue;
  try {
    if (!device.prefs.enabled || !executable || !model) throw new Error('Existing AGY configuration required');
    report.cliVersion = execFileSync(executable, ['--version'], { windowsHide: true, encoding: 'utf8', timeout: 15000 }).trim();
    const existing = execFileSync('powershell.exe', ['-NoProfile', '-Command', '@(Get-Process agy -ErrorAction SilentlyContinue).Count'], { windowsHide: true, encoding: 'utf8' }).trim();
    if (Number(existing) > 0) throw new Error('Existing AGY processes; capacity acceptance deferred');
    worker = createAgyWorker({ executable, model, effort });
    queue = new AgyQueue(device.prefs.concurrency);
    const featureLimits = Object.fromEntries(Object.entries(device.prefs.featureOverrides ?? {}).filter(([,v]) => v.concurrency).map(([k,v]) => [k,v.concurrency]));
    queue.configure(device.prefs.concurrency, featureLimits);
    let generating = 0, peak = 0;
    const request = async id => {
      if (++report.calls > 6) throw new Error('Acceptance call budget exceeded');
      const started = Date.now(), row = { id, startedAt: new Date().toISOString(), events: [], answerChars: 0, reasoningChars: 0 };
      report.requests.push(row); await save();
      let sent = false;
      try {
        const result = await queue.run('synthetic-observability', id, signal => worker.request({ requestId: id, signal, timeoutMs,
          prompt: `Use only this synthetic evidence. Reply with JSON only: {"id":"${id}","platforms":[...],"cloudSync":boolean,"summary":"..."}. Evidence: SyntheticNotes is a local Markdown editor for Windows and Linux, supports full-text search, and does not support cloud sync. Do not use tools.`,
          onInit: () => { row.initializedMs = Date.now() - started; },
          onPromptSent: () => { sent = true; generating++; peak = Math.max(peak, generating); row.sentMs = Date.now() - started; },
          onCleanup: () => { if (sent) { generating--; sent = false; } row.cleanupMs = Date.now() - started; },
          onText: text => { row.answerChars += text.length; row.firstOutputMs ??= Date.now() - started; },
          onReasoning: text => { row.reasoningChars += text.length; },
          onObservation: event => { row.events.push({ ...event, observedMs: Date.now() - started }); },
        }), { feature: 'organization', maxQueued: device.prefs.maxQueued, producer: 'synthetic-observability' });
        row.answer = result.text; row.usage = result.usage;
        let value; try { value = JSON.parse(result.text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')); } catch {}
        row.passed = value?.id === id && value.cloudSync === false && Array.isArray(value.platforms)
          && [...value.platforms].sort().join(',') === 'Linux,Windows' && typeof value.summary === 'string' && value.summary.length > 0;
        row.status = row.passed ? 'passed' : 'invalid-result';
      } catch (error) { row.status = error.code ?? 'FAILED'; row.details = error.details; }
      finally { if (sent) generating--; row.durationMs = Date.now() - started; await save(); }
      console.log(JSON.stringify({ id, status: row.status, durationMs: row.durationMs, reasoningChars: row.reasoningChars }));
      return row;
    };
    const baseline = await request('observability-baseline');
    report.baselinePeak = peak;
    if (!baseline.passed || worker.state().degraded || worker.state().suspect) { report.blocked = 'Baseline failed or worker cleanup is degraded; five-request expansion skipped'; return; }
    if (device.prefs.concurrency !== 5 || (featureLimits.organization ?? 5) < 5 || os.freemem() < 4 * 1024 ** 3) {
      report.blocked = 'Selected device/feature capacity or free memory insufficient for five; no setting changed'; return;
    }
    peak = 0;
    await Promise.all(Array.from({ length: 5 }, (_, i) => request(`observability-concurrent-${i + 1}`)));
    report.peakGeneratingConcurrency = peak;
    report.finalQueue = queue.state();
    report.nativeReasoningObserved = report.requests.some(row => row.reasoningChars > 0);
  } catch (error) { report.blocked = error.message; }
  finally { await queue?.shutdown(); await worker?.close(); report.finishedAt = new Date().toISOString(); await save(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
