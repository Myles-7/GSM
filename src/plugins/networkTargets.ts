import policy from '../../electron/plugins/networkPolicy.json';
const ownerRE = new RegExp(policy.ownerPattern);
const repoRE = new RegExp(policy.repoPattern);
export interface PluginNetworkRequestArgs { host: string; path: string; query?: Record<string, unknown> }
export function isAllowedNetworkTarget(input: unknown): input is PluginNetworkRequestArgs {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return false;
  const args = input as Record<string, unknown>;
  if (Object.keys(args).some(k => !['host', 'path', 'query'].includes(k)) ||
    typeof args.host !== 'string' || !policy.hosts.includes(args.host) ||
    typeof args.path !== 'string' || args.path.length > 500) return false;
  const parts = args.path.split('/');
  if (parts.some(p => p === '.' || p === '..')) return false;
  const validPath = parts[0] === '' && (
    (parts[1] === 'users' && parts.length === 3 && ownerRE.test(parts[2])) ||
    (parts[1] === 'repos' && parts.length >= 4 && ownerRE.test(parts[2]) && repoRE.test(parts[3]) &&
      policy.repoTails.includes(parts.slice(4).join('/')) && !args.path.endsWith('/')));
  if (!validPath) return false;
  if (args.query === undefined) return true;
  if (!args.query || typeof args.query !== 'object' || Array.isArray(args.query)) return false;
  return Object.entries(args.query).every(([key, value]) =>
    ['page', 'per_page'].includes(key) ? typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 100 :
      key === 'state' && parts.slice(4).join('/') === 'pulls' && ['open', 'closed', 'all'].includes(value as string));
}
export function buildNetworkRequestUrl(args: PluginNetworkRequestArgs): string {
  if (!isAllowedNetworkTarget(args)) throw new Error('Invalid network target');
  const url = new URL(`https://${args.host}${args.path}`);
  for (const [key, value] of Object.entries(args.query ?? {})) url.searchParams.set(key, String(value));
  return url.toString();
}
