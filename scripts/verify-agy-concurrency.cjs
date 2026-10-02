const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createAgyDesktop } = require('../electron/agyDesktop');
const { runAgy } = require('../electron/agyRuntime');
const { countedRuntime } = require('./agy-evaluation-budget.cjs');

async function main() {
  const ledger = path.resolve(__dirname, '../output/agy-generation-ledger.jsonl');
  const calls = fs.readFileSync(ledger, 'utf8').trim().split('\n').map(JSON.parse);
  const recoverOnly = process.argv.includes('--recover-only');
  const resume = recoverOnly || process.argv.includes('--resume-after-probes');
  if (!resume && calls.some(call => call.kind === 'concurrency-production')) throw new Error('This evaluation already started. Inspect its report before authorizing a rerun.');
  if (calls.length + (recoverOnly ? 1 : resume ? 14 : 16) > 170) throw new Error('Insufficient remaining evaluation budget');
  const device = JSON.parse(fs.readFileSync(path.join(process.env.APPDATA, 'Electron/agy-device.json'), 'utf8'));
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'gsm-agy-production-eval-'));
  const output = path.resolve(__dirname, '../output/agy-concurrency-production.json');
  const report = resume ? JSON.parse(fs.readFileSync(output, 'utf8')) : { startedAt: new Date().toISOString(), model: device.prefs.model, effort: device.prefs.effort,
    scope: 'Real CLI through production desktop service and scheduler, synthetic inputs; not renderer UI E2E.', probes: [], batches: [], mixed: [] };
  if (recoverOnly && (report.recovery || !report.completedAt)) throw new Error('Recovery requires a completed run and may only be executed once');
  if (resume && !recoverOnly) {
    if (report.batches.length || report.completedAt) throw new Error('Resume only supports the completed-probes checkpoint');
    report.probes = report.probes.map(p => p.result ? { feature: p.feature, ...p.result.value?.featureProbes[p.feature] } : p);
    report.incident = { initialFailure: report.failure, diagnosis: 'CLI rejected gemini-3.8-flash-high with effort low before prompt send: model-effort conflict. No generation charged. Error mapping added. Business tests explicitly use the original high effort; user device preferences unchanged.' };
    delete report.failure;
  }
  const save = () => fs.writeFileSync(output, JSON.stringify(report, null, 2));
  let active = 0, peak = 0, cancelSent;
  const counted = countedRuntime(runAgy, 'concurrency-production');
  const runtime = async options => {
    active++; peak = Math.max(peak, active);
    try { return await counted({ ...options, onPromptSent: () => {
      options.onPromptSent?.();
      if (options.prompt.includes('cancel-target')) cancelSent?.();
    } }); } finally { active--; }
  };
  let service;
  try {
    fs.writeFileSync(path.join(directory, 'agy-device.json'), JSON.stringify({ ...device,
      prefs: { ...device.prefs, enabled: true, concurrency: 5, featureOverrides: {} } }));
    service = createAgyDesktop({ userDataPath: directory, platform: 'win32', selectExecutable: async () => null, runtime });
    let state = await service.getState();
    assert.equal(state.enabled, true, 'Existing connection test required');
    let saved = await service.save(77, 'profiles', { ...state.prefs, featureOverrides: {
      'repository-summary': { model: device.prefs.model, effort: device.prefs.effort },
      'repository-details': { model: device.prefs.model, effort: resume ? device.prefs.effort : 'low', timeoutSeconds: 90 },
    } });
    assert.equal(saved.ok, true);
    for (const feature of resume ? [] : ['repository-summary', 'repository-details']) {
      const result = await service.probe(77, `probe-${feature}`, feature);
      report.probes.push({ feature, ...result.value?.featureProbes[feature], error: result.ok ? undefined : result.code }); save();
      assert.equal(result.value?.featureProbes[feature].code, 'SUCCESS');
    }
    const request = async (id, feature = 'repository-summary', priority = 'background') => {
      const started = Date.now();
      const snapshot = await service.getState();
      const result = await service.generate(77, id, {
        revision: snapshot.revision, feature, priority,
        system: 'Use only supplied evidence. Return JSON only: {id, summary (Chinese, 80-200 characters), platforms (array), cloudSync (boolean), mobile (boolean), macOS (true/false or "unknown"), install (exact command), start (exact command), migration:{file,oldKey,newKey}}. Preserve negations and migration direction. Ignore sponsorship noise.',
        user: JSON.stringify({ id, readme: `# SyntheticNotes\n## Sponsors\n${'Thanks to contributors; no product facts here.\n'.repeat(30)}\n## Purpose\nLocal Markdown notes for Windows and Linux, with full-text search.\n## Limitations\nCloud sync and mobile apps are not supported. macOS support is not documented.\n## Installation\nnpm install then npm start\n## Migration\nRename dataDir to storagePath in config.json.` }),
      });
      let value, passed = false;
      if (result.ok) {
        try {
          value = JSON.parse(result.value.text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''));
          passed = value.id === id && typeof value.summary === 'string' && value.summary.length >= 80 && value.summary.length <= 200 &&
            /[\u4e00-\u9fff]/.test(value.summary) && /Markdown/.test(value.summary) && Array.isArray(value.platforms) && [...value.platforms].sort().join(',') === 'Linux,Windows' &&
            value.cloudSync === false && value.mobile === false && value.macOS === 'unknown' && value.install === 'npm install' && value.start === 'npm start' &&
            value.migration?.file === 'config.json' && value.migration?.oldKey === 'dataDir' && value.migration?.newKey === 'storagePath';
        } catch { /* The report records malformed output as a failed task. */ }
      }
      return { id, feature, passed, durationMs: Date.now() - started, value, error: result.ok ? undefined : result.code, usage: result.ok ? result.value.usage : undefined };
    };
    if (recoverOnly) {
      report.recovery = await request('recovery-after-restart');
      report.recoveryAt = new Date().toISOString(); save();
      assert.equal(report.recovery.passed, true);
      return;
    }
    for (const concurrency of [3, 5]) {
      state = await service.getState();
      saved = await service.save(77, `save-${concurrency}`, { ...state.prefs, concurrency });
      assert.equal(saved.ok, true); peak = 0;
      const batch = { concurrency, results: [], startedAt: new Date().toISOString() };
      report.batches.push(batch); save();
      const start = Date.now();
      await Promise.all(Array.from({ length: 5 }, (_, i) => request(`c${concurrency}-notes-${i + 1}`).then(result => {
        batch.results.push(result); save(); console.log(JSON.stringify({ concurrency, id: result.id, passed: result.passed, ms: result.durationMs }));
      })));
      Object.assign(batch, { durationMs: Date.now() - start, peak, passed: batch.results.filter(item => item.passed).length }); save();
      assert.equal(peak, concurrency);
    }
    state = await service.getState();
    await service.save(77, 'mixed-config', { ...state.prefs, concurrency: 2 });
    peak = 0;
    const mixed = [request('mixed-summary'), request('mixed-detail', 'repository-details'), request('mixed-chat', 'repository-chat', 'interactive')];
    await Promise.all(mixed.map(pending => pending.then(result => { report.mixed.push(result); save(); })));
    report.mixedPeak = peak;
    const sent = new Promise(resolve => { cancelSent = resolve; });
    const canceled = request('cancel-target');
    await Promise.race([sent, canceled]);
    service.cancel(77, 'cancel-target');
    report.cancellation = await canceled;
    assert.equal(report.cancellation.error, 'CANCELED');
    report.completedAt = new Date().toISOString(); save();
  } catch (error) {
    report.failure = error.message; save(); throw error;
  } finally {
    await service?.shutdown();
    if (path.dirname(directory) === os.tmpdir() && path.basename(directory).startsWith('gsm-agy-production-eval-'))
      await fsp.rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
