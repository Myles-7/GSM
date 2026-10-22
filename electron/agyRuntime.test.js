const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const test = require('node:test');
const { EventEmitter } = require('node:events');
const { runAgy, createAgyWorker, terminateAgyTree, pendingAgyProcesses, createAgyWorkspace, AGENT_DEFINITION } = require('./agyRuntime');

const init = JSON.stringify({ event: 'init', init: { tools: [], agent: 'gsm-isolated', permission_mode: 'request-review' } });
const done = JSON.stringify({ event: 'result', result: { status: 'SUCCESS', num_turns: 1, response: 'ok' } });
const base = { executable: 'fake-agy', cwd: __dirname, prompt: 'synthetic-only', timeoutMs: 3000, initTimeoutMs: 1500 };
const fixture = source => (_executable, _args, options) => spawn(process.execPath, ['-e', source], options);

test('forwards typed reasoning and public steps without duplicating answer callbacks', async () => {
  const child = new EventEmitter(); child.pid = 1;
  child.stdin = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
  const answer = [], reasoning = [], observations = [];
  child.stdin.end = () => queueMicrotask(() => {
    for (const step of [{ step_type: 'agent_reasoning', text_delta: 'typed' }, { step_type: 'agent_response', step_index: 2, text_delta: 'ok' }]) {
      child.stdout.emit('data', Buffer.from(`${JSON.stringify({ event: 'step_update', step_update: step })}\n`));
    }
    child.stdout.emit('data', Buffer.from(`${done}\n`)); child.emit('close', 0);
  });
  const pending = runAgy({ ...base, spawnProcess: () => child, onText: text => answer.push(text),
    onReasoning: text => reasoning.push(text), onObservation: value => observations.push(value) });
  child.stdout.emit('data', Buffer.from(`${init}\n`));
  assert.equal((await pending).text, 'ok');
  assert.deepEqual(answer, ['ok']); assert.deepEqual(reasoning, ['typed']);
  assert.ok(observations.some(value => value.stepIndex === 2));
});

test('does not charge startup or confirmed terminal exit time to model generation', async () => {
  const child = new EventEmitter(); child.pid = 1;
  child.stdin = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
  child.stdin.end = () => {
    setTimeout(() => child.stdout.emit('data', Buffer.from(`${done}\n`)), 40);
    setTimeout(() => child.emit('close', 0), 95);
  };
  const promise = runAgy({ ...base, timeoutMs: 70, initTimeoutMs: 200, cleanupTimeoutMs: 150,
    spawnProcess: () => child, terminateProcess: () => { child.emit('close', 1); } });
  setTimeout(() => child.stdout.emit('data', Buffer.from(`${init}\n`)), 80);
  assert.equal((await promise).text, 'ok');
});

test('preserves a validated terminal result when termination confirms slow exit', async () => {
  const child = new EventEmitter(); child.pid = 1;
  child.stdin = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
  child.stdin.end = () => queueMicrotask(() => child.stdout.emit('data', Buffer.from(`${done}\n`)));
  const promise = runAgy({ ...base, cleanupTimeoutMs: 15,
    spawnProcess: () => child, terminateProcess: () => { child.emit('close', 1); } });
  child.stdout.emit('data', Buffer.from(`${init}\n`));
  const result = await promise;
  assert.equal(result.text, 'ok');
  assert.equal(result.cleanupStatus, 'recovered');
  assert.equal(pendingAgyProcesses(), 0);
});

test('never accepts late invalid frames or cancellation as an exit-only cleanup recovery', async () => {
  for (const invalid of ['protocol', 'cancel']) {
    const controller = new AbortController();
    const child = new EventEmitter(); child.pid = 1;
    child.stdin = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
    child.stdin.end = () => queueMicrotask(() => child.stdout.emit('data', Buffer.from(`${done}\n`)));
    const promise = runAgy({ ...base, signal: controller.signal, cleanupTimeoutMs: 5, spawnProcess: () => child,
      terminateProcess: () => {
        if (invalid === 'protocol') child.stdout.emit('data', Buffer.from('{bad frame}\n'));
        else controller.abort();
        child.emit('close', 1);
      } });
    child.stdout.emit('data', Buffer.from(`${init}\n`));
    await assert.rejects(promise, error => error.code !== 'PROCESS_EXIT_TIMEOUT' && error.code !== 'CLEANUP_TIMEOUT');
    assert.equal(pendingAgyProcesses(), 0);
  }
});

test('preserves a terminal artifact but retains unconfirmed process cleanup ownership', async () => {
  const child = new EventEmitter(); child.pid = 1;
  child.stdin = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
  child.stdin.end = () => queueMicrotask(() => child.stdout.emit('data', Buffer.from(`${done}\n`)));
  const promise = runAgy({ ...base, cleanupTimeoutMs: 5, spawnProcess: () => child, terminateProcess: () => new Promise(() => {}) });
  child.stdout.emit('data', Buffer.from(`${init}\n`));
  const result = await promise;
  assert.equal(result.text, 'ok'); assert.equal(result.cleanupStatus, 'pending');
  assert.equal(typeof result.cleanupSettled?.then, 'function');
  assert.equal(Object.keys(result).includes('cleanupSettled'), false);
  assert.ok(pendingAgyProcesses() > 0); child.emit('close', 1); await result.cleanupSettled;
  assert.equal(pendingAgyProcesses(), 0);
});

