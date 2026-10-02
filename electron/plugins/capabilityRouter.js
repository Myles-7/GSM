'use strict';

const { protocolError } = require('./pluginProtocol');
const { decodeBinary, validateFileName, argsBudget } = require('./pluginPageBridge');

function createCapabilityRouter({ storage, logger, catalog, hostOperations = null }) {
  return {
    async handle(permissions, request) {
      if (!request || typeof request !== 'object' || typeof request.capability !== 'string') {
        throw protocolError('PLUGIN_CAPABILITY_REQUEST_INVALID', 'Capability request is invalid');
      }
      if (request.capability === 'log') {
        logger.log(request.operation, request.args?.message, request.args?.metadata);
        return null;
      }
      if (request.capability === 'clipboard' || request.capability === 'downloads') {
        const permission = request.capability === 'clipboard' ? 'clipboard:write' : 'downloads:create';
        if (!permissions.includes(permission)) {
          throw protocolError('PLUGIN_PERMISSION_DENIED', `Permission '${permission}' is required`);
        }
        const operation = request.capability === 'clipboard'
          ? ({ write: 'clipboardWrite', writeImage: 'clipboardWriteImage' })[request.operation]
          : request.operation === 'saveFile' ? 'saveFile' : null;
        if (!operation) throw protocolError('PLUGIN_CAPABILITY_UNKNOWN', 'Unknown output operation');
        if (typeof hostOperations?.[operation] !== 'function') {
          throw protocolError('PLUGIN_CAPABILITY_UNAVAILABLE', 'System output is unavailable for this caller');
        }
        const args = request.args || {};
        if (Buffer.byteLength(JSON.stringify(args), 'utf8') > argsBudget(`${request.capability}.${request.operation}`)) {
          throw protocolError('PLUGIN_PAGE_REQUEST_TOO_LARGE', 'Output arguments are too large');
        }
        if (operation === 'clipboardWrite') {
          if (typeof args.text !== 'string' || !args.text || args.text.length > 200_000) {
            throw protocolError('PLUGIN_PAGE_REQUEST_INVALID', 'Clipboard text is invalid');
          }
          return hostOperations.clipboardWrite({ text: args.text });
        }
        const buffer = decodeBinary(args.dataBase64);
        return hostOperations[operation]({ buffer,
          ...(operation === 'saveFile' ? { fileName: validateFileName(args.fileName) } : {}),
        });
      }
      if (request.capability === 'ai') {
        if (request.operation !== 'generate') {
          throw protocolError('PLUGIN_CAPABILITY_UNKNOWN', `Unknown AI operation '${request.operation}'`);
        }
        if (!permissions.includes('ai:invoke')) {
          throw protocolError('PLUGIN_PERMISSION_DENIED', "Permission 'ai:invoke' is required");
        }
        // The renderer owns AI configuration; this checks authorization only.
        return null;
      }
      if (request.capability === 'web') {
        if (request.operation !== 'search') {
          throw protocolError('PLUGIN_CAPABILITY_UNKNOWN', `Unknown web operation '${request.operation}'`);
        }
        if (!permissions.includes('web:search')) {
          throw protocolError('PLUGIN_PERMISSION_DENIED', "Permission 'web:search' is required");
        }
        // The user-configured search endpoint is contacted only after confirmation.
        return null;
      }
      if (request.capability === 'github') {
        if (request.operation === 'getRelease') {
          if (!permissions.includes('releases:read')) {
            throw protocolError('PLUGIN_PERMISSION_DENIED', "Permission 'releases:read' is required");
          }
          return catalog.getRelease(request.args?.releaseId);
        }
        if (!permissions.includes('repositories:read') && !permissions.includes('privateRepositories:read')) {
          throw protocolError('PLUGIN_PERMISSION_DENIED', "Permission 'repositories:read' is required");
        }
        if (request.operation === 'getRepository') return catalog.getRepository(request.args?.repositoryId);
        if (request.operation === 'searchRepositories') {
          return catalog.searchRepositories(request.args?.query, request.args?.limit);
        }
        throw protocolError('PLUGIN_CAPABILITY_UNKNOWN', `Unknown GitHub operation '${request.operation}'`);
      }
      if (request.capability !== 'storage') {
        throw protocolError('PLUGIN_CAPABILITY_UNKNOWN', `Unknown capability '${request.capability}'`);
      }
      if (!permissions.includes('storage')) {
        throw protocolError('PLUGIN_PERMISSION_DENIED', "Permission 'storage' is required");
      }
      if (request.operation === 'get') return storage.get(request.args?.key);
      if (request.operation === 'set') {
        storage.set(request.args?.key, request.args?.value);
        return null;
      }
      if (request.operation === 'delete') return storage.delete(request.args?.key);
      throw protocolError('PLUGIN_CAPABILITY_UNKNOWN', `Unknown storage operation '${request.operation}'`);
    },
  };
}

module.exports = { createCapabilityRouter };
