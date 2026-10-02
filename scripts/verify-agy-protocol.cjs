const path = require('node:path');
const fs = require('node:fs/promises');
const assert = require('node:assert/strict');
const { createAgyWorkspace, runAgy: rawRun } = require('../electron/agyRuntime');
const run = require('./agy-evaluation-budget.cjs').countedRuntime(rawRun, 'protocol');

async function main() {
  const executable = path.join(process.env.LOCALAPPDATA, 'agy', 'bin', 'agy.exe');
  const reports = [];
  for (const name of process.argv.includes('--schema-only') ? ['schema'] : ['unicode-stream', 'schema', 'explicit-effort', 'cancel']) {
    const cwd = await createAgyWorkspace();
    const controller = new AbortController();
    let chunks = '', timer;
    try {
      const result = await run({ executable, cwd, signal: controller.signal,
        prompt: name === 'schema' ? 'Return {"answer":"中文正常","missing":[]}.'
          : name === 'cancel' ? 'Write a detailed 2000 word explanation of relational databases from general knowledge.'
            : 'Reply with exactly 中文正常。',
        effort: name === 'explicit-effort' ? 'low' : 'medium',
        ...(name === 'schema' ? { schema: { type: 'object', properties: { answer: { type: 'string' }, missing: { type: 'array', items: { type: 'string' } } }, required: ['answer', 'missing'], additionalProperties: false },
          validate: value => value?.answer === '中文正常' && Array.isArray(value.missing) && value.missing.length === 0 } : {}),
        onText: delta => { chunks += delta; },
        onPromptSent: () => { if (name === 'cancel') timer = setTimeout(() => controller.abort(), 1500); },
      });
      assert.notEqual(name, 'cancel');
      if (name !== 'schema') assert.equal(result.text.trim(), '中文正常。');
      if (name === 'unicode-stream') assert.equal(chunks.trim(), result.text.trim());
      reports.push({ name, passed: true, usage: result.usage });
    } catch (error) {
      reports.push({ name, passed: name === 'cancel' && error.code === 'CANCELED', code: error.code || error.message, details: error.details });
    } finally { clearTimeout(timer); await fs.rm(cwd, { recursive: true, force: true }); }
    console.log(JSON.stringify(reports.at(-1)));
  }
  await fs.writeFile(path.resolve(__dirname, process.argv.includes('--schema-only') ? '../output/agy-schema-retest.json' : '../output/agy-protocol-report.json'), JSON.stringify(reports, null, 2));
  if (reports.some(result => !result.passed)) process.exitCode = 1;
}
main().catch(error => { console.error(error); process.exitCode = 1; });
