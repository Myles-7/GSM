const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { AgyError } = require('./agyProtocol');
const digest = value => createHash('sha256').update(value).digest('hex');
const validId = value => typeof value === 'string' && /^[\w-]{1,80}$/.test(value);
const refused = new Set(['AUTH_REQUIRED', 'PERMISSION_DENIED', 'RATE_LIMIT', 'QUOTA_EXHAUSTED', 'BUDGET_LIMIT', 'MODEL_EFFORT_CONFLICT', 'INVALID_MODEL', 'INVALID_EFFORT']);

// Main-process local recovery storage. No prompts or credentials are written;
// evidence and results are protected by Windows safeStorage, separate from Store.
function createAgyCallRegistry({ directory, safeStorage, maxBytes = 50 * 1024 * 1024,
  reservationBytes = 8 * 1024 * 1024 } = {}) {
  let chain = Promise.resolve();
  const serial = work => { const next = chain.then(work); chain = next.catch(() => {}); return next; };
  const identity = (account, requestId) => {
    if (!validId(account) || !validId(requestId)) throw new AgyError('INVALID_REQUEST');
    return `${digest(account)}-${requestId}`;
  };
  const location = (account, requestId) => path.join(directory, `${identity(account, requestId)}.json`);
  const corruptLocation = (account, requestId) => `${location(account, requestId)}.corrupt`;
  const seal = value => {
    if (!safeStorage?.isEncryptionAvailable()) throw new AgyError('RECOVERY_ENCRYPTION_UNAVAILABLE');
    return safeStorage.encryptString(JSON.stringify(value)).toString('base64');
  };
  const unseal = value => {
    if (!safeStorage?.isEncryptionAvailable()) throw new AgyError('RECOVERY_ENCRYPTION_UNAVAILABLE');
    try { return JSON.parse(safeStorage.decryptString(Buffer.from(value, 'base64'))); }
    catch { throw new AgyError('RECOVERY_RECORD_CORRUPT'); }
  };
  const load = async (account, requestId) => {
    const file = location(account, requestId);
    try {
      const row = JSON.parse(await fs.readFile(file, 'utf8'));
      if (row.version !== 1 || row.account !== account || row.requestId !== requestId
        || !['prepared', 'sent'].includes(row.dispatch) || !Number.isFinite(row.bytes) || row.bytes < 0
        || !['not_started', 'in_flight', 'succeeded', 'failed', 'unknown'].includes(row.providerOutcome)) throw Error('corrupt');
      return row;
    } catch (error) {
      if (error.code === 'ENOENT') {
        try { await fs.access(corruptLocation(account, requestId)); } catch (missing) { if (missing.code === 'ENOENT') return undefined; throw missing; }
      } else {
        // Retain a blocking tombstone under the exact original identity.
        await fs.rename(file, corruptLocation(account, requestId)).catch(() => {});
      }
      throw new AgyError('RECOVERY_RECORD_CORRUPT');
    }
  };
  const inspectCorrupt = async (account, requestId) => {
    if (!validId(account) || !validId(requestId)) throw new AgyError('INVALID_REQUEST');
    const file = corruptLocation(account, requestId);
    let raw;
    try { raw = await fs.readFile(file, 'utf8'); }
    catch (error) { if (error.code === 'ENOENT') return undefined; throw error; }
    let row;
    try { row = JSON.parse(raw); } catch { /* An unreadable row can never prove that dispatch did not happen. */ }
    const matchesIdentity = row && row.account === account && row.requestId === requestId;
    const definitelyUnsent = matchesIdentity && row.dispatch === 'prepared' && row.providerOutcome === 'not_started';
    return {
      requestId,
      code: 'RECOVERY_RECORD_CORRUPT',
      certainty: definitelyUnsent ? 'definitely-unsent' : 'unknown',
      ...(matchesIdentity && ['prepared', 'sent'].includes(row.dispatch) ? { dispatch: row.dispatch } : {}),
      ...(matchesIdentity && ['not_started', 'in_flight', 'succeeded', 'failed', 'unknown'].includes(row.providerOutcome)
        ? { providerOutcome: row.providerOutcome } : {}),
      ...(matchesIdentity && typeof row.createdAt === 'string' ? { createdAt: row.createdAt } : {}),
    };
  };
  const write = async row => {
    await fs.mkdir(directory, { recursive: true });
    const file = location(row.account, row.requestId), temporary = `${file}.${randomUUID()}.tmp`;
    let handle;
    try {
      handle = await fs.open(temporary, 'wx', 0o600);
      await handle.writeFile(JSON.stringify({ ...row, updatedAt: new Date().toISOString() }));
      await handle.sync(); await handle.close(); handle = null;
      await fs.rename(temporary, file);
    } finally { await handle?.close(); await fs.rm(temporary, { force: true }).catch(() => {}); }
  };
  const all = async account => {
    if (!validId(account)) throw new AgyError('INVALID_REQUEST');
    let files;
    try { files = await fs.readdir(directory); } catch (error) { if (error.code === 'ENOENT') return { records: [], errors: [] }; throw error; }
    const records = [], errors = [];
    for (const file of files.filter(file => file.startsWith(`${digest(account)}-`) && /\.json(?:\.corrupt)?$/.test(file))) {
      const requestId = file.slice(65).replace(/\.json(?:\.corrupt)?$/, '');
      try { records.push(await load(account, requestId)); }
      catch {
        const issue = await inspectCorrupt(account, requestId);
        errors.push(issue ?? { requestId, code: 'RECOVERY_RECORD_CORRUPT', certainty: 'unknown' });
      }
    }
    return {
      records: records.filter(Boolean).filter((row, index, values) => values.findIndex(other => other.requestId === row.requestId) === index),
      errors: errors.filter((row, index, values) => values.findIndex(other => other.requestId === row.requestId) === index),
    };
  };
  const publicRecord = row => {
    const { body: _body, ...metadata } = row;
    return { ...metadata, providerOutcome: row.dispatch === 'sent' && row.providerOutcome === 'in_flight' ? 'unknown' : row.providerOutcome,
      recoverable: !!row.body && row.providerOutcome === 'succeeded' && !row.receipt };
  };
  return {
    reserve: (account, requestId, input) => serial(async () => {
      const prior = await load(account, requestId);
      const inputDigest = digest(JSON.stringify([input.system, input.user, input.profile, input.context ?? null]));
      if (prior) {
        if (prior.inputDigest !== inputDigest) throw new AgyError('REQUEST_ID_CONFLICT');
        return { existing: true, record: publicRecord(prior) };
      }
      const body = seal({ context: input.context });
      if (Buffer.byteLength(body) > 768 * 1024) throw new AgyError('INPUT_LIMIT');
      const rows = await all(account);
      if (rows.errors.length) throw new AgyError('RECOVERY_RECORD_CORRUPT');
      if (rows.records.reduce((sum, row) => sum + row.bytes, 0) + reservationBytes > maxBytes) throw new AgyError('RECOVERY_STORAGE_FULL');
      const row = { version: 1, account, requestId, inputDigest, profile: input.profile,
        taskId: validId(input.taskId) ? input.taskId : undefined, itemId: typeof input.itemId === 'string' ? input.itemId.slice(0, 160) : undefined,
        step: typeof input.step === 'string' && /^[\w:.-]{1,200}$/.test(input.step) ? input.step : undefined,
        feature: typeof input.feature === 'string' ? input.feature : undefined, retryOf: validId(input.retryOf) ? input.retryOf : undefined,
        createdAt: new Date().toISOString(), dispatch: 'prepared', providerOutcome: 'not_started', bytes: reservationBytes, body };
      await write(row); return { existing: false, record: publicRecord(row) };
    }),
    sent: (account, requestId) => serial(async () => {
      const row = await load(account, requestId);
      if (!row || row.dispatch !== 'prepared' || row.receipt) throw new AgyError('DUPLICATE_REQUEST');
      await write({ ...row, dispatch: 'sent', providerOutcome: 'in_flight' });
    }),
    succeed: (account, requestId, result) => serial(async () => {
      const row = await load(account, requestId);
      if (!row || row.receipt) throw new AgyError('RECOVERY_NOT_FOUND');
      const previous = unseal(row.body);
      const body = seal({ ...previous, result: { text: result.text, usage: result.usage, cleanupStatus: result.cleanupStatus } });
      if (Buffer.byteLength(body) > row.bytes) throw new AgyError('OUTPUT_LIMIT');
      // Retain the reservation until consumption. A successful response must not
      // let another request take the space reserved for its business checkpoint.
      await write({ ...row, body, providerOutcome: 'succeeded', resultDigest: digest(result.text) });
    }),
    fail: (account, requestId, code) => serial(async () => {
      const row = await load(account, requestId); if (!row || row.providerOutcome === 'succeeded') return;
      const unknown = row.dispatch === 'sent' && !refused.has(code);
      await write({ ...row, providerOutcome: unknown ? 'unknown' : 'failed', failureCode: /^[A-Z_]{1,80}$/.test(code) ? code : 'IO_FAILED', bytes: 0, body: undefined });
    }),
    async list(account, cursor = '', limit = 100) {
      await chain;
      const { records, errors } = await all(account);
      const ordered = records.sort((a, b) => a.requestId.localeCompare(b.requestId)).filter(row => !cursor || row.requestId.localeCompare(cursor) > 0);
      const page = ordered.slice(0, Math.min(100, Math.max(1, Number(limit) || 100)));
      return { records: page.map(publicRecord), errors, ...(ordered.length > page.length ? { nextCursor: page.at(-1).requestId } : {}) };
    },
    async read(account, requestId) {
      await chain; const row = await load(account, requestId);
      if (!row) throw new AgyError('RECOVERY_NOT_FOUND');
      const payload = row.body ? unseal(row.body) : {};
      if (payload.result && digest(payload.result.text) !== row.resultDigest) throw new AgyError('RECOVERY_RECORD_CORRUPT');
      return { record: publicRecord(row), ...payload };
    },
    stage: (account, requestId, resultDigest, commit) => serial(async () => {
      const row = await load(account, requestId);
      if (!row?.body || row.receipt || row.resultDigest !== resultDigest) throw new AgyError('RESULT_MISMATCH');
      if (Buffer.byteLength(JSON.stringify(commit)) > 1024 * 1024) throw new AgyError('INPUT_LIMIT');
      const body = seal({ ...unseal(row.body), commit });
      const rows = await all(account);
      if (rows.errors.length) throw new AgyError('RECOVERY_RECORD_CORRUPT');
      const bytes = Math.max(row.bytes, Buffer.byteLength(body));
      if (rows.records.reduce((sum, other) => sum + (other.requestId === requestId ? bytes : other.bytes), 0) > maxBytes) throw new AgyError('RECOVERY_STORAGE_FULL');
      await write({ ...row, body, bytes });
    }),
    ack: (account, requestId, resultDigest) => serial(async () => {
      const row = await load(account, requestId);
      if (!row || !row.resultDigest || row.resultDigest !== resultDigest) throw new AgyError('RESULT_MISMATCH');
      if (row.receipt === 'consumed') return;
      if (row.receipt) throw new AgyError('RESULT_DISCARDED');
      await write({ ...row, receipt: 'consumed', body: undefined, bytes: 0 });
    }),
    discard: (account, requestId) => serial(async () => {
      const row = await load(account, requestId); if (!row) throw new AgyError('RECOVERY_NOT_FOUND');
      await write({ ...row, receipt: 'discarded', body: undefined, bytes: 0 });
    }),
    repair: (account, requestId, action) => serial(async () => {
      if (!['discard-unsent', 'abandon-unknown'].includes(action)) throw new AgyError('INVALID_REQUEST');
      // Force a corrupt live .json into its blocking tombstone before inspection.
      try {
        const row = await load(account, requestId);
        if (row) throw new AgyError('RECOVERY_RECORD_NOT_CORRUPT');
      } catch (error) {
        if (error.code !== 'RECOVERY_RECORD_CORRUPT') throw error;
      }
      const issue = await inspectCorrupt(account, requestId);
      if (!issue) throw new AgyError('RECOVERY_NOT_FOUND');
      if (action === 'discard-unsent' && issue.certainty !== 'definitely-unsent') {
        throw new AgyError('RECOVERY_REPAIR_CONFIRMATION_REQUIRED');
      }
      // Preserve the original bytes for audit/debugging, but move them out of the
      // blocking namespace. Reusing the identity is now an explicit user action.
      const suffix = action === 'discard-unsent' ? 'discarded-unsent' : 'abandoned-unknown';
      const archived = `${corruptLocation(account, requestId)}.${suffix}-${Date.now()}-${randomUUID()}`;
      await fs.rename(corruptLocation(account, requestId), archived);
      return { ...issue, action };
    }),
  };
}
module.exports = { createAgyCallRegistry };
