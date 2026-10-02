const fs = require('node:fs');
const path = require('node:path');
const { AgyError } = require('../electron/agyProtocol');
const ledger = path.resolve(__dirname, '../output/agy-generation-ledger.jsonl');
const usageLedger = path.resolve(__dirname, '../output/agy-generation-usage.jsonl');

function countedRuntime(run, kind) {
  return async options => {
    let call;
    const startedAt = Date.now();
    try {
      const result = await run({ ...options, onPromptSent: () => {
        const previous = fs.existsSync(ledger) ? fs.readFileSync(ledger, 'utf8').trim().split('\n').filter(Boolean).length : 0;
        // User authorized 10 after the first 60, then another 100 on 2026-09-29.
        if (previous >= 170) throw new AgyError('EVALUATION_BUDGET');
        call = previous + 1;
        fs.mkdirSync(path.dirname(ledger), { recursive: true });
        fs.appendFileSync(ledger, `${JSON.stringify({ call, at: new Date().toISOString(), kind })}\n`);
        options.onPromptSent?.();
      } });
      fs.appendFileSync(usageLedger, `${JSON.stringify({ call, kind, durationMs: Date.now() - startedAt, status: 'SUCCESS', usage: result.usage })}\n`);
      return result;
    } catch (error) {
      fs.appendFileSync(usageLedger, `${JSON.stringify({ call, kind, durationMs: Date.now() - startedAt, status: error.code || 'FAILED' })}\n`);
      throw error;
    }
  };
}
module.exports = { countedRuntime };
