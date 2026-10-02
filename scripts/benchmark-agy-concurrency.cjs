const fs = require('node:fs/promises');
const syncFs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createAgyWorkspace, runAgy } = require('../electron/agyRuntime');
const { countedRuntime } = require('./agy-evaluation-budget.cjs');

async function main() {
  const device = JSON.parse(await fs.readFile(path.join(process.env.APPDATA, 'Electron', 'agy-device.json'), 'utf8'));
  const output = path.resolve(__dirname, '../output/agy-concurrency-benchmark.json');
  const tasks = Array.from({ length: 5 }, (_, index) => ({
    id: `notes-${index + 1}`, name: `SyntheticNotes${index + 1}`,
    readme: `# SyntheticNotes${index + 1}\n## Sponsors\n${'Thanks to contributors. This section does not describe product capabilities.\n'.repeat(30)}\n## Purpose\nA local Markdown note editor for Windows and Linux. Full-text search is included.\n## Limitations\nCloud sync and mobile apps are not supported. No macOS support is documented.\n## Installation\nRun npm install then npm start.\n## Version 2 migration\nRename dataDir to storagePath in config.json.\n`,
  }));
  const report = { at: new Date().toISOString(), model: device.prefs.model, effort: device.prefs.effort,
    scope: 'Direct production CLI transport, independent workspaces, synthetic summaries. Not production scheduler E2E.',
    retries: 0, taskCountPerLevel: tasks.length, levels: [] };
  const levels = process.argv.includes('--remaining') ? [2, 3, 5] : [1, 2, 3, 5];
  const ledger = syncFs.readFileSync(path.resolve(__dirname, '../output/agy-generation-ledger.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  const previousCalls = ledger.filter(entry => /^concurrency-/.test(entry.kind)).length;
  if (previousCalls + levels.length * tasks.length > 20) throw new Error('Benchmark 20-call limit would be exceeded. Inspect existing results before resuming.');
  if (levels[0] !== 1) {
    const usage = syncFs.readFileSync(path.resolve(__dirname, '../output/agy-generation-usage.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
    report.recoveredSerial = { callsStarted: ledger.filter(entry => entry.kind === 'concurrency-1').length,
      completedTransport: usage.filter(entry => entry.kind === 'concurrency-1'),
      note: 'Interrupted initial run; complete answers and full-batch wall time unavailable. Timing-only baseline.' };
  }
  const checkpoint = () => syncFs.writeFileSync(output, JSON.stringify(report, null, 2));
  for (const concurrency of levels) {
    const run = countedRuntime(runAgy, `concurrency-${concurrency}`);
    const level = { concurrency, startedAt: new Date().toISOString(), results: [] };
    report.levels.push(level);
    let next = 0;
    const started = Date.now();
    const worker = async () => {
      while (next < tasks.length) {
        const task = tasks[next++];
        const start = Date.now();
        let cwd;
        let firstTextMs;
        let result;
        try {
          cwd = await createAgyWorkspace();
          const response = await run({ executable: device.executable, cwd, model: device.prefs.model || undefined,
            effort: device.prefs.effort, timeoutMs: device.prefs.timeoutSeconds * 1000,
            onText: () => { firstTextMs ??= Date.now() - start; },
            prompt: `Analyze this repository using only supplied evidence. Return JSON only with exactly these keys:
id (exact input id), summary (Chinese, 80-200 characters, covering purpose, supported platforms and limitations),
platforms (documented supported platforms), cloudSync (boolean), mobile (boolean), macOS (true/false or "unknown"),
install (exact command), start (exact command), migration {file,oldKey,newKey}, tags (2-5 relevant strings).
Do not infer unsupported platforms. Ignore sponsorship noise. Preserve negations and migration direction.
INPUT: ${JSON.stringify(task)}` });
          const value = JSON.parse(response.text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''));
          const checks = {
            id: value.id === task.id,
            summary: typeof value.summary === 'string' && value.summary.length >= 80 && value.summary.length <= 200
              && /[\u4e00-\u9fff]/.test(value.summary) && /Markdown/i.test(value.summary),
            platforms: Array.isArray(value.platforms) && [...value.platforms].sort().join(',') === 'Linux,Windows',
            limitations: value.cloudSync === false && value.mobile === false && value.macOS === 'unknown',
            commands: value.install === 'npm install' && value.start === 'npm start',
            migration: value.migration?.file === 'config.json' && value.migration?.oldKey === 'dataDir' && value.migration?.newKey === 'storagePath',
            tags: Array.isArray(value.tags) && value.tags.length >= 2 && value.tags.length <= 5 && value.tags.every(t => typeof t === 'string'),
          };
          result = { id: task.id, passed: Object.values(checks).every(Boolean), checks, value, usage: response.usage };
        } catch (error) { result = { id: task.id, passed: false, error: error.code || error.message }; }
        finally {
          if (cwd && path.dirname(path.resolve(cwd)) === path.resolve(os.tmpdir()) && path.basename(cwd).startsWith('gsm-agy-'))
            await fs.rm(cwd, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
        }
        level.results.push({ ...result, durationMs: Date.now() - start, firstTextMs });
        checkpoint();
        console.log(JSON.stringify({ concurrency, id: task.id, passed: result.passed, durationMs: Date.now() - start, error: result.error }));
      }
    };
    await Promise.all(Array.from({ length: concurrency }, worker));
    level.durationMs = Date.now() - started;
    level.passed = level.results.filter(result => result.passed).length;
    level.meanRequestMs = Math.round(level.results.reduce((sum, result) => sum + result.durationMs, 0) / tasks.length);
    level.speedup = report.levels[0].concurrency === 1 ? report.levels[0].durationMs / level.durationMs : null;
    level.totalTokens = level.results.reduce((sum, result) => sum + (result.usage?.total_tokens || 0), 0);
    await fs.writeFile(output, JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ levelComplete: concurrency, durationMs: level.durationMs, passed: level.passed, speedup: level.speedup }));
    if (level.results.some(result => result.error === 'EVALUATION_BUDGET')) break;
  }
  report.completedAt = new Date().toISOString();
  await fs.writeFile(output, JSON.stringify(report, null, 2));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
