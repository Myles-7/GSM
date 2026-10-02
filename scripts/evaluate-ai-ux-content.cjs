const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { tasks, score } = require('./fixtures/ai-ux-content.cjs');
const { createAgyWorkspace, runAgy } = require('../electron/agyRuntime');
const independent = process.argv.includes('--independent');
const run = require('./agy-evaluation-budget.cjs').countedRuntime(runAgy, independent ? 'ux-content-independent' : 'ux-content-30');

async function main() {
  const cwd = await createAgyWorkspace();
  const started = Date.now();
  const reportPath = path.resolve(__dirname, independent ? '../output/ai-ux-content-independent.json' : '../output/ai-ux-content-report.json');
  const report = { syntheticOnly: true, scope: independent
    ? '30 independent real model content requests. Business workflow E2E is reported separately.'
    : 'One batched real model request, not 30 independent workflow E2E runs.',
    at: new Date().toISOString(), calls: [], response: { answers: [] } };
  try {
    for (const batch of independent ? tasks.map(task => [task]) : [tasks]) {
      const callStarted = Date.now();
      try {
        const result = await run({ executable: path.join(process.env.LOCALAPPDATA, 'agy', 'bin', 'agy.exe'), cwd,
      effort: 'high', timeoutMs: 240000,
      prompt: `Answer every task using only its own evidence. Deliver the requested answer, preserving format, language, negations and exclusions.
Return ONLY JSON {"answers":[{"id":"T01","answer":"actual answer","facts":{},"quotes":["exact evidence excerpt"],"missing":[]}]}.
Facts must contain exactly the fields named in each question. Use booleans for yes/no, arrays for platforms, and "unknown" only for absent evidence.
Quotes must be exact supporting evidence substrings. Missing contains unresolved facts keys only. Each task's format applies to its answer field, not the outer JSON.
${JSON.stringify(batch.map(({ expected, ...task }) => task))}` });
        const parsed = JSON.parse(result.text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''));
        if (!Array.isArray(parsed.answers) || parsed.answers.length !== batch.length
          || parsed.answers.some(answer => !batch.some(task => task.id === answer.id))) throw Error('INVALID_TASK_RESPONSE');
        report.response.answers.push(...parsed.answers);
        report.calls.push({ ids: batch.map(task => task.id), durationMs: Date.now() - callStarted, usage: result.usage });
      } catch (error) {
        report.calls.push({ ids: batch.map(task => task.id), durationMs: Date.now() - callStarted, error: error.code || error.message });
        if (error.code === 'EVALUATION_BUDGET') break;
      }
      await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
      if (independent) console.log(JSON.stringify(score(report.response.answers).find(item => item.id === batch[0].id)));
    }
    report.scores = score(report.response.answers);
    report.passed = report.scores.filter(item => item.passed).length;
    report.accepted = report.passed >= 27;
  } catch (error) {
    report.accepted = false;
    report.error = error.code || error.message;
  } finally {
    report.durationMs = Date.now() - started;
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
    const target = path.resolve(cwd);
    if (path.dirname(target) === path.resolve(os.tmpdir()) && path.basename(target).startsWith('gsm-agy-'))
      await fs.rm(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
  console.log(JSON.stringify({ passed: report.passed, accepted: report.accepted, error: report.error, durationMs: report.durationMs }));
  if (!report.accepted) process.exitCode = 1;
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
