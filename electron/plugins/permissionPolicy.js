'use strict';
const descriptor = require('./permissionPolicy.json');
const BASE_PERMISSIONS = new Set(descriptor.basePermissions);
const hostRE = new RegExp(descriptor.hostPattern);
const isNetworkHost = host => typeof host === 'string' && hostRE.test(host);
function parsePermission(value) {
  if (typeof value !== 'string') return null;
  if (BASE_PERMISSIONS.has(value)) return { permission: value, kind: 'host' };
  if (value.startsWith('network:') && isNetworkHost(value.slice(8))) {
    return { permission: value, kind: 'network', host: value.slice(8) };
  }
  return null;
}
const validatePermission = value => parsePermission(value) !== null;
module.exports = { BASE_PERMISSIONS, isNetworkHost, parsePermission, validatePermission };
