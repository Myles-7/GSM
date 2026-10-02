const assert = require('node:assert/strict');
const test = require('node:test');
const { AgyProtocol, classifyAgyFailure } = require('./agyProtocol');

test('distinguishes model-effort conflicts and exhausted credits from retryable throttling', () => {
  assert.equal(classifyAgyFailure('invalid model selection: --model example-high conflicts with --effort=low'), 'MODEL_EFFORT_CONFLICT');
  assert.equal(classifyAgyFailure('429 rate limit'), 'RATE_LIMIT');
  assert.equal(classifyAgyFailure('insufficient credits'), 'QUOTA_EXHAUSTED');
  assert.equal(classifyAgyFailure('quota exceeded'), 'QUOTA_EXHAUSTED');
});

const init = { event: 'init', init: { tools: [], agent: 'gsm-isolated', permission_mode: 'request-review' } };
const result = { event: 'result', result: { status: 'SUCCESS', response: '中文完成', num_turns: 1, usage: { output_tokens: 3 } } };
const encode = (...events) => Buffer.from(events.map(e => JSON.stringify(e)).join('\n') + '\n');

test('decodes split UTF-8 and partial NDJSON, suppresses reasoning', () => {
  const deltas = [];
  const parser = new AgyProtocol({ onText: text => deltas.push(text) });
  const data = encode(init,
    { event: 'step_update', step_update: { step_type: 'thinking', text_delta: 'private' } },
    { event: 'step_update', step_update: { step_type: 'agent_response', text_delta: '中文' } },
    result);
  for (const byte of data) parser.push(Buffer.from([byte]));
  assert.equal(parser.finish(0).text, '中文完成');
  assert.deepEqual(deltas, ['中文']);
});

for (const [name, events, code] of [
  ['missing tool declaration', [{ event: 'init', init: {} }], 'INVALID_PROTOCOL'],
  ['tool step', [init, { event: 'step_update', step_update: { step_type: 'tool' } }], 'NATIVE_TOOL_CALL'],
  ['new protocol event', [init, { event: 'future_protocol' }], 'INVALID_PROTOCOL'],
  ['duplicate result', [init, result, result], 'INVALID_PROTOCOL'],
  ['waiting result', [init, { event: 'result', result: { status: 'WAITING' } }], 'FAILED'],
  ['authentication', [{ event: 'result', result: { status: 'ERROR', error: 'login required SECRET' } }], 'AUTH_REQUIRED'],
]) {
  test(`rejects ${name}`, () => {
    assert.throws(() => new AgyProtocol().push(encode(...events)), { message: `AGY_${code}` });
  });
}

test('advertised tools and default agent do not block text inference', () => {
  const parser = new AgyProtocol();
  parser.push(encode({ ...init, init: { ...init.init, agent: 'default', tools: ['run_command'] } }, result));
  assert.equal(parser.finish(0).text, '中文完成');
});

test('requires terminal result and successful exit', () => {
  const missing = new AgyProtocol();
  missing.push(encode(init));
  assert.throws(() => missing.finish(0), /MISSING_RESULT/);
  const failed = new AgyProtocol();
  failed.push(encode(init, result));
  assert.throws(() => failed.finish(1), /PROCESS_FAILED/);
});

test('rejects denied permissions even when CLI exits successfully', () => {
  const parser = new AgyProtocol();
  parser.push(encode(init, result));
  assert.throws(() => parser.finish(0, true), /PERMISSION_DENIED/);
});

test('enforces schema before returning structured results', () => {
  const parser = new AgyProtocol({ validate: value => value?.ok === true });
  assert.throws(() => parser.push(encode(init, result)), /SCHEMA_MISMATCH/);
});

test('accepts validated structured output without a duplicate text response', () => {
  const parser = new AgyProtocol({ validate: value => value?.answer === '中文' });
  parser.push(encode(init, { event: 'result', result: {
    status: 'SUCCESS', response: '', num_turns: 1, structured_output: { answer: '中文' },
  } }));
  assert.equal(parser.finish(0).text, '{"answer":"中文"}');
});

test('limits output and rejects malformed bytes and JSON', () => {
  assert.throws(() => new AgyProtocol({ maxBytes: 2 }).push(Buffer.from('abc')), /OUTPUT_LIMIT/);
  assert.throws(() => new AgyProtocol().push(Buffer.from([0xff])), /INVALID_UTF8/);
  assert.throws(() => new AgyProtocol().push(Buffer.from('oops\n')), /INVALID_JSON/);
  assert.throws(() => new AgyProtocol().push(Buffer.from('x'.repeat(1024 * 1024 + 1) + '\n')), /LINE_LIMIT/);
});