test('bounds missing close and unresponsive termination without accepting late output', async () => {
  const child = new EventEmitter(); child.pid = 1;
  child.stdin = new EventEmitter(); child.stdin.end = () => {};
  child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
  const chunks = [];
  await assert.rejects(runAgy({ ...base, initTimeoutMs: 5, cleanupTimeoutMs: 15,
    spawnProcess: () => child, terminateProcess: () => new Promise(() => {}), onText: text => chunks.push(text) }), error => error.code === 'CLEANUP_TIMEOUT' && error.details.originalCode === 'INIT_TIMEOUT');
  child.stdout.emit('data', Buffer.from(`${init}\n${done}\n`));
  assert.deepEqual(chunks, []);
  assert.ok(pendingAgyProcesses() > 0); child.emit('close', 1);
});

test('confirmed close settles the original failure even if the termination helper never settles', async () => {
  const child = new EventEmitter(); child.pid = 1;
  child.stdin = new EventEmitter(); child.stdin.end = () => {};
  child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
  const promise = runAgy({ ...base, initTimeoutMs: 5, cleanupTimeoutMs: 100,
    spawnProcess: () => child, terminateProcess: () => { setTimeout(() => child.emit('close', 1), 5); return new Promise(() => {}); } });
  await assert.rejects(promise, { code: 'INIT_TIMEOUT' });
  assert.equal(pendingAgyProcesses(), 0);
});

test('Windows termination bounds a stuck helper and checks nonzero exit without using a shell', async () => {
  for (const exitCode of [null, 1]) {
    const killer = new EventEmitter(); killer.pid = 2;
    let fallback = 0; let stoppedHelper = 0;
    const child = { pid: 1, kill: () => { fallback++; } };
    killer.kill = () => { stoppedHelper++; killer.emit('close', 1); };
    const result = await terminateAgyTree(child, { platform: 'win32', timeoutMs: 5, spawnProcess: (_file, args, options) => {
      assert.deepEqual(args, ['/PID', '1', '/T', '/F']); assert.equal(options.shell, false);
      if (exitCode !== null) setTimeout(() => killer.emit('close', exitCode), 1);
      return killer;
    } });
    assert.ok(fallback > 0); assert.equal(stoppedHelper, exitCode === null ? 1 : 0);
    assert.match(result.code, /TASKKILL_(FAILED|TIMEOUT)/);
  }
});

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

test('generation supervisor keeps request processes and workspaces isolated', async () => {
  const { rm } = require('node:fs/promises');
  const cwd = await createAgyWorkspace();
  const seen = [];
  const worker = createAgyWorker({ executable: 'fake-agy', cwd, runtime: async request => {
    seen.push(request.cwd);
    await new Promise(resolve => setImmediate(resolve));
    return { text: request.prompt, usage: {} };
  } });
  try {
    const values = await Promise.all(Array.from({ length: 100 }, (_, i) => worker.request({ requestId: `req-${i}`, prompt: String(i) })));
    assert.equal(new Set(seen).size, 100);
    assert.equal(values[42].text, '42');
    assert.equal(worker.state().running, 0);
  } finally { await worker.close(); await rm(cwd, { recursive: true, force: true }); }
});

test('abort listeners do not affect later isolated requests', async () => {
  const cwd = await createAgyWorkspace();
  const first = new AbortController();
  const worker = createAgyWorker({ executable: 'fake-agy', cwd, runtime: async options => { options.signal.throwIfAborted(); return { text: options.prompt, usage: {} }; } });
  await worker.request({ prompt: 'one', signal: first.signal }); first.abort();
  assert.equal((await worker.request({ prompt: 'two' })).text, 'two');
  await worker.close();
});

test('100 actual CLI fixture processes retain request isolation at queue capacity five', async () => {
  const { AgyQueue }=require('./agyQueue');const queue=new AgyQueue(5);
  const cwd=await createAgyWorkspace(),directories=new Set(),processes=new Set();let peak=0,live=0;
  const worker=createAgyWorker({executable:'fixture',cwd,maxRequests:20,spawnProcess:(_exe,_args,options)=>{
    directories.add(options.cwd);live++;peak=Math.max(peak,live);
    const child=fixture(`console.log(${JSON.stringify(init)});let input='';process.stdin.on('data',part=>input+=part);process.stdin.on('end',()=>console.log(JSON.stringify({event:'result',result:{status:'SUCCESS',num_turns:1,response:JSON.parse(input).message.content.split(String.fromCharCode(10)).pop()}})));`)(_exe,_args,options);
    processes.add(child);child.once('close',()=>live--);return child;
  }});
  try{
    const result=await Promise.all(Array.from({length:100},(_,index)=>queue.run('owner',`request-${index}`,signal=>worker.request({requestId:`request-${index}`,prompt:`isolated-${index}`,signal,timeoutMs:5000}),{maxQueued:100,waitMs:30000})));
    assert.equal(result.length,100);for(let i=0;i<100;i++)assert.equal(result[i].text,`isolated-${i}`);
    // Windows may recycle PIDs after exit. Verify fresh process handles and
    // workspaces rather than global uniqueness of historical process numbers.
    assert.equal(directories.size,100);assert.equal(processes.size,100);assert.equal(peak,5);assert.equal(live,0);
  }finally{await queue.shutdown();await worker.close();}
});
