import { useCallback } from 'react';
import { useAppStore } from '../store/useAppStore';
import { pluginClient } from './pluginClient';
import { resolvePluginAccountTag } from './pluginAccountTag';
import { buildNetworkRequestUrl, isAllowedNetworkTarget } from './networkTargets';
import type { PluginPageCapabilitySession } from './types';

type Result = { success: true; value: { status: number; body: unknown; acct: string } } |
  { success: false; error: { code: string; message: string } };
const failure = (code: string, message: string): Result => ({ success: false, error: { code, message } });

export async function readNetworkBody(response: Response, limit: number, signal: AbortSignal): Promise<string> {
  if (Number(response.headers.get('content-length')) > limit) {
    void response.body?.cancel().catch(() => {});
    throw new RangeError('Network response exceeds limit');
  }
  if (!response.body) return '';
  const reader = response.body.getReader();
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', abort, { once: true });
  let size = 0;
  const decoder = new TextDecoder();
  let text = '';
  try {
    for (;;) {
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
      const { value, done } = await reader.read();
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
      if (done) return text + decoder.decode();
      size += value.byteLength;
      if (size > limit) { abort(); throw new RangeError('Network response exceeds limit'); }
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    signal.removeEventListener('abort', abort);
    reader.releaseLock();
  }
}

export async function requestPluginNetwork(
  session: PluginPageCapabilitySession, args: Record<string, unknown>,
  isCurrent: () => boolean, externalSignal: AbortSignal,
): Promise<Result> {
  if (!isAllowedNetworkTarget(args)) return failure('PLUGIN_PAGE_REQUEST_INVALID', 'Network request arguments are invalid');
  const initial = useAppStore.getState();
  const controller = new AbortController();
  let accountRevoked = false;
  const abort = () => controller.abort();
  externalSignal.addEventListener('abort', abort, { once: true });
  if (externalSignal.aborted) abort();
  const off = useAppStore.subscribe((next) => {
    if (next.user?.id !== initial.user?.id || next.githubToken !== initial.githubToken) { accountRevoked = true; abort(); }
  });
  const current = () => !controller.signal.aborted && isCurrent() &&
    useAppStore.getState().githubToken === initial.githubToken && useAppStore.getState().user?.id === initial.user?.id;
  let ticket: string | undefined;
  let completed = false;
  const finish = () => pluginClient.requestPageCapability({ ...session, method: 'network.request', args, networkTicket: ticket });
  const timer = setTimeout(abort, 15_000);
  try {
    if (!current()) return failure('PLUGIN_PAGE_CLOSED', 'Plugin page closed');
    const authorization = await pluginClient.requestPageCapability({ ...session, method: 'network.request', args });
    if (!authorization.success) return authorization;
    ticket = (authorization.value as { networkTicket?: string } | null)?.networkTicket;
    if (!ticket) return failure('PLUGIN_PAGE_CLOSED', 'Network authorization missing');
    if (!current()) return failure('PLUGIN_PAGE_CLOSED', 'Plugin page closed');
    const response = await fetch(buildNetworkRequestUrl(args), {
      method: 'GET', redirect: 'error', credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer',
      signal: controller.signal,
      headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28',
        ...(initial.githubToken ? { Authorization: `Bearer ${initial.githubToken}` } : {}) },
    });
    let body: unknown = null;
    if (response.status === 202 || response.status === 204) await response.body?.cancel();
    else {
      const text = await readNetworkBody(response, response.ok ? 4 * 1024 * 1024 : 64 * 1024, controller.signal);
      if (response.ok) {
        try { body = text ? JSON.parse(text) : null; }
        catch { return failure('PLUGIN_NETWORK_RESPONSE_INVALID', 'Network response is not valid JSON'); }
      }
    }
    const acct = await resolvePluginAccountTag(initial.githubToken ?? null);
    if (!current()) return failure('PLUGIN_PAGE_CLOSED', 'Plugin page closed');
    const verified = await finish();
    completed = true;
    if (!verified.success) return verified;
    if (!current()) return failure('PLUGIN_PAGE_CLOSED', 'Plugin page closed');
    if (!response.ok) return failure('PLUGIN_NETWORK_HTTP_ERROR', `GitHub API returned ${response.status}`);
    return { success: true, value: { status: response.status, body, acct } };
  } catch (error) {
    if (!isCurrent() || externalSignal.aborted || accountRevoked || useAppStore.getState().githubToken !== initial.githubToken) {
      return failure('PLUGIN_PAGE_CLOSED', 'Plugin page closed');
    }
    return failure(error instanceof RangeError ? 'PLUGIN_NETWORK_RESPONSE_TOO_LARGE' : controller.signal.aborted ? 'PLUGIN_NETWORK_TIMEOUT' : 'PLUGIN_NETWORK_FAILED',
      'Network request failed');
  } finally {
    clearTimeout(timer); off(); externalSignal.removeEventListener('abort', abort);
    if (ticket && !completed) await finish().catch(() => {});
  }
}

export function usePluginNetwork() { return useCallback(requestPluginNetwork, []); }
