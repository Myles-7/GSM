const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { createReadStream } = require('node:fs');
const { spawn } = require('node:child_process');
const { TextDecoder } = require('node:util');
const { AgyError, classifyAgyFailure } = require('./agyProtocol');
const { createAgyWorkspace, runAgy, createAgyWorker, terminateAgyTree, pendingAgyProcesses, trackAgyProcess } = require('./agyRuntime');
const { AgyQueue } = require('./agyQueue');
const { createLocalProjects } = require('./agyLocalProjects');
const { FEATURES, validOverrides, resolveProfile } = require('./agyProfiles');
const { createAgyCallRegistry } = require('./agyCallRegistry');

const DEFAULT_PREFS = Object.freeze({ model: '', effort: 'medium', mode: 'model', timeoutSeconds: 180, maxQueued: 10, enabled: false, concurrency: 5, featureOverrides: {} });
const PREF_KEYS = Object.keys(DEFAULT_PREFS);

function validPrefs(value) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).every(key => PREF_KEYS.includes(key)) &&
    typeof value.model === 'string' && (value.model === '' || /^[\w.-]{1,120}$/.test(value.model)) &&
    ['low', 'medium', 'high', 'max'].includes(value.effort) &&
    ['model', 'research'].includes(value.mode) &&
    typeof value.enabled === 'boolean' &&
    Number.isInteger(value.timeoutSeconds) && value.timeoutSeconds >= 20 && value.timeoutSeconds <= 600 &&
    Number.isInteger(value.maxQueued) && value.maxQueued >= 0 && value.maxQueued <= 50 &&
    (value.concurrency === undefined || Number.isInteger(value.concurrency) && value.concurrency >= 1 && value.concurrency <= 5) &&
    (value.featureOverrides === undefined || validOverrides(value.featureOverrides));
}

function parseModels(text) {
  const models = new Map();
  for (const line of text.split(/\r?\n/)) {
    const [id, label] = line.split('\t');
    if (/^[\w.-]{1,120}$/.test(id) && typeof label === 'string' && label.length > 0 && label.length <= 160 &&
        !/[\u0000-\u001f\u007f]/.test(label)) models.set(id, { id, label });
    if (models.size > 200) throw new AgyError('OUTPUT_LIMIT');
  }
  if (!models.size) throw new AgyError('INVALID_MODELS');
  return [...models.values()];
}

function readModels(executable, cwd, signal, spawnProcess = spawn) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new AgyError('CANCELED')); return; }
    const child = spawnProcess(executable, ['models'], {
      cwd, shell: false, windowsHide: true, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'],
    });
    trackAgyProcess(child);
    const cleanupSettled = new Promise(resolve => child.once('close', resolve));
    let failure, settled = false, cleanupTimer, text = '', stderr = '', bytes = 0;
    const finish = (error, value) => {
      if (settled) return;
      settled = true; clearTimeout(timer); clearTimeout(cleanupTimer); signal.removeEventListener('abort', abort);
      if (error) { if (error.code === 'CLEANUP_TIMEOUT') Object.defineProperty(error, 'cleanupSettled', { value: cleanupSettled }); reject(error); } else resolve(value);
    };
    const decoder = new TextDecoder('utf-8', { fatal: true });
    const stop = code => {
      if (failure || settled) return;
      failure = new AgyError(code);
      void terminateAgyTree(child).catch(() => {});
      cleanupTimer = setTimeout(() => finish(new AgyError('CLEANUP_TIMEOUT', { operation: 'list-models-cleanup', originalCode: code })), 5000);
    };
    const abort = () => stop('CANCELED');
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    const timer = setTimeout(() => stop('TIMEOUT'), 20000);
    child.stdout.on('data', chunk => {
      if (failure) return;
      bytes += chunk.length;
      if (bytes > 256 * 1024) { stop('OUTPUT_LIMIT'); return; }
      try { text += decoder.decode(chunk, { stream: true }); } catch { stop('INVALID_UTF8'); }
    });
    child.stderr.on('data', chunk => {
      bytes += chunk.length;
      stderr = (stderr + chunk.toString('utf8')).slice(-4096);
      if (bytes > 256 * 1024) stop('OUTPUT_LIMIT');
    });
    child.once('error', () => stop('SPAWN_FAILED'));
    child.once('close', code => {
      if (failure) { finish(failure); return; }
      if (code !== 0) { finish(new AgyError(classifyAgyFailure(stderr))); return; }
      try { finish(null, parseModels(text + decoder.decode())); } catch { finish(new AgyError('INVALID_MODELS')); }
    });
  });
}

