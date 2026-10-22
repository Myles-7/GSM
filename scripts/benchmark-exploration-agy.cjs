// Explicit, bounded live benchmark. Only 25 synthetic descriptions are supplied;
// it never opens the repository collection or changes AGY device preferences.
const fs = require('node:fs/promises');
const path = require('node:path');
const { createAgyWorkspace, runAgy, pendingAgyProcesses } = require('../electron/agyRuntime');

async function main() {
  if (!process.argv.includes('--run')) { console.log('Use --run to compare 1/2/5 workers (at most 15 paid requests using the configured model).'); return; }
  const device = JSON.parse(await fs.readFile(path.join(process.env.APPDATA, 'Electron', 'agy-device.json'), 'utf8'));
  if (!device.prefs?.enabled || !device.executable) throw new Error('AGY must already be enabled and bound in GSM.');
  const executable = typeof device.executable === 'string' ? device.executable : device.executable.path;
  if (!executable) throw new Error('No bound executable path');
  await fs.access(executable);
  const override = device.prefs.featureOverrides?.organization ?? {};
  const model = override.model || device.prefs.model, effort = override.effort || device.prefs.effort;
  const timeoutMs = (override.timeoutSeconds || device.prefs.timeoutSeconds) * 1000;
  const examples = ['A coding agent workflow runner.', 'Browser task automation.', 'Personal note search and reading.', 'SQL reporting dashboards.', 'Image editing tools.'];
  const projects = Array.from({ length: 25 }, (_, index) => ({ repositoryId: index+1, analysis: examples[index%examples.length] }));
  const report = { synthetic: true, provider: 'agy-cli', model, effort, timeoutMs, maxRequests: 15, startedAt: new Date().toISOString(), stages: [] };
  const destination = path.join(process.env.TEMP, 'gsm-exploration-agy-benchmark-20261021.json');
  let calls = 0;
  for (const concurrency of [1, 2, 5]) {
    const stage = { concurrency, batches: [], durationMs: 0, peakProcesses: 0, runnerPeakRssBytes: 0 };
    const begin = Date.now(); let next = 0;
    const timer = setInterval(() => { stage.peakProcesses = Math.max(stage.peakProcesses, pendingAgyProcesses()); stage.runnerPeakRssBytes = Math.max(stage.runnerPeakRssBytes, process.memoryUsage().rss); }, 200);
    await Promise.all(Array.from({ length: concurrency }, async () => {
      while (next < 5) {
        const batch = next++, items = projects.slice(batch*5,batch*5+5), cwd = await createAgyWorkspace();
        const started = Date.now(); let initializedMs, sentMs;
        try {
          if (++calls > 15) throw new Error('BENCHMARK_REQUEST_BUDGET');
          const result = await runAgy({ executable, cwd, model, effort, timeoutMs,
            prompt: `Classify concrete purpose using the synthetic analysis only. Return only compact JSON {"assignments":[[1,[["specific purpose","analysis"]]]]}. Every supplied ID once, 1 purpose per project. No tools, no summaries. Projects: ${JSON.stringify(items)}`,
            onInit: () => { initializedMs = Date.now()-started; }, onPromptSent: () => { sentMs=Date.now()-started; } });
          const parsed = JSON.parse(result.text.trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,''));
          const valid = Array.isArray(parsed.assignments) && parsed.assignments.length===5 && items.every(item=>parsed.assignments.filter(row=>row[0]===item.repositoryId).length===1);
          stage.batches.push({ batch, status:valid?'passed':'invalid-output',durationMs:Date.now()-started,initializedMs,sentMs,usage:result.usage });
        } catch(error) { stage.batches.push({batch,status:error.code||'FAILED',durationMs:Date.now()-started,initializedMs,sentMs}); }
        console.log(JSON.stringify({concurrency,batch:batch+1,...stage.batches.at(-1)}));
      }
    }));
    clearInterval(timer); stage.durationMs=Date.now()-begin; stage.batches.sort((a,b)=>a.batch-b.batch); report.stages.push(stage);
    await fs.writeFile(destination,JSON.stringify(report,null,2)); console.log(JSON.stringify({stageComplete:concurrency,durationMs:stage.durationMs,destination}));
  }
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
