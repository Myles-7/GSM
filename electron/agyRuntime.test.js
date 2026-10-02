const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const test = require('node:test');
const { runAgy, AGENT_DEFINITION } = require('./agyRuntime');

const init = JSON.stringify({ event: 'init', init: { tools: [], agent: 'gsm-isolated', permission_mode: 'request-review' } });
const done = JSON.stringify({ event: 'result', result: { status: 'SUCCESS', num_turns: 1, response: 'ok' } });
const base = { executable: 'fake-agy', cwd: __dirname, prompt: 'synthetic-only', timeoutMs: 3000, initTimeoutMs: 1500 };
const fixture = source => (_executable, _args, options) => spawn(process.execPath, ['-e', source], options);

test('uses fixed args and stdin, never a shell, persistent session, or prompt argument', async () => {
  let args;
  let options;
  const result = await runAgy({ ...base, prompt: '$(must-not-execute)',
    spawnProcess: (exe, passedArgs, passedOptions) => {
      args = passedArgs; options = passedOptions;
      return fixture(`console.log(${JSON.stringify(init)}); process.stdin.resume(); process.stdin.on('end', () => console.log(${JSON.stringify(done)}));`)(exe, args, options);
    } });
  assert.equal(result.text, 'ok');
  assert.equal(options.shell, false);
  assert.equal(options.windowsHide, true);
  assert.equal(args.includes('$(must-not-execute)'), false);
  for (const flag of ['--continue', '--conversation', '--dangerously-skip-permissions']) assert.equal(args.includes(flag), false);
  assert.match(AGENT_DEFINITION, /inheritCustomizations: false/);
  assert.match(AGENT_DEFINITION, /tools: \[\]/);
});

test('sends a prompt despite advertised tools, but aborts actual tool use', async () => {
  let sent = 0;
  const unsafe = init.replace('"tools":[]', '"tools":["run_command"]');
  await assert.rejects(runAgy({ ...base, onPromptSent: () => { sent++; },
    spawnProcess: fixture(`console.log(${JSON.stringify(unsafe)}); process.stdin.resume(); process.stdin.on('end', () => console.log(JSON.stringify({event:'step_update',step_update:{step_type:'tool'}})));`) }), /NATIVE_TOOL_CALL/);
  assert.equal(sent, 1);
});

test('enforces startup timeout without sending a prompt', async () => {
  let sent = 0;
  await assert.rejects(runAgy({ ...base, initTimeoutMs: 50, onPromptSent: () => { sent++; },
    spawnProcess: fixture('process.stdin.resume();') }), /INIT_TIMEOUT/);
  assert.equal(sent, 0);
});

test('cancels an active process and rejects late content', async () => {
  const controller = new AbortController();
  let sent = 0;
  const promise = runAgy({ ...base, signal: controller.signal,
    onPromptSent: () => { sent++; setTimeout(() => controller.abort(), 25); },
    spawnProcess: fixture(`console.log(${JSON.stringify(init)}); process.stdin.resume(); setInterval(() => {}, 1000);`) });
  await assert.rejects(promise, /CANCELED/);
  assert.equal(sent, 1);
});

test('rejects successful process exit without a terminal result', async () => {
  await assert.rejects(runAgy({ ...base,
    spawnProcess: fixture(`console.log(${JSON.stringify(init)}); process.stdin.resume();`) }), /MISSING_RESULT/);
});

test('maps stderr auth diagnostics without leaking their text', async () => {
  await assert.rejects(runAgy({ ...base,
    spawnProcess: fixture(`console.error('login required SECRET_SENTINEL'); process.exitCode = 1;`) }), error =>
    error.code === 'AUTH_REQUIRED' && !error.message.includes('SECRET_SENTINEL'));
});
