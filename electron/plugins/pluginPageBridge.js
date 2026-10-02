'use strict';

const { protocolError } = require('./pluginProtocol');

const METHODS = {
  'repositories.search': { capability: 'github', operation: 'searchRepositories', fields: ['query', 'limit'] },
  'repositories.get': { capability: 'github', operation: 'getRepository', fields: ['repositoryId'] },
  'releases.get': { capability: 'github', operation: 'getRelease', fields: ['releaseId'] },
  'storage.get': { capability: 'storage', operation: 'get', fields: ['key'] },
  'storage.set': { capability: 'storage', operation: 'set', fields: ['key', 'value'] },
  'storage.delete': { capability: 'storage', operation: 'delete', fields: ['key'] },
  'ai.generate': { capability: 'ai', operation: 'generate', fields: ['system', 'user', 'maxTokens'] },
  'web.search': { capability: 'web', operation: 'search', fields: ['query', 'limit'] },
  'clipboard.write': { capability: 'clipboard', operation: 'write', fields: ['text'] },
  'clipboard.writeImage': { capability: 'clipboard', operation: 'writeImage', fields: ['dataBase64'] },
  'downloads.saveFile': { capability: 'downloads', operation: 'saveFile', fields: ['fileName', 'dataBase64'] },
  'page.close': { capability: 'page', operation: 'close', fields: [] },
};

function argsBudget(method) {
  return method === 'clipboard.writeImage' || method === 'downloads.saveFile'
    ? 10 * 1024 * 1024 : 1024 * 1024;
}

function decodeBinary(dataBase64) {
  if (typeof dataBase64 !== 'string' || !dataBase64 || dataBase64.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(dataBase64)) {
    throw protocolError('PLUGIN_PAGE_REQUEST_INVALID', 'Base64 payload is invalid');
  }
  const buffer = Buffer.from(dataBase64, 'base64');
  if (!buffer.length || buffer.toString('base64') !== dataBase64) {
    throw protocolError('PLUGIN_PAGE_REQUEST_INVALID', 'Base64 payload is invalid');
  }
  return buffer;
}

function validateFileName(fileName) {
  if (typeof fileName !== 'string' || !fileName.trim() || fileName.length > 200 ||
    fileName !== fileName.trim() || /[\x00-\x1f\x7f<>:"/\\|?*]/.test(fileName) ||
    fileName.startsWith('.') || /[. ]$/.test(fileName) ||
    /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(fileName)) {
    throw protocolError('PLUGIN_PAGE_REQUEST_INVALID', 'Download file name is invalid');
  }
  return fileName;
}

function validatePageCapabilityRequest(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
    Object.keys(input).some((field) => !['pluginId', 'pageId', 'method', 'args', 'sessionToken', 'requestId'].includes(field))) {
    throw protocolError('PLUGIN_PAGE_REQUEST_INVALID', 'Page request is invalid');
  }
  const { pluginId, pageId, method, args = {} } = input;
  if (typeof pluginId !== 'string' || typeof pageId !== 'string' || typeof method !== 'string' ||
    !Object.hasOwn(METHODS, method) || !args || typeof args !== 'object' || Array.isArray(args)) {
    throw protocolError('PLUGIN_PAGE_REQUEST_INVALID', 'Page request is invalid');
  }
  const definition = METHODS[method];
  if (Object.keys(args).some((field) => !definition.fields.includes(field))) {
    throw protocolError('PLUGIN_PAGE_REQUEST_INVALID', 'Page request has unknown arguments');
  }
  let size;
  try { size = Buffer.byteLength(JSON.stringify(args), 'utf8'); } catch {
    throw protocolError('PLUGIN_PAGE_REQUEST_INVALID', 'Page arguments must be JSON serializable');
  }
  if (size > argsBudget(method)) {
    throw protocolError('PLUGIN_PAGE_REQUEST_TOO_LARGE', 'Page request is too large');
  }
  if (method === 'repositories.search' &&
    (typeof args.query !== 'string' || args.query.length > 200 ||
      (args.limit !== undefined && (!Number.isInteger(args.limit) || args.limit < 1 || args.limit > 100)))) {
    throw protocolError('PLUGIN_PAGE_REQUEST_INVALID', 'Repository search arguments are invalid');
  }
  if (method === 'repositories.get' && (!Number.isSafeInteger(args.repositoryId) || args.repositoryId <= 0)) {
    throw protocolError('PLUGIN_PAGE_REQUEST_INVALID', 'Repository id is invalid');
  }
  if (method === 'releases.get' && (!Number.isSafeInteger(args.releaseId) || args.releaseId <= 0)) {
    throw protocolError('PLUGIN_PAGE_REQUEST_INVALID', 'Release id is invalid');
  }
  if (method.startsWith('storage.') && (typeof args.key !== 'string' || !args.key)) {
    throw protocolError('PLUGIN_PAGE_REQUEST_INVALID', 'Storage key is invalid');
  }
  if (method === 'ai.generate' &&
    (typeof args.system !== 'string' || args.system.length > 2000 ||
      typeof args.user !== 'string' || !args.user.trim() || args.user.length > 160_000 ||
      (args.maxTokens !== undefined && (!Number.isInteger(args.maxTokens) || args.maxTokens < 1 || args.maxTokens > 4000)))) {
    throw protocolError('PLUGIN_PAGE_REQUEST_INVALID', 'AI request arguments are invalid');
  }
  if (method === 'web.search' &&
    (typeof args.query !== 'string' || !args.query.trim() || args.query.length > 200 ||
      (args.limit !== undefined && (!Number.isInteger(args.limit) || args.limit < 1 || args.limit > 10)))) {
    throw protocolError('PLUGIN_PAGE_REQUEST_INVALID', 'Web search arguments are invalid');
  }
  if (method === 'clipboard.write' && (typeof args.text !== 'string' || !args.text || args.text.length > 200_000)) {
    throw protocolError('PLUGIN_PAGE_REQUEST_INVALID', 'Clipboard text is invalid');
  }
  if (method === 'clipboard.writeImage' || method === 'downloads.saveFile') decodeBinary(args.dataBase64);
  if (method === 'downloads.saveFile') validateFileName(args.fileName);
  return { pluginId, pageId, capability: definition.capability, operation: definition.operation, args };
}

module.exports = { validatePageCapabilityRequest, argsBudget, decodeBinary, validateFileName };
