'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { writeFileAtomicSync } = require('../atomicFile');

const { searchUrl } = require('./webSearch');

const STATE_VERSION = 2;
const PLUGIN_ID_RE = /^[a-z0-9]+(?:[.-][a-z0-9]+)+$/;

function emptyState() {
  return { version: STATE_VERSION, plugins: {}, searchEndpoint: null };
}

function normalizeState(input) {
  if (!input || ![1, STATE_VERSION].includes(input.version) || !input.plugins || typeof input.plugins !== 'object') {
    return emptyState();
  }
  const state = emptyState();
  if (input.version === STATE_VERSION && typeof input.searchEndpoint === 'string') {
    try {
      searchUrl(input.searchEndpoint);
      state.searchEndpoint = input.searchEndpoint;
    } catch { /* Ignore a damaged endpoint without discarding plugin enablement. */ }
  }
  for (const [pluginId, value] of Object.entries(input.plugins)) {
    if (!PLUGIN_ID_RE.test(pluginId)) continue;
    if (!value || typeof value !== 'object') continue;
    state.plugins[pluginId] = {
      enabled: value.enabled === true,
      grantedPermissions: Array.isArray(value.grantedPermissions)
        ? value.grantedPermissions.filter((permission) => typeof permission === 'string')
        : [],
      ...(value.lastError && typeof value.lastError === 'object'
        ? {
            lastError: {
              code: typeof value.lastError.code === 'string' ? value.lastError.code : 'PLUGIN_ERROR',
              message: typeof value.lastError.message === 'string' ? value.lastError.message : 'Plugin failed',
              at: typeof value.lastError.at === 'string' ? value.lastError.at : new Date(0).toISOString(),
            },
          }
        : {}),
    };
  }
  return state;
}

function createPluginStateStore(statePath, {
  fileSystem = fs,
  platform = process.platform,
  wait = milliseconds => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds),
} = {}) {
  if (typeof statePath !== 'string' || statePath.trim() === '') {
    throw new TypeError('statePath must be a non-empty string');
  }
  const resolvedPath = path.resolve(statePath);

  return {
    load() {
      try {
        return normalizeState(JSON.parse(fileSystem.readFileSync(resolvedPath, 'utf8')));
      } catch {
        return emptyState();
      }
    },
    save(state) {
      const normalized = normalizeState(state);
      fileSystem.mkdirSync(path.dirname(resolvedPath), { recursive: true });
      writeFileAtomicSync(resolvedPath, `${JSON.stringify(normalized, null, 2)}\n`, { fileSystem, platform, wait });
    },
  };
}

module.exports = { STATE_VERSION, createPluginStateStore, emptyState, normalizeState };
