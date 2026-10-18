import descriptor from '../../electron/plugins/permissionPolicy.json';
const hostRE = new RegExp(descriptor.hostPattern);
export function parsePermission(value: string): { permission: string; kind: 'host' | 'network'; host?: string } | null {
  if (descriptor.basePermissions.includes(value)) return { permission: value, kind: 'host' };
  if (value.startsWith('network:') && hostRE.test(value.slice(8))) {
    return { permission: value, kind: 'network', host: value.slice(8) };
  }
  return null;
}
