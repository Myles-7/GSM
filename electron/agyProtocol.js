const { TextDecoder } = require('node:util');

class AgyError extends Error {
  constructor(code, details) {
    super(`AGY_${code}`);
    this.name = 'AgyError';
    this.code = code;
    this.details = details;
  }
}

// Deliberately exclude raw diagnostics: CLI errors can contain prompts or secrets.
function classifyAgyFailure(message) {
  if (/invalid model selection|conflicts with --effort|unsupported.*effort/i.test(message)) return 'MODEL_EFFORT_CONFLICT';
  if (/auth|login|sign.?in|credential|unauthorized/i.test(message)) return 'AUTH_REQUIRED';
  if (/quota|credits|insufficient.balance/i.test(message)) return 'QUOTA_EXHAUSTED';
  if (/rate.limit|429|too.many.requests/i.test(message)) return 'RATE_LIMIT';
  if (/timeout|deadline/i.test(message)) return 'TIMEOUT';
  if (/permission|denied|not.allowed/i.test(message)) return 'PERMISSION_DENIED';
  return 'FAILED';
}

class AgyProtocol {
  constructor({ onInit = () => {}, onText = () => {}, validate, maxBytes = 4 * 1024 * 1024 } = {}) {
    this.decoder = new TextDecoder('utf-8', { fatal: true });
    this.buffer = '';
    this.bytes = 0;
    this.maxBytes = maxBytes;
    this.onInit = onInit;
    this.onText = onText;
    this.validate = validate;
    this.initialized = false;
    this.result = null;
    this.failed = false;
  }

  fail(code, details) {
    this.failed = true;
    throw new AgyError(code, details);
  }

  push(chunk) {
    if (this.failed) this.fail('INVALID_PROTOCOL');
    this.bytes += chunk.byteLength;
    if (this.bytes > this.maxBytes) this.fail('OUTPUT_LIMIT');
    try {
      this.buffer += this.decoder.decode(chunk, { stream: true });
    } catch {
      this.fail('INVALID_UTF8');
    }
    let newline;
    while ((newline = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (line) this.consume(line);
    }
    if (Buffer.byteLength(this.buffer) > 1024 * 1024) this.fail('LINE_LIMIT');
  }

  consume(line) {
    if (Buffer.byteLength(line) > 1024 * 1024) this.fail('LINE_LIMIT');
    let event;
    try { event = JSON.parse(line); } catch { this.fail('INVALID_JSON'); }
    if (!event || typeof event !== 'object' || this.result) this.fail('INVALID_PROTOCOL');
    if (event.event === 'init') {
      if (this.initialized) this.fail('INVALID_PROTOCOL');
      const init = event.init;
      if (!init || !Array.isArray(init.tools)) this.fail('INVALID_PROTOCOL');
      this.initialized = true;
      this.onInit(init);
    } else if (event.event === 'step_update') {
      if (!this.initialized) this.fail('INVALID_PROTOCOL');
      const step = event.step_update;
      if (!step || typeof step !== 'object') this.fail('INVALID_PROTOCOL');
      if (step.step_type === 'tool' || step.tool_info || step.subagent_info) this.fail('NATIVE_TOOL_CALL');
      if (step.step_type === 'agent_response' && typeof step.text_delta === 'string') this.onText(step.text_delta);
    } else if (event.event === 'result') {
      const result = event.result;
      if (!result || result.status !== 'SUCCESS') this.fail(classifyAgyFailure(String(result?.error || result?.status || '')));
      const structuredOnly = this.validate && result.structured_output !== undefined;
      if (!this.initialized || result.num_turns !== 1 ||
          (!structuredOnly && (typeof result.response !== 'string' || !result.response.trim()))) this.fail('INVALID_RESULT', {
            initialized: this.initialized, turns: result.num_turns, responseType: typeof result.response,
            responseLength: typeof result.response === 'string' ? result.response.length : 0,
            hasStructured: result.structured_output !== undefined,
          });
      if (this.validate && !this.validate(result.structured_output)) this.fail('SCHEMA_MISMATCH');
      // Do not propagate internal reasoning, conversation identifiers, or arbitrary fields.
      const usage = {};
      for (const key of ['input_tokens', 'output_tokens', 'thinking_tokens', 'cache_read_tokens', 'total_tokens']) {
        if (Number.isFinite(result.usage?.[key]) && result.usage[key] >= 0) usage[key] = result.usage[key];
      }
      this.result = { text: typeof result.response === 'string' && result.response.trim()
        ? result.response : JSON.stringify(result.structured_output), structuredOutput: result.structured_output, usage };
    } else {
      this.fail('INVALID_PROTOCOL');
    }
  }

  finish(exitCode, permissionDenied = false) {
    if (this.failed) this.fail('INVALID_PROTOCOL');
    try { this.buffer += this.decoder.decode(); } catch { this.fail('INVALID_UTF8'); }
    if (this.buffer.trim()) this.consume(this.buffer.trim());
    this.buffer = '';
    if (permissionDenied) this.fail('PERMISSION_DENIED');
    if (exitCode !== 0) this.fail('PROCESS_FAILED');
    if (!this.result) this.fail('MISSING_RESULT');
    return this.result;
  }
}

module.exports = { AgyProtocol, AgyError, classifyAgyFailure };
