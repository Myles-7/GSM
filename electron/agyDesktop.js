const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { createReadStream } = require('node:fs');
const { spawn } = require('node:child_process');
const { TextDecoder } = require('node:util');
const { AgyError, classifyAgyFailure } = require('./agyProtocol');
const { createAgyWorkspace, runAgy, terminateAgyTree } = require('./agyRuntime');
const { AgyQueue } = require('./agyQueue');
const { createLocalProjects } = require('./agyLocalProjects');
const { FEATURES, validOverrides, resolveProfile } = require('./agyProfiles');

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
    let failure, termination = Promise.resolve(), text = '', stderr = '', bytes = 0;
    const decoder = new TextDecoder('utf-8', { fatal: true });
    const stop = code => {
      if (failure) return;
      failure = new AgyError(code);
      termination = terminateAgyTree(child);
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
    child.once('close', async code => {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      await termination;
      if (failure) { reject(failure); return; }
      if (code !== 0) { reject(new AgyError(classifyAgyFailure(stderr))); return; }
      try { resolve(parseModels(text + decoder.decode())); } catch { reject(new AgyError('INVALID_MODELS')); }
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

function createAgyDesktop({ userDataPath, selectExecutable, selectDirectory = async () => null, platform = process.platform,
  defaultExecutable = path.join(process.env.LOCALAPPDATA || '', 'agy', 'bin', 'agy.exe'),
  inspect = inspectExecutable, models = readModels, runtime = runAgy }) {
  const prefsFile = path.join(userDataPath, 'agy-device.json');
  const queue = new AgyQueue();
  const generations = new AgyQueue(5);
  const observers = new Map();
  generations.onChange = pool => { for (const notify of observers.values()) notify({ type: 'scheduler', pool }); };
  let revision = 1;
  const revisions = new Map();
  const featureProbes = {};
  const updatePool = () => generations.configure(prefs.concurrency, Object.fromEntries(FEATURES.map(feature => [feature, resolveProfile(prefs, feature).concurrency])));
  const localProjects = createLocalProjects({ selectDirectory });
  let prefs = { ...DEFAULT_PREFS }, executable = null, lastProbe = null;
  const ready = fs.readFile(prefsFile, 'utf8').then(text => {
    const saved = JSON.parse(text);
    const migrated = { ...DEFAULT_PREFS, ...saved.prefs };
    if (validPrefs(migrated)) prefs = migrated;
    if (typeof saved.executable === 'string') executable = { path: saved.executable, fingerprint: saved.fingerprint };
    if (saved.lastProbe?.code === 'SUCCESS' && typeof saved.lastProbe.identity === 'string') lastProbe = saved.lastProbe;
    if (lastProbe?.fingerprint !== executable?.fingerprint) prefs.enabled = false;
    if (saved.featureProbes && typeof saved.featureProbes === 'object') {
      for (const feature of FEATURES) if (typeof saved.featureProbes[feature]?.code === 'string') featureProbes[feature] = saved.featureProbes[feature];
    }
  }).catch(() => {}).then(() => { revisions.set(revision, structuredClone(prefs)); updatePool(); });
  const snapshot = () => ({ prefs: { ...prefs }, supported: platform === 'win32', enabled: prefs.enabled,
    executable: executable?.fingerprint ? { name: executable.name || 'agy.exe', fingerprint: executable.fingerprint, path: executable.path } : null,
    revision, featureProbes: { ...featureProbes }, lastProbe, busy: !!queue.active || !!generations.active, queued: generations.pending.length, pool: generations.state() });
  const persist = async (nextPrefs, nextExecutable) => {
    await fs.mkdir(userDataPath, { recursive: true });
    await fs.writeFile(`${prefsFile}.tmp`, JSON.stringify({ prefs: nextPrefs, executable: nextExecutable?.path || null,
      fingerprint: nextExecutable?.fingerprint, lastProbe, featureProbes }), { mode: 0o600 });
    await fs.rename(`${prefsFile}.tmp`, prefsFile);
  };
  const perform = async (owner, requestId, work, options, scheduler = queue) => {
    await ready;
    if (platform !== 'win32') return { ok: false, code: 'UNSUPPORTED' };
    try {
      return { ok: true, value: await scheduler.run(owner, requestId, work, options) };
    } catch (error) {
      return { ok: false, code: error instanceof AgyError ? error.code : error?.code === 'ENOENT' ? 'NOT_FOUND' : 'IO_FAILED' };
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
    async getState() { await ready; return snapshot(); },
    chooseProject: (owner, id) => perform(owner, id, () => localProjects.choose(owner)),
    readProject: (owner, id, grantId, relative) => perform(owner, id, () => localProjects.read(owner, grantId, relative), { maxQueued: 50 }),
    revokeProject: (owner, grantId) => localProjects.revoke(owner, grantId),
    save: (owner, id, value) => perform(owner, id, async signal => {
      if (!validPrefs(value)) throw new AgyError('INVALID_PREFS');
      const next = { ...DEFAULT_PREFS, ...value };
      if (next.enabled && (lastProbe?.code !== 'SUCCESS' || lastProbe.fingerprint !== executable?.fingerprint)) throw new AgyError('TEST_REQUIRED');
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
    listModels: (owner, id) => perform(owner, id, async signal => {
      const found = await verify();
      const cwd = await createAgyWorkspace();
      try { return await models(found.path, cwd, signal); }
      finally { await fs.rm(cwd, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); }
    }),
    probe: async (owner, id, feature) => {
      await ready;
      if (feature !== undefined && !FEATURES.includes(feature)) return { ok: false, code: 'INVALID_REQUEST' };
      const probePrefs = structuredClone(prefs);
      const profile = feature ? resolveProfile(probePrefs, feature) : probePrefs;
      return perform(owner, id, async signal => {
      const inspected = await perform(owner, randomUUID(), verify, { maxQueued: 50 });
      if (!inspected.ok) throw new AgyError(inspected.code);
      const found = inspected.value;
      const cwd = await createAgyWorkspace();
      let code = 'SUCCESS', toolCount = null, promptsSent = 0, usage = {};
      try {
        const result = await runtime({ executable: found.path, cwd,
          prompt: 'Return exactly this JSON and nothing else: {"answer":"连接成功","missing":[]}',
          model: profile.model || undefined, effort: profile.effort, signal, timeoutMs: profile.timeoutSeconds * 1000,
          onInit: init => { toolCount = init.tools.length; }, onPromptSent: () => { promptsSent++; } });
        const parsed = JSON.parse(result.text.trim().replace(/^```(?:json)?\s*|\s*```$/g, ''));
        if (parsed.answer !== '连接成功' || !Array.isArray(parsed.missing) || parsed.missing.length) throw new AgyError('SCHEMA_MISMATCH');
        usage = result.usage;
      } catch (error) {
        if (signal.aborted || error.code === 'CANCELED') throw new AgyError('CANCELED');
        code = error instanceof AgyError ? error.code : 'SCHEMA_MISMATCH';
        if (Number.isInteger(error.details?.toolCount)) toolCount = error.details.toolCount;
      } finally { await fs.rm(cwd, { recursive: true, force: true }); }
      if (signal.aborted) throw new AgyError('CANCELED');
      const committed = await perform(owner, randomUUID(), async () => {
        if (signal.aborted) throw new AgyError('CANCELED');
        if (executable?.fingerprint !== found.fingerprint) throw new AgyError('CONFIG_CHANGED');
        if (feature) featureProbes[feature] = { code, at: new Date().toISOString(), model: profile.model, effort: profile.effort, fingerprint: found.fingerprint };
        else {
          lastProbe = { code, toolCount, at: new Date().toISOString(), fingerprint: found.fingerprint,
            identity: probeIdentity(probePrefs, found), promptsSent, usage };
          if (code !== 'SUCCESS') {
            prefs.enabled = false;
            for (const task of [...generations.running, ...generations.pending]) if (task.id !== id || task.owner !== owner) generations.cancel(task.owner, task.id);
          }
        }
        await persist(prefs, executable);
        return snapshot();
      }, { maxQueued: 50 });
      if (!committed.ok) throw new AgyError(committed.code);
      return committed.value;
    }, { maxQueued: probePrefs.maxQueued, waitMs: profile.timeoutSeconds * 1000, feature: feature || 'other', priority: 'interactive' }, generations);
    },
    generate: async (owner, id, request, onEvent = () => {}, isCurrent = () => true) => {
      await ready;
      if (!isCurrent()) return { ok: false, code: 'CANCELED' };
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
      if (observers.has(observerKey)) return { ok: false, code: 'DUPLICATE_REQUEST' };
      observers.set(observerKey, onEvent);
      try { return await perform(owner, id, async signal => {
      if (!isCurrent()) throw new AgyError('CANCELED');
      if (!prefs.enabled) throw new AgyError('DISABLED');
      if (!request || typeof request.system !== 'string' || typeof request.user !== 'string' ||
          Buffer.byteLength(request.system + request.user) > 500 * 1024) throw new AgyError('INPUT_LIMIT');
      if (request.revision === undefined && (request.model !== prefs.model || request.effort !== prefs.effort)) throw new AgyError('CONFIG_CHANGED');
      const verified = await perform(owner, randomUUID(), verify, { maxQueued: 50 });
      if (!verified.ok) throw new AgyError(verified.code);
      const found = verified.value;
      if (!lastProbe || lastProbe.code !== 'SUCCESS' || lastProbe.fingerprint !== found.fingerprint) throw new AgyError('TEST_REQUIRED');
      const cwd = await createAgyWorkspace();
      onEvent({ type: 'running' });
      try {
        return await runtime({ executable: found.path, cwd, signal,
          prompt: `TASK REQUIREMENTS:\n${request.system}\n\nINPUT:\n${request.user}`,
          model: profile.model || undefined, effort: profile.effort, timeoutMs: profile.timeoutSeconds * 1000,
          onText: text => onEvent({ type: 'text', text }),
        });
      } finally { await fs.rm(cwd, { recursive: true, force: true }); }
      }, { maxQueued: prefs.maxQueued, feature, priority: request.priority || 'interactive', waitMs: profile.timeoutSeconds * 1000, onQueued: position => onEvent({ type: 'queued', position }) }, generations);
      } finally { observers.delete(observerKey); }
    },
    cancel: (owner, id) => {
      queue.cancel(owner, id);
      generations.cancel(owner, id);
      if (id === undefined) localProjects.revoke(owner);
    },
    shutdown: async () => { const draining = generations.shutdown(); await queue.shutdown(); await draining; },
  };
}

module.exports = { DEFAULT_PREFS, validPrefs, parseModels, readModels, inspectExecutable, createAgyDesktop };