async function inspectExecutable(candidate) {
  if (typeof candidate !== 'string' || !path.isAbsolute(candidate) || candidate.startsWith('\\\\') ||
      path.basename(candidate).toLowerCase() !== 'agy.exe') throw new AgyError('INVALID_EXECUTABLE');
  const real = await fs.realpath(candidate);
  if (real.startsWith('\\\\') || path.basename(real).toLowerCase() !== 'agy.exe') throw new AgyError('INVALID_EXECUTABLE');
  const stat = await fs.stat(real);
  if (!stat.isFile() || stat.size < 2 || stat.size > 512 * 1024 * 1024) throw new AgyError('INVALID_EXECUTABLE');
  const handle = await fs.open(real, 'r');
  try {
    const magic = Buffer.alloc(2);
    await handle.read(magic, 0, 2, 0);
    if (magic.toString('ascii') !== 'MZ') throw new AgyError('INVALID_EXECUTABLE');
  } finally { await handle.close(); }
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(real)) hash.update(chunk);
  return { path: real, name: path.basename(real), fingerprint: hash.digest('hex') };
}

const probeIdentity = (prefs, executable) => `${executable?.fingerprint}:${prefs.model}:${prefs.effort}:text-v1`;

function createAgyDesktop({ userDataPath, safeStorage, selectExecutable, selectDirectory = async () => null, platform = process.platform,
  defaultExecutable = path.join(process.env.LOCALAPPDATA || '', 'agy', 'bin', 'agy.exe'),
  inspect = inspectExecutable, models = readModels, runtime = runAgy,
  processCount = pendingAgyProcesses,
  cleanupWorkspace = directory => fs.rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 150 }) }) {
  const prefsFile = path.join(userDataPath, 'agy-device.json');
  const calls = createAgyCallRegistry({ directory: path.join(userDataPath, 'agy-recovery', 'v1'), safeStorage });
  const accounts = new Map();
  const activeCalls = new Map();
  const accountFor = owner => { const account = accounts.get(owner); if (!account) throw new AgyError('SESSION_CHANGED'); return account; };
  const queue = new AgyQueue();
  const generations = new AgyQueue(5);
  const recovery = new AgyQueue();
  const observers = new Map();
  generations.onChange = pool => { for (const notify of observers.values()) notify({ type: 'scheduler', pool }); };
  let revision = 1;
  const verifiedTasks = new Map();
  const revisions = new Map();
  const featureProbes = {};
  const testedProfiles = new Set();
  const profileReady = (profile, found = executable) => testedProfiles.has(probeIdentity(profile, found));
  const updatePool = () => generations.configure(prefs.concurrency, Object.fromEntries(FEATURES.map(feature => [feature, resolveProfile(prefs, feature).concurrency])));
  const localProjects = createLocalProjects({ selectDirectory });
  let prefs = { ...DEFAULT_PREFS }, executable = null, lastProbe = null;
  const generationWorkers = new Map();
  const controlCleanup = new Set();
  const workspaceOperation = async (work, onWarning = () => {}) => {
    const cwd = await createAgyWorkspace();
    let lease;
    try {
      const value = await work(cwd);
      lease = value?.cleanupSettled;
      return value;
    } catch (error) {
      lease = error.cleanupSettled;
      if (error.code === 'CLEANUP_TIMEOUT' && !lease) {
        lease = new Promise(resolve => { const t = setTimeout(resolve, 15000); t.unref?.(); });
      }
      throw error;
    }
    finally {
      if (lease) {
        const entry = { cwd, settled: false }; controlCleanup.add(entry);
        let completed = false;
        let timer;
        const release = async () => {
          if (completed) return;
          completed = true;
          clearTimeout(timer);
          entry.settled = true;
          try { await cleanupWorkspace(cwd); }
          catch { onWarning('CLEANUP_IO_FAILED'); }
          finally { controlCleanup.delete(entry); }
        };
        timer = setTimeout(() => { void release(); }, 15000);
        timer.unref?.();
        void lease.then(() => { entry.settled = true; return release(); }, () => { entry.settled = true; return release(); });
      } else {
        try { await cleanupWorkspace(cwd); }
        catch { controlCleanup.add({ cwd, settled: true }); onWarning('CLEANUP_IO_FAILED'); }
      }
    }
  };
  const workerFor = async (owner, generation, found, profile) => {
    const workerKey = JSON.stringify([owner, accounts.get(owner), generation, found.fingerprint, profile.model, profile.effort]);
    for(const [key,entry] of generationWorkers)if(key!==workerKey&&entry.owner===owner&&Date.now()-entry.lastUsed>120000){
      const worker=await entry.pending;
      if(!worker.state().running&&!worker.state().suspect){
        entry.retired = true;
        try { await worker.close(); if (generationWorkers.get(key) === entry) generationWorkers.delete(key); }
        catch { /* Retain failed cleanup ownership for explicit recovery. */ }
      }
    }
    const previous = generationWorkers.get(workerKey);
    if (previous?.retired) { await (await previous.pending).close(); if (generationWorkers.get(workerKey) === previous) generationWorkers.delete(workerKey); }
    if (!generationWorkers.has(workerKey)) {
      // Store the promise before creating the workspace so concurrent requests
      // cannot create multiple supervisors for one generation.
      const pending = createAgyWorkspace().then(cwd => createAgyWorker({ executable: found.path, cwd, model: profile.model || undefined, effort: profile.effort }));
      generationWorkers.set(workerKey, { owner, pending, lastUsed:Date.now() });
      pending.catch(() => generationWorkers.delete(workerKey));
    }
    const entry=generationWorkers.get(workerKey);entry.lastUsed=Date.now();return entry.pending;
  };
  const ready = fs.readFile(prefsFile, 'utf8').then(text => {
    const saved = JSON.parse(text);
    const migrated = { ...DEFAULT_PREFS, ...saved.prefs };
    if (validPrefs(migrated)) prefs = migrated;
    if (typeof saved.executable === 'string') executable = { path: saved.executable, fingerprint: saved.fingerprint };
    if (saved.lastProbe?.code === 'SUCCESS' && typeof saved.lastProbe.identity === 'string') lastProbe = saved.lastProbe;
    if (lastProbe) testedProfiles.add(lastProbe.identity);
    if (Array.isArray(saved.testedProfiles)) for (const identity of saved.testedProfiles) if (typeof identity === 'string' && identity.length <= 300) testedProfiles.add(identity);
    if (lastProbe?.fingerprint !== executable?.fingerprint) prefs.enabled = false;
    if (saved.featureProbes && typeof saved.featureProbes === 'object') {
      for (const feature of FEATURES) if (typeof saved.featureProbes[feature]?.code === 'string') {
        featureProbes[feature] = saved.featureProbes[feature];
        if (featureProbes[feature].code === 'SUCCESS') testedProfiles.add(probeIdentity(featureProbes[feature], { fingerprint: featureProbes[feature].fingerprint }));
      }
    }
  }).catch(() => {}).then(() => { revisions.set(revision, structuredClone(prefs)); updatePool(); });
  let workerHealth = false;
  const snapshot = () => ({ prefs: { ...prefs }, supported: platform === 'win32', enabled: prefs.enabled,
    executable: executable?.fingerprint ? { name: executable.name || 'agy.exe', fingerprint: executable.fingerprint, path: executable.path } : null,
    revision, featureProbes: { ...featureProbes }, testedProfiles: [...testedProfiles], requiresTest: !profileReady(prefs), lastProbe, busy: !!queue.active || !!generations.active, queued: generations.pending.length,
    pool: { ...generations.state(), degraded: workerHealth || controlCleanup.size > 0 } });
  const persist = async (nextPrefs, nextExecutable) => {
    await fs.mkdir(userDataPath, { recursive: true });
    await fs.writeFile(`${prefsFile}.tmp`, JSON.stringify({ prefs: nextPrefs, executable: nextExecutable?.path || null,
      fingerprint: nextExecutable?.fingerprint, lastProbe, featureProbes, testedProfiles: [...testedProfiles] }), { mode: 0o600 });
    await fs.rename(`${prefsFile}.tmp`, prefsFile);
  };
  const perform = async (owner, requestId, work, options, scheduler = queue) => {
    await ready;
    if (platform !== 'win32') return { ok: false, code: 'UNSUPPORTED' };
    try {
      return { ok: true, value: await scheduler.run(owner, requestId, work, options) };
    } catch (error) {
      const details = error instanceof AgyError ? error.details : { operation: error?.operation || 'unknown', systemCode: /^[A-Z_]{1,40}$/.test(error?.code || '') ? error.code : undefined };
      return { ok: false, code: error instanceof AgyError ? error.code : error?.code === 'ENOENT' && !error?.operation ? 'NOT_FOUND' : 'IO_FAILED', ...(details ? { details } : {}) };
    }
  };
  const verify = async () => {
    if (!executable) throw new AgyError('NOT_FOUND');
    const found = await inspect(executable.path);
    if (executable.fingerprint && found.fingerprint !== executable.fingerprint) {
      executable = found;
      lastProbe = null;
      prefs.enabled = false;
      for (const task of [...generations.running, ...generations.pending]) generations.cancel(task.owner, task.id);
      await persist(prefs, found);
      throw new AgyError('EXECUTABLE_CHANGED');
    }
    executable = found;
    return found;
  };
  return {
    setAccount(owner, account) {
      if (account !== undefined && (typeof account !== 'string' || !/^[\w-]{1,80}$/.test(account))) throw new AgyError('INVALID_REQUEST');
      if (accounts.get(owner) !== account) { queue.cancel(owner); generations.cancel(owner); accounts.delete(owner); if (account) accounts.set(owner, account); }
    },
    async recoveryList(owner, cursor, limit) { return calls.list(accountFor(owner), cursor, limit); },
    async recoveryRead(owner, id) { return calls.read(accountFor(owner), id); },
    async recoveryAck(owner, id, digest) { return calls.ack(accountFor(owner), id, digest); },
    async recoveryStage(owner, id, digest, commit) { return calls.stage(accountFor(owner), id, digest, commit); },
    async recoveryDiscard(owner, id) {
      const account = accountFor(owner);
      if (activeCalls.has(`${account}:${id}`)) throw new AgyError('BUSY');
      return calls.discard(account, id);
    },
    async recoveryRepair(owner, id, action) {
      const account = accountFor(owner);
      if (activeCalls.has(`${account}:${id}`)) throw new AgyError('BUSY');
      return calls.repair(account, id, action);
    },
    async getState() { await ready; workerHealth = (await Promise.all([...generationWorkers.values()].map(async entry => (await entry.pending).state()))).some(state => state.degraded || state.suspect); return snapshot(); },
    recover: (owner, id) => perform(owner, id, async signal => {
      const busy = () => generations.running.size || generations.pending.length || queue.running.size || queue.pending.length;
      if (busy()) throw new AgyError('BUSY');
      if (processCount()) throw new AgyError('RECOVERY_REQUIRED', { operation: 'recover-process' });
      await verify();
      if (signal.aborted) throw new AgyError('CANCELED');
      if (busy() || processCount()) throw new AgyError('RECOVERY_REQUIRED', { operation: 'recover-process' });
      for (const entry of controlCleanup) {
        if (!entry.settled) throw new AgyError('RECOVERY_REQUIRED');
        await cleanupWorkspace(entry.cwd); controlCleanup.delete(entry);
      }
      for (const [key, entry] of generationWorkers) {
        const worker = await entry.pending; await worker.recover();
        if (entry.retired) { await worker.close(); if (generationWorkers.get(key) === entry) generationWorkers.delete(key); }
      }
      workerHealth = false;
      queue.recover();
      generations.recover();
      return snapshot();
    }, undefined, recovery),
    chooseProject: (owner, id) => perform(owner, id, () => localProjects.choose(owner)),
    readProject: (owner, id, grantId, relative) => perform(owner, id, () => localProjects.read(owner, grantId, relative), { maxQueued: 50 }),
    revokeProject: (owner, grantId) => localProjects.revoke(owner, grantId),
    save: (owner, id, value) => perform(owner, id, async signal => {
      if (!validPrefs(value)) throw new AgyError('INVALID_PREFS');
      const next = { ...DEFAULT_PREFS, ...value };
      if (next.enabled && !prefs.enabled && !profileReady(next)) throw new AgyError('TEST_REQUIRED');
      await persist(next, executable);
      if (!signal.aborted) {
        prefs = next;
        revisions.set(++revision, structuredClone(prefs));
        updatePool();
        if (!prefs.enabled) for (const task of [...generations.running, ...generations.pending]) generations.cancel(task.owner, task.id);
      }
      return snapshot();
    }),
    detect: (owner, id) => perform(owner, id, async signal => {
      const found = await inspect(executable?.path || defaultExecutable);
      if (signal.aborted) throw new AgyError('CANCELED');
      if (executable?.fingerprint !== found.fingerprint) {
        lastProbe = null;
        prefs.enabled = false;
        for (const task of [...generations.running, ...generations.pending]) generations.cancel(task.owner, task.id);
      }
      executable = found;
      await persist(prefs, found);
      return snapshot();
    }),
    choose: (owner, id) => perform(owner, id, async signal => {
      const candidate = await selectExecutable();
      if (!candidate || signal.aborted) throw new AgyError('CANCELED');
      const found = await inspect(candidate);
      if (signal.aborted) throw new AgyError('CANCELED');
      executable = found;
      for (const task of [...generations.running, ...generations.pending]) generations.cancel(task.owner, task.id);
      lastProbe = null;
      prefs.enabled = false;
      await persist(prefs, found);
      return snapshot();
    }),
    listModels: async (owner, id) => {
      const inspected = await perform(owner, randomUUID(), verify, { maxQueued: 50 });
      if (!inspected.ok) return inspected;
      return perform(owner, id, signal => workspaceOperation(cwd => models(inspected.value.path, cwd, signal)),
        { maxQueued: 50, priority: 'interactive', waitMs: 180000 }, generations);
    },
    probe: async (owner, id, feature) => {
      await ready;
      if (feature !== undefined && !FEATURES.includes(feature)) return { ok: false, code: 'INVALID_REQUEST' };
      const probePrefs = structuredClone(prefs);
      const profile = feature ? resolveProfile(probePrefs, feature) : probePrefs;
      return perform(owner, id, async signal => {
      const inspected = await perform(owner, randomUUID(), verify, { maxQueued: 50 });
      if (!inspected.ok) throw new AgyError(inspected.code);
      const found = inspected.value;
      let code = 'SUCCESS', toolCount = null, promptsSent = 0, usage = {}, cleanupSettled;
      const preserveCleanup = error => {
        if (cleanupSettled && !error.cleanupSettled) Object.defineProperty(error, 'cleanupSettled', { value: cleanupSettled });
        return error;
      };
      try {
        const result = await workspaceOperation(async cwd => {
          try { const result = await runtime({ executable: found.path, cwd,
          prompt: 'Return exactly this JSON and nothing else: {"answer":"连接成功","missing":[]}',
          model: profile.model || undefined, effort: profile.effort, signal, timeoutMs: profile.timeoutSeconds * 1000,
          onInit: init => { toolCount = init.tools.length; }, onPromptSent: () => { promptsSent++; } });
          cleanupSettled = result.cleanupSettled; return result;
          } catch (error) {
            cleanupSettled = error.cleanupSettled ?? (error.code === 'CLEANUP_TIMEOUT' ? new Promise(resolve => { const t = setTimeout(resolve, 15000); t.unref?.(); }) : undefined);
            throw error;
          }
        });
        const parsed = JSON.parse(result.text.trim().replace(/^```(?:json)?\s*|\s*```$/g, ''));
        if (parsed.answer !== '连接成功' || !Array.isArray(parsed.missing) || parsed.missing.length) throw new AgyError('SCHEMA_MISMATCH');
        usage = result.usage;
      } catch (error) {
        if (signal.aborted || error.code === 'CANCELED') {
          const canceled = new AgyError('CANCELED');
          if (cleanupSettled) Object.defineProperty(canceled, 'cleanupSettled', { value: cleanupSettled });
          throw canceled;
        }
        code = error instanceof AgyError ? error.code : 'SCHEMA_MISMATCH';
        if (Number.isInteger(error.details?.toolCount)) toolCount = error.details.toolCount;
      }
      if (signal.aborted) throw preserveCleanup(new AgyError('CANCELED'));
      const committed = await perform(owner, randomUUID(), async () => {
        if (signal.aborted) throw new AgyError('CANCELED');
        if (executable?.fingerprint !== found.fingerprint) throw new AgyError('CONFIG_CHANGED');
        if (code === 'SUCCESS') testedProfiles.add(probeIdentity(profile, found));
        else if (['AUTH_REQUIRED', 'MODEL_EFFORT_CONFLICT', 'INVALID_MODEL', 'INVALID_EFFORT', 'PERMISSION_DENIED'].includes(code)) testedProfiles.delete(probeIdentity(profile, found));
        if (feature) featureProbes[feature] = { code, at: new Date().toISOString(), model: profile.model, effort: profile.effort, fingerprint: found.fingerprint };
        else {
          lastProbe = { code, toolCount, at: new Date().toISOString(), fingerprint: found.fingerprint,
            identity: probeIdentity(probePrefs, found), promptsSent, usage };
        }
        await persist(prefs, executable);
        return snapshot();
      }, { maxQueued: 50 });
      if (!committed.ok) throw preserveCleanup(new AgyError(committed.code));
      if (cleanupSettled) Object.defineProperty(committed.value, 'cleanupSettled', { value: cleanupSettled });
      return committed.value;
    }, { maxQueued: probePrefs.maxQueued, waitMs: 180000, feature: feature || 'other', priority: 'interactive' }, generations);
    },
    generate: async (owner, id, request, onEvent = () => {}, isCurrent = () => true) => {
      await ready;
      if (!isCurrent()) return { ok: false, code: 'CANCELED' };
      let account;
      try { account = accountFor(owner); } catch { return { ok: false, code: 'SESSION_CHANGED' }; }
      // Retrieval is not a provider call; configuration changes cannot hide an
      // existing result or make a repeated request id dispatch again.
      try {
        const saved = await calls.read(account, id);
        const inputDigest = createHash('sha256').update(JSON.stringify([request?.system, request?.user, saved.record.profile, request?.recoveryContext ?? null])).digest('hex');
        if (saved.record.inputDigest !== inputDigest) return { ok: false, code: 'REQUEST_ID_CONFLICT' };
        if (saved.result && !saved.record.receipt) return { ok: true, value: { ...saved.result, recovery: saved.record } };
        return { ok: false, code: saved.record.providerOutcome === 'unknown' ? 'UNKNOWN_PROVIDER_OUTCOME' : 'DUPLICATE_REQUEST' };
      } catch (error) { if (error.code !== 'RECOVERY_NOT_FOUND') return { ok: false, code: error.code || 'RECOVERY_IO_FAILED' }; }
      const feature = request?.feature || 'other';
      if (!FEATURES.includes(feature)) return { ok: false, code: 'INVALID_REQUEST' };
      const savedPrefs = request?.revision === undefined ? prefs : revisions.get(request.revision);
      if (!savedPrefs) return { ok: false, code: 'CONFIG_CHANGED' };
      const profile = resolveProfile(savedPrefs, feature);
      if (request.profileOverride !== undefined) {
        const override = request.profileOverride;
        if (!override || typeof override.model !== 'string' || override.model.length > 200 || /[\r\n\0]/.test(override.model)
          || !['low', 'medium', 'high', 'max'].includes(override.effort) || !Number.isInteger(override.timeoutSeconds)
          || override.timeoutSeconds < 20 || override.timeoutSeconds > 600) return { ok: false, code: 'INVALID_REQUEST' };
        Object.assign(profile, override);
      }
      const observerKey = `${owner}:${id}`;
      const callKey = `${account}:${id}`;
      if (activeCalls.has(callKey)) return { ok: false, code: 'DUPLICATE_REQUEST' };
      activeCalls.set(callKey, true);
      observers.set(observerKey, onEvent);
      try { return await perform(owner, id, async signal => {
      if (!isCurrent()) throw new AgyError('CANCELED');
      if (!prefs.enabled) throw new AgyError('DISABLED');
      if (!request || typeof request.system !== 'string' || typeof request.user !== 'string' ||
          Buffer.byteLength(request.system + request.user) > 500 * 1024) throw new AgyError('INPUT_LIMIT');
      if (request.revision === undefined && (request.model !== prefs.model || request.effort !== prefs.effort)) throw new AgyError('CONFIG_CHANGED');
       let signature;
       if (executable && typeof request.taskId === 'string' && /^[\w-]{1,80}$/.test(request.taskId)) {
         try { const stat = await fs.stat(executable.path); signature = `${executable.path}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`; } catch { /* The full verifier provides the actionable error. */ }
       }
       const taskKey = `${owner}:${request.taskId}`;
       const cached = signature && verifiedTasks.get(taskKey);
       const verified = cached && cached.signature === signature ? { ok: true, value: cached.found } : await perform(owner, randomUUID(), verify, { maxQueued: 50 });
       if (!verified.ok) throw new AgyError(verified.code);
       const found = verified.value;
       if (signature) { verifiedTasks.set(taskKey, { signature, found }); if (verifiedTasks.size > 50) verifiedTasks.delete(verifiedTasks.keys().next().value); }
      if (!profileReady(profile, found)) throw new AgyError('TEST_REQUIRED');
      if (!isCurrent() || accounts.get(owner) !== account) throw new AgyError('SESSION_CHANGED');
      const reservation = await calls.reserve(account, id, { ...request, profile: probeIdentity(profile, found), context: request.recoveryContext });
      if (reservation.existing) {
        const saved = await calls.read(account, id);
        if (saved.result && !saved.record.receipt) return { ...saved.result, recovery: saved.record };
        throw new AgyError(saved.record.providerOutcome === 'unknown' ? 'UNKNOWN_PROVIDER_OUTCOME' : 'DUPLICATE_REQUEST');
      }
       onEvent({ type: 'running' });
       onEvent({ type: 'initializing' });
      let cleanupLease, providerSucceeded = false;
      try {
        const requestRuntime = runtime === runAgy ? await workerFor(owner, request.revision ?? revision, found, profile) : null;
        let generated;
        generated = await (requestRuntime ? requestRuntime.request({
          requestId: id, signal, timeoutMs: profile.timeoutSeconds * 1000,
          beforePrompt: () => calls.sent(account, id),
          prompt: `TASK REQUIREMENTS:\n${request.system}\n\nINPUT:\n${request.user}`,
          onPromptSent: () => { onEvent({ type: 'sent' }); onEvent({ type: 'running' }); },
          onText: text => onEvent({ type: 'text', text }),
          onReasoning: text => onEvent({ type: 'reasoning', text }),
          onObservation: observation => onEvent({ type: 'observation', observation }),
          onCleanup: () => onEvent({ type: 'cleanup' }),
          onWarning: code => onEvent({ type: 'warning', code }),
        }) : workspaceOperation(cwd => runtime({ executable: found.path, cwd, signal,
          beforePrompt: () => calls.sent(account, id),
          prompt: `TASK REQUIREMENTS:\n${request.system}\n\nINPUT:\n${request.user}`,
           model: profile.model || undefined, effort: profile.effort, timeoutMs: profile.timeoutSeconds * 1000,
           onPromptSent: () => { onEvent({ type: 'sent' }); onEvent({ type: 'running' }); },
          onText: text => onEvent({ type: 'text', text }),
          onReasoning: text => onEvent({ type: 'reasoning', text }),
          onObservation: observation => onEvent({ type: 'observation', observation }),
          onCleanup: () => onEvent({ type: 'cleanup' }),
          onWarning: code => onEvent({ type: 'warning', code }),
        }), code => onEvent({ type: 'warning', code })));
        cleanupLease = generated.cleanupSettled; providerSucceeded = true;
        try { await calls.succeed(account, id, generated); }
        catch { throw new AgyError('RECOVERY_WRITE_FAILED', { providerOutcome: 'succeeded' }); }
        const saved = await calls.read(account, id);
        return Object.assign(generated, { recovery: saved.record });
       } catch (error) {
         if (cleanupLease && !error.cleanupSettled) Object.defineProperty(error, 'cleanupSettled', { value: cleanupLease });
         if (providerSucceeded) error.details = { ...error.details, providerOutcome: 'succeeded' };
         if (error.details?.providerOutcome !== 'succeeded') await calls.fail(account, id, error.code || 'IO_FAILED').catch(() => {});
         throw error;
       } finally {
         onEvent({ type: 'cleanup' });
       }
      }, { maxQueued: prefs.maxQueued, maxFeatureQueued: Infinity, feature, priority: request.priority || 'interactive', producer: request.taskId ?? feature,
        waitMs: request.priority === 'background' ? 30000 : 180000, deferOnTimeout: true, onDeferred: () => onEvent({ type: 'warning', code: 'RESOURCE_DEFERRED' }), onQueued: position => onEvent({ type: 'queued', position }) }, generations);
      } finally { observers.delete(observerKey); activeCalls.delete(callKey); }
    },
    cancel: (owner, id) => {
      queue.cancel(owner, id);
      generations.cancel(owner, id);
      recovery.cancel(owner, id);
      if (id === undefined) {
        localProjects.revoke(owner);
        for (const [key, entry] of generationWorkers) if (entry.owner === owner) {
          entry.retired = true;
          void entry.pending.then(worker => worker.close()).then(() => { if (generationWorkers.get(key) === entry) generationWorkers.delete(key); }).catch(() => {});
        }
      }
    },
    shutdown: async () => {
      const draining = generations.shutdown(); await recovery.shutdown(); await queue.shutdown(); await draining;
      const workers = [...generationWorkers.values()]; generationWorkers.clear();
      await Promise.allSettled(workers.map(entry => entry.pending.then(worker => worker.close())));
    },
  };
}

module.exports = { DEFAULT_PREFS, validPrefs, parseModels, readModels, inspectExecutable, createAgyDesktop };
