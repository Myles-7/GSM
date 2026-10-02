// Explicitly invoked synthetic-only probe. Never reads project files or credentials.
const path = require('node:path');
const fs = require('node:fs/promises');
const { createAgyWorkspace, runAgy: rawRun } = require('../electron/agyRuntime');
const runAgy = require('./agy-evaluation-budget.cjs').countedRuntime(rawRun, 'connection-probe');

async function main() {
  if (process.platform !== 'win32') throw new Error('Windows verification only');
  const executable = path.join(process.env.LOCALAPPDATA, 'agy', 'bin', 'agy.exe');
  await fs.access(executable);
  const cwd = await createAgyWorkspace();
  let generationCalls = 0;
  const startedAt = Date.now();
  let initSummary;
  try {
    const result = await runAgy({
      executable, cwd, prompt: 'Reply with exactly GSM_PROTOCOL_OK.',
      onPromptSent: () => { generationCalls++; },
      onInit: init => { initSummary = { toolCount: init.tools.length, agent: init.agent }; },
    });
    console.log(JSON.stringify({ probe: 'connection', status: 'text-probe-passed',
      experimental: true, generationCalls,
      init: initSummary, responseMatches: result.text.trim() === 'GSM_PROTOCOL_OK',
      durationMs: Date.now() - startedAt, usage: result.usage }));
  } catch (error) {
    console.log(JSON.stringify({ probe: 'connection', status: 'failed', generationCalls,
      code: error.code || 'UNKNOWN', details: error.details, init: initSummary, durationMs: Date.now() - startedAt }));
    process.exitCode = 1;
  }
  // Keep this synthetic workspace for diagnosis; never delete CLI-owned session data.
}

main().catch(() => { console.error('AGY_PROBE_SETUP_FAILED'); process.exitCode = 1; });
