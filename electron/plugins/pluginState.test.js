const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { createPluginStateStore } = require('./pluginState');

test('persists enabled state and granted permissions without runtime objects', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gsm-plugin-state-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const statePath = path.join(directory, 'plugins-state.json');
  const store = createPluginStateStore(statePath);

  store.save({
    version: 1,
    plugins: {
      'com.example.exporter': {
        enabled: true,
        grantedPermissions: ['repositories:read'],
        runtime: { mustNotPersist: true },
      },
    },
  });

  assert.deepEqual(store.load(), {
    version: 2,
    searchEndpoint: null,
    plugins: {
      'com.example.exporter': {
        enabled: true,
        grantedPermissions: ['repositories:read'],
      },
    },
  });
  assert.equal(fs.readFileSync(statePath, 'utf8').includes('mustNotPersist'), false);
});

test('recovers with an empty state when the state file is damaged', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gsm-plugin-state-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const statePath = path.join(directory, 'plugins-state.json');
  fs.writeFileSync(statePath, '{broken');

  assert.deepEqual(createPluginStateStore(statePath).load(), { version: 2, plugins: {}, searchEndpoint: null });
});

test('ignores invalid plugin ids from a tampered state file', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gsm-plugin-state-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const statePath = path.join(directory, 'plugins-state.json');
  fs.writeFileSync(statePath, '{"version":1,"plugins":{"__proto__":{"enabled":true}}}');

  assert.deepEqual(createPluginStateStore(statePath).load(), { version: 2, plugins: {}, searchEndpoint: null });
});

test('migrates v1 plugin state without losing enabled plugins', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gsm-plugin-state-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const statePath = path.join(directory, 'plugins-state.json');
  fs.writeFileSync(statePath, JSON.stringify({ version: 1, plugins: {
    'com.example.exporter': { enabled: true, grantedPermissions: ['repositories:read'] },
  } }));
  const state = createPluginStateStore(statePath).load();
  assert.equal(state.version, 2);
  assert.equal(state.searchEndpoint, null);
  assert.equal(state.plugins['com.example.exporter'].enabled, true);
});

test('retries a transient Windows destination lock without removing the old state', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gsm-plugin-state-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const statePath = path.join(directory, 'plugins-state.json');
  const old = {version:2, plugins:{}, searchEndpoint:null};
  createPluginStateStore(statePath).save(old);
  const waits = []; let attempts = 0;
  const store = createPluginStateStore(statePath, {platform:'win32', wait:ms=>waits.push(ms),
    fileSystem:{...fs, renameSync(from,to) {
      if (++attempts <= 2) {
        assert.deepEqual(JSON.parse(fs.readFileSync(to,'utf8')),old);
        throw Object.assign(new Error('locked'),{code:'EPERM'});
      }
      fs.renameSync(from,to);
    }},
  });
  store.save({version:2, plugins:{'com.example.exporter':{enabled:true,grantedPermissions:[]}}});
  assert.deepEqual(waits,[10,20]); assert.equal(attempts,3);
  assert.equal(store.load().plugins['com.example.exporter'].enabled,true);
  assert.deepEqual(fs.readdirSync(directory),['plugins-state.json']);
});

for (const [platform,code,expectedAttempts] of [['win32','EPERM',5],['win32','EIO',1],['linux','EPERM',1]]) {
  test(`failed state replacement preserves old file (${platform}/${code})`, (t) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gsm-plugin-state-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const statePath = path.join(directory, 'plugins-state.json');
    createPluginStateStore(statePath).save({version:2,plugins:{}});
    const old = fs.readFileSync(statePath,'utf8'); let attempts=0; const waits=[];
    const store = createPluginStateStore(statePath, {platform,wait:ms=>waits.push(ms),
      fileSystem:{...fs, renameSync(){attempts++;throw Object.assign(new Error('failed'),{code});}},
    });
    assert.throws(()=>store.save({version:2,plugins:{'com.example.exporter':{enabled:true}}}),{code});
    assert.equal(attempts,expectedAttempts); assert.equal(waits.reduce((a,b)=>a+b,0),expectedAttempts===5?150:0);
    assert.equal(fs.readFileSync(statePath,'utf8'),old);
    assert.deepEqual(fs.readdirSync(directory),['plugins-state.json']);
  });
}
