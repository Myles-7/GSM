import { normalizeBackendUrl } from '../utils/backendUrl';
import type { Capabilities } from './types';

export class HomeApiError extends Error {
  constructor(public status: number, public code: string, message: string, public body?: unknown) { super(message); }
}
export class HomeApi {
  readonly url: string;
  constructor(url: string, private readonly getSecret: () => string | Promise<string>) {
    const normalized = normalizeBackendUrl(url);
    if (!normalized) throw new Error('远程后端必须使用 HTTPS 地址');
    this.url = normalized;
  }
  async request<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
    const response = await this.response(path, body, signal);
    return response.status === 204 ? undefined as T : response.json() as Promise<T>;
  }
  async response(path: string, body?: unknown, signal?: AbortSignal): Promise<Response> {
    const secret = await this.getSecret();
    if (!secret) throw new HomeApiError(401, 'UNAUTHORIZED', '请重新输入后端访问密钥');
    const response = await fetch(`${this.url}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: signal ?? AbortSignal.timeout(30_000),
      redirect: 'error',
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({})) as { code?: string; error?: string };
      throw new HomeApiError(response.status, data.code ?? 'REQUEST_FAILED', data.error ?? `请求失败 (${response.status})`, data);
    }
    return response;
  }
  capabilities(): Promise<Capabilities> { return this.request('/capabilities'); }
}
